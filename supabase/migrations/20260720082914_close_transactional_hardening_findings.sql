-- Close the remaining Phase 1 transactional-hardening findings without
-- changing any existing RPC signature. This migration can be deployed before
-- the application code that starts using the new guarded RPCs.

create table private.workflow_expected_state_snapshots (
  request_id uuid primary key,
  workflow text not null check (workflow = 'masjid_staff_grant'),
  actor_id uuid not null,
  target_id uuid not null,
  input_payload jsonb not null,
  expected_state jsonb not null,
  prepared_at timestamptz not null default now()
);

alter table private.workflow_expected_state_snapshots enable row level security;
revoke all on table private.workflow_expected_state_snapshots
  from public, anon, authenticated, service_role;

create table private.masjid_update_requests (
  request_id uuid primary key,
  actor_id uuid not null,
  masjid_id uuid not null,
  input_payload jsonb not null,
  result jsonb not null,
  completed_at timestamptz not null default now()
);

alter table private.masjid_update_requests enable row level security;
revoke all on table private.masjid_update_requests
  from public, anon, authenticated, service_role;

update public.masajid
set updated_at = created_at
where updated_at is null;

alter table public.masajid
  alter column updated_at set default now();

-- Masjid updates now flow through guarded server-side service operations. The
-- existing caller-relative read policy remains unchanged.
drop policy if exists "Admins can manage masajid foundation data" on public.masajid;

create or replace function public.prepare_super_admin_masjid_staff_grant(
  input_request_id uuid,
  input_actor_id uuid,
  input_target_profile_id uuid,
  input_masjid_id uuid,
  input_grant text,
  input_starts_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_snapshot private.workflow_expected_state_snapshots%rowtype;
  existing_request private.workflow_mutation_requests%rowtype;
  preparation_payload jsonb;
  expected_state jsonb;
begin
  if input_request_id is null
    or input_actor_id is null
    or input_target_profile_id is null
    or input_masjid_id is null then
    raise exception using errcode = '22023', message = 'request_id, actor_id, target_profile_id, and masjid_id are required.';
  end if;

  if input_grant not in ('admin', 'teacher', 'admin_teacher') then
    raise exception using errcode = '22023', message = 'grant must be admin, teacher, or admin_teacher.';
  end if;

  if input_starts_on is null then
    raise exception using errcode = '22023', message = 'starts_on is required.';
  end if;

  preparation_payload := jsonb_build_object(
    'actor_id', input_actor_id,
    'target_profile_id', input_target_profile_id,
    'masjid_id', input_masjid_id,
    'grant', input_grant,
    'starts_on', input_starts_on
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workflow-request:' || input_request_id::text, 0)
  );

  select snapshots.*
  into existing_snapshot
  from private.workflow_expected_state_snapshots as snapshots
  where snapshots.request_id = input_request_id;

  if found then
    if existing_snapshot.actor_id <> input_actor_id then
      raise exception using errcode = '42501', message = 'request belongs to another actor.';
    end if;

    if existing_snapshot.workflow <> 'masjid_staff_grant'
      or existing_snapshot.target_id <> input_target_profile_id
      or existing_snapshot.input_payload <> preparation_payload then
      raise exception using errcode = '22023', message = 'request_id was already used with different input.';
    end if;

    if not private.raw_is_active_super_admin(input_actor_id) then
      raise exception using errcode = '42501', message = 'actor is not an active super admin.';
    end if;

    return existing_snapshot.expected_state;
  end if;

  -- Recover snapshots for requests committed immediately before this additive
  -- migration was deployed.
  select requests.*
  into existing_request
  from private.workflow_mutation_requests as requests
  where requests.request_id = input_request_id;

  if found then
    if existing_request.actor_id <> input_actor_id then
      raise exception using errcode = '42501', message = 'request belongs to another actor.';
    end if;

    if existing_request.workflow <> 'masjid_staff_grant'
      or existing_request.target_id <> input_target_profile_id
      or (existing_request.input_payload - 'expected_state') <> preparation_payload then
      raise exception using errcode = '22023', message = 'request_id was already used with different input.';
    end if;

    if not private.raw_is_active_super_admin(input_actor_id) then
      raise exception using errcode = '42501', message = 'actor is not an active super admin.';
    end if;

    expected_state := coalesce(
      existing_request.input_payload -> 'expected_state',
      existing_request.result -> 'access_state'
    );

    if expected_state is null or jsonb_typeof(expected_state) <> 'object' then
      raise exception using errcode = 'P0002', message = 'completed request has no valid expected state.';
    end if;

    insert into private.workflow_expected_state_snapshots (
      request_id, workflow, actor_id, target_id, input_payload, expected_state
    ) values (
      input_request_id,
      'masjid_staff_grant',
      input_actor_id,
      input_target_profile_id,
      preparation_payload,
      expected_state
    );

    return expected_state;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('super-admin-access-change', 0)
  );

  perform 1
  from public.profiles
  where profiles.id = input_actor_id
  for share;

  if not private.raw_is_active_super_admin(input_actor_id) then
    raise exception using errcode = '42501', message = 'actor is not an active super admin.';
  end if;

  perform 1
  from public.profiles
  where profiles.id = input_target_profile_id
    and profiles.active = true
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'target profile must be active.';
  end if;

  perform 1
  from public.masajid
  where masajid.id = input_masjid_id
    and masajid.active = true
  for share;

  if not found then
    raise exception using errcode = '22023', message = 'masjid must be active.';
  end if;

  expected_state := private.person_access_state(input_target_profile_id);

  if expected_state is null then
    raise exception using errcode = 'P0002', message = 'target profile does not exist.';
  end if;

  insert into private.workflow_expected_state_snapshots (
    request_id, workflow, actor_id, target_id, input_payload, expected_state
  ) values (
    input_request_id,
    'masjid_staff_grant',
    input_actor_id,
    input_target_profile_id,
    preparation_payload,
    expected_state
  );

  return expected_state;
