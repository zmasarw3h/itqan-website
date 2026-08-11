-- Bounded admin reporting contracts.
--
-- The historical reporting RPCs remain available for student reporting and
-- compatibility checks. Admin dashboard reads use the contracts below so the
-- browser receives a single bounded week list and a single aggregated payload,
-- rather than raw multi-week activity rows subject to PostgREST paging.

create or replace function private.raw_admin_below70_streaks_for_students(
  input_student_ids uuid[],
  input_through_week_start date
)
returns table (
  student_id uuid,
  active_streak_length integer
)
language sql
stable
set search_path = ''
as $$
  with requested_students as (
    select distinct requested.student_id
    from unnest(coalesce(input_student_ids, array[]::uuid[])) as requested(student_id)
    where requested.student_id is not null
  ),
  student_boundaries as (
    select requested.student_id,
           profiles.score_starts_on,
           (
             select max(resets.effective_through_week_start)
             from public.below70_streak_resets as resets
             where resets.student_id = requested.student_id
               and resets.effective_through_week_start <= input_through_week_start
           ) as reset_boundary
    from requested_students as requested
    join public.profiles on profiles.id = requested.student_id
  ),
  valid_input as (
    select input_through_week_start as through_week_start
    where input_through_week_start is not null
      and input_through_week_start = public.week_start_for_date(input_through_week_start)
      and input_through_week_start + 6 < public.current_effective_date()
  ),
  candidate_weeks as (
    select boundaries.student_id,
           boundaries.score_starts_on,
           boundaries.reset_boundary,
           generated.week_start::date as week_start,
           (row_number() over (
             partition by boundaries.student_id
             order by generated.week_start desc
           ) - 1)::integer as week_index
    from student_boundaries as boundaries
    cross join valid_input
    cross join lateral generate_series(
      valid_input.through_week_start::timestamp,
      date '2026-05-31'::timestamp,
      interval '-7 days'
    ) as generated(week_start)
  ),
  historical_scope_counts as (
    select weeks.student_id,
           weeks.score_starts_on,
           weeks.reset_boundary,
           weeks.week_start,
           weeks.week_index,
           count(cohorts.id)::integer as historical_scope_count
    from candidate_weeks as weeks
    left join public.student_group_memberships as memberships
      on memberships.student_id = weeks.student_id
     and memberships.starts_on <= weeks.week_start
     and (memberships.ends_on is null or memberships.ends_on >= weeks.week_start)
    left join public.halaqa_groups as groups on groups.id = memberships.group_id
    left join public.cohorts on cohorts.id = groups.cohort_id
    group by weeks.student_id,
             weeks.score_starts_on,
             weeks.reset_boundary,
             weeks.week_start,
             weeks.week_index
  ),
  raw_activity as (
    select 'checkin'::text as activity_kind,
           checkins.id as row_id,
           checkins.student_id,
           public.week_start_for_date(checkins.date) as week_start,
           checkins.date as activity_date,
           checkins.daily_score::numeric as daily_score,
           null::numeric as partner_points,
           null::numeric as attendance_points,
           null::numeric as recitation_points,
           null::text as recitation_round
    from public.checkins
    join candidate_weeks as weeks
      on weeks.student_id = checkins.student_id
     and weeks.week_start = public.week_start_for_date(checkins.date)
    where private.raw_historical_report_activity_is_attributable(
      checkins.student_id,
      weeks.week_start,
      checkins.masjid_id,
      checkins.cohort_id,
      checkins.halaqa_group_id
    )
    union all
    select 'partner_recitation',
           recitations.id,
           recitations.student_id,
           recitations.week_start,
           recitations.week_start,
           null::numeric,
           recitations.points::numeric,
           null::numeric,
           null::numeric,
           recitations.round::text
    from public.partner_recitations as recitations
    join candidate_weeks as weeks
      on weeks.student_id = recitations.student_id
     and weeks.week_start = recitations.week_start
    where private.raw_historical_report_activity_is_attributable(
      recitations.student_id,
      weeks.week_start,
      recitations.masjid_id,
      recitations.cohort_id,
      recitations.halaqa_group_id
    )
    union all
    select 'halaqa_grade',
           grades.id,
           grades.student_id,
           grades.week_start,
           grades.week_start,
           null::numeric,
           null::numeric,
           grades.attendance_points::numeric,
           grades.recitation_points::numeric,
           null::text
    from public.halaqa_grades as grades
    join candidate_weeks as weeks
      on weeks.student_id = grades.student_id
     and weeks.week_start = grades.week_start
    where private.raw_historical_report_activity_is_attributable(
      grades.student_id,
      weeks.week_start,
      grades.masjid_id,
      grades.cohort_id,
      grades.halaqa_group_id
    )
  ),
  daily_by_date as (
    select activity.student_id,
           activity.week_start,
           activity.activity_date,
           activity.daily_score,
           row_number() over (
             partition by activity.student_id, activity.week_start, activity.activity_date
             order by activity.row_id desc
           ) as row_number
    from raw_activity as activity
    where activity.activity_kind = 'checkin'
  ),
  daily_totals as (
    select daily_by_date.student_id,
           daily_by_date.week_start,
           sum(daily_by_date.daily_score) filter (where daily_by_date.row_number = 1) as daily_points
    from daily_by_date
    group by daily_by_date.student_id, daily_by_date.week_start
  ),
  partner_totals as (
    select activity.student_id,
           activity.week_start,
           sum(activity.partner_points) as partner_points
    from raw_activity as activity
    where activity.activity_kind = 'partner_recitation'
    group by activity.student_id, activity.week_start
  ),
  grade_rows as (
    select activity.student_id,
           activity.week_start,
           activity.attendance_points,
           activity.recitation_points,
           row_number() over (
             partition by activity.student_id, activity.week_start
             order by activity.row_id desc
           ) as row_number
    from raw_activity as activity
    where activity.activity_kind = 'halaqa_grade'
  ),
  weekly_scores as (
    select scopes.student_id,
           scopes.score_starts_on,
           scopes.reset_boundary,
           scopes.week_start,
           scopes.week_index,
           scopes.historical_scope_count,
           round((
             least(700::numeric, greatest(0::numeric, coalesce(daily.daily_points, 0)))
             + least(150::numeric, greatest(0::numeric, coalesce(partner.partner_points, 0)))
             + least(150::numeric, greatest(0::numeric, coalesce(
                 grade.attendance_points + grade.recitation_points,
                 0
               )))
           ) / 10, 2) as weekly_percentage
    from historical_scope_counts as scopes
    left join daily_totals as daily
      on daily.student_id = scopes.student_id
     and daily.week_start = scopes.week_start
    left join partner_totals as partner
      on partner.student_id = scopes.student_id
     and partner.week_start = scopes.week_start
    left join grade_rows as grade
      on grade.student_id = scopes.student_id
     and grade.week_start = scopes.week_start
     and grade.row_number = 1
  ),
  streak_candidates as (
    select weekly_scores.*,
           (
             weekly_scores.score_starts_on is not null
             and weekly_scores.week_start >= weekly_scores.score_starts_on
             and (
               weekly_scores.reset_boundary is null
               or weekly_scores.week_start > weekly_scores.reset_boundary
             )
             and weekly_scores.historical_scope_count = 1
             and weekly_scores.weekly_percentage is not null
             and weekly_scores.weekly_percentage < 70
           ) as is_below70
    from weekly_scores
  ),
  streak_lengths as (
    select candidates.student_id,
           coalesce(
             min(candidates.week_index) filter (where not candidates.is_below70),
             count(*)::integer
           )::integer as active_streak_length
    from streak_candidates as candidates
    group by candidates.student_id
  )
  select boundaries.student_id,
         coalesce(lengths.active_streak_length, 0)::integer
  from student_boundaries as boundaries
  left join streak_lengths as lengths on lengths.student_id = boundaries.student_id;
