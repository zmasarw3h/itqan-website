-- Restore the access-transition behavior for databases that already applied
-- the immutable pre-Slice-3 migrations. This migration deliberately replaces
-- only the functions whose civil-date behavior changed in Slice 3.

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
  desired_roles text[];
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

  desired_roles := case input_grant
    when 'admin' then array['admin']::text[]
    when 'teacher' then array['teacher']::text[]
    when 'admin_teacher' then array['admin', 'teacher']::text[]
  end;

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

  perform 1
  from public.profiles
  where profiles.id = input_actor_id
  for share;

  if not private.raw_is_active_super_admin(input_actor_id) then
    raise exception using errcode = '42501', message = 'actor is not an active super admin.';
  end if;

  if input_starts_on < public.current_toronto_civil_date() then
    raise exception using errcode = '22023', message = 'staff grant date cannot be historical.';
  end if;

  if input_starts_on > public.current_toronto_civil_date() then
    perform private.assert_future_profile_projection_unchanged(
      input_target_profile_id,
      input_starts_on,
      'add_staff',
      input_masjid_id,
      desired_roles,
      null,
      null
    );
  end if;

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

    return existing_snapshot.expected_state;
  end if;

  -- Recover snapshots for requests committed immediately before this
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

revoke all on function public.prepare_super_admin_masjid_staff_grant(uuid, uuid, uuid, uuid, text, date)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_super_admin_masjid_staff_grant(uuid, uuid, uuid, uuid, text, date)
  to service_role;

