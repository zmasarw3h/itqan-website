-- Transactional workflow foundation.
--
-- This migration is intentionally backward-compatible with the currently
-- deployed application. Phase 1B will move the existing sequential service
-- role writes onto these guarded RPCs after this migration is deployed.

create table private.workflow_mutation_requests (
  request_id uuid primary key,
  workflow text not null check (workflow in ('scoped_user_setup', 'super_admin_access_change')),
  actor_id uuid not null,
  target_id uuid not null,
  input_payload jsonb not null,
  result jsonb not null,
  completed_at timestamptz not null default now()
);

alter table private.workflow_mutation_requests enable row level security;
revoke all on table private.workflow_mutation_requests from public, anon, authenticated, service_role;

create index workflow_mutation_requests_actor_completed_idx
  on private.workflow_mutation_requests(actor_id, completed_at desc);

create or replace function private.person_access_state(input_target_profile_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', profiles.id,
      'role', profiles.role,
      'active', profiles.active
    ),
    'student_memberships', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', memberships.id,
          'student_id', memberships.student_id,
          'group_id', memberships.group_id,
          'starts_on', memberships.starts_on,
          'ends_on', memberships.ends_on,
          'assigned_by', memberships.assigned_by,
          'created_at', memberships.created_at,
          'updated_at', memberships.updated_at
        ) order by memberships.id
      )
      from public.student_group_memberships as memberships
      where memberships.student_id = profiles.id
    ), '[]'::jsonb),
    'staff_memberships', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', memberships.id,
          'profile_id', memberships.profile_id,
          'masjid_id', memberships.masjid_id,
          'staff_role', memberships.staff_role,
          'active', memberships.active,
          'starts_on', memberships.starts_on,
          'ends_on', memberships.ends_on,
          'created_by', memberships.created_by,
          'created_at', memberships.created_at,
          'updated_at', memberships.updated_at
        ) order by memberships.id
      )
      from public.masjid_staff_memberships as memberships
      where memberships.profile_id = profiles.id
    ), '[]'::jsonb)
  )
  from public.profiles
  where profiles.id = input_target_profile_id;
$$;

