-- Rotation publication integrity.
--
-- The planner remains a deterministic presentation concern, but PostgreSQL
-- owns the publication decision.  This migration deliberately keeps the
-- legacy generation signature executable during the database-first rollout.

alter table private.workflow_mutation_requests
  drop constraint workflow_mutation_requests_workflow_check;

alter table private.workflow_mutation_requests
  add constraint workflow_mutation_requests_workflow_check check (workflow in (
    'scoped_user_setup',
    'super_admin_access_change',
    'staff_membership_end',
    'masjid_staff_grant',
    'masjid_provision',
    'hierarchy_change',
    'teacher_rotation_publication'
  ));

alter table private.workflow_expected_state_snapshots
  drop constraint workflow_expected_state_snapshots_workflow_check;

alter table private.workflow_expected_state_snapshots
  add constraint workflow_expected_state_snapshots_workflow_check check (workflow in (
    'masjid_staff_grant',
    'teacher_rotation_publication'
  ));

alter table public.teacher_rotation_runs
  add column if not exists request_id uuid,
  add column if not exists masjid_id uuid references public.masajid(id) on delete restrict,
  add column if not exists halaqa_saturday date,
  add column if not exists expected_state_digest text,
  add column if not exists eligible_teacher_count integer,
  add column if not exists unassigned_group_ids jsonb,
  add column if not exists unassigned_teacher_ids jsonb,
  add column if not exists assignment_result jsonb,
  add column if not exists warning_codes jsonb,
  add column if not exists completed_at timestamptz,
  add column if not exists publication_source text;

create unique index if not exists teacher_rotation_runs_request_id_unique_idx
  on public.teacher_rotation_runs(request_id)
  where request_id is not null;

create index if not exists teacher_rotation_runs_masjid_cohort_week_idx
  on public.teacher_rotation_runs(masjid_id, cohort_id, week_start);

