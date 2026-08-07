-- Schema-catalog assertions complement the signed-session behavioral tests.
-- This runs only inside the disposable local Postgres container.

create temp table application_definers (
  function_oid oid primary key,
  signature text not null unique
);

insert into application_definers (function_oid, signature)
select listed.function_oid, listed.function_oid::regprocedure::text
from private.application_security_definer_oids() listed;

create temp table expected_authenticated_definers (signature text primary key);

insert into expected_authenticated_definers (signature) values
  ('admin_students_for_week(date)'),
  ('apply_admin_checkin_correction(uuid,date,text,text,text[])'),
  ('can_admin_delete_student(uuid)'),
  ('can_admin_manage_group_history(uuid)'),
  ('can_admin_manage_student_for_week(uuid,date)'),
  ('can_admin_read_weekly_plan_path(text)'),
  ('can_grade_student_for_week(uuid,date)'),
  ('can_read_cohort(uuid)'),
  ('can_read_group(uuid)'),
  ('can_read_masjid(uuid)'),
  ('can_read_operational_student_row(uuid,uuid,date)'),
  ('can_read_profile(uuid)'),
  ('can_read_session_roster_cohort(uuid)'),
  ('can_read_student_for_week(uuid,date)'),
  ('can_teacher_read_weekly_plan_path(text)'),
  ('cohort_masjid_id(uuid)'),
  ('current_effective_date()'),
  ('current_partner_recitation_round()'),
  ('current_toronto_civil_date()'),
  ('get_teacher_session_checklist_details(uuid,uuid,uuid,date,date)'),
  ('get_teacher_session_dashboard(uuid,date)'),
  ('get_teacher_session_group_roster(uuid,uuid,date)'),
  ('get_teacher_session_student_context(uuid,date)'),
  ('group_masjid_id(uuid)'),
  ('historical_reporting_available_weeks()'),
  ('historical_reporting_activity_for_weeks(date[])'),
  ('historical_reporting_students_for_weeks(date[])'),
  ('is_active_admin()'),
  ('is_active_student()'),
  ('is_active_super_admin()'),
  ('is_active_teacher()'),
  ('is_admin_for_masjid(uuid)'),
  ('is_rotation_teacher_for_masjid_week(uuid,uuid,date)'),
  ('is_staff_for_masjid(uuid)'),
  ('is_teacher_for_group_week(uuid,date)'),
  ('refresh_current_profile_role()'),
  ('student_cohort_for_week(uuid,date)'),
  ('student_cohort_leaderboard_for_week(date)'),
  ('student_current_group_id(uuid)'),
  ('student_group_for_week(uuid,date)'),
  ('student_historical_reporting_scope_for_week(date)'),
  ('student_leaderboard_available_weeks()'),
  ('student_masjid_for_week(uuid,date)'),
  ('student_scope_snapshot_matches(uuid,date,uuid,uuid,uuid)'),
  ('student_weekly_teacher(uuid,date)'),
  ('student_weekly_teacher_name(date)'),
  ('teacher_assignment_contexts()'),
  ('teacher_can_read_membership(uuid,date,date)'),
  ('teacher_grade_scope_snapshot_matches(uuid,date,uuid,uuid,uuid)'),
  ('teacher_session_authorized_scopes(date)'),
  ('teacher_session_grade_row_visible(uuid,date,uuid,uuid)'),
  ('teacher_session_grade_scope_matches(uuid,date,uuid,uuid,uuid,uuid,uuid)'),
  ('teacher_session_grade_snapshot_matches(uuid,date,uuid,uuid,uuid,uuid,uuid)'),
  ('teacher_session_plan_scope_matches(uuid,date)'),
  ('save_teacher_session_halaqa_grade(uuid,uuid,uuid,date,boolean,integer,text)');

-- The shared rotation trigger is deliberately attached only to tables whose
-- row shape it handles in an explicit branch. Keep this catalog assertion
-- alongside behavioral seed tests so a future attachment cannot reintroduce
-- an unsafe NEW-field reference.
do $$
declare
  missing_attachments text;
  unexpected_attachments text;
  assignment_active_update_missing boolean;
