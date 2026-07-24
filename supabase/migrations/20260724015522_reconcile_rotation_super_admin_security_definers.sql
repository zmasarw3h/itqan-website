-- The rotation and super-admin branches each extended the application-owned
-- SECURITY DEFINER inventory. The later super-admin migration replaced the
-- inventory before the rotation RPC existed on that branch, so reconcile the
-- complete combined set after both feature migrations have been applied.
--
-- The hierarchy-readiness trigger also crosses into the private schema. Run
-- that trigger helper as its owner so ordinary table writers do not need
-- private-schema access; the body remains schema-qualified with an empty
-- search path.
create or replace function private.enforce_masjid_hierarchy_readiness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  impacted_masjid_id uuid;
  impacted_cohort_id uuid;
begin
  if tg_table_name = 'masajid' then
    impacted_masjid_id := case when tg_op = 'DELETE' then old.id else new.id end;
  elsif tg_table_name = 'cohorts' then
    impacted_masjid_id := case when tg_op = 'DELETE' then old.masjid_id else new.masjid_id end;
  else
    impacted_cohort_id := case when tg_op = 'DELETE' then old.cohort_id else new.cohort_id end;
    select cohorts.masjid_id into impacted_masjid_id
    from public.cohorts
    where cohorts.id = impacted_cohort_id;
  end if;

  if impacted_masjid_id is not null then
    perform private.assert_masjid_hierarchy_readiness(impacted_masjid_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_masjid_hierarchy_readiness()
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
    'private.apply_super_admin_masjid_staff_grant_once(uuid,uuid,uuid,uuid,text,date,jsonb)',
    'private.enforce_masjid_hierarchy_readiness()'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
