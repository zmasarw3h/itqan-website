alter table private.workflow_mutation_requests
  drop constraint workflow_mutation_requests_workflow_check;

alter table private.workflow_mutation_requests
  add constraint workflow_mutation_requests_workflow_check check (workflow in (
    'scoped_user_setup',
    'super_admin_access_change',
    'staff_membership_end',
    'masjid_staff_grant',
    'masjid_provision',
    'hierarchy_change'
  ));

create or replace function public.apply_super_admin_masjid_provision(
  input_request_id uuid,
  input_actor_id uuid,
  input_name text,
  input_slug text,
  input_cohort_name text,
  input_cohort_kind text,
  input_cohort_sort_order integer,
  input_cohort_active boolean,
  input_group_name text,
  input_group_sort_order integer,
  input_group_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_request private.workflow_mutation_requests%rowtype;
  normalized_name text := nullif(btrim(input_name), '');
  normalized_slug text := lower(nullif(btrim(input_slug), ''));
  normalized_cohort_name text := nullif(btrim(input_cohort_name), '');
  normalized_group_name text := nullif(btrim(input_group_name), '');
  stable_payload jsonb;
  result_payload jsonb;
  created_masjid public.masajid%rowtype;
  created_cohort public.cohorts%rowtype;
  created_group public.halaqa_groups%rowtype;
  created_cohort_id uuid;
  created_group_id uuid;
begin
  if input_request_id is null or input_actor_id is null then
    raise exception using errcode = '22023', message = 'request_id and actor_id are required.';
  end if;

  if normalized_name is null or char_length(normalized_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'masjid name is invalid.';
  end if;

  if normalized_slug is null or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception using errcode = '22023', message = 'masjid slug is invalid.';
  end if;

  if normalized_cohort_name is null and normalized_group_name is not null then
    raise exception using errcode = '22023', message = 'a starter group requires a starter cohort.';
  end if;

  if normalized_cohort_name is not null then
    if char_length(normalized_cohort_name) not between 2 and 120
      or input_cohort_kind not in ('brothers', 'sisters')
      or input_cohort_sort_order is null
      or input_cohort_sort_order < 1
      or input_cohort_active is null then
      raise exception using errcode = '22023', message = 'starter cohort values are invalid.';
    end if;
  end if;

  if normalized_group_name is not null and (
    char_length(normalized_group_name) not between 2 and 120
    or input_group_sort_order is null
    or input_group_sort_order < 1
    or input_group_active is null
  ) then
    raise exception using errcode = '22023', message = 'starter group values are invalid.';
  end if;

  stable_payload := jsonb_build_object(
    'actor_id', input_actor_id,
    'name', normalized_name,
    'slug', normalized_slug,
    'cohort_name', normalized_cohort_name,
    'cohort_kind', input_cohort_kind,
    'cohort_sort_order', input_cohort_sort_order,
    'cohort_active', input_cohort_active,
    'group_name', normalized_group_name,
    'group_sort_order', input_group_sort_order,
    'group_active', input_group_active
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workflow-request:' || input_request_id::text, 0)
  );

  select requests.*
  into existing_request
  from private.workflow_mutation_requests as requests
  where requests.request_id = input_request_id;

  if found then
    if existing_request.actor_id <> input_actor_id then
      raise exception using errcode = '42501', message = 'request belongs to another actor.';
    end if;

    if existing_request.workflow <> 'masjid_provision'
      or existing_request.input_payload <> stable_payload then
      raise exception using errcode = '22023', message = 'request_id was already used with different input.';
    end if;

    if not private.raw_is_active_super_admin(input_actor_id) then
      raise exception using errcode = '42501', message = 'actor is not an active super admin.';
    end if;

    return existing_request.result;
  end if;

  perform 1
  from public.profiles
  where profiles.id = input_actor_id
  for share;

  if not private.raw_is_active_super_admin(input_actor_id) then
    raise exception using errcode = '42501', message = 'actor is not an active super admin.';
  end if;

  insert into public.masajid (name, slug, active)
  values (normalized_name, normalized_slug, false)
  returning * into created_masjid;

  insert into public.super_admin_audit_events (
    actor_id, action, target_table, target_id, target_masjid_id, after_data, metadata
  ) values (
    input_actor_id,
    'masjid_created',
    'masajid',
    created_masjid.id,
    created_masjid.id,
    to_jsonb(created_masjid),
    jsonb_build_object('request_id', input_request_id, 'source_workflow', 'masjid_provision')
  );

  if normalized_cohort_name is not null then
    insert into public.cohorts (masjid_id, kind, name, active, sort_order)
    values (
      created_masjid.id,
      input_cohort_kind,
      normalized_cohort_name,
      input_cohort_active,
      input_cohort_sort_order
    )
    returning * into created_cohort;
    created_cohort_id := created_cohort.id;

    insert into public.super_admin_audit_events (
      actor_id, action, target_table, target_id, target_masjid_id, after_data, metadata
    ) values (
      input_actor_id,
      'cohort_created',
      'cohorts',
      created_cohort.id,
      created_masjid.id,
      to_jsonb(created_cohort),
      jsonb_build_object('request_id', input_request_id, 'source_workflow', 'masjid_provision')
    );

    if normalized_group_name is not null then
      insert into public.halaqa_groups (cohort_id, name, active, sort_order)
      values (created_cohort.id, normalized_group_name, input_group_active, input_group_sort_order)
      returning * into created_group;
      created_group_id := created_group.id;

      insert into public.super_admin_audit_events (
        actor_id, action, target_table, target_id, target_masjid_id, after_data, metadata
      ) values (
        input_actor_id,
        'group_created',
        'halaqa_groups',
        created_group.id,
        created_masjid.id,
        to_jsonb(created_group),
        jsonb_build_object('request_id', input_request_id, 'source_workflow', 'masjid_provision')
      );
    end if;
  end if;

  result_payload := jsonb_build_object(
    'masjid_id', created_masjid.id,
    'cohort_id', created_cohort_id,
    'group_id', created_group_id,
    'active', false
  );

  insert into private.workflow_mutation_requests (
    request_id, workflow, actor_id, target_id, input_payload, result
  ) values (
    input_request_id,
    'masjid_provision',
    input_actor_id,
    created_masjid.id,
    stable_payload,
    result_payload
  );

  return result_payload;
end;
$$;

revoke all on function public.apply_super_admin_masjid_provision(
  uuid, uuid, text, text, text, text, integer, boolean, text, integer, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.apply_super_admin_masjid_provision(
  uuid, uuid, text, text, text, text, integer, boolean, text, integer, boolean
) to service_role;

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
            and (memberships.ends_on is null or memberships.ends_on >= public.current_effective_date()))
        +
        (select count(*) from public.group_teacher_assignments as assignments
          where assignments.group_id = changed_group.id and assignments.active
            and assignments.week_start >= (
              public.current_effective_date() - extract(dow from public.current_effective_date())::integer
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

-- Signed sessions retain global super-admin reads through can_read_* helpers,
-- but all hierarchy writes now go through the actor-guarded service workflows.
drop policy if exists "Admins can manage masajid foundation data" on public.masajid;
drop policy if exists "Admins can manage cohort foundation data" on public.cohorts;
drop policy if exists "Admins can manage halaqa group foundation data" on public.halaqa_groups;

create or replace function private.assert_masjid_hierarchy_readiness(input_masjid_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.masajid
    where masajid.id = input_masjid_id and masajid.active
  ) then
    return;
  end if;

  if not exists (
    select 1 from public.cohorts
    where cohorts.masjid_id = input_masjid_id and cohorts.active
  ) then
    raise exception using errcode = '23514', message = 'an active masjid must retain an active cohort.';
  end if;

  if not exists (
    select 1
    from public.halaqa_groups as groups
    join public.cohorts on cohorts.id = groups.cohort_id
    where cohorts.masjid_id = input_masjid_id and cohorts.active and groups.active
  ) then
    raise exception using errcode = '23514', message = 'an active masjid must retain an active group under an active cohort.';
  end if;
end;
$$;

create or replace function private.enforce_masjid_hierarchy_readiness()
returns trigger
language plpgsql
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

drop trigger if exists enforce_masjid_hierarchy_readiness on public.masajid;
create trigger enforce_masjid_hierarchy_readiness
  after insert or update or delete on public.masajid
  for each row execute function private.enforce_masjid_hierarchy_readiness();

drop trigger if exists enforce_cohort_hierarchy_readiness on public.cohorts;
create trigger enforce_cohort_hierarchy_readiness
  after insert or update or delete on public.cohorts
  for each row execute function private.enforce_masjid_hierarchy_readiness();

drop trigger if exists enforce_group_hierarchy_readiness on public.halaqa_groups;
create trigger enforce_group_hierarchy_readiness
  after insert or update or delete on public.halaqa_groups
  for each row execute function private.enforce_masjid_hierarchy_readiness();

revoke all on function private.assert_masjid_hierarchy_readiness(uuid)
  from public, anon, authenticated, service_role;
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
    'private.apply_super_admin_masjid_staff_grant_once(uuid,uuid,uuid,uuid,text,date,jsonb)'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