begin
  select string_agg(expected.table_oid::regclass::text || ':' || expected.trigger_name, ', ' order by expected.table_oid::regclass::text)
  into missing_attachments
  from (
    values
      ('public.cohort_rotation_settings'::regclass, 'cohort_rotation_settings_scope_trigger'),
      ('public.teacher_rotation_availability'::regclass, 'teacher_rotation_availability_scope_trigger'),
      ('public.group_teacher_assignments'::regclass, 'teacher_assignment_teacher_eligibility_trigger')
  ) as expected(table_oid, trigger_name)
  where not exists (
    select 1
    from pg_trigger as triggers
    where triggers.tgrelid = expected.table_oid
      and triggers.tgname = expected.trigger_name
      and triggers.tgfoid = 'public.teacher_rotation_row_scope_matches()'::regprocedure
      and not triggers.tgisinternal
  );

  select string_agg(triggers.tgrelid::regclass::text || ':' || triggers.tgname, ', ' order by triggers.tgrelid::regclass::text)
  into unexpected_attachments
  from pg_trigger as triggers
  where triggers.tgfoid = 'public.teacher_rotation_row_scope_matches()'::regprocedure
    and not triggers.tgisinternal
    and not exists (
      select 1
      from (
        values
          ('public.cohort_rotation_settings'::regclass, 'cohort_rotation_settings_scope_trigger'),
          ('public.teacher_rotation_availability'::regclass, 'teacher_rotation_availability_scope_trigger'),
          ('public.group_teacher_assignments'::regclass, 'teacher_assignment_teacher_eligibility_trigger')
      ) as expected(table_oid, trigger_name)
      where expected.table_oid = triggers.tgrelid
        and expected.trigger_name = triggers.tgname
    );

  select not exists (
    select 1
    from pg_trigger as triggers
    join pg_attribute as attributes
      on attributes.attrelid = triggers.tgrelid
      and attributes.attnum = any(triggers.tgattr)
    where triggers.tgrelid = 'public.group_teacher_assignments'::regclass
      and triggers.tgname = 'teacher_assignment_teacher_eligibility_trigger'
      and attributes.attname = 'active'
  )
  into assignment_active_update_missing;

  if missing_attachments is not null
    or unexpected_attachments is not null
    or assignment_active_update_missing then
    raise exception
      'rotation trigger attachment mismatch: missing=% unexpected=% assignment_active_update_missing=%',
      coalesce(missing_attachments, 'none'),
      coalesce(unexpected_attachments, 'none'),
      assignment_active_update_missing;
  end if;
end;
$$;

do $$
declare
  invalid_allowlist text;
  unlisted_application_definers text;
  unexpected_authenticated text;
  missing_authenticated text;
  anon_or_public_executable text;
  unsafe_search_path text;
  unexpected_service text;
