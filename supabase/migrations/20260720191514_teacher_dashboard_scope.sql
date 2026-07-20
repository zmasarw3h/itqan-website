-- Teacher dashboard scope projections and assigned weekly-plan file access.
-- Ordinary teacher application reads remain signed-session/RLS bound.

-- Teachers must not inherit the full profiles row, which includes contact
-- fields. Roster names are exposed only through the projection below.
create or replace function public.can_read_profile(input_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_active_super_admin((select auth.uid()))
    or (
      input_profile_id = (select auth.uid())
      and exists (
        select 1 from public.profiles
        where profiles.id = input_profile_id and profiles.active = true
      )
    )
    or exists (
      select 1
      from public.profiles as target
      join public.student_group_memberships as memberships
        on memberships.student_id = target.id
      where target.id = input_profile_id
        and target.active = true
        and private.raw_is_admin_for_masjid(
          (select auth.uid()),
          private.raw_group_masjid_id(memberships.group_id),
          public.current_effective_date()
        )
    )
    or exists (
      select 1
      from public.profiles as target
      join public.masjid_staff_memberships as memberships
        on memberships.profile_id = target.id
      where target.id = input_profile_id
        and target.active = true
        and private.raw_is_admin_for_masjid(
          (select auth.uid()), memberships.masjid_id, public.current_effective_date()
        )
    );
$$;

-- Grade targets must remain active students for both direct Data API writes
-- and application actions. Assignment and admin scope checks remain unchanged.
create or replace function public.can_grade_student_for_week(
  input_student_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as target
    where target.id = input_student_id
      and target.role = 'student'
      and target.active = true
  )
  and (
    private.raw_is_active_super_admin((select auth.uid()))
    or private.raw_is_admin_for_masjid(
      (select auth.uid()),
      private.raw_student_masjid_for_week(input_student_id, input_week_start),
      public.current_effective_date()
    )
    or private.raw_is_teacher_for_group_week(
      (select auth.uid()),
      private.raw_student_group_for_week(input_student_id, input_week_start),
      input_week_start
    )
  );
$$;

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
    (
      select count(*)::integer
      from public.student_group_memberships as memberships
      join public.profiles as students on students.id = memberships.student_id
      where memberships.group_id = assignments.group_id
        and memberships.starts_on <= assignments.week_start
        and (memberships.ends_on is null or memberships.ends_on >= assignments.week_start)
        and students.role = 'student'
        and students.active = true
    ) as roster_count
  from public.group_teacher_assignments as assignments
  join public.halaqa_groups as groups on groups.id = assignments.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  where assignments.teacher_id = (select auth.uid())
    and assignments.active = true
    and groups.active = true
    and cohorts.active = true
    and masajid.active = true
    and private.raw_is_teacher_for_group_week(
      (select auth.uid()), assignments.group_id, assignments.week_start
    )
  order by assignments.week_start desc, masajid.name, cohorts.sort_order, groups.sort_order, groups.name;
$$;

create or replace function public.teacher_group_roster_context(
  input_group_id uuid,
  input_week_start date
)
returns table (
  student_id uuid,
  student_name text,
  daily_checkin_days integer,
  daily_points numeric,
  partner_rounds integer,
  partner_points integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_tracker_week_start(input_week_start);

  if (select auth.uid()) is null
    or not private.raw_is_teacher_for_group_week(
      (select auth.uid()), input_group_id, input_week_start
    )
    or not exists (
      select 1
      from public.halaqa_groups as groups
      join public.cohorts on cohorts.id = groups.cohort_id
      join public.masajid on masajid.id = cohorts.masjid_id
      where groups.id = input_group_id
        and groups.active = true
        and cohorts.active = true
        and masajid.active = true
    ) then
    raise exception using
      errcode = '42501',
      message = 'The requested group is not assigned to this teacher for the selected week.';
  end if;

  return query
  select
    students.id,
    students.name,
    (
      select count(*)::integer
      from public.checkins
      where checkins.student_id = students.id
        and checkins.date between input_week_start and input_week_start + 6
    ),
    least(700::numeric, greatest(0::numeric, coalesce((
      select sum(coalesce(checkins.daily_score, 0))
      from public.checkins
      where checkins.student_id = students.id
        and checkins.date between input_week_start and input_week_start + 6
    ), 0)::numeric)),
    (
      select count(*)::integer
      from public.partner_recitations as recitations
      where recitations.student_id = students.id
        and recitations.week_start = input_week_start
    ),
    least(150, greatest(0, coalesce((
      select sum(recitations.points)
      from public.partner_recitations as recitations
      where recitations.student_id = students.id
        and recitations.week_start = input_week_start
    ), 0)::integer))
  from public.student_group_memberships as memberships
  join public.profiles as students on students.id = memberships.student_id
  where memberships.group_id = input_group_id
    and memberships.starts_on <= input_week_start
    and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
    and students.role = 'student'
    and students.active = true
  order by students.name, students.id;
end;
$$;

create or replace function public.can_teacher_read_weekly_plan_path(input_file_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parsed_student_id uuid;
  parsed_week_start date;
  assigned_group_id uuid;
begin
  if input_file_path !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[^/]+$' then
    return false;
  end if;

  begin
    parsed_student_id := split_part(input_file_path, '/', 1)::uuid;
    parsed_week_start := split_part(input_file_path, '/', 2)::date;
  exception
    when invalid_text_representation or datetime_field_overflow then
      return false;
  end;

  assigned_group_id := private.raw_student_group_for_week(parsed_student_id, parsed_week_start);

  return assigned_group_id is not null
    and private.raw_is_teacher_for_group_week(
      (select auth.uid()), assigned_group_id, parsed_week_start
    )
    and exists (
      select 1
      from public.weekly_plans as plans
      join public.profiles as students on students.id = plans.student_id
      where plans.student_id = parsed_student_id
        and plans.week_start = parsed_week_start
        and plans.file_path = input_file_path
        and plans.halaqa_group_id = assigned_group_id
        and students.role = 'student'
        and students.active = true
    );
end;
$$;

revoke execute on function public.teacher_assignment_contexts() from public, anon, authenticated, service_role;
revoke execute on function public.teacher_group_roster_context(uuid, date) from public, anon, authenticated, service_role;
revoke execute on function public.can_teacher_read_weekly_plan_path(text) from public, anon, authenticated, service_role;
grant execute on function public.teacher_assignment_contexts() to authenticated;
grant execute on function public.teacher_group_roster_context(uuid, date) to authenticated;
grant execute on function public.can_teacher_read_weekly_plan_path(text) to authenticated;

create policy "Teachers can read assigned weekly plan files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'weekly-plans'
    and public.can_teacher_read_weekly_plan_path(name)
  );

-- Keep the application-owned SECURITY DEFINER inventory explicit.
create or replace function private.application_security_definer_oids()
returns table (function_oid oid)
language sql
stable
set search_path = ''
as $$
  select signature::regprocedure::oid
  from unnest(array[
    'public.admin_students_for_week(date)',
    'public.apply_admin_checkin_correction(uuid,date,text,text,text[])',
    'public.apply_scoped_user_setup(uuid,uuid,uuid,text,text,text,text,date,uuid,uuid)',
    'public.apply_super_admin_access_change(uuid,uuid,uuid,text,date,uuid,uuid,jsonb)',
    'public.apply_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date,jsonb)',
    'public.apply_super_admin_masjid_update(uuid,uuid,uuid,text,text,boolean,jsonb)',
    'public.apply_super_admin_staff_membership_end(uuid,uuid,uuid,uuid,date,jsonb)',
    'public.apply_teacher_rotation_generation(uuid,date,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,integer,integer,integer,integer)',
    'public.can_admin_delete_student(uuid)',
    'public.can_admin_manage_group_history(uuid)',
    'public.can_admin_manage_student_for_week(uuid,date)',
    'public.can_admin_read_weekly_plan_path(text)',
    'public.can_grade_student_for_week(uuid,date)',
    'public.can_read_cohort(uuid)',
    'public.can_read_group(uuid)',
    'public.can_read_masjid(uuid)',
    'public.can_read_operational_student_row(uuid,uuid,date)',
    'public.can_read_profile(uuid)',
    'public.can_read_student_for_week(uuid,date)',
    'public.can_teacher_read_weekly_plan_path(text)',
    'public.cohort_masjid_id(uuid)',
    'public.current_effective_date()',
    'public.current_partner_recitation_round()',
    'public.enforce_student_accountability_attestation()',
    'public.enforce_student_checkin_integrity()',
    'public.enforce_student_checkin_item_integrity()',
    'public.get_person_access_state(uuid,uuid)',
    'public.get_scoped_user_setup_auth_recovery(uuid,uuid,text,text,text,text,date,uuid,uuid)',
    'public.get_scoped_user_setup_request_result(uuid,uuid,text,text,text,text,date,uuid,uuid)',
    'public.group_masjid_id(uuid)',
    'public.is_active_admin()',
    'public.is_active_student()',
    'public.is_active_super_admin()',
    'public.is_active_teacher()',
    'public.is_admin_for_masjid(uuid)',
    'public.is_rotation_teacher_for_masjid_week(uuid,uuid,date)',
    'public.is_staff_for_masjid(uuid)',
    'public.is_teacher_for_group_week(uuid,date)',
    'public.prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)',
    'public.protect_foundation_row_identity()',
    'public.recalculate_student_checkin_score()',
    'public.set_student_scope_snapshot()',
    'public.student_cohort_for_week(uuid,date)',
    'public.student_cohort_leaderboard_for_week(date)',
    'public.student_cohort_students_for_week(uuid,date)',
    'public.student_current_group_id(uuid)',
    'public.student_group_for_week(uuid,date)',
    'public.student_leaderboard_available_weeks()',
    'public.student_masjid_for_week(uuid,date)',
    'public.student_scope_snapshot_matches(uuid,date,uuid,uuid,uuid)',
    'public.student_weekly_teacher_name(date)',
    'public.student_weekly_teacher(uuid,date)',
    'public.teacher_assignment_contexts()',
    'public.teacher_can_read_membership(uuid,date,date)',
    'public.teacher_group_roster_context(uuid,date)',
    'public.teacher_rotation_row_scope_matches()',
    'private.apply_super_admin_masjid_staff_grant_once(uuid,uuid,uuid,uuid,text,date,jsonb)'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
