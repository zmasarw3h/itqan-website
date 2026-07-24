-- Prevent service-role workflows from creating a pending accountability gate
-- for a week in which the student had no valid scoped membership. Existing
-- malformed rows remain visible for the separately reviewed repair workflow.

alter table public.accountability_obligations
  add constraint accountability_pending_scope_required
  check (
    status <> 'pending'
    or (
      masjid_id is not null
      and cohort_id is not null
      and halaqa_group_id is not null
    )
  )
  not valid;

create or replace function public.validate_accountability_obligation_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_group_id uuid;
  expected_cohort_id uuid;
  expected_masjid_id uuid;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select groups.id, cohorts.id, masajid.id
  into expected_group_id, expected_cohort_id, expected_masjid_id
  from public.student_group_memberships as memberships
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  where memberships.student_id = new.student_id
    and memberships.starts_on <= new.week_start
    and (memberships.ends_on is null or memberships.ends_on >= new.week_start)
    and groups.active = true
    and cohorts.active = true
    and masajid.active = true
  order by memberships.starts_on desc
  limit 1;

  if expected_group_id is null
    or new.halaqa_group_id is distinct from expected_group_id
    or new.cohort_id is distinct from expected_cohort_id
    or new.masjid_id is distinct from expected_masjid_id
  then
    raise exception using
      errcode = '23514',
      message = 'Pending accountability obligations require a valid student scope for their week.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_accountability_obligation_scope_trigger
  on public.accountability_obligations;

create trigger validate_accountability_obligation_scope_trigger
  before insert or update on public.accountability_obligations
  for each row
  execute function public.validate_accountability_obligation_scope();

revoke execute on function public.validate_accountability_obligation_scope()
  from public, anon, authenticated, service_role;

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
    'public.apply_super_admin_hierarchy_change(uuid,uuid,text,uuid,uuid,uuid,text,text,integer,boolean,jsonb)',
    'public.apply_super_admin_masjid_provision(uuid,uuid,text,text,text,text,integer,boolean,text,integer,boolean)',
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
    'public.validate_accountability_obligation_scope()',
    'private.apply_super_admin_masjid_staff_grant_once(uuid,uuid,uuid,uuid,text,date,jsonb)',
    'private.enforce_masjid_hierarchy_readiness()'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