begin
  select string_agg(definers.signature, ', ' order by definers.signature)
  into invalid_allowlist
  from application_definers definers
  join pg_proc p on p.oid = definers.function_oid
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('public', 'private')
    or not p.prosecdef
    or p.proowner <> (
      select anchor.proowner from pg_proc anchor
      where anchor.oid = 'public.is_active_admin()'::regprocedure
    )
    or exists (
      select 1
      from pg_depend dependency
      join pg_extension extension on extension.oid = dependency.refobjid
      where dependency.classid = 'pg_proc'::regclass
        and dependency.objid = p.oid
        and dependency.refclassid = 'pg_extension'::regclass
        and dependency.deptype = 'e'
    );

  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into unlisted_application_definers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and p.proowner = (
      select anchor.proowner from pg_proc anchor
      where anchor.oid = 'public.is_active_admin()'::regprocedure
    )
    and not exists (
      select 1
      from pg_depend dependency
      join pg_extension extension on extension.oid = dependency.refobjid
      where dependency.classid = 'pg_proc'::regclass
        and dependency.objid = p.oid
        and dependency.refclassid = 'pg_extension'::regclass
        and dependency.deptype = 'e'
    )
    and not exists (
      select 1 from application_definers listed where listed.function_oid = p.oid
    );

  select string_agg(difference.signature, ', ' order by difference.signature)
  into unexpected_authenticated
  from (
    select signature from application_definers
    where has_function_privilege('authenticated', function_oid, 'EXECUTE')
    except
    select signature from expected_authenticated_definers
  ) difference;

  select string_agg(difference.signature, ', ' order by difference.signature)
  into missing_authenticated
  from (
    select signature from expected_authenticated_definers
    except
    select signature from application_definers
    where has_function_privilege('authenticated', function_oid, 'EXECUTE')
  ) difference;

  select string_agg(signature, ', ' order by signature)
  into anon_or_public_executable
  from application_definers
  -- anon inherits any PUBLIC EXECUTE grant, so this effective check covers
  -- both the role-specific and blanket PUBLIC privilege paths.
  where has_function_privilege('anon', function_oid, 'EXECUTE');

  select string_agg(definers.signature, ', ' order by definers.signature)
  into unsafe_search_path
  from application_definers definers
  join pg_proc p on p.oid = definers.function_oid
  where not coalesce(p.proconfig @> array['search_path=""'], false);

  select string_agg(difference.signature, ', ' order by difference.signature)
  into unexpected_service
  from (
    select signature from application_definers
    where has_function_privilege('service_role', function_oid, 'EXECUTE')
    except
    select signature
    from (values
      ('apply_cohort_group_rebalance(uuid,date,uuid,integer)'),
      ('apply_student_rotation_availability(uuid,uuid,date,jsonb)'),
      ('apply_official_scoring_start_change(uuid,uuid,uuid,date,date,text)'),
      ('apply_scoped_user_setup(uuid,uuid,uuid,text,text,text,text,date,date,uuid,uuid)'),
      ('apply_super_admin_access_change(uuid,uuid,uuid,text,date,uuid,uuid,jsonb)'),
      ('apply_super_admin_hierarchy_change(uuid,uuid,text,uuid,uuid,uuid,text,text,integer,boolean,jsonb)'),
      ('apply_super_admin_masjid_provision(uuid,uuid,text,text,text,text,integer,boolean,text,integer,boolean)'),
      ('apply_super_admin_masjid_update(uuid,uuid,uuid,text,text,boolean,jsonb)'),
      ('apply_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date,jsonb)'),
      ('apply_super_admin_staff_membership_end(uuid,uuid,uuid,uuid,date,jsonb)'),
      ('access_transition_rollout_diagnostic()'),
      ('apply_teacher_rotation_generation(uuid,date,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,integer,integer,integer,integer)'),
      ('apply_teacher_rotation_publication(uuid,uuid,uuid,date,jsonb,jsonb)'),
      ('get_person_access_state(uuid,uuid)'),
      ('prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)'),
      ('prepare_teacher_rotation_publication(uuid,uuid,uuid,date)'),
      ('preview_official_scoring_start_change(uuid,uuid,date)'),
      ('reconcile_historical_accountability_obligation(uuid,date)'),
      ('get_scoped_user_setup_auth_recovery(uuid,uuid,text,text,text,text,date,date,uuid,uuid)'),
      ('get_scoped_user_setup_request_result(uuid,uuid,text,text,text,text,date,date,uuid,uuid)'),
      ('load_or_create_session_roster_draft(uuid,uuid,uuid,date)'),
      ('refresh_session_roster_draft(uuid,uuid,uuid,date,uuid,bigint,text,uuid,boolean)'),
      ('get_session_roster_draft(uuid,uuid)'),
      ('move_session_roster_student(uuid,uuid,uuid,uuid,uuid,bigint)'),
      ('assign_session_roster_primary_teacher(uuid,uuid,uuid,uuid,uuid,bigint)'),
      ('compute_session_roster_readiness(uuid,uuid)'),
      ('review_session_roster_draft(uuid,uuid,uuid,bigint)'),
      ('publish_session_roster_draft(uuid,uuid,uuid,bigint)'),
      ('create_session_roster_revision(uuid,uuid,uuid,date,uuid)'),
      ('get_current_session_roster(uuid,uuid,date)'),
      ('get_session_roster_history(uuid,uuid,date)')
    ) expected_service(signature)
  ) difference;

  if invalid_allowlist is not null then
    raise exception 'Invalid application SECURITY DEFINER allowlist entries: %', invalid_allowlist;
  end if;
  if unlisted_application_definers is not null then
    raise exception 'Application SECURITY DEFINER functions missing from allowlist: %', unlisted_application_definers;
  end if;
  if unexpected_authenticated is not null then
    raise exception 'Unexpected authenticated SECURITY DEFINER grants: %', unexpected_authenticated;
  end if;
  if missing_authenticated is not null then
    raise exception 'Missing authenticated SECURITY DEFINER grants: %', missing_authenticated;
  end if;
  if anon_or_public_executable is not null then
    raise exception 'anon/PUBLIC can execute application SECURITY DEFINER functions: %', anon_or_public_executable;
  end if;
  if unsafe_search_path is not null then
    raise exception 'Application SECURITY DEFINER functions without empty search_path: %', unsafe_search_path;
  end if;
  if unexpected_service is not null then
    raise exception 'Unexpected service_role SECURITY DEFINER grants: %', unexpected_service;
  end if;
  if not has_function_privilege(
    'service_role',
    'public.apply_cohort_group_rebalance(uuid,date,uuid,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_student_rotation_availability(uuid,uuid,date,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_teacher_rotation_generation(uuid,date,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,integer,integer,integer,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.prepare_teacher_rotation_publication(uuid,uuid,uuid,date)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_teacher_rotation_publication(uuid,uuid,uuid,date,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'service_role lacks guarded rotation workflow EXECUTE';
  end if;

  if not has_function_privilege('service_role', 'public.load_or_create_session_roster_draft(uuid,uuid,uuid,date)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.refresh_session_roster_draft(uuid,uuid,uuid,date,uuid,bigint,text,uuid,boolean)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.get_session_roster_draft(uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.move_session_roster_student(uuid,uuid,uuid,uuid,uuid,bigint)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.assign_session_roster_primary_teacher(uuid,uuid,uuid,uuid,uuid,bigint)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.compute_session_roster_readiness(uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.review_session_roster_draft(uuid,uuid,uuid,bigint)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.publish_session_roster_draft(uuid,uuid,uuid,bigint)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.create_session_roster_revision(uuid,uuid,uuid,date,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.get_current_session_roster(uuid,uuid,date)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.get_session_roster_history(uuid,uuid,date)', 'EXECUTE') then
    raise exception 'service_role lacks guarded session-roster workflow EXECUTE';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.apply_scoped_user_setup(uuid,uuid,uuid,text,text,text,text,date,date,uuid,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.get_scoped_user_setup_auth_recovery(uuid,uuid,text,text,text,text,date,date,uuid,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.get_scoped_user_setup_request_result(uuid,uuid,text,text,text,text,date,date,uuid,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_super_admin_access_change(uuid,uuid,uuid,text,date,uuid,uuid,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_official_scoring_start_change(uuid,uuid,uuid,date,date,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.preview_official_scoring_start_change(uuid,uuid,date)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_super_admin_hierarchy_change(uuid,uuid,text,uuid,uuid,uuid,text,text,integer,boolean,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_super_admin_masjid_provision(uuid,uuid,text,text,text,text,integer,boolean,text,integer,boolean)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_super_admin_masjid_update(uuid,uuid,uuid,text,text,boolean,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_super_admin_staff_membership_end(uuid,uuid,uuid,uuid,date,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.get_person_access_state(uuid,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.access_transition_rollout_diagnostic()',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.reconcile_historical_accountability_obligation(uuid,date)',
    'EXECUTE'
  ) then
    raise exception 'service_role lacks transactional workflow RPC EXECUTE';
  end if;
end;
$$;

-- Disposable-only fault injection used to prove a failed audit insert rolls the
-- masjid mutation back. This is created after catalog assertions and never ships.
create function public.test_reject_masjid_update_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.action = 'masjid_updated'
    and new.after_data ->> 'slug' = 'force-audit-failure' then
    raise exception using errcode = 'P0001', message = 'forced masjid audit failure';
  end if;

  return new;
end;
$$;

create trigger test_reject_masjid_update_audit_trigger
  before insert on public.super_admin_audit_events
  for each row
  execute function public.test_reject_masjid_update_audit();

-- The signed super-admin role is intentionally read-capable but cannot own
-- direct profile/access-history writes. These policy-shape assertions catch a
-- future migration that accidentally restores the Data API bypass.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'masajid'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and 'authenticated' = any (roles)
  ) then
    raise exception 'authenticated masjid mutation policy bypasses guarded service workflows';
  end if;
end;
$$;

do $$
declare
  policy_expression text;
begin
  select lower(regexp_replace(coalesce(with_check, ''), '[()[:space:]]', '', 'g'))
  into policy_expression
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname = 'Admins can insert profiles';
  if policy_expression is distinct from 'false' then
    raise exception 'profiles insert policy is not deny-only: %', policy_expression;
  end if;

  select lower(regexp_replace(coalesce(qual, '') || coalesce(with_check, ''), '[()[:space:]]', '', 'g'))
  into policy_expression
  from pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
    and policyname = 'Admins can update profiles';
  if policy_expression is distinct from 'falsefalse' then
    raise exception 'profiles update policy is not deny-only: %', policy_expression;
  end if;

  for policy_expression in
    select lower(coalesce(with_check, '') || coalesce(qual, ''))
    from pg_policies
    where schemaname = 'public'
      and (
        (tablename = 'student_group_memberships' and policyname in (
          'Admins can insert student memberships',
          'Admins can close student memberships'
        ))
        or (tablename = 'masjid_staff_memberships' and policyname in (
          'Admins can insert teacher staff memberships',
          'Admins can close teacher staff memberships'
        ))
      )
  loop
    if position('is_active_super_admin' in policy_expression) = 0
      or position('not' in policy_expression) = 0 then
      raise exception 'scoped membership policy does not explicitly exclude signed super admins: %', policy_expression;
    end if;
  end loop;

  for policy_expression in
    select lower(regexp_replace(coalesce(qual, ''), '[()[:space:]]', '', 'g'))
    from pg_policies
    where schemaname = 'public'
      and (
        (tablename = 'student_group_memberships' and policyname = 'Super admins can delete student membership history')
        or (tablename = 'masjid_staff_memberships' and policyname = 'Super admins can delete staff membership history')
      )
  loop
    if policy_expression is distinct from 'false' then
      raise exception 'membership delete policy is not deny-only: %', policy_expression;
    end if;
  end loop;
end;
$$;

-- The private schema is never part of the browser or service-role RPC
-- surface. Check every private function, including SECURITY INVOKER helpers
-- added after the public-definer allowlist was assembled. The owning database
-- role is intentionally not probed because owners inherently retain EXECUTE.
do $$
declare
  exposed_private_functions text;
begin
  select string_agg(
    format(
      '%s [%s]',
      p.oid::regprocedure::text,
      concat_ws(', ',
        case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'PUBLIC/anon' end,
        case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'authenticated' end,
        case when has_function_privilege('service_role', p.oid, 'EXECUTE') then 'service_role' end
      )
    ),
    ', ' order by p.oid::regprocedure::text
  )
  into exposed_private_functions
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or has_function_privilege('service_role', p.oid, 'EXECUTE')
    );

  if exposed_private_functions is not null then
    raise exception 'Private functions have effective non-owner EXECUTE privileges: %', exposed_private_functions;
  end if;
end;
$$;

do $$
declare
  policy_count integer;
  policy_record record;
begin
  for policy_record in
    select *
    from (values
      ('Weekly plan object inserts are server-only', 'a'::"char", false, null::text, '(bucket_id <> ''weekly-plans''::text)'),
      ('Weekly plan object updates are server-only', 'w'::"char", false, '(bucket_id <> ''weekly-plans''::text)', '(bucket_id <> ''weekly-plans''::text)'),
      ('Weekly plan object deletes are server-only', 'd'::"char", false, '(bucket_id <> ''weekly-plans''::text)', null::text)
    ) expected(policy_name, command, permissive, using_expression, check_expression)
  loop
    select count(*)
    into policy_count
    from pg_policy policy
    where policy.polrelid = 'storage.objects'::regclass
      and policy.polname = policy_record.policy_name
      and policy.polcmd = policy_record.command
      and policy.polpermissive = policy_record.permissive
      and policy.polroles = array['authenticated'::regrole::oid]
      and pg_get_expr(policy.polqual, policy.polrelid) is not distinct from policy_record.using_expression
      and pg_get_expr(policy.polwithcheck, policy.polrelid) is not distinct from policy_record.check_expression;

    if policy_count <> 1 then
      raise exception 'Weekly-plan Storage policy does not match exact role/command/permissiveness/expression contract: %', policy_record.policy_name;
    end if;
  end loop;

  select count(*)
  into policy_count
  from pg_policy policy
  where policy.polrelid = 'public.teacher_rotation_runs'::regclass
    and policy.polname = 'Admins can read teacher rotation runs'
    and policy.polcmd = 'r'
    and policy.polpermissive
    and policy.polroles = array['authenticated'::regrole::oid]
    and pg_get_expr(policy.polqual, policy.polrelid)
      = 'is_admin_for_masjid(cohort_masjid_id(cohort_id))'
    and policy.polwithcheck is null;

  if policy_count <> 1 then
    raise exception 'teacher_rotation_runs scoped SELECT policy does not match the exact catalog contract';
  end if;

  if exists (
    select 1
    from pg_policy policy
    where policy.polrelid = 'public.teacher_rotation_runs'::regclass
      and 'authenticated'::regrole::oid = any(policy.polroles)
      and policy.polcmd in ('*', 'a', 'w', 'd')
  ) then
    raise exception 'teacher_rotation_runs has a signed-session mutation policy';
  end if;
end;
$$;

do $$
begin
  if not has_table_privilege('service_role', 'public.super_admin_audit_events', 'SELECT')
    or not has_table_privilege('service_role', 'public.super_admin_audit_events', 'INSERT') then
    raise exception 'service_role must retain only required audit SELECT/INSERT privileges';
  end if;

  if has_table_privilege('service_role', 'public.super_admin_audit_events', 'UPDATE')
    or has_table_privilege('service_role', 'public.super_admin_audit_events', 'DELETE')
    or has_table_privilege('service_role', 'public.super_admin_audit_events', 'TRUNCATE') then
    raise exception 'service_role has forbidden audit UPDATE/DELETE/TRUNCATE privileges';
  end if;

  if exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as privileges(privilege_name)
    where has_table_privilege(
      roles.role_name,
      'private.workflow_mutation_requests',
      privileges.privilege_name
    )
  ) then
    raise exception 'workflow mutation ledger is directly accessible outside its owner functions';
  end if;

  if exists (
    select 1
    from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as privileges(privilege_name)
    cross join (values
      ('private.workflow_expected_state_snapshots'),
      ('private.masjid_update_requests')
    ) as protected_tables(table_name)
    where has_table_privilege(
      roles.role_name,
      protected_tables.table_name,
      privileges.privilege_name
    )
  ) then
    raise exception 'transactional closure state is directly accessible outside owner functions';
  end if;
end;
$$;