-- A per-cohort version lets a publication take a shared lock immediately
-- before its final comparison. State writers take the conflicting update lock.
-- Two publications for different weeks can hold shared locks concurrently,
-- while an out-of-band availability/member/group insertion cannot slip between
-- the final comparison and publication commit. Publishers lock existing public
-- rows before this version lock: that order matches writers, which acquire a
-- public row lock before their AFTER trigger advances the version.
create table if not exists private.rotation_publication_state_versions (
  cohort_id uuid primary key references public.cohorts(id) on delete cascade,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table private.rotation_publication_state_versions enable row level security;
revoke all on table private.rotation_publication_state_versions
  from public, anon, authenticated, service_role;

create or replace function private.ensure_rotation_publication_state_version(
  input_cohort_id uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  current_version bigint;
begin
  insert into private.rotation_publication_state_versions (cohort_id)
  values (input_cohort_id)
  on conflict (cohort_id) do nothing;

  select versions.version
  into current_version
  from private.rotation_publication_state_versions as versions
  where versions.cohort_id = input_cohort_id;

  return current_version;
end;
$$;

create or replace function private.bump_rotation_publication_state_version(
  input_cohort_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if input_cohort_id is null then
    return;
  end if;

  perform private.ensure_rotation_publication_state_version(input_cohort_id);
  update private.rotation_publication_state_versions
  set version = version + 1,
      updated_at = statement_timestamp()
  where cohort_id = input_cohort_id;
end;
$$;

-- This guard deliberately uses the civil calendar, not the check-in reset
-- clock. An admin+teacher remains a profile-role `admin` and is accepted for
-- teaching separately by the Saturday eligibility helper below.
create or replace function private.assert_rotation_publication_actor(
  input_actor_id uuid,
  input_cohort_id uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  cohort_masjid_id uuid;
begin
  if input_actor_id is null or input_cohort_id is null then
    raise exception using errcode = '22023', message = 'rotation publication actor and cohort are required.';
  end if;

  select cohorts.masjid_id
  into cohort_masjid_id
  from public.cohorts
  join public.masajid on masajid.id = cohorts.masjid_id
  where cohorts.id = input_cohort_id
    and cohorts.active = true
    and masajid.active = true;

  if cohort_masjid_id is null then
    raise exception using errcode = '22023', message = 'rotation_publication_inactive_scope';
  end if;

  if not exists (
    select 1
    from public.profiles as profiles
    where profiles.id = input_actor_id
      and profiles.active = true
      and (
        profiles.role = 'super_admin'
        or (
          profiles.role = 'admin'
          and exists (
            select 1
            from public.masjid_staff_memberships as memberships
            where memberships.profile_id = profiles.id
              and memberships.masjid_id = cohort_masjid_id
              and memberships.staff_role = 'admin'
              and memberships.active = true
              and memberships.starts_on <= public.current_toronto_civil_date()
              and (
                memberships.ends_on is null
                or memberships.ends_on >= public.current_toronto_civil_date()
              )
          )
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'rotation_publication_unauthorized_actor';
  end if;

  return cohort_masjid_id;
end;
$$;

-- One canonical, ordered source for the planner and stale-state comparison.
-- `all_groups` and `teacher_memberships` intentionally include ineligible
-- rows so activation/deactivation and eligibility-boundary changes are seen
-- even when they do not appear in the planner input.
create or replace function private.rotation_publication_state(
  input_cohort_id uuid,
  input_week_start date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with scope as (
    select
      cohorts.id as cohort_id,
      cohorts.masjid_id,
      cohorts.name as cohort_name,
      cohorts.kind as cohort_kind,
      cohorts.active as cohort_active,
      cohorts.sort_order as cohort_sort_order,
      cohorts.created_at as cohort_created_at,
      cohorts.updated_at as cohort_updated_at,
      masajid.active as masjid_active,
      masajid.created_at as masjid_created_at,
      masajid.updated_at as masjid_updated_at
    from public.cohorts
    join public.masajid on masajid.id = cohorts.masjid_id
    where cohorts.id = input_cohort_id
  ),
  teacher_candidates as (
    select distinct on (memberships.profile_id)
      profiles.id,
      profiles.name,
      profiles.active as profile_active,
      profiles.role as profile_role,
      profiles.created_at as profile_created_at,
      memberships.id as membership_id,
      memberships.active as membership_active,
      memberships.starts_on,
      memberships.ends_on,
      memberships.created_at as membership_created_at,
      memberships.updated_at as membership_updated_at
    from scope
    join public.masjid_staff_memberships as memberships
      on memberships.masjid_id = scope.masjid_id
      and memberships.staff_role = 'teacher'
    join public.profiles on profiles.id = memberships.profile_id
    where private.raw_teacher_has_halaqa_saturday_eligibility(
      profiles.id,
      scope.masjid_id,
      input_week_start
    )
    order by memberships.profile_id, memberships.starts_on, memberships.id
  ),
  eligible_teachers as (
    select
      candidates.*,
      row_number() over (
        order by candidates.starts_on, candidates.name, candidates.profile_created_at, candidates.id
      )::integer as sort_order,
      availability.id as availability_id,
      availability.available,
      availability.created_at as availability_created_at,
      availability.updated_at as availability_updated_at
    from teacher_candidates as candidates
    cross join scope
    left join public.teacher_rotation_availability as availability
      on availability.teacher_id = candidates.id
      and availability.cohort_id = scope.cohort_id
      and availability.week_start = input_week_start
  )
  select jsonb_build_object(
    'version', 1,
    'state_version', coalesce((
      select versions.version
      from private.rotation_publication_state_versions as versions
      where versions.cohort_id = scope.cohort_id
    ), 0),
    'cohort', jsonb_build_object(
      'id', scope.cohort_id,
      'masjid_id', scope.masjid_id,
      'name', scope.cohort_name,
      'kind', scope.cohort_kind,
      'active', scope.cohort_active,
      'sort_order', scope.cohort_sort_order,
      'created_at', scope.cohort_created_at,
      'updated_at', scope.cohort_updated_at,
      'masjid_active', scope.masjid_active,
      'masjid_created_at', scope.masjid_created_at,
      'masjid_updated_at', scope.masjid_updated_at
    ),
    'week_start', input_week_start,
    'halaqa_saturday', public.halaqa_saturday_for_week(input_week_start),
    'rotation_settings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', settings.id,
        'masjid_id', settings.masjid_id,
        'cohort_id', settings.cohort_id,
        'target_group_count', settings.target_group_count,
        'active', settings.active,
        'created_at', settings.created_at,
        'updated_at', settings.updated_at
      ) order by settings.active desc, settings.created_at desc, settings.id)
      from public.cohort_rotation_settings as settings
      where settings.cohort_id = scope.cohort_id
    ), '[]'::jsonb),
    'all_groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', groups.id,
        'cohort_id', groups.cohort_id,
        'name', groups.name,
        'active', groups.active,
        'sort_order', groups.sort_order,
        'created_at', groups.created_at,
        'updated_at', groups.updated_at
      ) order by groups.sort_order, groups.name, groups.created_at, groups.id)
      from public.halaqa_groups as groups
      where groups.cohort_id = scope.cohort_id
    ), '[]'::jsonb),
    'teacher_memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', memberships.id,
        'teacher_id', memberships.profile_id,
        'staff_role', memberships.staff_role,
        'active', memberships.active,
        'starts_on', memberships.starts_on,
        'ends_on', memberships.ends_on,
        'created_at', memberships.created_at,
        'updated_at', memberships.updated_at,
        'profile_active', profiles.active,
        'profile_role', profiles.role,
        'profile_created_at', profiles.created_at
      ) order by memberships.profile_id, memberships.starts_on, memberships.id)
      from public.masjid_staff_memberships as memberships
      join public.profiles on profiles.id = memberships.profile_id
      where memberships.masjid_id = scope.masjid_id
        and memberships.staff_role = 'teacher'
    ), '[]'::jsonb),
    'availability_rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', availability.id,
        'teacher_id', availability.teacher_id,
        'masjid_id', availability.masjid_id,
        'cohort_id', availability.cohort_id,
        'week_start', availability.week_start,
        'available', availability.available,
        'created_at', availability.created_at,
        'updated_at', availability.updated_at
      ) order by availability.teacher_id, availability.id)
      from public.teacher_rotation_availability as availability
      where availability.cohort_id = scope.cohort_id
        and availability.week_start = input_week_start
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignments.id,
        'group_id', assignments.group_id,
        'teacher_id', assignments.teacher_id,
        'week_start', assignments.week_start,
        'active', assignments.active,
        'assigned_by', assignments.assigned_by,
        'created_at', assignments.created_at,
        'updated_at', assignments.updated_at
      ) order by assignments.week_start desc, assignments.group_id, assignments.id)
      from public.group_teacher_assignments as assignments
      join public.halaqa_groups as groups on groups.id = assignments.group_id
      where groups.cohort_id = scope.cohort_id
        and assignments.week_start <= input_week_start
    ), '[]'::jsonb),
    'planner', jsonb_build_object(
      'groups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', groups.id,
          'name', groups.name,
          'sort_order', groups.sort_order,
          'created_at', groups.created_at
        ) order by groups.sort_order, groups.name, groups.created_at, groups.id)
        from public.halaqa_groups as groups
        where groups.cohort_id = scope.cohort_id
          and groups.active = true
      ), '[]'::jsonb),
      'eligible_teachers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', teachers.id,
          'name', teachers.name,
          'sort_order', teachers.sort_order,
          'created_at', teachers.profile_created_at,
          'available', coalesce(teachers.available, false),
          'availability', case when teachers.availability_id is null then null else jsonb_build_object(
            'id', teachers.availability_id,
            'available', teachers.available,
            'created_at', teachers.availability_created_at,
            'updated_at', teachers.availability_updated_at
          ) end
        ) order by teachers.sort_order, teachers.id)
        from eligible_teachers as teachers
      ), '[]'::jsonb),
      'prior_assignments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'group_id', assignments.group_id,
          'teacher_id', assignments.teacher_id,
          'week_start', assignments.week_start,
          'active', assignments.active,
          'created_at', assignments.created_at
        ) order by assignments.week_start desc, assignments.created_at desc, assignments.id)
        from public.group_teacher_assignments as assignments
        join public.halaqa_groups as groups on groups.id = assignments.group_id
        where groups.cohort_id = scope.cohort_id
          and groups.active = true
          and assignments.week_start <= input_week_start
      ), '[]'::jsonb)
    )
  )
  from scope;
