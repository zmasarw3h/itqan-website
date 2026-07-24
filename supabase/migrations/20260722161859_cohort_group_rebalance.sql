-- Explicit, transaction-backed student group rebalancing for one cohort/week.
-- Weekly teacher assignment generation remains a separate operation.

create or replace function public.apply_cohort_group_rebalance(
  input_cohort_id uuid,
  input_week_start date,
  input_rebalanced_by uuid,
  input_target_group_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cohort_masjid_id uuid;
  active_group_count integer;
  active_student_count integer;
  base_group_size integer;
  larger_group_count integer;
  student_rank integer := 0;
  desired_group_index integer;
  desired_group_id uuid;
  moved_student_count integer := 0;
  next_group_number integer;
  student_row record;
  now_timestamp timestamptz := now();
begin
  if input_target_group_count is null or input_target_group_count <= 0 then
    raise exception using errcode = '22023', message = 'target_group_count must be positive.';
  end if;

  if input_week_start is null
    or input_week_start <> public.week_start_for_date(input_week_start) then
    raise exception using errcode = '22023', message = 'week_start must be the tracker week start.';
  end if;

  select cohorts.masjid_id
  into cohort_masjid_id
  from public.cohorts
  join public.masajid on masajid.id = cohorts.masjid_id
  where cohorts.id = input_cohort_id
    and cohorts.active = true
    and masajid.active = true
  for update of cohorts;

  if cohort_masjid_id is null then
    raise exception using errcode = '22023', message = 'Invalid active cohort.';
  end if;

  if not (
    private.raw_is_active_super_admin(input_rebalanced_by)
    or private.raw_is_admin_for_masjid(
      input_rebalanced_by,
      cohort_masjid_id,
      public.current_effective_date()
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'rebalanced_by is not an active admin for the cohort masjid.';
  end if;

  select count(*)::integer
  into active_group_count
  from public.halaqa_groups
  where halaqa_groups.cohort_id = input_cohort_id
    and halaqa_groups.active = true;

  if input_target_group_count < active_group_count then
    raise exception using
      errcode = '22023',
      message = 'target_group_count cannot be lower than the active group count.';
  end if;

  next_group_number := active_group_count + 1;

  while active_group_count < input_target_group_count loop
    while exists (
      select 1
      from public.halaqa_groups
      where halaqa_groups.cohort_id = input_cohort_id
        and halaqa_groups.active = true
        and lower(halaqa_groups.name) = lower('Group ' || next_group_number::text)
    ) loop
      next_group_number := next_group_number + 1;
    end loop;

    insert into public.halaqa_groups (cohort_id, name, active, sort_order)
    values (
      input_cohort_id,
      'Group ' || next_group_number::text,
      true,
      next_group_number * 10
    );

    active_group_count := active_group_count + 1;
    next_group_number := next_group_number + 1;
  end loop;

  select count(*)::integer
  into active_student_count
  from public.student_group_memberships as memberships
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.profiles as students on students.id = memberships.student_id
  where groups.cohort_id = input_cohort_id
    and groups.active = true
    and students.role = 'student'
    and students.active = true
    and memberships.starts_on <= input_week_start
    and (memberships.ends_on is null or memberships.ends_on >= input_week_start);

  base_group_size := active_student_count / active_group_count;
  larger_group_count := active_student_count % active_group_count;

  for student_row in
    select
      memberships.id as membership_id,
      memberships.student_id,
      memberships.group_id,
      memberships.starts_on
    from public.student_group_memberships as memberships
    join public.halaqa_groups as groups on groups.id = memberships.group_id
    join public.profiles as students on students.id = memberships.student_id
    where groups.cohort_id = input_cohort_id
      and groups.active = true
      and students.role = 'student'
      and students.active = true
      and memberships.starts_on <= input_week_start
      and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
    order by students.name, students.created_at, students.id
    for update of memberships
  loop
    student_rank := student_rank + 1;

    if student_rank <= larger_group_count * (base_group_size + 1) then
      desired_group_index := ((student_rank - 1) / (base_group_size + 1)) + 1;
    else
      desired_group_index := larger_group_count
        + ((student_rank - (larger_group_count * (base_group_size + 1)) - 1) / base_group_size)
        + 1;
    end if;

    select groups.id
    into desired_group_id
    from public.halaqa_groups as groups
    where groups.cohort_id = input_cohort_id
      and groups.active = true
    order by groups.sort_order, groups.name, groups.created_at, groups.id
    offset desired_group_index - 1
    limit 1;

    if desired_group_id is null then
      raise exception 'Unable to resolve a target group for student %.', student_row.student_id;
    end if;

    if student_row.group_id = desired_group_id then
      continue;
    end if;

    moved_student_count := moved_student_count + 1;

    if student_row.starts_on = input_week_start then
      update public.student_group_memberships
      set group_id = desired_group_id,
          assigned_by = input_rebalanced_by,
          updated_at = now_timestamp
      where student_group_memberships.id = student_row.membership_id;
    else
      update public.student_group_memberships
      set ends_on = input_week_start - 1,
          assigned_by = input_rebalanced_by,
          updated_at = now_timestamp
      where student_group_memberships.id = student_row.membership_id;

      insert into public.student_group_memberships (
        student_id,
        group_id,
        starts_on,
        assigned_by
      )
      values (
        student_row.student_id,
        desired_group_id,
        input_week_start,
        input_rebalanced_by
      );
    end if;
  end loop;

  return jsonb_build_object(
    'group_count', active_group_count,
    'student_count', active_student_count,
    'moved_student_count', moved_student_count
  );
end;
$$;

revoke execute on function public.apply_cohort_group_rebalance(uuid, date, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_cohort_group_rebalance(uuid, date, uuid, integer)
  to service_role;

-- Keep the explicit application-owned SECURITY DEFINER inventory current.
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
    'public.apply_cohort_group_rebalance(uuid,date,uuid,integer)',
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
    'public.set_halaqa_grade_scope_snapshot()',
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
    'public.teacher_grade_scope_snapshot_matches(uuid,date,uuid,uuid,uuid)',
    'public.teacher_rotation_row_scope_matches()',
    'private.apply_super_admin_masjid_staff_grant_once(uuid,uuid,uuid,uuid,text,date,jsonb)'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
