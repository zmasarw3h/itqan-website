-- Read-only rotation-publication integrity audit.
--
-- Run against a production-shaped copy before the Slice 5 migration and after
-- deployment validation. It returns IDs only: never names, emails, or phones.
-- `group_teacher_assignments` has no independent cohort column: its group is
-- the canonical cohort relationship, so an assignment cannot be represented
-- as belonging to a different cohort. The equivalent reportable condition is
-- an active assignment targeting a group that is no longer active; assignments
-- without a matching cohort/week run are reported separately below.

with runtime as (
  select public.week_start_for_date(public.current_toronto_civil_date()) as current_week_start
), assignment_scope as (
  select
    assignments.id as assignment_id,
    assignments.group_id,
    assignments.teacher_id,
    assignments.week_start,
    assignments.active,
    groups.cohort_id,
    cohorts.masjid_id,
    public.halaqa_saturday_for_week(assignments.week_start) as halaqa_saturday,
    case
      when assignments.week_start >= runtime.current_week_start then 'current_or_future'
      else 'historical'
    end as temporal_scope
  from public.group_teacher_assignments as assignments
  join public.halaqa_groups as groups on groups.id = assignments.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  cross join runtime
), findings as (
  select
    'assignment_missing_exact_availability'::text as reason_code,
    assignment_scope.temporal_scope,
    assignment_scope.assignment_id as row_id,
    assignment_scope.cohort_id,
    assignment_scope.group_id,
    assignment_scope.teacher_id,
    assignment_scope.masjid_id,
    assignment_scope.week_start,
    assignment_scope.halaqa_saturday
  from assignment_scope
  left join public.teacher_rotation_availability as availability
    on availability.teacher_id = assignment_scope.teacher_id
    and availability.cohort_id = assignment_scope.cohort_id
    and availability.masjid_id = assignment_scope.masjid_id
    and availability.week_start = assignment_scope.week_start
  where assignment_scope.active
    and availability.id is null

  union all

  select
    'assignment_availability_false',
    assignment_scope.temporal_scope,
    assignment_scope.assignment_id,
    assignment_scope.cohort_id,
    assignment_scope.group_id,
    assignment_scope.teacher_id,
    assignment_scope.masjid_id,
    assignment_scope.week_start,
    assignment_scope.halaqa_saturday
  from assignment_scope
  join public.teacher_rotation_availability as availability
    on availability.teacher_id = assignment_scope.teacher_id
    and availability.cohort_id = assignment_scope.cohort_id
    and availability.masjid_id = assignment_scope.masjid_id
    and availability.week_start = assignment_scope.week_start
  where assignment_scope.active
    and not availability.available

  union all

  select
    'assignment_missing_saturday_eligibility',
    assignment_scope.temporal_scope,
    assignment_scope.assignment_id,
    assignment_scope.cohort_id,
    assignment_scope.group_id,
    assignment_scope.teacher_id,
    assignment_scope.masjid_id,
    assignment_scope.week_start,
    assignment_scope.halaqa_saturday
  from assignment_scope
  where assignment_scope.active
    and case
      when assignment_scope.temporal_scope = 'current_or_future' then
        not private.raw_teacher_has_halaqa_saturday_eligibility(
          assignment_scope.teacher_id,
          assignment_scope.masjid_id,
          assignment_scope.week_start
        )
      else not private.raw_historical_teacher_assignment_is_valid(
        assignment_scope.teacher_id,
        assignment_scope.group_id,
        assignment_scope.week_start
        )
    end

  union all

  select
    'duplicate_active_teacher_within_cohort_week',
    assignment_scope.temporal_scope,
    assignment_scope.assignment_id,
    assignment_scope.cohort_id,
    assignment_scope.group_id,
    assignment_scope.teacher_id,
    assignment_scope.masjid_id,
    assignment_scope.week_start,
    assignment_scope.halaqa_saturday
  from assignment_scope
  join (
    select cohort_id, teacher_id, week_start
    from assignment_scope
    where active
    group by cohort_id, teacher_id, week_start
    having count(*) > 1
  ) as duplicates
    on duplicates.cohort_id = assignment_scope.cohort_id
    and duplicates.teacher_id = assignment_scope.teacher_id
    and duplicates.week_start = assignment_scope.week_start
  where assignment_scope.active

  union all

  select
    'active_assignment_inactive_group',
    assignment_scope.temporal_scope,
    assignment_scope.assignment_id,
    assignment_scope.cohort_id,
    assignment_scope.group_id,
    assignment_scope.teacher_id,
    assignment_scope.masjid_id,
    assignment_scope.week_start,
    assignment_scope.halaqa_saturday
  from assignment_scope
  join public.halaqa_groups as groups on groups.id = assignment_scope.group_id
  where assignment_scope.active
    and not groups.active

  union all

  select
    'availability_teacher_missing_saturday_eligibility',
    case when availability.week_start >= runtime.current_week_start then 'current_or_future' else 'historical' end,
    availability.id,
    availability.cohort_id,
    null::uuid,
    availability.teacher_id,
    availability.masjid_id,
    availability.week_start,
    public.halaqa_saturday_for_week(availability.week_start)
  from public.teacher_rotation_availability as availability
  cross join runtime
  where not private.raw_teacher_has_halaqa_saturday_eligibility(
    availability.teacher_id,
    availability.masjid_id,
    availability.week_start
  )

  union all

  select
    'rotation_run_assigned_count_mismatch',
    case when runs.week_start >= runtime.current_week_start then 'current_or_future' else 'historical' end,
    runs.id,
    runs.cohort_id,
    null::uuid,
    null::uuid,
    coalesce(runs.masjid_id, cohorts.masjid_id),
    runs.week_start,
    coalesce(runs.halaqa_saturday, public.halaqa_saturday_for_week(runs.week_start))
  from public.teacher_rotation_runs as runs
  join public.cohorts on cohorts.id = runs.cohort_id
  cross join runtime
  left join lateral (
    select count(*)::integer as active_assignment_count
    from public.group_teacher_assignments as assignments
    join public.halaqa_groups as groups on groups.id = assignments.group_id
    where groups.cohort_id = runs.cohort_id
      and assignments.week_start = runs.week_start
      and assignments.active
  ) as actual on true
  where runs.assigned_count <> actual.active_assignment_count

  union all

  select
    'multiple_rotation_runs_for_cohort_week',
    case when runs.week_start >= runtime.current_week_start then 'current_or_future' else 'historical' end,
    runs.id,
    runs.cohort_id,
    null::uuid,
    null::uuid,
    coalesce(runs.masjid_id, cohorts.masjid_id),
    runs.week_start,
    coalesce(runs.halaqa_saturday, public.halaqa_saturday_for_week(runs.week_start))
  from public.teacher_rotation_runs as runs
  join public.cohorts on cohorts.id = runs.cohort_id
  cross join runtime
  join (
    select cohort_id, week_start
    from public.teacher_rotation_runs
    group by cohort_id, week_start
    having count(*) > 1
  ) as duplicates
    on duplicates.cohort_id = runs.cohort_id
    and duplicates.week_start = runs.week_start

  union all

  select
    'assignment_without_rotation_run',
    assignment_scope.temporal_scope,
    assignment_scope.assignment_id,
    assignment_scope.cohort_id,
    assignment_scope.group_id,
    assignment_scope.teacher_id,
    assignment_scope.masjid_id,
    assignment_scope.week_start,
    assignment_scope.halaqa_saturday
  from assignment_scope
  where assignment_scope.active
    and not exists (
      select 1
      from public.teacher_rotation_runs as runs
      where runs.cohort_id = assignment_scope.cohort_id
        and runs.week_start = assignment_scope.week_start
    )

  union all

  select
    'rotation_run_without_active_assignment',
    case when runs.week_start >= runtime.current_week_start then 'current_or_future' else 'historical' end,
    runs.id,
    runs.cohort_id,
    null::uuid,
    null::uuid,
    coalesce(runs.masjid_id, cohorts.masjid_id),
    runs.week_start,
    coalesce(runs.halaqa_saturday, public.halaqa_saturday_for_week(runs.week_start))
  from public.teacher_rotation_runs as runs
  join public.cohorts on cohorts.id = runs.cohort_id
  cross join runtime
  where runs.assigned_count > 0
    and not exists (
      select 1
      from public.group_teacher_assignments as assignments
      join public.halaqa_groups as groups on groups.id = assignments.group_id
      where groups.cohort_id = runs.cohort_id
        and assignments.week_start = runs.week_start
        and assignments.active
    )
)
select
  reason_code,
  temporal_scope,
  row_id,
  cohort_id,
  group_id,
  teacher_id,
  masjid_id,
  week_start,
  halaqa_saturday
from findings
order by temporal_scope, reason_code, week_start, cohort_id, group_id, teacher_id, row_id;