$$;

create or replace function private.rotation_publication_normalize_assignments(
  input_assignments jsonb,
  input_week_start date
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  normalized jsonb;
begin
  if input_assignments is null or jsonb_typeof(input_assignments) <> 'array' then
    raise exception using errcode = '22023', message = 'rotation_publication_invalid_assignments';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'group_id', payload.group_id,
    'teacher_id', payload.teacher_id,
    'week_start', payload.week_start
  ) order by payload.group_id, payload.teacher_id), '[]'::jsonb)
  into normalized
  from jsonb_to_recordset(input_assignments) as payload(
    group_id uuid,
    teacher_id uuid,
    week_start date
  );

  if exists (
    select 1
    from jsonb_to_recordset(normalized) as payload(group_id uuid, teacher_id uuid, week_start date)
    where payload.group_id is null
      or payload.teacher_id is null
      or payload.week_start is distinct from input_week_start
  ) then
    raise exception using errcode = '22023', message = 'rotation_publication_invalid_assignment_shape';
  end if;

  return normalized;
end;
$$;

create or replace function private.assert_rotation_publication_setup(
  input_state jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  active_settings jsonb;
  active_group_count integer;
begin
  select settings
  into active_settings
  from jsonb_array_elements(input_state -> 'rotation_settings') as settings
  where coalesce((settings ->> 'active')::boolean, false)
  order by settings ->> 'created_at' desc, settings ->> 'id' desc
  limit 1;

  active_group_count := jsonb_array_length(input_state -> 'planner' -> 'groups');

  if active_settings is null
    or active_group_count = 0
    or (active_settings ->> 'target_group_count')::integer <> active_group_count then
    raise exception using errcode = '23514', message = 'rotation_publication_setup_incomplete';
  end if;
end;
$$;

-- Shared authoritative mutation path.  The public prepare/apply pair supplies
-- an expected state; the legacy wrapper supplies NULL and is therefore
-- intentionally non-idempotent until it is removed in a later cleanup slice.
create or replace function private.apply_rotation_publication(
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date,
  input_expected_state jsonb,
  input_desired_assignments jsonb,
  input_request_id uuid default null,
  input_source text default 'publication'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  cohort_masjid_id uuid;
  current_state jsonb;
  desired_assignments jsonb;
  assigned_count_value integer;
  active_group_count_value integer;
  eligible_teacher_count_value integer;
  available_teacher_count_value integer;
  warning_codes_value jsonb := '[]'::jsonb;
  unassigned_group_ids_value jsonb := '[]'::jsonb;
  unassigned_teacher_ids_value jsonb := '[]'::jsonb;
  final_assignments_value jsonb := '[]'::jsonb;
  affected_assignment_ids_value jsonb := '[]'::jsonb;
  run_id uuid;
  result_payload jsonb;
begin
  if input_week_start is null
    or input_week_start <> public.week_start_for_date(input_week_start) then
    raise exception using errcode = '22023', message = 'rotation_publication_invalid_week_start';
  end if;

  cohort_masjid_id := private.assert_rotation_publication_actor(input_actor_id, input_cohort_id);
  desired_assignments := private.rotation_publication_normalize_assignments(
    input_desired_assignments,
    input_week_start
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'rotation-publication:' || input_cohort_id::text || ':' || input_week_start::text,
      0
    )
  );

  -- Lock every existing row that contributes to the state. The scoped advisory
  -- lock serializes guarded publication/legacy paths without blocking another
  -- cohort or week. State writers acquire these public rows before their AFTER
  -- trigger takes the version update lock, so take the version share lock only
  -- after this block to avoid a lock-order inversion.
  perform cohorts.id
  from public.cohorts
  join public.masajid on masajid.id = cohorts.masjid_id
  where cohorts.id = input_cohort_id
  for update of cohorts, masajid;

  perform groups.id
  from public.halaqa_groups as groups
  where groups.cohort_id = input_cohort_id
  for update;

  perform settings.id
  from public.cohort_rotation_settings as settings
  where settings.cohort_id = input_cohort_id
  for update;

  perform availability.id
  from public.teacher_rotation_availability as availability
  where availability.cohort_id = input_cohort_id
    and availability.week_start = input_week_start
  for update;

  perform memberships.id
  from public.masjid_staff_memberships as memberships
  where memberships.masjid_id = cohort_masjid_id
    and memberships.staff_role = 'teacher'
  for update;

  perform profiles.id
  from public.profiles as profiles
  join public.masjid_staff_memberships as memberships
    on memberships.profile_id = profiles.id
    and memberships.masjid_id = cohort_masjid_id
    and memberships.staff_role = 'teacher'
  for update of profiles;

  perform assignments.id
  from public.group_teacher_assignments as assignments
  join public.halaqa_groups as groups on groups.id = assignments.group_id
  where groups.cohort_id = input_cohort_id
    and assignments.week_start <= input_week_start
  for update of assignments;

  perform private.ensure_rotation_publication_state_version(input_cohort_id);
  perform versions.cohort_id
  from private.rotation_publication_state_versions as versions
  where versions.cohort_id = input_cohort_id
  for share;
  perform set_config('app.rotation_publication_mutation', 'true', true);

  current_state := private.rotation_publication_state(input_cohort_id, input_week_start);
  if current_state is null
    or not coalesce((current_state -> 'cohort' ->> 'active')::boolean, false)
    or not coalesce((current_state -> 'cohort' ->> 'masjid_active')::boolean, false) then
    raise exception using errcode = '22023', message = 'rotation_publication_inactive_scope';
  end if;

  if input_source <> 'legacy' then
    perform private.assert_rotation_publication_setup(current_state);
  end if;

  if input_expected_state is not null and current_state is distinct from input_expected_state then
    raise exception using errcode = 'PT412', message = 'rotation_publication_stale_state';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(desired_assignments) as payload(group_id uuid, teacher_id uuid, week_start date)
    group by payload.group_id
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'rotation_publication_duplicate_group';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(desired_assignments) as payload(group_id uuid, teacher_id uuid, week_start date)
    group by payload.teacher_id
    having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'rotation_publication_duplicate_teacher';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(desired_assignments) as payload(group_id uuid, teacher_id uuid, week_start date)
    where not exists (
      select 1
      from public.halaqa_groups as groups
      where groups.id = payload.group_id
        and groups.cohort_id = input_cohort_id
        and groups.active = true
    )
  ) then
    raise exception using errcode = '22023', message = 'rotation_publication_invalid_group';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(desired_assignments) as payload(group_id uuid, teacher_id uuid, week_start date)
    where not private.raw_teacher_has_halaqa_saturday_eligibility(
      payload.teacher_id,
      cohort_masjid_id,
      input_week_start
    )
      or not exists (
        select 1
        from public.teacher_rotation_availability as availability
        where availability.teacher_id = payload.teacher_id
          and availability.masjid_id = cohort_masjid_id
          and availability.cohort_id = input_cohort_id
          and availability.week_start = input_week_start
          and availability.available = true
      )
  ) then
    raise exception using errcode = '23514', message = 'rotation_publication_teacher_unavailable_or_ineligible';
  end if;

  with deactivated as (
    update public.group_teacher_assignments as assignments
    set active = false,
        assigned_by = input_actor_id,
        updated_at = statement_timestamp()
    from public.halaqa_groups as groups
    where groups.id = assignments.group_id
      and groups.cohort_id = input_cohort_id
      and assignments.week_start = input_week_start
      and assignments.active = true
      and (
        not groups.active
        or not exists (
          select 1
          from jsonb_to_recordset(desired_assignments) as desired(group_id uuid, teacher_id uuid, week_start date)
          where desired.group_id = assignments.group_id
        )
      )
    returning assignments.id
  )
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
  into affected_assignment_ids_value
  from deactivated;

  with written as (
    insert into public.group_teacher_assignments (
      group_id,
      teacher_id,
      week_start,
      active,
      assigned_by,
      updated_at
    )
    select payload.group_id,
           payload.teacher_id,
           payload.week_start,
           true,
           input_actor_id,
           statement_timestamp()
    from jsonb_to_recordset(desired_assignments) as payload(group_id uuid, teacher_id uuid, week_start date)
    on conflict (group_id, week_start) do update
    set teacher_id = excluded.teacher_id,
        active = true,
        assigned_by = excluded.assigned_by,
        updated_at = excluded.updated_at
    returning id
  )
  select coalesce(
    affected_assignment_ids_value || jsonb_agg(id order by id),
    affected_assignment_ids_value
  )
  into affected_assignment_ids_value
  from written;

  select count(*)::integer
  into active_group_count_value
  from public.halaqa_groups as groups
  where groups.cohort_id = input_cohort_id
    and groups.active = true;

  select count(*)::integer
  into eligible_teacher_count_value
  from (
    select distinct memberships.profile_id
    from public.masjid_staff_memberships as memberships
    where memberships.masjid_id = cohort_masjid_id
      and memberships.staff_role = 'teacher'
      and private.raw_teacher_has_halaqa_saturday_eligibility(
        memberships.profile_id,
        cohort_masjid_id,
        input_week_start
      )
  ) as eligible_teachers;

  select count(*)::integer
  into available_teacher_count_value
  from public.teacher_rotation_availability as availability
  where availability.masjid_id = cohort_masjid_id
    and availability.cohort_id = input_cohort_id
    and availability.week_start = input_week_start
    and availability.available = true
    and private.raw_teacher_has_halaqa_saturday_eligibility(
      availability.teacher_id,
      cohort_masjid_id,
      input_week_start
    );

  select count(*)::integer
  into assigned_count_value
  from jsonb_to_recordset(desired_assignments) as payload(group_id uuid, teacher_id uuid, week_start date);

  select coalesce(jsonb_agg(groups.id order by groups.sort_order, groups.name, groups.created_at, groups.id), '[]'::jsonb)
  into unassigned_group_ids_value
  from public.halaqa_groups as groups
  where groups.cohort_id = input_cohort_id
    and groups.active = true
    and not exists (
      select 1
      from jsonb_to_recordset(desired_assignments) as payload(group_id uuid, teacher_id uuid, week_start date)
      where payload.group_id = groups.id
    );

  select coalesce(jsonb_agg(availability.teacher_id order by availability.teacher_id), '[]'::jsonb)
  into unassigned_teacher_ids_value
  from public.teacher_rotation_availability as availability
  where availability.masjid_id = cohort_masjid_id
    and availability.cohort_id = input_cohort_id
    and availability.week_start = input_week_start
    and availability.available = true
    and private.raw_teacher_has_halaqa_saturday_eligibility(
      availability.teacher_id,
      cohort_masjid_id,
      input_week_start
    )
    and not exists (
      select 1
      from jsonb_to_recordset(desired_assignments) as payload(group_id uuid, teacher_id uuid, week_start date)
      where payload.teacher_id = availability.teacher_id
    );

  if jsonb_array_length(unassigned_group_ids_value) > 0 then
    warning_codes_value := warning_codes_value || jsonb_build_array('UNASSIGNED_GROUPS');
  end if;
  if jsonb_array_length(unassigned_teacher_ids_value) > 0 then
    warning_codes_value := warning_codes_value || jsonb_build_array('EXTRA_TEACHERS');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', assignments.id,
    'group_id', assignments.group_id,
    'teacher_id', assignments.teacher_id,
    'week_start', assignments.week_start,
    'active', assignments.active
  ) order by groups.sort_order, groups.name, groups.created_at, groups.id), '[]'::jsonb)
  into final_assignments_value
  from public.group_teacher_assignments as assignments
  join public.halaqa_groups as groups on groups.id = assignments.group_id
  where groups.cohort_id = input_cohort_id
    and assignments.week_start = input_week_start
    and assignments.active = true;

  insert into public.teacher_rotation_runs (
    cohort_id,
    week_start,
    generated_by,
    generated_at,
    available_teacher_count,
    group_count,
    assigned_count,
    warning_count,
    request_id,
    masjid_id,
    halaqa_saturday,
    expected_state_digest,
    eligible_teacher_count,
    unassigned_group_ids,
    unassigned_teacher_ids,
    assignment_result,
    warning_codes,
    completed_at,
    publication_source
  ) values (
    input_cohort_id,
    input_week_start,
    input_actor_id,
    statement_timestamp(),
    available_teacher_count_value,
    active_group_count_value,
    assigned_count_value,
    jsonb_array_length(warning_codes_value),
    input_request_id,
    cohort_masjid_id,
    public.halaqa_saturday_for_week(input_week_start),
    case when input_expected_state is null then null else md5(input_expected_state::text) end,
    eligible_teacher_count_value,
    unassigned_group_ids_value,
    unassigned_teacher_ids_value,
    final_assignments_value,
    warning_codes_value,
    statement_timestamp(),
    input_source
  )
  returning id into run_id;

  result_payload := jsonb_build_object(
    'status', 'published',
    'run_id', run_id,
    'cohort_id', input_cohort_id,
    'masjid_id', cohort_masjid_id,
    'week_start', input_week_start,
    'halaqa_saturday', public.halaqa_saturday_for_week(input_week_start),
    'active_group_count', active_group_count_value,
    'eligible_teacher_count', eligible_teacher_count_value,
    'available_teacher_count', available_teacher_count_value,
    'assigned_count', assigned_count_value,
    'unassigned_group_ids', unassigned_group_ids_value,
    'unassigned_teacher_ids', unassigned_teacher_ids_value,
    'warning_codes', warning_codes_value,
    'assignment_result', final_assignments_value,
    'affected_assignment_ids', affected_assignment_ids_value
  );

  return result_payload;