end;
$$;

create or replace function private.lock_masjid_admin_coverage_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('super-admin-access-change', 0)
  );
  return null;
end;
$$;

create or replace function private.assert_reactivated_masjid_admin_coverage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active = true and old.active = false then
    perform private.assert_masjid_admin_coverage(new.id);
  end if;
  return null;
end;
$$;

create trigger lock_masjid_admin_coverage_updates
  before update of active on public.masajid
  for each statement
  execute function private.lock_masjid_admin_coverage_updates();

create trigger assert_reactivated_masjid_admin_coverage
  after update of active on public.masajid
  for each row
  execute function private.assert_reactivated_masjid_admin_coverage();

create or replace function private.masjid_update_state(input_masjid_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', masajid.id,
    'name', masajid.name,
    'slug', masajid.slug,
    'active', masajid.active,
    'updated_at', to_char(
      masajid.updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  )
  from public.masajid
  where masajid.id = input_masjid_id;
$$;

create or replace function public.apply_super_admin_masjid_update(
  input_request_id uuid,
  input_actor_id uuid,
  input_masjid_id uuid,
  input_name text,
  input_slug text,
  input_active boolean,
  input_expected_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_request private.masjid_update_requests%rowtype;
  request_payload jsonb;
  current_state jsonb;
  updated_state jsonb;
  normalized_name text := nullif(btrim(input_name), '');
  normalized_slug text := lower(nullif(btrim(input_slug), ''));
  result_payload jsonb;
begin
  if input_request_id is null or input_actor_id is null or input_masjid_id is null then
    raise exception using errcode = '22023', message = 'request_id, actor_id, and masjid_id are required.';
  end if;

  if normalized_name is null or char_length(normalized_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'masjid name is invalid.';
  end if;

  if normalized_slug is null or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception using errcode = '22023', message = 'masjid slug is invalid.';
  end if;

  if input_active is null or input_expected_state is null then
    raise exception using errcode = '22023', message = 'active and expected state are required.';
  end if;

  request_payload := jsonb_build_object(
    'actor_id', input_actor_id,
    'masjid_id', input_masjid_id,
    'name', normalized_name,
    'slug', normalized_slug,
    'active', input_active
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workflow-request:' || input_request_id::text, 0)
  );

  select requests.*
  into existing_request
  from private.masjid_update_requests as requests
  where requests.request_id = input_request_id;

  if found then
    if existing_request.actor_id <> input_actor_id then
      raise exception using errcode = '42501', message = 'request belongs to another actor.';
    end if;

    if existing_request.masjid_id <> input_masjid_id
      or existing_request.input_payload <> request_payload then
      raise exception using errcode = '22023', message = 'request_id was already used with different input.';
    end if;

    if not private.raw_is_active_super_admin(input_actor_id) then
      raise exception using errcode = '42501', message = 'actor is not an active super admin.';
    end if;

    return existing_request.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('super-admin-access-change', 0)
  );

  perform 1
  from public.profiles
  where profiles.id = input_actor_id
  for share;

  if not private.raw_is_active_super_admin(input_actor_id) then
    raise exception using errcode = '42501', message = 'actor is not an active super admin.';
  end if;

  perform 1
  from public.masajid
  where masajid.id = input_masjid_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'masjid was not found.';
  end if;

  current_state := private.masjid_update_state(input_masjid_id);

  if current_state is distinct from input_expected_state then
    raise exception using errcode = 'P0001', message = 'masjid state changed; reload before saving.';
  end if;

  perform 1
  from public.masjid_staff_memberships as memberships
  where memberships.masjid_id = input_masjid_id
    and memberships.staff_role = 'admin'
  for update;

  update public.masajid
  set name = normalized_name,
      slug = normalized_slug,
      active = input_active,
      updated_at = now()
  where id = input_masjid_id;

  if input_active then
    perform private.assert_masjid_admin_coverage(input_masjid_id);
  end if;

  updated_state := private.masjid_update_state(input_masjid_id);

  insert into public.super_admin_audit_events (
    actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data
  ) values (
    input_actor_id,
    'masjid_updated',
    'masajid',
    input_masjid_id,
    input_masjid_id,
    current_state,
    updated_state
  );

  result_payload := jsonb_build_object(
    'masjid_id', input_masjid_id,
    'masjid_state', updated_state
  );

  insert into private.masjid_update_requests (
    request_id, actor_id, masjid_id, input_payload, result
  ) values (
    input_request_id,
    input_actor_id,
    input_masjid_id,
    request_payload,
    result_payload
  );

  return result_payload;
end;
$$;

revoke all on function private.lock_masjid_admin_coverage_updates()
  from public, anon, authenticated, service_role;
revoke all on function private.assert_reactivated_masjid_admin_coverage()
  from public, anon, authenticated, service_role;
revoke all on function private.masjid_update_state(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_super_admin_masjid_staff_grant(uuid, uuid, uuid, uuid, text, date)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_super_admin_masjid_staff_grant(uuid, uuid, uuid, uuid, text, date, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_super_admin_masjid_update(uuid, uuid, uuid, text, text, boolean, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.prepare_super_admin_masjid_staff_grant(uuid, uuid, uuid, uuid, text, date)
  to service_role;
grant execute on function public.apply_super_admin_masjid_staff_grant(uuid, uuid, uuid, uuid, text, date, jsonb)
  to service_role;
grant execute on function public.apply_super_admin_masjid_update(uuid, uuid, uuid, text, text, boolean, jsonb)
  to service_role;

-- Keep the explicit application SECURITY DEFINER inventory current.
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
    'public.teacher_can_read_membership(uuid,date,date)',
    'public.teacher_rotation_row_scope_matches()'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