$$;

create or replace function public.admin_dashboard_available_weeks()
returns date[]
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

  return array(
    select available.week_start
    from (
      select current_week_start as week_start
      union
      select scopes.week_start
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
    ) as available
    order by available.week_start desc
  );
end;
$$;

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
           ) as halaqa_points
    from selected_population as students
    left join daily_totals as daily on daily.student_id = students.student_id
    left join partner_totals as partner on partner.student_id = students.student_id
    left join grade_rows as grade
      on grade.student_id = students.student_id
     and grade.row_number = 1
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
           coalesce(streaks.active_streak_length, 0)::integer as below70_streak
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
          'below70_streak', rows_for_page.below70_streak
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

create or replace function public.admin_student_available_week_starts(
  input_student_id uuid,
  input_selected_week_start date
)
returns date[]
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
begin
  select profiles.role, profiles.active
  into actor_role, actor_active
  from public.profiles
  where profiles.id = actor_id;

  if actor_id is null
    or not coalesce(actor_active, false)
    or actor_role not in ('admin', 'super_admin') then
    raise exception using errcode = '42501', message = 'Administrative student access is required.';
  end if;

  if input_student_id is null
    or not exists (
      select 1
      from public.profiles as students
      where students.id = input_student_id
        and students.role = 'student'
        and students.active = true
    ) then
    raise exception using errcode = '42501', message = 'An active student target is required.';
  end if;

  if input_selected_week_start is null
    or input_selected_week_start <> public.week_start_for_date(input_selected_week_start)
    or input_selected_week_start > current_week_start then
    raise exception using errcode = '22023', message = 'A current or historical tracker week is required.';
  end if;

  if actor_role <> 'super_admin'
    and not private.raw_is_admin_for_masjid(
      actor_id,
      private.raw_student_masjid_for_week(input_student_id, input_selected_week_start),
      public.current_effective_date()
    ) then
    raise exception using errcode = '42501', message = 'The student is outside the admin scope for this week.';
  end if;

  return array(
    select distinct evidence.week_start
    from (
      select public.week_start_for_date(checkins.date) as week_start
      from public.checkins
      where checkins.student_id = input_student_id
        and public.can_read_operational_student_row(
          checkins.masjid_id,
          checkins.halaqa_group_id,
          public.week_start_for_date(checkins.date)
        )
      union all
      select recitations.week_start
      from public.partner_recitations as recitations
      where recitations.student_id = input_student_id
        and public.can_read_operational_student_row(
          recitations.masjid_id,
          recitations.halaqa_group_id,
          recitations.week_start
        )
      union all
      select grades.week_start
      from public.halaqa_grades as grades
      where grades.student_id = input_student_id
        and public.can_read_operational_student_row(
          grades.masjid_id,
          grades.halaqa_group_id,
          grades.week_start
        )
      union all
      select plans.week_start
      from public.weekly_plans as plans
      where plans.student_id = input_student_id
        and public.can_read_operational_student_row(
          plans.masjid_id,
          plans.halaqa_group_id,
          plans.week_start
        )
    ) as evidence
    where evidence.week_start = public.week_start_for_date(evidence.week_start)
      and evidence.week_start <= current_week_start
    order by evidence.week_start desc
  );