end;
$$;

-- Every canonical-state writer advances the cohort version unless it is the
-- guarded publisher itself. The publisher already holds the version share lock
-- and writes a complete desired assignment set; bumping there would serialize
-- otherwise independent week publications.
create or replace function public.rotation_publication_state_version_bump()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_masjid_id uuid;
  affected_profile_id uuid;
  affected_cohort_id uuid;
  previous_cohort_id uuid;
  next_cohort_id uuid;
  previous_masjid_id uuid;
  next_masjid_id uuid;
begin
  if current_setting('app.rotation_publication_mutation', true) = 'true' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'teacher_rotation_availability'
    or tg_table_name = 'cohort_rotation_settings'
    or tg_table_name = 'halaqa_groups' then
    if tg_op <> 'INSERT' then
      previous_cohort_id := old.cohort_id;
      perform private.bump_rotation_publication_state_version(previous_cohort_id);
    end if;
    if tg_op <> 'DELETE' then
      next_cohort_id := new.cohort_id;
      if next_cohort_id is distinct from previous_cohort_id then
        perform private.bump_rotation_publication_state_version(next_cohort_id);
      end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'group_teacher_assignments' then
    if tg_op <> 'INSERT' then
      select groups.cohort_id
      into previous_cohort_id
      from public.halaqa_groups as groups
      where groups.id = old.group_id;
      perform private.bump_rotation_publication_state_version(previous_cohort_id);
    end if;
    if tg_op <> 'DELETE' then
      select groups.cohort_id
      into next_cohort_id
      from public.halaqa_groups as groups
      where groups.id = new.group_id;
      if next_cohort_id is distinct from previous_cohort_id then
        perform private.bump_rotation_publication_state_version(next_cohort_id);
      end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'cohorts' then
    perform private.bump_rotation_publication_state_version(
      case when tg_op = 'DELETE' then old.id else new.id end
    );
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'masajid' then
    if tg_op <> 'INSERT' then previous_masjid_id := old.id; end if;
    if tg_op <> 'DELETE' then next_masjid_id := new.id; end if;
  elsif tg_table_name = 'masjid_staff_memberships' then
    if tg_op <> 'INSERT' then previous_masjid_id := old.masjid_id; end if;
    if tg_op <> 'DELETE' then next_masjid_id := new.masjid_id; end if;
  elsif tg_table_name = 'profiles' then
    affected_profile_id := case when tg_op = 'DELETE' then old.id else new.id end;
    for affected_masjid_id in
      select distinct memberships.masjid_id
      from public.masjid_staff_memberships as memberships
      where memberships.profile_id = affected_profile_id
        and memberships.staff_role = 'teacher'
    loop
      for affected_cohort_id in
        select cohorts.id from public.cohorts as cohorts where cohorts.masjid_id = affected_masjid_id
      loop
        perform private.bump_rotation_publication_state_version(affected_cohort_id);
      end loop;
    end loop;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  else
    raise exception 'rotation publication state trigger is attached to unsupported table %', tg_table_name;
  end if;

  for affected_masjid_id in
    select distinct scopes.masjid_id
    from (values (previous_masjid_id), (next_masjid_id)) as scopes(masjid_id)
    where scopes.masjid_id is not null
  loop
    for affected_cohort_id in
      select cohorts.id from public.cohorts as cohorts where cohorts.masjid_id = affected_masjid_id
    loop
      perform private.bump_rotation_publication_state_version(affected_cohort_id);
    end loop;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists rotation_publication_state_version_availability_trigger
  on public.teacher_rotation_availability;
