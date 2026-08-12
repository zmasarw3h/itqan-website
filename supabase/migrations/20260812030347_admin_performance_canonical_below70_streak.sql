-- Consolidate below-70 streak calculation behind one set-based primitive.
-- The prior admin-performance migration introduced the same calculation for
-- the dashboard while the reset/read path still used its older single-student
-- loop. This forward migration keeps the public APIs unchanged and makes both
-- paths delegate to the canonical set-based implementation below.

create or replace function private.raw_below70_streaks_for_students(
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

-- The existing batch helper remains available to the dashboard, but it now
-- delegates to the shared primitive rather than owning a second algorithm.
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
  select streaks.student_id,
         streaks.active_streak_length
  from private.raw_below70_streaks_for_students(
    input_student_ids,
    input_through_week_start
  ) as streaks;
$$;

-- The reset command and the public single-student read retain their existing
-- signatures, but now consume the same set-based calculation as the batch
-- dashboard path.
create or replace function private.raw_below70_streak(
  input_student_id uuid,
  input_through_week_start date
)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select streaks.active_streak_length
      from private.raw_below70_streaks_for_students(
        array[input_student_id],
        input_through_week_start
      ) as streaks
      where streaks.student_id = input_student_id
    ),
    0
  )::integer;
$$;

revoke all on function private.raw_below70_streaks_for_students(uuid[], date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_admin_below70_streaks_for_students(uuid[], date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_below70_streak(uuid, date)
  from public, anon, authenticated, service_role;

comment on function private.raw_below70_streaks_for_students(uuid[], date) is
  'Canonical set-based below-70 streak calculation shared by reset/read and admin dashboard paths.';

-- No SECURITY DEFINER inventory change is required: this helper is a
-- SECURITY INVOKER private primitive, and its existing callers remain in the
-- reviewed inventory unchanged.