create or replace function public.get_person_access_state(
  input_actor_id uuid,
  input_target_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  access_state jsonb;
begin
  if input_actor_id is null or input_target_profile_id is null then
    raise exception using errcode = '22023', message = 'actor_id and target_profile_id are required.';
  end if;

  if not private.raw_is_active_super_admin(input_actor_id) then
    raise exception using errcode = '42501', message = 'actor is not an active super admin.';
  end if;

  access_state := private.person_access_state(input_target_profile_id);

  if access_state is null then
    raise exception using errcode = 'P0002', message = 'target profile does not exist.';
  end if;

  return access_state;
end;
$$;

create or replace function public.apply_scoped_user_setup(
  input_request_id uuid,
  input_actor_id uuid,
  input_profile_id uuid,
  input_name text,
  input_email text,
  input_phone text,
  input_role text,
  input_starts_on date,
  input_masjid_id uuid,
  input_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_request private.workflow_mutation_requests%rowtype;
  normalized_name text := nullif(btrim(input_name), '');
  normalized_email text := lower(nullif(btrim(input_email), ''));
  normalized_phone text := nullif(btrim(input_phone), '');
  request_payload jsonb;
  target_masjid_id uuid;
  membership_id uuid;
  result_payload jsonb;
begin
  if input_request_id is null or input_actor_id is null or input_profile_id is null then
    raise exception using errcode = '22023', message = 'request_id, actor_id, and profile_id are required.';
  end if;

  if normalized_name is null or normalized_email is null or normalized_phone is null then
    raise exception using errcode = '22023', message = 'name, email, and phone are required.';
  end if;

  if input_role not in ('student', 'teacher') then
    raise exception using errcode = '22023', message = 'role must be student or teacher.';
  end if;

  if input_starts_on is null or input_starts_on <> public.week_start_for_date(input_starts_on) then
    raise exception using errcode = '22023', message = 'starts_on must be a Sunday tracker week start.';
  end if;

  request_payload := jsonb_build_object(
    'actor_id', input_actor_id,
    'profile_id', input_profile_id,
    'name', normalized_name,
    'email', normalized_email,
    'phone', normalized_phone,
    'role', input_role,
    'starts_on', input_starts_on,
    'masjid_id', input_masjid_id,
    'group_id', input_group_id
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workflow-request:' || input_request_id::text, 0)
  );

  select requests.*
  into existing_request
  from private.workflow_mutation_requests as requests
  where requests.request_id = input_request_id;

  if found then
    if existing_request.workflow <> 'scoped_user_setup'
      or existing_request.actor_id <> input_actor_id
      or existing_request.target_id <> input_profile_id
      or existing_request.input_payload <> request_payload then
      raise exception using errcode = '22023', message = 'request_id was already used with different input.';
    end if;

    return existing_request.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('profile-id:' || input_profile_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('profile-email:' || normalized_email, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('profile-phone:' || normalized_phone, 0)
  );

  if input_role = 'student' then
    if input_group_id is null then
      raise exception using errcode = '22023', message = 'group_id is required for a student.';
    end if;

    select masajid.id
    into target_masjid_id
    from public.halaqa_groups as groups
    join public.cohorts on cohorts.id = groups.cohort_id
    join public.masajid on masajid.id = cohorts.masjid_id
    where groups.id = input_group_id
      and groups.active = true
      and cohorts.active = true
      and masajid.active = true
    for share of groups, cohorts, masajid;

    if target_masjid_id is null then
      raise exception using errcode = '22023', message = 'group_id must identify an active group in an active cohort and masjid.';
    end if;

    if input_masjid_id is not null and input_masjid_id <> target_masjid_id then
      raise exception using errcode = '22023', message = 'group_id does not belong to masjid_id.';
    end if;
  else
    if input_masjid_id is null then
      raise exception using errcode = '22023', message = 'masjid_id is required for a teacher.';
    end if;

    select masajid.id
    into target_masjid_id
    from public.masajid
    where masajid.id = input_masjid_id
      and masajid.active = true
    for share;

    if target_masjid_id is null then
      raise exception using errcode = '22023', message = 'masjid_id must identify an active masjid.';
    end if;

    if input_group_id is not null then
      raise exception using errcode = '22023', message = 'group_id must be null for a teacher.';
    end if;
  end if;

  perform 1
  from public.profiles
  where profiles.id = input_actor_id
  for share;

  if not private.raw_is_active_super_admin(input_actor_id)
    and not private.raw_is_admin_for_masjid(
      input_actor_id,
      target_masjid_id,
      public.current_effective_date()
    ) then
    raise exception using errcode = '42501', message = 'actor is not an active admin for the target masjid.';
  end if;

  if not exists (
    select 1
    from auth.users
    where users.id = input_profile_id
      and lower(users.email) = normalized_email
  ) then
    raise exception using errcode = '23503', message = 'profile_id and email must identify the same existing Auth user.';
  end if;

  if exists (
    select 1
    from public.profiles
    where profiles.id = input_profile_id
      or lower(profiles.email) = normalized_email
      or profiles.phone = normalized_phone
  ) then
    raise exception using errcode = '23505', message = 'profile id, email, or phone already exists.';
  end if;

  insert into public.profiles (id, name, email, phone, role, active)
  values (input_profile_id, normalized_name, normalized_email, normalized_phone, input_role, true);

  if input_role = 'student' then
    insert into public.student_group_memberships (
      student_id,
      group_id,
      starts_on,
      assigned_by
    )
    values (
      input_profile_id,
      input_group_id,
      input_starts_on,
      input_actor_id
    )
    returning id into membership_id;
  else
    insert into public.masjid_staff_memberships (
      profile_id,
      masjid_id,
      staff_role,
      active,
      starts_on,
      created_by
    )
    values (
      input_profile_id,
      target_masjid_id,
      'teacher',
      true,
      input_starts_on,
      input_actor_id
    )
    returning id into membership_id;
  end if;

  insert into public.super_admin_audit_events (
    actor_id,
    action,
    target_table,
    target_id,
    target_masjid_id,
    after_data,
    metadata
  )
  values (
    input_actor_id,
    'scoped_user_created',
    'profiles',
    input_profile_id,
    target_masjid_id,
    jsonb_build_object('role', input_role, 'active', true),
    jsonb_build_object(
      'membership_id', membership_id,
      'membership_table', case
        when input_role = 'student' then 'student_group_memberships'
        else 'masjid_staff_memberships'
      end,
      'group_id', input_group_id,
      'starts_on', input_starts_on
    )
  );

  result_payload := jsonb_build_object(
    'profile_id', input_profile_id,
    'membership_id', membership_id,
    'role', input_role,
    'masjid_id', target_masjid_id,
    'group_id', input_group_id
  );

  insert into private.workflow_mutation_requests (
    request_id,
    workflow,
    actor_id,
    target_id,
    input_payload,
    result
  )
  values (
    input_request_id,
    'scoped_user_setup',
    input_actor_id,
    input_profile_id,
    request_payload,
    result_payload
  );

  return result_payload;
end;
$$;

create or replace function public.apply_super_admin_access_change(
  input_request_id uuid,
  input_actor_id uuid,
  input_target_profile_id uuid,
  input_preset text,
  input_starts_on date,
  input_selected_masjid_id uuid,
  input_selected_group_id uuid,
  input_expected_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_request private.workflow_mutation_requests%rowtype;
  request_payload jsonb;
  target_profile public.profiles%rowtype;
  selected_masjid_id uuid;
  selected_group_masjid_id uuid;
  existing_selected_student_membership_id uuid;
  next_role text;
  next_active boolean;
  close_end_date date;
  membership record;
  desired_staff_role text;
  undesired_staff_roles text[] := array[]::text[];
  desired_staff_roles text[] := array[]::text[];
  impacted_admin_masjid_ids uuid[] := array[]::uuid[];
  impacted_masjid_id uuid;
  current_date_in_app date := public.current_effective_date();
  membership_id uuid;
  result_payload jsonb;
begin
  if input_request_id is null or input_actor_id is null or input_target_profile_id is null then
    raise exception using errcode = '22023', message = 'request_id, actor_id, and target_profile_id are required.';
  end if;

  if input_preset not in ('student', 'teacher', 'admin', 'admin_teacher', 'inactive') then
    raise exception using errcode = '22023', message = 'invalid access preset.';
  end if;

  if input_starts_on is null then
    raise exception using errcode = '22023', message = 'starts_on is required.';
  end if;

  if input_expected_state is null then
    raise exception using errcode = '22023', message = 'expected access state is required.';
  end if;

  request_payload := jsonb_build_object(
    'actor_id', input_actor_id,
    'target_profile_id', input_target_profile_id,
    'preset', input_preset,
    'starts_on', input_starts_on,
    'selected_masjid_id', input_selected_masjid_id,
    'selected_group_id', input_selected_group_id,
    'expected_state', input_expected_state
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workflow-request:' || input_request_id::text, 0)
  );

  select requests.*
  into existing_request
  from private.workflow_mutation_requests as requests
  where requests.request_id = input_request_id;

  if found then
    if existing_request.workflow <> 'super_admin_access_change'
      or existing_request.actor_id <> input_actor_id
      or existing_request.target_id <> input_target_profile_id
      or existing_request.input_payload <> request_payload then
      raise exception using errcode = '22023', message = 'request_id was already used with different input.';
    end if;

    return existing_request.result;
  end if;

  -- Access changes are low-volume administrative operations. A global lock
  -- gives last-super-admin and last-masjid-admin checks one serialization
  -- order even when concurrent requests target different profiles.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('super-admin-access-change', 0)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('profile-access:' || input_target_profile_id::text, 0)
  );

  perform 1
  from public.profiles
  where profiles.id = input_actor_id
  for share;

  if not private.raw_is_active_super_admin(input_actor_id) then
    raise exception using errcode = '42501', message = 'actor is not an active super admin.';
  end if;

  select profiles.*
  into target_profile
  from public.profiles
  where profiles.id = input_target_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'target profile does not exist.';
  end if;

  perform 1
  from public.student_group_memberships as memberships
  where memberships.student_id = input_target_profile_id
  for update;

  perform 1
  from public.masjid_staff_memberships as memberships
  where memberships.profile_id = input_target_profile_id
  for update;

  if private.person_access_state(input_target_profile_id) is distinct from input_expected_state then
    raise exception using errcode = 'P0001', message = 'access state changed; reload before saving.';
  end if;

  if input_preset = 'student' then
    if input_selected_group_id is null then
      raise exception using errcode = '22023', message = 'selected_group_id is required for student access.';
    end if;

    select masajid.id
    into selected_group_masjid_id
    from public.halaqa_groups as groups
    join public.cohorts on cohorts.id = groups.cohort_id
    join public.masajid on masajid.id = cohorts.masjid_id
    where groups.id = input_selected_group_id
      and groups.active = true
      and cohorts.active = true
      and masajid.active = true
    for share of groups, cohorts, masajid;

    if selected_group_masjid_id is null then
      raise exception using errcode = '22023', message = 'selected_group_id must identify an active group in an active cohort and masjid.';
    end if;

    if input_selected_masjid_id is not null and input_selected_masjid_id <> selected_group_masjid_id then
      raise exception using errcode = '22023', message = 'selected group does not belong to selected masjid.';
    end if;
  elsif input_preset in ('teacher', 'admin', 'admin_teacher') then
    if input_selected_masjid_id is null then
      raise exception using errcode = '22023', message = 'selected_masjid_id is required for staff access.';
    end if;

    select masajid.id
    into selected_masjid_id
    from public.masajid
    where masajid.id = input_selected_masjid_id
      and masajid.active = true
    for update;

    if selected_masjid_id is null then
      raise exception using errcode = '22023', message = 'selected_masjid_id must identify an active masjid.';
    end if;

    if input_selected_group_id is not null then
      raise exception using errcode = '22023', message = 'selected_group_id must be null for staff access.';
    end if;
  elsif input_selected_masjid_id is not null or input_selected_group_id is not null then
    raise exception using errcode = '22023', message = 'inactive access does not accept masjid or group scope.';
  end if;

  if input_preset = 'inactive' then
    next_role := target_profile.role;
    next_active := false;
    close_end_date := input_starts_on;
  elsif input_preset = 'student' then
    next_role := 'student';
    next_active := true;
    close_end_date := input_starts_on - 1;
  elsif input_preset = 'admin' then
    next_role := 'admin';
    next_active := true;
    close_end_date := input_starts_on - 1;
    desired_staff_roles := array['admin'];
    undesired_staff_roles := array['teacher'];
  elsif input_preset = 'admin_teacher' then
    next_role := 'admin';
    next_active := true;
    close_end_date := input_starts_on - 1;
    desired_staff_roles := array['admin', 'teacher'];
  else
    next_role := 'teacher';
    next_active := true;
    close_end_date := input_starts_on - 1;
    desired_staff_roles := array['teacher'];
    undesired_staff_roles := array['admin'];
  end if;

  if input_preset = 'student' then
    select memberships.id
    into existing_selected_student_membership_id
    from public.student_group_memberships as memberships
    where memberships.student_id = input_target_profile_id
      and memberships.group_id = input_selected_group_id
      and memberships.ends_on is null
      and memberships.starts_on <= input_starts_on
    order by memberships.starts_on desc, memberships.id
    limit 1;
  end if;

  if input_preset in ('inactive', 'student', 'teacher', 'admin', 'admin_teacher') then
    for membership in
      select memberships.*,
             cohorts.masjid_id
      from public.student_group_memberships as memberships
      join public.halaqa_groups as groups on groups.id = memberships.group_id
      join public.cohorts on cohorts.id = groups.cohort_id
      where memberships.student_id = input_target_profile_id
        and memberships.ends_on is null
        and (
          input_preset <> 'student'
          or memberships.id <> existing_selected_student_membership_id
        )
      order by memberships.id
    loop
      if membership.starts_on > close_end_date then
        raise exception using errcode = '22023', message = 'effective date cannot close a future student membership.';
      end if;

      update public.student_group_memberships
      set ends_on = close_end_date,
          updated_at = now()
      where id = membership.id
        and ends_on is null;

      insert into public.super_admin_audit_events (
        actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data
      ) values (
        input_actor_id,
        'student_membership_closed',
        'student_group_memberships',
        membership.id,
        membership.masjid_id,
        jsonb_build_object(
          'student_id', membership.student_id,
          'group_id', membership.group_id,
          'starts_on', membership.starts_on,
          'ends_on', membership.ends_on
        ),
        jsonb_build_object(
          'student_id', membership.student_id,
          'group_id', membership.group_id,
          'starts_on', membership.starts_on,
          'ends_on', close_end_date
        )
      );
    end loop;
  end if;

  if input_preset = 'student' and existing_selected_student_membership_id is null then
    insert into public.student_group_memberships (
      student_id, group_id, starts_on, assigned_by
    ) values (
      input_target_profile_id, input_selected_group_id, input_starts_on, input_actor_id
    )
    returning id into membership_id;

    insert into public.super_admin_audit_events (
      actor_id, action, target_table, target_id, target_masjid_id, after_data
    ) values (
      input_actor_id,
      'student_membership_created',
      'student_group_memberships',
      membership_id,
      selected_group_masjid_id,
      jsonb_build_object(
        'student_id', input_target_profile_id,
        'group_id', input_selected_group_id,
        'starts_on', input_starts_on,
        'ends_on', null
      )
    );
  end if;

  if input_preset in ('inactive', 'student') then
    for membership in
      select memberships.*
      from public.masjid_staff_memberships as memberships
      where memberships.profile_id = input_target_profile_id
        and memberships.active = true
        and memberships.ends_on is null
      order by memberships.id
    loop
      if membership.starts_on > close_end_date then
        raise exception using errcode = '22023', message = 'effective date cannot close a future staff membership.';
      end if;

      if membership.staff_role = 'admin' then
        impacted_admin_masjid_ids := array_append(impacted_admin_masjid_ids, membership.masjid_id);
      end if;

      update public.masjid_staff_memberships
      set ends_on = close_end_date,
          updated_at = now()
      where id = membership.id
        and active = true
        and ends_on is null;

      insert into public.super_admin_audit_events (
        actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data
      ) values (
        input_actor_id,
        'staff_membership_closed',
        'masjid_staff_memberships',
        membership.id,
        membership.masjid_id,
        jsonb_build_object(
          'profile_id', membership.profile_id,
          'masjid_id', membership.masjid_id,
          'staff_role', membership.staff_role,
          'active', membership.active,
          'starts_on', membership.starts_on,
          'ends_on', membership.ends_on
        ),
        jsonb_build_object(
          'profile_id', membership.profile_id,
          'masjid_id', membership.masjid_id,
          'staff_role', membership.staff_role,
          'active', membership.active,
          'starts_on', membership.starts_on,
          'ends_on', close_end_date
        )
      );
    end loop;
  elsif input_preset in ('teacher', 'admin', 'admin_teacher') then
    for membership in
      select memberships.*
      from public.masjid_staff_memberships as memberships
      where memberships.profile_id = input_target_profile_id
        and memberships.masjid_id = selected_masjid_id
        and memberships.staff_role = any(undesired_staff_roles)
        and memberships.active = true
        and memberships.ends_on is null
      order by memberships.id
    loop
      if membership.starts_on > close_end_date then
        raise exception using errcode = '22023', message = 'effective date cannot close a future staff membership.';
      end if;

      if membership.staff_role = 'admin' then
        impacted_admin_masjid_ids := array_append(impacted_admin_masjid_ids, membership.masjid_id);
      end if;

      update public.masjid_staff_memberships
      set ends_on = close_end_date,
          updated_at = now()
      where id = membership.id
        and active = true
        and ends_on is null;

      insert into public.super_admin_audit_events (
        actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data
      ) values (
        input_actor_id,
        'staff_membership_closed',
        'masjid_staff_memberships',
        membership.id,
        membership.masjid_id,
        jsonb_build_object(
          'profile_id', membership.profile_id,
          'masjid_id', membership.masjid_id,
          'staff_role', membership.staff_role,
          'active', membership.active,
          'starts_on', membership.starts_on,
          'ends_on', membership.ends_on
        ),
        jsonb_build_object(
          'profile_id', membership.profile_id,
          'masjid_id', membership.masjid_id,
          'staff_role', membership.staff_role,
          'active', membership.active,
          'starts_on', membership.starts_on,
          'ends_on', close_end_date
        )
      );
    end loop;

    foreach desired_staff_role in array desired_staff_roles
    loop
      if not exists (
        select 1
        from public.masjid_staff_memberships as memberships
        where memberships.profile_id = input_target_profile_id
          and memberships.masjid_id = selected_masjid_id
          and memberships.staff_role = desired_staff_role
          and memberships.active = true
          and memberships.starts_on <= input_starts_on
          and (memberships.ends_on is null or memberships.ends_on >= input_starts_on)
      ) then
        if exists (
          select 1
          from public.masjid_staff_memberships as memberships
          where memberships.profile_id = input_target_profile_id
            and memberships.masjid_id = selected_masjid_id
            and memberships.staff_role = desired_staff_role
            and memberships.active = true
            and memberships.ends_on is null
            and memberships.starts_on > input_starts_on
        ) then
          raise exception using errcode = '22023', message = 'effective date overlaps a future staff membership.';
        end if;

        insert into public.masjid_staff_memberships (
          profile_id, masjid_id, staff_role, active, starts_on, created_by
        ) values (
          input_target_profile_id,
          selected_masjid_id,
          desired_staff_role,
          true,
          input_starts_on,
          input_actor_id
        )
        returning id into membership_id;

        insert into public.super_admin_audit_events (
          actor_id, action, target_table, target_id, target_masjid_id, after_data
        ) values (
          input_actor_id,
          'staff_membership_created',
          'masjid_staff_memberships',
          membership_id,
          selected_masjid_id,
          jsonb_build_object(
            'profile_id', input_target_profile_id,
            'masjid_id', selected_masjid_id,
            'staff_role', desired_staff_role,
            'active', true,
            'starts_on', input_starts_on,
            'ends_on', null
          )
        );
      end if;
    end loop;

    if input_preset = 'teacher' and exists (
      select 1
      from public.masjid_staff_memberships as memberships
      where memberships.profile_id = input_target_profile_id
        and memberships.staff_role = 'admin'
        and memberships.active = true
        and memberships.starts_on <= input_starts_on
        and (memberships.ends_on is null or memberships.ends_on >= input_starts_on)
    ) then
      next_role := 'admin';
    end if;
  end if;

  if target_profile.role = 'super_admin'
    and target_profile.active
    and (next_role <> 'super_admin' or not next_active) then
    if input_actor_id = input_target_profile_id then
      raise exception using errcode = '42501', message = 'super admins cannot demote or deactivate their own account.';
    end if;

    perform 1
    from public.profiles
    where profiles.role = 'super_admin'
      and profiles.active = true
    order by profiles.id
    for update;

    if (
      select count(*)
      from public.profiles
      where profiles.role = 'super_admin'
        and profiles.active = true
    ) <= 1 then
      raise exception using errcode = '23514', message = 'at least one active super admin must remain.';
    end if;
  end if;

  if (target_profile.role, target_profile.active) is distinct from (next_role, next_active) then
    update public.profiles
    set role = next_role,
        active = next_active
    where id = input_target_profile_id;

    insert into public.super_admin_audit_events (
      actor_id, action, target_table, target_id, before_data, after_data, metadata
    ) values (
      input_actor_id,
      'profile_access_update',
      'profiles',
      input_target_profile_id,
      jsonb_build_object('role', target_profile.role, 'active', target_profile.active),
      jsonb_build_object('role', next_role, 'active', next_active),
      jsonb_build_object('preset', input_preset)
    );
  end if;

  if next_role <> 'admin' or not next_active then
    select impacted_admin_masjid_ids
      || coalesce(array_agg(distinct memberships.masjid_id), array[]::uuid[])
    into impacted_admin_masjid_ids
    from public.masjid_staff_memberships as memberships
    where memberships.profile_id = input_target_profile_id
      and memberships.staff_role = 'admin'
      and memberships.active = true
      and not (memberships.masjid_id = any(impacted_admin_masjid_ids));
  end if;

  for impacted_masjid_id in
    select distinct ids.masjid_id
    from unnest(impacted_admin_masjid_ids) as ids(masjid_id)
    join public.masajid on masajid.id = ids.masjid_id
    where masajid.active = true
    order by ids.masjid_id
  loop
    perform 1
    from public.masajid
    where masajid.id = impacted_masjid_id
    for update;

    if not exists (
      select 1
      from public.profiles
      join public.masjid_staff_memberships as memberships
        on memberships.profile_id = profiles.id
      where profiles.role = 'admin'
        and profiles.active = true
        and memberships.masjid_id = impacted_masjid_id
        and memberships.staff_role = 'admin'
        and memberships.active = true
        and memberships.starts_on <= current_date_in_app
        and (memberships.ends_on is null or memberships.ends_on >= current_date_in_app)
    ) then
      raise exception using errcode = '23514', message = 'an active masjid must retain an active admin.';
    end if;

    if not exists (
      select 1
      from public.profiles
      join public.masjid_staff_memberships as memberships
        on memberships.profile_id = profiles.id
      where profiles.role = 'admin'
        and profiles.active = true
        and memberships.masjid_id = impacted_masjid_id
        and memberships.staff_role = 'admin'
        and memberships.active = true
        and memberships.starts_on <= input_starts_on
        and (memberships.ends_on is null or memberships.ends_on >= input_starts_on)
    ) then
      raise exception using errcode = '23514', message = 'an active masjid must retain an active admin on the effective date.';
    end if;
  end loop;

  result_payload := jsonb_build_object(
    'profile_id', input_target_profile_id,
    'preset', input_preset,
    'role', next_role,
    'active', next_active,
    'access_state', private.person_access_state(input_target_profile_id)
  );

  insert into private.workflow_mutation_requests (
    request_id,
    workflow,
    actor_id,
    target_id,
    input_payload,
    result
  ) values (
    input_request_id,
    'super_admin_access_change',
    input_actor_id,
    input_target_profile_id,
    request_payload,
    result_payload
  );

  return result_payload;
end;
$$;

revoke all on function private.person_access_state(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.get_person_access_state(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_scoped_user_setup(uuid, uuid, uuid, text, text, text, text, date, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_super_admin_access_change(uuid, uuid, uuid, text, date, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.get_person_access_state(uuid, uuid) to service_role;
grant execute on function public.apply_scoped_user_setup(uuid, uuid, uuid, text, text, text, text, date, uuid, uuid)
  to service_role;
grant execute on function public.apply_super_admin_access_change(uuid, uuid, uuid, text, date, uuid, uuid, jsonb)
  to service_role;

-- Keep the hardening migration's explicit SECURITY DEFINER inventory current.
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
    'public.group_masjid_id(uuid)',
    'public.is_active_admin()',
    'public.is_active_student()',
    'public.is_active_super_admin()',
    'public.is_active_teacher()',
    'public.is_admin_for_masjid(uuid)',
    'public.is_rotation_teacher_for_masjid_week(uuid,uuid,date)',
    'public.is_staff_for_masjid(uuid)',
    'public.is_teacher_for_group_week(uuid,date)',
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
