-- Add authoritative selected-week checklist activity counts to the existing
-- bounded dashboard aggregate. The due-day rule mirrors the admin student
-- workspace: dates before the configured Toronto effective date are due, the
-- effective current date is due only after a scoped check-in exists, and
-- future dates are upcoming. A check-in row is submitted activity even when
-- its stored daily score is zero.

create or replace function public.admin_dashboard_leaderboard_for_week(
  input_selected_week_start date,
  input_below70_only boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  actor_active boolean;
  current_week_start date := public.week_start_for_date(public.current_effective_date());
  result jsonb;
begin
  select profiles.role, profiles.active
  into actor_role, actor_active
  from public.profiles
  where profiles.id = actor_id;

  if actor_id is null
    or not coalesce(actor_active, false)
    or actor_role not in ('admin', 'super_admin') then
    raise exception using errcode = '42501', message = 'Administrative dashboard access is required.';
  end if;

  if input_selected_week_start is null
    or input_selected_week_start <> public.week_start_for_date(input_selected_week_start)
    or input_selected_week_start > current_week_start then
    raise exception using errcode = '22023', message = 'A current or historical tracker week is required.';
  end if;

  if input_selected_week_start <> current_week_start
    and not exists (
      select 1
      from private.raw_historical_report_week_scopes() as scopes
      where scopes.week_start = input_selected_week_start
        and (
          actor_role = 'super_admin'
          or private.raw_is_admin_for_masjid(
            actor_id,
            scopes.masjid_id,
            public.current_toronto_civil_date()
          )
        )
    ) then
    raise exception using errcode = '22023', message = 'Requested dashboard week is not available.';
  end if;

  with report_scopes as materialized (
    select distinct scopes.week_start, scopes.masjid_id, scopes.cohort_id
    from private.raw_historical_report_week_scopes() as scopes
    where scopes.week_start <= current_week_start
      and (
        actor_role = 'super_admin'
        or private.raw_is_admin_for_masjid(
          actor_id,
          scopes.masjid_id,
          public.current_toronto_civil_date()
        )
      )
  ),
  requested_weeks as (
    select input_selected_week_start as week_start
    where exists (
      select 1
      from report_scopes
      where report_scopes.week_start = input_selected_week_start
    )
  ),
  population as (
    select requested.week_start,
           memberships.student_id,
           memberships.starts_on as membership_starts_on,
           memberships.ends_on as membership_ends_on,
           profiles.name as student_name,
           profiles.email as student_email,
           profiles.phone as student_phone,
           profiles.score_starts_on,
           groups.id as group_id,
           groups.name as group_name,
           cohorts.id as cohort_id,
           cohorts.kind as cohort_kind,
           cohorts.name as cohort_name,
           masajid.id as masjid_id,
           masajid.name as masjid_name,
           visibility.allowed as contact_allowed
    from requested_weeks as requested
    join public.student_group_memberships as memberships
      on memberships.starts_on <= requested.week_start
     and (memberships.ends_on is null or memberships.ends_on >= requested.week_start)
    join public.halaqa_groups as groups on groups.id = memberships.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
    join public.masajid on masajid.id = cohorts.masjid_id
    join public.profiles on profiles.id = memberships.student_id
    cross join lateral (
      select actor_id = profiles.id
        or private.raw_can_open_current_student_profile(actor_id, profiles.id) as allowed
    ) as visibility
    where actor_role = 'super_admin'
      or private.raw_is_admin_for_masjid(
        actor_id,
        cohorts.masjid_id,
        public.current_toronto_civil_date()
      )
  ),
  selected_population as (
    select population.*,
           population.score_starts_on is not null
             and population.score_starts_on <= input_selected_week_start as scoring_eligible
    from population
    where population.week_start = input_selected_week_start
      and population.score_starts_on is not null
      and population.score_starts_on <= input_selected_week_start
  ),
  selected_students as (
    select distinct selected.student_id
    from selected_population as selected
  ),
  selected_activity as (
    select 'checkin'::text as activity_kind,
           checkins.id as row_id,
           checkins.student_id,
           checkins.date as activity_date,
           checkins.daily_score::numeric as daily_score,
           null::text as recitation_round,
           null::numeric as partner_points,
           null::numeric as attendance_points,
           null::numeric as recitation_points
    from public.checkins
    join selected_students as students on students.student_id = checkins.student_id
    where checkins.date between input_selected_week_start and input_selected_week_start + 6
      and private.raw_historical_report_activity_is_attributable(
        checkins.student_id,
        input_selected_week_start,
        checkins.masjid_id,
        checkins.cohort_id,
        checkins.halaqa_group_id
      )
    union all
    select 'partner_recitation',
           recitations.id,
           recitations.student_id,
           recitations.week_start,
           null::numeric,
           recitations.round::text,
           recitations.points::numeric,
           null::numeric,
           null::numeric
    from public.partner_recitations as recitations
    join selected_students as students on students.student_id = recitations.student_id
    where recitations.week_start = input_selected_week_start
      and private.raw_historical_report_activity_is_attributable(
        recitations.student_id,
        input_selected_week_start,
        recitations.masjid_id,
        recitations.cohort_id,
        recitations.halaqa_group_id
      )
    union all
    select 'halaqa_grade',
           grades.id,
           grades.student_id,
           grades.week_start,
           null::numeric,
           null::text,
           null::numeric,
           grades.attendance_points::numeric,
           grades.recitation_points::numeric
    from public.halaqa_grades as grades
    join selected_students as students on students.student_id = grades.student_id
    where grades.week_start = input_selected_week_start
      and private.raw_historical_report_activity_is_attributable(
        grades.student_id,
        input_selected_week_start,
        grades.masjid_id,
        grades.cohort_id,
        grades.halaqa_group_id
      )
  ),
  daily_by_date as (
    select activity.student_id,
           activity.activity_date,
           activity.daily_score,
           row_number() over (
             partition by activity.student_id, activity.activity_date
             order by activity.row_id desc
           ) as row_number
    from selected_activity as activity
    where activity.activity_kind = 'checkin'
  ),
  daily_activity_counts as (
    select students.student_id,
           count(*)::integer as due_days,
           count(daily.activity_date)::integer as submitted_days
    from selected_students as students
    cross join lateral generate_series(
      input_selected_week_start::timestamp,
      (input_selected_week_start + 6)::timestamp,
      interval '1 day'
    ) as dates(activity_timestamp)
    cross join (
      select public.current_effective_date() as effective_date
    ) as clock
    left join daily_by_date as daily
      on daily.student_id = students.student_id
     and daily.activity_date = dates.activity_timestamp::date
     and daily.row_number = 1
    where dates.activity_timestamp::date < clock.effective_date
      or (
        dates.activity_timestamp::date = clock.effective_date
        and daily.activity_date is not null
      )
    group by students.student_id
  ),
  daily_totals as (
    select daily_by_date.student_id,
           sum(daily_by_date.daily_score) filter (where daily_by_date.row_number = 1) as daily_points
    from daily_by_date
    group by daily_by_date.student_id
  ),
  partner_by_round as (
    select activity.student_id,
           activity.recitation_round,
           max(least(75::numeric, greatest(0::numeric, activity.partner_points))) as round_points
    from selected_activity as activity
    where activity.activity_kind = 'partner_recitation'
    group by activity.student_id, activity.recitation_round
  ),
  partner_totals as (
    select partner_by_round.student_id,
           sum(partner_by_round.round_points) as partner_points
    from partner_by_round
    group by partner_by_round.student_id
  ),
  grade_rows as (
    select activity.student_id,
           activity.attendance_points,
           activity.recitation_points,
           row_number() over (
             partition by activity.student_id
             order by activity.row_id desc
           ) as row_number
    from selected_activity as activity
    where activity.activity_kind = 'halaqa_grade'
  ),
  score_values as (
    select students.student_id,
           students.student_name,
           students.student_email,
           students.student_phone,
           students.masjid_name,
           students.cohort_name,
           students.group_name,
           students.contact_allowed,
           students.score_starts_on,
           round(least(700::numeric, greatest(0::numeric, coalesce(daily.daily_points, 0))), 2) as daily_points,
           round(least(150::numeric, greatest(0::numeric, coalesce(partner.partner_points, 0))), 2) as partner_points,
           round(
             least(
               150::numeric,
               greatest(0::numeric, coalesce(grade.attendance_points + grade.recitation_points, 0))
             ),
             2
           ) as halaqa_points,
           coalesce(activity_counts.due_days, 0)::integer as due_days,
           coalesce(activity_counts.submitted_days, 0)::integer as submitted_days
    from selected_population as students
    left join daily_totals as daily on daily.student_id = students.student_id
    left join partner_totals as partner on partner.student_id = students.student_id
    left join grade_rows as grade
      on grade.student_id = students.student_id
     and grade.row_number = 1
    left join daily_activity_counts as activity_counts
      on activity_counts.student_id = students.student_id
  ),
  scores_with_total as (
    select score_values.*,
           round(
             score_values.daily_points
             + score_values.partner_points
             + score_values.halaqa_points,
             2
           ) as total_points
    from score_values
  ),
  streaks as (
    select streak.student_id, streak.active_streak_length
    from private.raw_admin_below70_streaks_for_students(
      coalesce(
        (select array_agg(distinct selected.student_id) from selected_population as selected),
        array[]::uuid[]
      ),
      case
        when input_selected_week_start + 6 < public.current_effective_date()
          then input_selected_week_start
        else input_selected_week_start - 7
      end
    ) as streak
  ),
  rows_for_page as (
    select scores.student_id,
           scores.student_name,
           case when scores.contact_allowed then scores.student_email end as student_email,
           case when scores.contact_allowed then scores.student_phone end as student_phone,
           scores.masjid_name,
           scores.cohort_name,
           scores.group_name,
           scores.contact_allowed as can_view_current_contact,
           scores.contact_allowed as can_open_current_profile,
           scores.score_starts_on,
           scores.daily_points,
           scores.partner_points,
           scores.halaqa_points,
           scores.total_points,
           round(scores.total_points / 10, 2) as percentage,
           coalesce(streaks.active_streak_length, 0)::integer as below70_streak,
           scores.due_days,
           scores.submitted_days,
           greatest(scores.due_days - scores.submitted_days, 0)::integer as missing_due_days
    from scores_with_total as scores
    left join streaks on streaks.student_id = scores.student_id
    where not input_below70_only
      or round(scores.total_points / 10, 2) < 70
  )
  select jsonb_build_object(
    'selected_week_start', input_selected_week_start,
    'rows', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'student_id', rows_for_page.student_id,
          'student_name', rows_for_page.student_name,
          'student_email', rows_for_page.student_email,
          'student_phone', rows_for_page.student_phone,
          'masjid_name', rows_for_page.masjid_name,
          'cohort_name', rows_for_page.cohort_name,
          'group_name', rows_for_page.group_name,
          'can_view_current_contact', rows_for_page.can_view_current_contact,
          'can_open_current_profile', rows_for_page.can_open_current_profile,
          'score_starts_on', rows_for_page.score_starts_on,
          'daily_points', rows_for_page.daily_points,
          'partner_points', rows_for_page.partner_points,
          'halaqa_points', rows_for_page.halaqa_points,
          'total_points', rows_for_page.total_points,
          'percentage', rows_for_page.percentage,
          'below70_streak', rows_for_page.below70_streak,
          'due_days', rows_for_page.due_days,
          'submitted_days', rows_for_page.submitted_days,
          'missing_due_days', rows_for_page.missing_due_days
        )
        order by rows_for_page.student_name, rows_for_page.student_id
      ),
      '[]'::jsonb
    )
  )
  from rows_for_page
  into result;

  return result;
end;
$$;

comment on function public.admin_dashboard_leaderboard_for_week(date, boolean) is
  'Returns one bounded JSON payload of selected-week score components, authoritative due/submitted/missing checklist days, current contact visibility, and reset-aware below-70 streak lengths.';