create or replace function public.apply_super_admin_hierarchy_change(
  input_request_id uuid,
  input_actor_id uuid,
  input_operation text,
  input_masjid_id uuid,
  input_cohort_id uuid,
  input_group_id uuid,
  input_name text,
  input_kind text,
  input_sort_order integer,
  input_active boolean,
  input_expected_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_request private.workflow_mutation_requests%rowtype;
  normalized_name text := nullif(btrim(input_name), '');
  stable_payload jsonb;
  current_state jsonb;
  result_payload jsonb;
  changed_cohort public.cohorts%rowtype;
  changed_group public.halaqa_groups%rowtype;
  parent_cohort public.cohorts%rowtype;
  target_id uuid;
  result_cohort_id uuid;
  result_group_id uuid;
  dependency_count integer;
begin
  if input_request_id is null or input_actor_id is null or input_masjid_id is null then
    raise exception using errcode = '22023', message = 'request, actor, and masjid are required.';
  end if;

  if input_operation not in ('create_cohort', 'update_cohort', 'create_group', 'update_group') then
    raise exception using errcode = '22023', message = 'hierarchy operation is invalid.';
  end if;

  if normalized_name is null or char_length(normalized_name) not between 2 and 120
    or input_sort_order is null or input_sort_order < 1 or input_active is null then
    raise exception using errcode = '22023', message = 'hierarchy values are invalid.';
  end if;

  if input_operation in ('create_cohort', 'update_cohort') and input_kind not in ('brothers', 'sisters') then
    raise exception using errcode = '22023', message = 'cohort kind is invalid.';
  end if;

  stable_payload := jsonb_build_object(
    'actor_id', input_actor_id,
    'operation', input_operation,
    'masjid_id', input_masjid_id,
    'cohort_id', input_cohort_id,
    'group_id', input_group_id,
    'name', normalized_name,
    'kind', input_kind,
    'sort_order', input_sort_order,
    'active', input_active,
    'expected_state', input_expected_state
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workflow-request:' || input_request_id::text, 0)
  );

  select requests.* into existing_request
  from private.workflow_mutation_requests as requests
  where requests.request_id = input_request_id;

  if found then
    if existing_request.actor_id <> input_actor_id then
      raise exception using errcode = '42501', message = 'request belongs to another actor.';
    end if;
    if existing_request.workflow <> 'hierarchy_change' or existing_request.input_payload <> stable_payload then
      raise exception using errcode = '22023', message = 'request_id was already used with different input.';
    end if;
    if not private.raw_is_active_super_admin(input_actor_id) then
      raise exception using errcode = '42501', message = 'actor is not an active super admin.';
    end if;
    return existing_request.result;
  end if;

  perform 1 from public.profiles where profiles.id = input_actor_id for share;
  if not private.raw_is_active_super_admin(input_actor_id) then
    raise exception using errcode = '42501', message = 'actor is not an active super admin.';
  end if;

  perform 1 from public.masajid where masajid.id = input_masjid_id for share;
  if not found then
    raise exception using errcode = '22023', message = 'masjid does not exist.';
  end if;

  if input_operation = 'create_cohort' then
    insert into public.cohorts (masjid_id, kind, name, active, sort_order)
    values (input_masjid_id, input_kind, normalized_name, input_active, input_sort_order)
    returning * into changed_cohort;
    target_id := changed_cohort.id;
    result_cohort_id := changed_cohort.id;

    insert into public.super_admin_audit_events (
      actor_id, action, target_table, target_id, target_masjid_id, after_data, metadata
    ) values (
      input_actor_id, 'cohort_created', 'cohorts', target_id, input_masjid_id,
      to_jsonb(changed_cohort),
      jsonb_build_object('request_id', input_request_id, 'source_workflow', 'hierarchy_change')
    );

  elsif input_operation = 'update_cohort' then
    if input_cohort_id is null then
      raise exception using errcode = '22023', message = 'cohort is required.';
    end if;

    select cohorts.* into changed_cohort
    from public.cohorts as cohorts
    where cohorts.id = input_cohort_id and cohorts.masjid_id = input_masjid_id
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'cohort does not exist in this masjid.';
    end if;

    current_state := jsonb_build_object(
      'id', changed_cohort.id, 'masjid_id', changed_cohort.masjid_id, 'kind', changed_cohort.kind,
      'name', changed_cohort.name, 'active', changed_cohort.active,
      'sort_order', changed_cohort.sort_order, 'updated_at', changed_cohort.updated_at
    );
    if input_expected_state is null or input_expected_state <> current_state then
      raise exception using errcode = '40001', message = 'cohort state changed; review and try again.';
    end if;

    if changed_cohort.active and not input_active then
      select count(*) into dependency_count
      from public.halaqa_groups
      where halaqa_groups.cohort_id = changed_cohort.id and halaqa_groups.active;
      if dependency_count > 0 then
        raise exception using errcode = '23514', message = 'deactivate active groups in this cohort first.';
      end if;
    end if;

    update public.cohorts
    set name = normalized_name, kind = input_kind, sort_order = input_sort_order,
        active = input_active, updated_at = statement_timestamp()
    where cohorts.id = changed_cohort.id
    returning * into changed_cohort;
    target_id := changed_cohort.id;
    result_cohort_id := changed_cohort.id;

    insert into public.super_admin_audit_events (
      actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data, metadata
    ) values (
      input_actor_id, 'cohort_updated', 'cohorts', target_id, input_masjid_id,
      current_state, to_jsonb(changed_cohort),
      jsonb_build_object('request_id', input_request_id, 'source_workflow', 'hierarchy_change')
    );

  elsif input_operation = 'create_group' then
    if input_cohort_id is null then
      raise exception using errcode = '22023', message = 'cohort is required.';
    end if;
    select cohorts.* into parent_cohort
    from public.cohorts as cohorts
    where cohorts.id = input_cohort_id and cohorts.masjid_id = input_masjid_id
    for share;
    if not found then
      raise exception using errcode = '22023', message = 'cohort does not exist in this masjid.';
    end if;
    if input_active and not parent_cohort.active then
      raise exception using errcode = '23514', message = 'activate the parent cohort before creating an active group.';
    end if;

    insert into public.halaqa_groups (cohort_id, name, active, sort_order)
    values (input_cohort_id, normalized_name, input_active, input_sort_order)
    returning * into changed_group;
    target_id := changed_group.id;
    result_cohort_id := input_cohort_id;
    result_group_id := changed_group.id;

    insert into public.super_admin_audit_events (
      actor_id, action, target_table, target_id, target_masjid_id, after_data, metadata
    ) values (
      input_actor_id, 'group_created', 'halaqa_groups', target_id, input_masjid_id,
      to_jsonb(changed_group),
      jsonb_build_object('request_id', input_request_id, 'source_workflow', 'hierarchy_change')
    );

  else
    if input_cohort_id is null or input_group_id is null then
      raise exception using errcode = '22023', message = 'cohort and group are required.';
    end if;
    select cohorts.* into parent_cohort
    from public.cohorts as cohorts
    where cohorts.id = input_cohort_id and cohorts.masjid_id = input_masjid_id
    for share;
    if not found then
      raise exception using errcode = '22023', message = 'cohort does not exist in this masjid.';
    end if;

    select groups.* into changed_group
    from public.halaqa_groups as groups
    where groups.id = input_group_id and groups.cohort_id = input_cohort_id
    for update;
    if not found then
      raise exception using errcode = '22023', message = 'group does not exist in this cohort.';
    end if;

    current_state := jsonb_build_object(
      'id', changed_group.id, 'cohort_id', changed_group.cohort_id, 'name', changed_group.name,
      'active', changed_group.active, 'sort_order', changed_group.sort_order,
      'updated_at', changed_group.updated_at
    );
    if input_expected_state is null or input_expected_state <> current_state then
      raise exception using errcode = '40001', message = 'group state changed; review and try again.';
    end if;
    if input_active and not parent_cohort.active then
      raise exception using errcode = '23514', message = 'activate the parent cohort before activating this group.';
    end if;

    if changed_group.active and not input_active then
      select (
        (select count(*) from public.student_group_memberships as memberships
          where memberships.group_id = changed_group.id
            and (memberships.ends_on is null or memberships.ends_on >= public.current_toronto_civil_date()))
        +
        (select count(*) from public.group_teacher_assignments as assignments
          where assignments.group_id = changed_group.id and assignments.active
            and assignments.week_start >= (
              public.current_toronto_civil_date() - extract(dow from public.current_toronto_civil_date())::integer
            ))
      ) into dependency_count;
      if dependency_count > 0 then
        raise exception using errcode = '23514', message = 'group has current or future student/teacher dependencies.';
      end if;
    end if;

    update public.halaqa_groups
    set name = normalized_name, sort_order = input_sort_order, active = input_active,
        updated_at = statement_timestamp()
    where halaqa_groups.id = changed_group.id
    returning * into changed_group;
    target_id := changed_group.id;
    result_cohort_id := input_cohort_id;
    result_group_id := changed_group.id;

    insert into public.super_admin_audit_events (
      actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data, metadata
    ) values (
      input_actor_id, 'group_updated', 'halaqa_groups', target_id, input_masjid_id,
      current_state, to_jsonb(changed_group),
      jsonb_build_object('request_id', input_request_id, 'source_workflow', 'hierarchy_change')
    );
  end if;

  result_payload := jsonb_build_object(
    'target_id', target_id,
    'operation', input_operation,
    'cohort_id', result_cohort_id,
    'group_id', result_group_id
  );

  insert into private.workflow_mutation_requests (
    request_id, workflow, actor_id, target_id, input_payload, result
  ) values (
    input_request_id, 'hierarchy_change', input_actor_id, target_id, stable_payload, result_payload
  );

  return result_payload;
end;
$$;

revoke all on function public.apply_super_admin_hierarchy_change(
  uuid, uuid, text, uuid, uuid, uuid, text, text, integer, boolean, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.apply_super_admin_hierarchy_change(
  uuid, uuid, text, uuid, uuid, uuid, text, text, integer, boolean, jsonb
) to service_role;