create trigger rotation_publication_state_version_availability_trigger
  after insert or update or delete on public.teacher_rotation_availability
  for each row execute function public.rotation_publication_state_version_bump();

drop trigger if exists rotation_publication_state_version_settings_trigger
  on public.cohort_rotation_settings;
create trigger rotation_publication_state_version_settings_trigger
  after insert or update or delete on public.cohort_rotation_settings
  for each row execute function public.rotation_publication_state_version_bump();

drop trigger if exists rotation_publication_state_version_groups_trigger
  on public.halaqa_groups;
create trigger rotation_publication_state_version_groups_trigger
  after insert or update or delete on public.halaqa_groups
  for each row execute function public.rotation_publication_state_version_bump();

drop trigger if exists rotation_publication_state_version_assignments_trigger
  on public.group_teacher_assignments;
create trigger rotation_publication_state_version_assignments_trigger
  after insert or update or delete on public.group_teacher_assignments
  for each row execute function public.rotation_publication_state_version_bump();

drop trigger if exists rotation_publication_state_version_cohorts_trigger
  on public.cohorts;
create trigger rotation_publication_state_version_cohorts_trigger
  after insert or update or delete on public.cohorts
  for each row execute function public.rotation_publication_state_version_bump();

drop trigger if exists rotation_publication_state_version_masajid_trigger
  on public.masajid;