end;
$$;

revoke all on function private.raw_admin_below70_streaks_for_students(uuid[], date)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_dashboard_available_weeks()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_dashboard_leaderboard_for_week(date, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_student_available_week_starts(uuid, date)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_dashboard_available_weeks() to authenticated;
grant execute on function public.admin_dashboard_leaderboard_for_week(date, boolean) to authenticated;
grant execute on function public.admin_student_available_week_starts(uuid, date) to authenticated;

alter function public.admin_dashboard_available_weeks() set search_path = '';
alter function public.admin_dashboard_leaderboard_for_week(date, boolean) set search_path = '';
alter function public.admin_student_available_week_starts(uuid, date) set search_path = '';

comment on function public.admin_dashboard_available_weeks() is
  'Returns one bounded, scope-filtered date array for the admin dashboard; never exposes raw historical rows.';
comment on function public.admin_dashboard_leaderboard_for_week(date, boolean) is
  'Returns one bounded JSON payload of selected-week score components, current contact visibility, and reset-aware below-70 streak lengths.';
comment on function public.admin_student_available_week_starts(uuid, date) is
  'Returns one bounded, distinct date array from the target student''s authorized operational history.';

-- Extend the reviewed SECURITY DEFINER inventory without replacing the
-- complete allowlist established by the prior below-70/privacy migrations.
alter function private.application_security_definer_oids()
  rename to application_security_definer_oids_before_admin_performance;

create or replace function private.application_security_definer_oids()
returns table (function_oid oid)
language sql
stable
set search_path = ''
as $$
  select function_oid
  from private.application_security_definer_oids_before_admin_performance()
  union
  select 'public.admin_dashboard_available_weeks()'::regprocedure::oid
  union
  select 'public.admin_dashboard_leaderboard_for_week(date,boolean)'::regprocedure::oid
  union
  select 'public.admin_student_available_week_starts(uuid,date)'::regprocedure::oid;
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
