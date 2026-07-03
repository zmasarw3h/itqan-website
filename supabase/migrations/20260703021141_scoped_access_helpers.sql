-- Scoped app helpers for the multi-masjid model.
-- These functions expose only the student-facing data that the app needs
-- without opening broad profile or assignment reads through RLS.

create or replace function public.can_read_student_for_week(input_student_id uuid, input_week_start date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
      input_student_id = auth.uid()
      and public.is_active_student()
    )
    or public.is_admin_for_masjid(public.student_masjid_for_week(input_student_id, input_week_start))
    or public.is_teacher_for_group_week(public.student_group_for_week(input_student_id, input_week_start), input_week_start);
$$;

create or replace function public.student_weekly_teacher(
  input_student_id uuid,
  input_week_start date
)
returns table (
  teacher_id uuid,
  teacher_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select profiles.id, profiles.name
  from public.group_teacher_assignments
  join public.profiles on profiles.id = group_teacher_assignments.teacher_id
  where group_teacher_assignments.group_id = public.student_group_for_week(input_student_id, input_week_start)
    and group_teacher_assignments.week_start = input_week_start
    and group_teacher_assignments.active = true
    and profiles.role = 'teacher'
    and profiles.active = true
    and public.can_read_student_for_week(input_student_id, input_week_start)
  order by group_teacher_assignments.created_at desc
  limit 1;
$$;

revoke all on function public.student_weekly_teacher(uuid, date) from public;
grant execute on function public.student_weekly_teacher(uuid, date) to authenticated;

create or replace function public.student_cohort_students_for_week(
  input_student_id uuid,
  input_week_start date
)
returns table (
  student_id uuid,
  student_name text,
  student_created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select profiles.id, profiles.name, profiles.created_at
  from public.student_group_memberships
  join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
  join public.profiles on profiles.id = student_group_memberships.student_id
  where halaqa_groups.cohort_id = public.student_cohort_for_week(input_student_id, input_week_start)
    and student_group_memberships.starts_on <= input_week_start
    and (
      student_group_memberships.ends_on is null
      or student_group_memberships.ends_on >= input_week_start
    )
    and profiles.role = 'student'
    and profiles.active = true
    and public.can_read_student_for_week(input_student_id, input_week_start)
  order by profiles.name asc;
$$;

revoke all on function public.student_cohort_students_for_week(uuid, date) from public;
grant execute on function public.student_cohort_students_for_week(uuid, date) to authenticated;

create or replace function public.admin_students_for_week(input_week_start date)
returns table (
  student_id uuid,
  student_name text,
  student_email text,
  student_phone text,
  student_created_at timestamptz,
  masjid_id uuid,
  cohort_id uuid,
  cohort_kind text,
  cohort_name text,
  group_id uuid,
  group_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select profiles.id,
         profiles.name,
         profiles.email,
         profiles.phone,
         profiles.created_at,
         cohorts.masjid_id,
         cohorts.id,
         cohorts.kind,
         cohorts.name,
         halaqa_groups.id,
         halaqa_groups.name
  from public.student_group_memberships
  join public.profiles on profiles.id = student_group_memberships.student_id
  join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
  join public.cohorts on cohorts.id = halaqa_groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  where student_group_memberships.starts_on <= input_week_start
    and (
      student_group_memberships.ends_on is null
      or student_group_memberships.ends_on >= input_week_start
    )
    and profiles.role = 'student'
    and profiles.active = true
    and halaqa_groups.active = true
    and cohorts.active = true
    and masajid.active = true
    and public.is_admin_for_masjid(cohorts.masjid_id)
  order by cohorts.sort_order asc, halaqa_groups.sort_order asc, profiles.name asc;
$$;

revoke all on function public.admin_students_for_week(date) from public;
grant execute on function public.admin_students_for_week(date) to authenticated;