create trigger rotation_publication_state_version_masajid_trigger
  after insert or update or delete on public.masajid
  for each row execute function public.rotation_publication_state_version_bump();

drop trigger if exists rotation_publication_state_version_staff_trigger
  on public.masjid_staff_memberships;
create trigger rotation_publication_state_version_staff_trigger
  after insert or update or delete on public.masjid_staff_memberships
  for each row execute function public.rotation_publication_state_version_bump();

drop trigger if exists rotation_publication_state_version_profiles_trigger
  on public.profiles;
create trigger rotation_publication_state_version_profiles_trigger
  after insert or update or delete on public.profiles
  for each row execute function public.rotation_publication_state_version_bump();

-- Direct table writes remain possible for trusted maintenance tooling and
-- service-role work, so RLS alone is not sufficient.  Preserve the existing
-- Saturday eligibility trigger but extend it to require the same exact,
-- positive availability record as the guarded publication functions.  This
-- keeps every newly-written active assignment behind the same database rule;
-- historical rows are deliberately not rewritten by this rollout.
create or replace function public.teacher_rotation_row_scope_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'cohort_rotation_settings' then
    if not exists (
      select 1
      from public.cohorts
      where cohorts.id = new.cohort_id
        and cohorts.masjid_id = new.masjid_id
    ) then
      raise exception 'cohort_id must belong to masjid_id';
    end if;

    return new;
  end if;

  if tg_table_name = 'teacher_rotation_availability' then
    if not exists (
      select 1
      from public.cohorts
      where cohorts.id = new.cohort_id
        and cohorts.masjid_id = new.masjid_id
    ) then
      raise exception 'cohort_id must belong to masjid_id';
    end if;

    if not private.raw_teacher_has_halaqa_saturday_eligibility(
      new.teacher_id,
      new.masjid_id,
      new.week_start
    ) then
      raise exception 'teacher_id must have active teacher staff membership through the Saturday halaqa date.';
    end if;

    return new;
  end if;

  if tg_table_name = 'group_teacher_assignments' then
    if new.active and (
      not private.raw_teacher_has_halaqa_saturday_eligibility(
        new.teacher_id,
        private.raw_group_masjid_id(new.group_id),
        new.week_start
      )
      or not exists (
        select 1
        from public.halaqa_groups as groups
        join public.cohorts on cohorts.id = groups.cohort_id
        join public.teacher_rotation_availability as availability
          on availability.teacher_id = new.teacher_id
          and availability.masjid_id = cohorts.masjid_id
          and availability.cohort_id = groups.cohort_id
          and availability.week_start = new.week_start
          and availability.available = true
        where groups.id = new.group_id
          and groups.active = true
          and cohorts.active = true
      )
    ) then
      raise exception using
        errcode = '23514',
        message = 'teacher_assignment_requires_exact_available_teacher_rotation_availability';
    end if;

    return new;
  end if;

  raise exception 'teacher_rotation_row_scope_matches is not attached to table %', tg_table_name;
end;
$$;

