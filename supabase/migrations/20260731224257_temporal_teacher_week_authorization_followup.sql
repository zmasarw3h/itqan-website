-- Follow-up for environments that already applied the temporal authorization
-- migration. Keep private helpers private after an in-place upgrade as well as
-- after a clean install.
revoke all on function private.raw_teacher_has_halaqa_saturday_eligibility(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_historical_teacher_assignment_is_valid(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_has_current_active_teacher_staff_for_masjid(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_historical_student_group_for_week(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_can_view_teacher_assignment_context(uuid, uuid, date)
  from public, anon, authenticated, service_role;

-- A listed upcoming or historical assignment is navigation-only. Never reveal
-- a roster total unless the exact assignment is operationally authorized for
-- the current Toronto civil date.
create or replace function public.teacher_assignment_contexts()
returns table (
  assignment_id uuid,
  group_id uuid,
  group_name text,
  cohort_id uuid,
  cohort_name text,
  cohort_kind text,
  masjid_id uuid,
  masjid_name text,
  week_start date,
  roster_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    assignments.id as assignment_id,
    groups.id as group_id,
    groups.name as group_name,
    cohorts.id as cohort_id,
    cohorts.name as cohort_name,
    cohorts.kind as cohort_kind,
    masajid.id as masjid_id,
    masajid.name as masjid_name,
    assignments.week_start,
    case
      when private.raw_can_teacher_access_assignment(
        (select auth.uid()), assignments.group_id, assignments.week_start
      ) then (
        select count(*)::integer
        from public.student_group_memberships as memberships
        join public.profiles as students on students.id = memberships.student_id
        where memberships.group_id = assignments.group_id
          and memberships.starts_on <= assignments.week_start
          and (memberships.ends_on is null or memberships.ends_on >= assignments.week_start)
          and students.role = 'student'
          and students.active = true
      )
      else null::integer
    end as roster_count
  from public.group_teacher_assignments as assignments
  join public.halaqa_groups as groups on groups.id = assignments.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  where assignments.teacher_id = (select auth.uid())
    and assignments.active = true
    and private.raw_can_view_teacher_assignment_context(
      (select auth.uid()), assignments.group_id, assignments.week_start
    )
  order by assignments.week_start desc, masajid.name, cohorts.sort_order, groups.sort_order, groups.name;
$$;

-- This function is a narrow historical identity projection. Its caller
-- checks are inside the function: a student can request only themselves and
-- a current scoped admin can request only a student historically assigned in
-- that admin's masjid. It intentionally does not authorize any roster, plan,
-- signed-file, or grade operation.
revoke all on function public.student_weekly_teacher(uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.student_weekly_teacher(uuid, date)
  to authenticated, service_role;