create or replace function public.prepare_teacher_rotation_publication(
  input_request_id uuid,
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_snapshot private.workflow_expected_state_snapshots%rowtype;
  preparation_payload jsonb;
  expected_state jsonb;
begin
  if input_request_id is null
    or input_actor_id is null
    or input_cohort_id is null
    or input_week_start is null
    or input_week_start <> public.week_start_for_date(input_week_start) then
    raise exception using errcode = '22023', message = 'rotation_publication_invalid_prepare_input';
  end if;

  preparation_payload := jsonb_build_object(
    'actor_id', input_actor_id,
    'cohort_id', input_cohort_id,
    'week_start', input_week_start
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workflow-request:' || input_request_id::text, 0)
  );
  perform private.assert_rotation_publication_actor(input_actor_id, input_cohort_id);

  select snapshots.*
  into existing_snapshot
  from private.workflow_expected_state_snapshots as snapshots
  where snapshots.request_id = input_request_id
  for update;

  if found then
    if existing_snapshot.workflow <> 'teacher_rotation_publication'
      or existing_snapshot.actor_id <> input_actor_id
      or existing_snapshot.target_id <> input_cohort_id
      or existing_snapshot.input_payload <> preparation_payload then
      raise exception using errcode = '22023', message = 'rotation_publication_request_reused';
    end if;
    return existing_snapshot.expected_state;
  end if;

  expected_state := private.rotation_publication_state(input_cohort_id, input_week_start);
  perform private.assert_rotation_publication_setup(expected_state);

  insert into private.workflow_expected_state_snapshots (
    request_id,
    workflow,
    actor_id,
    target_id,
    input_payload,
    expected_state
  ) values (
    input_request_id,
    'teacher_rotation_publication',
    input_actor_id,
    input_cohort_id,
    preparation_payload,
    expected_state
  );

  return expected_state;
end;
$$;

create or replace function public.apply_teacher_rotation_publication(
  input_request_id uuid,
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date,
  input_expected_state jsonb,
  input_desired_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_snapshot private.workflow_expected_state_snapshots%rowtype;
  existing_request private.workflow_mutation_requests%rowtype;
  normalized_assignments jsonb;
  request_payload jsonb;
  result_payload jsonb;
  current_state jsonb;
begin
  if input_request_id is null
    or input_actor_id is null
    or input_cohort_id is null
    or input_week_start is null
    or input_expected_state is null
    or input_week_start <> public.week_start_for_date(input_week_start) then
    raise exception using errcode = '22023', message = 'rotation_publication_invalid_apply_input';
  end if;

  normalized_assignments := private.rotation_publication_normalize_assignments(
    input_desired_assignments,
    input_week_start
  );
  request_payload := jsonb_build_object(
    'actor_id', input_actor_id,
    'cohort_id', input_cohort_id,
    'week_start', input_week_start,
    'expected_state', input_expected_state,
    'desired_assignments', normalized_assignments
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workflow-request:' || input_request_id::text, 0)
  );

  select snapshots.*
  into existing_snapshot
  from private.workflow_expected_state_snapshots as snapshots
  where snapshots.request_id = input_request_id
  for update;

  if not found then
    perform private.assert_rotation_publication_actor(input_actor_id, input_cohort_id);
    raise exception using errcode = 'P0002', message = 'rotation_publication_not_prepared';
  end if;

  if existing_snapshot.workflow <> 'teacher_rotation_publication'
    or existing_snapshot.actor_id <> input_actor_id
    or existing_snapshot.target_id <> input_cohort_id
    or existing_snapshot.expected_state is distinct from input_expected_state then
    perform private.assert_rotation_publication_actor(input_actor_id, input_cohort_id);
    raise exception using errcode = 'PT412', message = 'rotation_publication_stale_state';
  end if;

  select requests.*
  into existing_request
  from private.workflow_mutation_requests as requests
  where requests.request_id = input_request_id
  for update;

  if found then
    perform private.assert_rotation_publication_actor(input_actor_id, input_cohort_id);
    if existing_request.workflow <> 'teacher_rotation_publication'
      or existing_request.actor_id <> input_actor_id
      or existing_request.target_id <> input_cohort_id
      or existing_request.input_payload <> request_payload then
      raise exception using errcode = '22023', message = 'rotation_publication_request_reused';
    end if;
    return existing_request.result;
  end if;

  -- Compare before the active-scope/actor guard in the mutation helper so a
  -- legitimately prepared request reports a deterministic stale conflict when
  -- its cohort or masjid is deactivated. The final locked comparison inside
  -- private.apply_rotation_publication remains authoritative against races.
  current_state := private.rotation_publication_state(input_cohort_id, input_week_start);
  if current_state is distinct from input_expected_state then
    raise exception using errcode = 'PT412', message = 'rotation_publication_stale_state';
  end if;

  result_payload := private.apply_rotation_publication(
    input_actor_id,
    input_cohort_id,
    input_week_start,
    input_expected_state,
    normalized_assignments,
    input_request_id,
    'publication'
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
    'teacher_rotation_publication',
    input_actor_id,
    input_cohort_id,
    request_payload,
    result_payload
  );

  return result_payload;
end;
$$;

-- Compatibility wrapper for the current deployed application. It preserves
-- the exact signature and return type, ignores caller-provided counts, does
-- not modify student memberships, and routes all assignment validation and
-- deactivation through the authoritative path above. It deliberately lacks a
-- request ID/expected state, so it is not replay-idempotent; remove it only
-- after the new application has been live and verified.
create or replace function public.apply_teacher_rotation_generation(
  input_cohort_id uuid,
  input_week_start date,
  input_generated_by uuid,
  membership_closes jsonb default '[]'::jsonb,
  membership_inserts jsonb default '[]'::jsonb,
  membership_replaces jsonb default '[]'::jsonb,
  assignment_upserts jsonb default '[]'::jsonb,
  assignment_deactivations jsonb default '[]'::jsonb,
  available_teacher_count integer default 0,
  group_count integer default 0,
  assigned_count integer default 0,
  warning_count integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_payload jsonb;
begin
  if coalesce(jsonb_array_length(membership_closes), 0) <> 0
    or coalesce(jsonb_array_length(membership_inserts), 0) <> 0
    or coalesce(jsonb_array_length(membership_replaces), 0) <> 0 then
    raise exception using errcode = '22023', message = 'legacy_rotation_generation_cannot_change_student_memberships';
  end if;

  -- assignment_deactivations and all count arguments are intentionally
  -- ignored: the desired assignments are complete, and PostgreSQL derives the
  -- deactivations, counts, and warnings from current canonical state.
  result_payload := private.apply_rotation_publication(
    input_generated_by,
    input_cohort_id,
    input_week_start,
    null,
    assignment_upserts,
    null,
    'legacy'
  );

  return (result_payload ->> 'run_id')::uuid;
end;
$$;

revoke all on function private.assert_rotation_publication_actor(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.rotation_publication_state(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.rotation_publication_normalize_assignments(jsonb, date)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_rotation_publication_setup(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.apply_rotation_publication(uuid, uuid, date, jsonb, jsonb, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.ensure_rotation_publication_state_version(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.bump_rotation_publication_state_version(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.rotation_publication_state_version_bump()
  from public, anon, authenticated, service_role;

revoke all on function public.prepare_teacher_rotation_publication(uuid, uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_teacher_rotation_publication(uuid, uuid, uuid, date, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_teacher_rotation_generation(
  uuid, date, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, integer, integer, integer, integer
) from public, anon, authenticated, service_role;

grant execute on function public.prepare_teacher_rotation_publication(uuid, uuid, uuid, date)
  to service_role;
grant execute on function public.apply_teacher_rotation_publication(uuid, uuid, uuid, date, jsonb, jsonb)
  to service_role;
grant execute on function public.apply_teacher_rotation_generation(
  uuid, date, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, integer, integer, integer, integer
) to service_role;

create or replace function private.application_security_definer_oids()
returns table (function_oid oid)
language sql
stable
set search_path = ''
as $$
  select signature::regprocedure::oid
  from unnest(array[
    'public.access_transition_rollout_diagnostic()',
    'public.admin_students_for_week(date)',
    'public.apply_admin_checkin_correction(uuid,date,text,text,text[])',
    'public.apply_cohort_group_rebalance(uuid,date,uuid,integer)',
    'public.apply_official_scoring_start_change(uuid,uuid,uuid,date,date,text)',
    'public.apply_scoped_user_setup(uuid,uuid,uuid,text,text,text,text,date,uuid,uuid)',
    'public.apply_scoped_user_setup(uuid,uuid,uuid,text,text,text,text,date,date,uuid,uuid)',
    'public.apply_super_admin_access_change(uuid,uuid,uuid,text,date,uuid,uuid,jsonb)',
    'public.apply_super_admin_hierarchy_change(uuid,uuid,text,uuid,uuid,uuid,text,text,integer,boolean,jsonb)',
    'public.apply_super_admin_masjid_provision(uuid,uuid,text,text,text,text,integer,boolean,text,integer,boolean)',
    'public.apply_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date,jsonb)',
    'public.apply_super_admin_masjid_update(uuid,uuid,uuid,text,text,boolean,jsonb)',
    'public.apply_super_admin_score_start_correction(uuid,uuid,date,date)',
    'public.apply_super_admin_staff_membership_end(uuid,uuid,uuid,uuid,date,jsonb)',
    'public.apply_teacher_rotation_generation(uuid,date,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,integer,integer,integer,integer)',
    'public.apply_teacher_rotation_publication(uuid,uuid,uuid,date,jsonb,jsonb)',
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
    'public.current_toronto_civil_date()',
    'public.enforce_student_accountability_attestation()',
    'public.enforce_student_checkin_integrity()',
    'public.enforce_student_checkin_item_integrity()',
    'public.get_person_access_state(uuid,uuid)',
    'public.get_scoped_user_setup_auth_recovery(uuid,uuid,text,text,text,text,date,uuid,uuid)',
    'public.get_scoped_user_setup_auth_recovery(uuid,uuid,text,text,text,text,date,date,uuid,uuid)',
    'public.get_scoped_user_setup_request_result(uuid,uuid,text,text,text,text,date,uuid,uuid)',
    'public.get_scoped_user_setup_request_result(uuid,uuid,text,text,text,text,date,date,uuid,uuid)',
    'public.group_masjid_id(uuid)',
    'public.historical_reporting_available_weeks()',
    'public.historical_reporting_activity_for_weeks(date[])',
    'public.historical_reporting_students_for_weeks(date[])',
    'public.is_active_admin()',
    'public.is_active_student()',
    'public.is_active_super_admin()',
    'public.is_active_teacher()',
    'public.is_admin_for_masjid(uuid)',
    'public.is_rotation_teacher_for_masjid_week(uuid,uuid,date)',
    'public.is_staff_for_masjid(uuid)',
    'public.is_teacher_for_group_week(uuid,date)',
    'public.prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)',
    'public.prepare_teacher_rotation_publication(uuid,uuid,uuid,date)',
    'public.preview_official_scoring_start_change(uuid,uuid,date)',
    'public.protect_foundation_row_identity()',
    'public.refresh_current_profile_role()',
    'public.recalculate_student_checkin_score()',
    'public.reconcile_historical_accountability_obligation(uuid,date)',
    'public.rotation_publication_state_version_bump()',
    'public.set_student_scope_snapshot()',
    'public.set_halaqa_grade_scope_snapshot()',
    'public.student_cohort_for_week(uuid,date)',
    'public.student_cohort_leaderboard_for_week(date)',
    'public.student_cohort_students_for_week(uuid,date)',
    'public.student_current_group_id(uuid)',
    'public.student_group_for_week(uuid,date)',
    'public.student_historical_reporting_scope_for_week(date)',
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
    'private.assert_teacher_assignment_removal_safe(uuid,date,uuid)',
    'private.enforce_staff_grant_preview_transition()',
    'private.enforce_masjid_hierarchy_readiness()',
    'private.project_cohort_profile_access()',
    'private.project_group_profile_access()',
    'private.project_masjid_profile_access()',
    'private.project_staff_membership_profile_access()',
    'private.project_student_membership_profile_access()',
    'private.recompute_profiles_for_masjid(uuid)',
    'private.recompute_profile_access(uuid,date)'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
