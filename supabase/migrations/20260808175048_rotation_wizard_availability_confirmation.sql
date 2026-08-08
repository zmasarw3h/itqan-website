-- Additive, cohort/week-scoped confirmation state for the sequential rotation
-- wizard.  The sparse availability ledgers remain authoritative for absences
-- and unavailable teachers; this row records whether each source was
-- deliberately confirmed without materializing attending rows.
create table if not exists public.session_roster_wizard_confirmations (
  cohort_id uuid not null references public.cohorts(id) on delete restrict,
  week_start date not null,
  student_availability_confirmed_at timestamptz,
  student_availability_confirmed_by uuid references public.profiles(id) on delete restrict,
  teacher_availability_confirmed_at timestamptz,
  teacher_availability_confirmed_by uuid references public.profiles(id) on delete restrict,
  student_availability_revision bigint not null default 0,
  teacher_availability_revision bigint not null default 0,
  state_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (cohort_id, week_start),
  constraint session_roster_wizard_confirmations_week_check
    check (week_start = public.week_start_for_date(week_start)),
  constraint session_roster_wizard_confirmations_student_pair_check
    check ((student_availability_confirmed_at is null) = (student_availability_confirmed_by is null)),
  constraint session_roster_wizard_confirmations_teacher_pair_check
    check ((teacher_availability_confirmed_at is null) = (teacher_availability_confirmed_by is null)),
  constraint session_roster_wizard_confirmations_revision_check
    check (
      student_availability_revision >= 0
      and teacher_availability_revision >= 0
      and state_version >= 0
    )
);

alter table public.session_roster_wizard_confirmations enable row level security;
revoke all on table public.session_roster_wizard_confirmations from public, anon, authenticated;
grant select on table public.session_roster_wizard_confirmations to authenticated;
grant all on table public.session_roster_wizard_confirmations to service_role;

create policy "Scoped admins can read rotation wizard confirmations"
  on public.session_roster_wizard_confirmations
  for select
  to authenticated
  using (public.can_read_session_roster_cohort(cohort_id));

-- Confirmation writes must take the same deterministic cohort/week advisory
-- lock as source writes and advance the narrow dependency marker.  The
-- service-only RPCs below perform the validation and persistence atomically;
-- this trigger also prevents a trusted server-side table write from silently
-- bypassing invalidation.
create or replace function private.session_roster_wizard_confirmation_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_cohort_id uuid;
  target_week_start date;
begin
  if tg_op = 'DELETE' then
    target_cohort_id := old.cohort_id;
    target_week_start := old.week_start;
  else
    target_cohort_id := new.cohort_id;
    target_week_start := new.week_start;
  end if;

  perform private.session_roster_lock(target_cohort_id, target_week_start);
  perform private.session_roster_advance_dependency(target_cohort_id, target_week_start);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists session_roster_wizard_confirmation_lock_trigger
  on public.session_roster_wizard_confirmations;
create trigger session_roster_wizard_confirmation_lock_trigger
  before insert or update or delete on public.session_roster_wizard_confirmations
  for each row execute function private.session_roster_wizard_confirmation_lock();

-- Replace the existing student availability RPC in place.  Validation occurs
-- before the sparse ledger is replaced; the confirmation upsert is in the
-- same transaction and lock scope, so invalid input cannot partially confirm.
create or replace function public.apply_student_rotation_availability(
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date,
  input_absences jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cohort_masjid_id uuid;
  absence_count integer;
  confirmation_revision bigint;
  request_id uuid := gen_random_uuid();
  current_draft public.session_roster_drafts%rowtype;
begin
  if input_week_start is null
    or input_week_start <> public.week_start_for_date(input_week_start) then
    raise exception using errcode = '22023', message = 'student_rotation_availability_invalid_week_start';
  end if;

  if input_absences is null or jsonb_typeof(input_absences) <> 'array' then
    raise exception using errcode = '22023', message = 'student_rotation_availability_invalid_absences';
  end if;

  select cohorts.masjid_id
  into cohort_masjid_id
  from public.cohorts
  join public.masajid on masajid.id = cohorts.masjid_id
  where cohorts.id = input_cohort_id
    and cohorts.active = true
    and masajid.active = true
  for update of cohorts;

  if cohort_masjid_id is null
    or not exists (
      select 1
      from public.profiles as actor
      join public.masjid_staff_memberships as memberships
        on memberships.profile_id = actor.id
      where actor.id = input_actor_id
        and actor.role = 'admin'
        and actor.active = true
        and memberships.masjid_id = cohort_masjid_id
        and memberships.staff_role = 'admin'
        and memberships.active = true
        and memberships.starts_on <= public.current_toronto_civil_date()
        and (memberships.ends_on is null or memberships.ends_on >= public.current_toronto_civil_date())
    ) then
    raise exception using errcode = '42501', message = 'student_rotation_availability_unauthorized_actor';
  end if;

  perform private.session_roster_lock(input_cohort_id, input_week_start);

  if exists (
    select submitted.student_id
    from jsonb_to_recordset(input_absences) as submitted(student_id uuid, reason text)
    group by submitted.student_id
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'student_rotation_availability_duplicate_student';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(input_absences) as submitted(student_id uuid, reason text)
    left join public.student_group_memberships as memberships
      on memberships.student_id = submitted.student_id
      and memberships.starts_on <= input_week_start
      and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
    left join public.halaqa_groups as groups
      on groups.id = memberships.group_id
      and groups.cohort_id = input_cohort_id
      and groups.active = true
    left join public.profiles as students
      on students.id = submitted.student_id
      and students.role = 'student'
      and students.active = true
    where submitted.student_id is null
      or groups.id is null
      or students.id is null
      or (submitted.reason is not null and char_length(btrim(submitted.reason)) > 240)
  ) then
    raise exception using errcode = '22023', message = 'student_rotation_availability_invalid_student_or_reason';
  end if;

  delete from public.student_rotation_availability
  where cohort_id = input_cohort_id
    and week_start = input_week_start;

  insert into public.student_rotation_availability (
    student_id,
    cohort_id,
    week_start,
    available,
    reason,
    recorded_by,
    updated_at
  )
  select
    submitted.student_id,
    input_cohort_id,
    input_week_start,
    false,
    nullif(btrim(submitted.reason), ''),
    input_actor_id,
    now()
  from jsonb_to_recordset(input_absences) as submitted(student_id uuid, reason text);

  get diagnostics absence_count = row_count;

  insert into public.session_roster_wizard_confirmations (
    cohort_id,
    week_start,
    student_availability_confirmed_at,
    student_availability_confirmed_by,
    student_availability_revision,
    state_version,
    updated_at
  ) values (
    input_cohort_id,
    input_week_start,
    statement_timestamp(),
    input_actor_id,
    1,
    1,
    statement_timestamp()
  )
  on conflict (cohort_id, week_start) do update
    set student_availability_confirmed_at = excluded.student_availability_confirmed_at,
        student_availability_confirmed_by = excluded.student_availability_confirmed_by,
        student_availability_revision = public.session_roster_wizard_confirmations.student_availability_revision + 1,
        state_version = public.session_roster_wizard_confirmations.state_version + 1,
        updated_at = excluded.updated_at
  returning student_availability_revision into confirmation_revision;

  select drafts.*
  into current_draft
  from public.session_roster_drafts as drafts
  where drafts.cohort_id = input_cohort_id
    and drafts.week_start = input_week_start
    and drafts.status = 'draft'
    and drafts.wizard_mode = 'teacher_driven'
  for update;

  if current_draft.id is not null then
    insert into public.session_roster_audit_events (
      actor_id,
      action,
      masjid_id,
      cohort_id,
      week_start,
      halaqa_saturday,
      draft_id,
      request_id,
      after_data,
      metadata
    ) values (
      input_actor_id,
      'source_dependency_changed',
      cohort_masjid_id,
      input_cohort_id,
      input_week_start,
      public.halaqa_saturday_for_week(input_week_start),
      current_draft.id,
      request_id,
      jsonb_build_object(
        'absence_count', absence_count,
        'student_availability_confirmed', true,
        'student_availability_revision', confirmation_revision
      ),
      jsonb_build_object(
        'source', 'student_rotation_availability',
        'draft_is_stale', true,
        'recovery', 'Refresh after confirming discard of unpublished placement and responsibility edits.'
      )
    );
  end if;

  return jsonb_build_object(
    'cohort_id', input_cohort_id,
    'week_start', input_week_start,
    'absence_count', absence_count,
    'student_availability_confirmed', true,
    'student_availability_revision', confirmation_revision
  );
end;
$$;

-- Replace the existing teacher availability RPC in place.  Eligible rows are
-- still persisted exactly as before; an empty selected array is a confirmed
-- answer but does not make the teacher prerequisite ready.
create or replace function public.apply_teacher_rotation_availability(
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date,
  input_available_teacher_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_masjid_id uuid;
  eligible_count integer := 0;
  available_count integer := 0;
  request_id uuid := gen_random_uuid();
  current_draft public.session_roster_drafts%rowtype;
  confirmation_revision bigint;
begin
  if input_week_start is null
    or input_week_start <> public.week_start_for_date(input_week_start) then
    raise exception using errcode = '22023', message = 'teacher_rotation_availability_invalid_week_start';
  end if;

  if input_available_teacher_ids is null
    or jsonb_typeof(input_available_teacher_ids) <> 'array' then
    raise exception using errcode = '22023', message = 'teacher_rotation_availability_invalid_teacher_ids';
  end if;

  select cohorts.masjid_id
  into target_masjid_id
  from public.cohorts
  join public.masajid on masajid.id = cohorts.masjid_id
  where cohorts.id = input_cohort_id
    and cohorts.active = true
    and masajid.active = true
  for update of cohorts;

  if target_masjid_id is null
    or not exists (
      select 1
      from public.profiles as actor
      join public.masjid_staff_memberships as staff
        on staff.profile_id = actor.id
        and staff.masjid_id = target_masjid_id
        and staff.staff_role = 'admin'
        and staff.active = true
        and staff.starts_on <= public.current_toronto_civil_date()
        and (staff.ends_on is null or staff.ends_on >= public.current_toronto_civil_date())
      where actor.id = input_actor_id
        and actor.role = 'admin'
        and actor.active = true
    ) then
    raise exception using errcode = '42501', message = 'teacher_rotation_availability_unauthorized_actor';
  end if;

  perform private.session_roster_lock(input_cohort_id, input_week_start);

  if exists (
    select teacher_id
    from jsonb_array_elements_text(input_available_teacher_ids) as ids(teacher_id)
    group by teacher_id
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'teacher_rotation_availability_duplicate_teacher';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(input_available_teacher_ids) as ids(teacher_id)
    where not exists (
      select 1
      from public.profiles
      join public.masjid_staff_memberships as staff
        on staff.profile_id = profiles.id
        and staff.masjid_id = target_masjid_id
        and staff.staff_role = 'teacher'
        and staff.active = true
        and staff.starts_on <= public.halaqa_saturday_for_week(input_week_start)
        and (staff.ends_on is null or staff.ends_on >= public.halaqa_saturday_for_week(input_week_start))
      where profiles.id = ids.teacher_id::uuid
        and profiles.role in ('teacher', 'admin')
        and profiles.active = true
    )
  ) then
    raise exception using errcode = '22023', message = 'teacher_rotation_availability_ineligible_teacher';
  end if;

  select count(*)::integer
  into eligible_count
  from (
    select distinct profiles.id
    from public.profiles
    join public.masjid_staff_memberships as staff
      on staff.profile_id = profiles.id
      and staff.masjid_id = target_masjid_id
      and staff.staff_role = 'teacher'
      and staff.active = true
      and staff.starts_on <= public.halaqa_saturday_for_week(input_week_start)
      and (staff.ends_on is null or staff.ends_on >= public.halaqa_saturday_for_week(input_week_start))
    where profiles.role in ('teacher', 'admin')
      and profiles.active = true
  ) as eligible;

  select count(*)::integer
  into available_count
  from jsonb_array_elements_text(input_available_teacher_ids);

  insert into public.teacher_rotation_availability (
    teacher_id,
    masjid_id,
    cohort_id,
    week_start,
    available,
    created_by,
    updated_by,
    updated_at
  )
  select
    eligible.teacher_id,
    target_masjid_id,
    input_cohort_id,
    input_week_start,
    exists (
      select 1
      from jsonb_array_elements_text(input_available_teacher_ids) as selected(teacher_id)
      where selected.teacher_id::uuid = eligible.teacher_id
    ),
    input_actor_id,
    input_actor_id,
    statement_timestamp()
  from (
    select distinct profiles.id as teacher_id
    from public.profiles
    join public.masjid_staff_memberships as staff
      on staff.profile_id = profiles.id
      and staff.masjid_id = target_masjid_id
      and staff.staff_role = 'teacher'
      and staff.active = true
      and staff.starts_on <= public.halaqa_saturday_for_week(input_week_start)
      and (staff.ends_on is null or staff.ends_on >= public.halaqa_saturday_for_week(input_week_start))
    where profiles.role in ('teacher', 'admin')
      and profiles.active = true
  ) as eligible
  on conflict (teacher_id, cohort_id, week_start) do update
    set masjid_id = excluded.masjid_id,
        available = excluded.available,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.session_roster_wizard_confirmations (
    cohort_id,
    week_start,
    teacher_availability_confirmed_at,
    teacher_availability_confirmed_by,
    teacher_availability_revision,
    state_version,
    updated_at
  ) values (
    input_cohort_id,
    input_week_start,
    statement_timestamp(),
    input_actor_id,
    1,
    1,
    statement_timestamp()
  )
  on conflict (cohort_id, week_start) do update
    set teacher_availability_confirmed_at = excluded.teacher_availability_confirmed_at,
        teacher_availability_confirmed_by = excluded.teacher_availability_confirmed_by,
        teacher_availability_revision = public.session_roster_wizard_confirmations.teacher_availability_revision + 1,
        state_version = public.session_roster_wizard_confirmations.state_version + 1,
        updated_at = excluded.updated_at
  returning teacher_availability_revision into confirmation_revision;

  select drafts.*
  into current_draft
  from public.session_roster_drafts as drafts
  where drafts.cohort_id = input_cohort_id
    and drafts.week_start = input_week_start
    and drafts.status = 'draft'
    and drafts.wizard_mode = 'teacher_driven'
  for update;

  if current_draft.id is not null then
    insert into public.session_roster_audit_events (
      actor_id,
      action,
      masjid_id,
      cohort_id,
      week_start,
      halaqa_saturday,
      draft_id,
      request_id,
      after_data,
      metadata
    ) values (
      input_actor_id,
      'source_dependency_changed',
      target_masjid_id,
      input_cohort_id,
      input_week_start,
      public.halaqa_saturday_for_week(input_week_start),
      current_draft.id,
      request_id,
      jsonb_build_object(
        'available_teacher_count', available_count,
        'eligible_teacher_count', eligible_count,
        'teacher_availability_confirmed', true,
        'teacher_availability_revision', confirmation_revision
      ),
      jsonb_build_object(
        'source', 'teacher_rotation_availability',
        'draft_is_stale', true,
        'recovery', 'Refresh after confirming discard of unpublished placement and responsibility edits.'
      )
    );
  end if;

  return jsonb_build_object(
    'cohort_id', input_cohort_id,
    'week_start', input_week_start,
    'eligible_teacher_count', eligible_count,
    'available_teacher_count', available_count,
    'teacher_availability_confirmed', true,
    'teacher_availability_revision', confirmation_revision,
    'draft_staled', current_draft.id is not null
  );
end;
$$;

-- Add confirmation metadata and historical primary-assignment context to the
-- existing source snapshot.  The history fields are response context only;
-- source_digest below deliberately excludes them so publishing a later week
-- does not unexpectedly stale an unrelated unpublished draft.
create or replace function private.session_roster_wizard_source_snapshot(
  input_cohort_id uuid,
  input_week_start date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with base as (
    select private.session_roster_source_snapshot(input_cohort_id, input_week_start) as value
  ),
  confirmation as (
    select confirmations.*
    from public.session_roster_wizard_confirmations as confirmations
    where confirmations.cohort_id = input_cohort_id
      and confirmations.week_start = input_week_start
  ),
  primary_assignments as (
    select
      versions.cohort_id,
      versions.week_start,
      versions.halaqa_saturday,
      versions.version_number,
      versions.published_at,
      slots.primary_teacher_id as teacher_id,
      slots.slot_name as group_name,
      slots.slot_sort_order as assignment_sort_order,
      slots.slot_id as assignment_id
    from public.session_roster_versions as versions
    join public.session_roster_version_slots as slots
      on slots.version_id = versions.id
    where versions.cohort_id = input_cohort_id
      and slots.primary_teacher_id is not null
    union all
    select
      versions.cohort_id,
      versions.week_start,
      versions.halaqa_saturday,
      versions.version_number,
      versions.published_at,
      groups.primary_teacher_id as teacher_id,
      groups.group_name,
      groups.group_sort_order,
      groups.group_id
    from public.session_roster_versions as versions
    join public.session_roster_version_groups as groups
      on groups.version_id = versions.id
    where versions.cohort_id = input_cohort_id
      and groups.primary_teacher_id is not null
  ),
  last_primary_assignment as (
    select distinct on (assignments.teacher_id)
      assignments.teacher_id,
      assignments.week_start,
      assignments.halaqa_saturday,
      assignments.group_name
    from primary_assignments as assignments
    order by
      assignments.teacher_id,
      assignments.week_start desc,
      assignments.version_number desc,
      assignments.published_at desc,
      assignments.assignment_sort_order,
      assignments.assignment_id desc
  ),
  eligible_teachers as (
    select distinct on (profiles.id)
      profiles.id as teacher_id,
      profiles.name as teacher_name,
      profiles.email as teacher_email,
      coalesce(availability.available, false) as available,
      last_assignment.week_start as last_published_week_start,
      last_assignment.halaqa_saturday as last_published_halaqa_saturday,
      last_assignment.group_name as last_published_group_name
    from public.cohorts
    join public.masajid
      on masajid.id = cohorts.masjid_id
    join public.profiles
      on profiles.role in ('teacher', 'admin')
      and profiles.active = true
    join public.masjid_staff_memberships as staff
      on staff.profile_id = profiles.id
      and staff.masjid_id = cohorts.masjid_id
      and staff.staff_role = 'teacher'
      and staff.active = true
      and staff.starts_on <= public.halaqa_saturday_for_week(input_week_start)
      and (staff.ends_on is null or staff.ends_on >= public.halaqa_saturday_for_week(input_week_start))
    left join public.teacher_rotation_availability as availability
      on availability.teacher_id = profiles.id
      and availability.masjid_id = cohorts.masjid_id
      and availability.cohort_id = input_cohort_id
      and availability.week_start = input_week_start
    left join last_primary_assignment as last_assignment
      on last_assignment.teacher_id = profiles.id
    where cohorts.id = input_cohort_id
      and cohorts.active = true
      and masajid.active = true
    order by profiles.id, staff.starts_on desc, availability.updated_at desc nulls last
  )
  select case
    when base.value is null then null
    else base.value || jsonb_build_object(
      'availability_confirmation', jsonb_build_object(
        'student_confirmed', confirmation.student_availability_confirmed_at is not null,
        'student_confirmed_at', confirmation.student_availability_confirmed_at,
        'student_confirmed_by', confirmation.student_availability_confirmed_by,
        'student_revision', coalesce(confirmation.student_availability_revision, 0),
        'teacher_confirmed', confirmation.teacher_availability_confirmed_at is not null,
        'teacher_confirmed_at', confirmation.teacher_availability_confirmed_at,
        'teacher_confirmed_by', confirmation.teacher_availability_confirmed_by,
        'teacher_revision', coalesce(confirmation.teacher_availability_revision, 0),
        'state_version', coalesce(confirmation.state_version, 0)
      ),
      'teachers', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'teacher_id', eligible.teacher_id,
            'teacher_name', eligible.teacher_name,
            'teacher_email', eligible.teacher_email,
            'available', eligible.available,
            'last_published_week_start', eligible.last_published_week_start,
            'last_published_halaqa_saturday', eligible.last_published_halaqa_saturday,
            'last_published_group_name', eligible.last_published_group_name
          ) order by eligible.teacher_name, eligible.teacher_id
        )
        from eligible_teachers as eligible
      ), '[]'::jsonb)
    )
  end
  from base
  left join confirmation on true;
$$;

create or replace function private.session_roster_wizard_source_digest(
  input_cohort_id uuid,
  input_week_start date
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when snapshot is null then null
    else md5(
      jsonb_set(
        snapshot,
        '{teachers}',
        coalesce((
          select jsonb_agg(
            teacher - array[
              'last_published_week_start',
              'last_published_halaqa_saturday',
              'last_published_group_name'
            ]::text[]
          )
          from jsonb_array_elements(coalesce(snapshot -> 'teachers', '[]'::jsonb)) as rows(teacher)
        ), '[]'::jsonb),
        true
      )::text
    )
  end
  from private.session_roster_wizard_source_snapshot(input_cohort_id, input_week_start) as snapshot;
$$;

-- Keep the original readiness calculation as a private implementation and
-- layer only authoritative confirmation semantics on top.  This avoids a
-- second workflow state machine and preserves the merged count-mismatch and
-- permanent-anchor rules.
alter function private.session_roster_wizard_readiness_v2(uuid)
  rename to session_roster_wizard_readiness_v2_without_confirmation;

create or replace function private.session_roster_wizard_readiness_v2(
  input_draft_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  readiness jsonb;
  prerequisite_state jsonb;
  student_state jsonb;
  teacher_state jsonb;
  groups_state jsonb;
  review_state jsonb;
  blockers jsonb;
  student_confirmed boolean := false;
  teacher_confirmed boolean := false;
  student_confirmed_at timestamptz;
  student_confirmed_by uuid;
  teacher_confirmed_at timestamptz;
  teacher_confirmed_by uuid;
begin
  readiness := private.session_roster_wizard_readiness_v2_without_confirmation(input_draft_id);
  if readiness is null then
    return null;
  end if;

  select
    confirmations.student_availability_confirmed_at,
    confirmations.student_availability_confirmed_by,
    confirmations.teacher_availability_confirmed_at,
    confirmations.teacher_availability_confirmed_by
  into
    student_confirmed_at,
    student_confirmed_by,
    teacher_confirmed_at,
    teacher_confirmed_by
  from public.session_roster_drafts as drafts
  left join public.session_roster_wizard_confirmations as confirmations
    on confirmations.cohort_id = drafts.cohort_id
    and confirmations.week_start = drafts.week_start
  where drafts.id = input_draft_id;

  student_confirmed := student_confirmed_at is not null;
  teacher_confirmed := teacher_confirmed_at is not null;

  blockers := coalesce(readiness -> 'blocker_codes', '[]'::jsonb);
  if not student_confirmed then
    blockers := blockers || jsonb_build_array('student_availability_confirmation_required');
  end if;
  if not teacher_confirmed then
    blockers := blockers || jsonb_build_array('teacher_availability_confirmation_required');
  end if;

  prerequisite_state := coalesce(readiness -> 'prerequisite_state', '{}'::jsonb);
  student_state := coalesce(prerequisite_state -> 'students', '{}'::jsonb)
    || jsonb_build_object(
      'confirmed', student_confirmed,
      'confirmed_at', student_confirmed_at,
      'confirmed_by', student_confirmed_by,
      'ready', student_confirmed
    );
  teacher_state := coalesce(prerequisite_state -> 'teachers', '{}'::jsonb)
    || jsonb_build_object(
      'confirmed', teacher_confirmed,
      'confirmed_at', teacher_confirmed_at,
      'confirmed_by', teacher_confirmed_by,
      'ready', teacher_confirmed
        and coalesce((readiness ->> 'available_teacher_count')::integer, 0) > 0
    );
  groups_state := coalesce(prerequisite_state -> 'groups', '{}'::jsonb)
    || jsonb_build_object(
      'ready', coalesce((prerequisite_state -> 'groups' ->> 'ready')::boolean, false)
        and student_confirmed
        and teacher_confirmed
    );
  review_state := coalesce(prerequisite_state -> 'review', '{}'::jsonb)
    || jsonb_build_object(
      'ready', coalesce((prerequisite_state -> 'review' ->> 'ready')::boolean, false)
        and student_confirmed
        and teacher_confirmed
    );
  prerequisite_state := prerequisite_state
    || jsonb_build_object(
      'students', student_state,
      'teachers', teacher_state,
      'groups', groups_state,
      'review', review_state
    );

  return readiness
    || jsonb_build_object(
      'can_publish', jsonb_array_length(blockers) = 0,
      'blocker_codes', blockers,
      'student_availability_confirmed', student_confirmed,
      'student_availability_confirmed_at', student_confirmed_at,
      'student_availability_confirmed_by', student_confirmed_by,
      'teacher_availability_confirmed', teacher_confirmed,
      'teacher_availability_confirmed_at', teacher_confirmed_at,
      'teacher_availability_confirmed_by', teacher_confirmed_by,
      'prerequisite_state', prerequisite_state,
      'recovery_guidance', case
        when readiness ->> 'recovery_guidance' is not null
          and (readiness ->> 'source_stale')::boolean then readiness ->> 'recovery_guidance'
        when not student_confirmed then 'Confirm student availability before continuing to teacher availability.'
        when not teacher_confirmed then 'Confirm teacher availability before generating session groups.'
        else readiness ->> 'recovery_guidance'
      end
    );
end;
$$;

-- Keep the renamed implementation private as well as the additive wrapper.
revoke all on function private.session_roster_wizard_readiness_v2_without_confirmation(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_readiness_v2(uuid)
  from public, anon, authenticated, service_role;

-- Preserve the existing wizard payload shape and add the assignment context
-- fields alongside the existing teacher fields.
create or replace function private.session_roster_wizard_draft_payload(
  input_draft_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'contract_version', 2,
    'draft', jsonb_build_object(
      'id', drafts.id,
      'masjid_id', drafts.masjid_id,
      'cohort_id', drafts.cohort_id,
      'week_start', drafts.week_start,
      'halaqa_saturday', drafts.halaqa_saturday,
      'revision_number', drafts.revision_number,
      'status', drafts.status,
      'base_published_version_id', drafts.base_published_version_id,
      'source_state_digest', drafts.source_state_digest,
      'current_source_digest', private.session_roster_wizard_source_digest(drafts.cohort_id, drafts.week_start),
      'source_stale', drafts.dependency_revision is distinct from private.session_roster_dependency_revision_read(drafts.cohort_id, drafts.week_start)
        or drafts.dependency_digest is distinct from private.session_roster_wizard_source_digest(drafts.cohort_id, drafts.week_start),
      'state_version', drafts.state_version,
      'reviewed_at', drafts.reviewed_at,
      'reviewed_by', drafts.reviewed_by,
      'reviewed_state_version', drafts.reviewed_state_version,
      'published_version_id', drafts.published_version_id,
      'created_by', drafts.created_by,
      'updated_by', drafts.updated_by,
      'created_at', drafts.created_at,
      'updated_at', drafts.updated_at,
      'wizard_mode', drafts.wizard_mode,
      'dependency_revision', drafts.dependency_revision,
      'dependency_digest', drafts.dependency_digest,
      'available_teacher_count', drafts.available_teacher_count,
      'default_group_count', drafts.default_group_count,
      'requested_group_count', drafts.requested_group_count,
      'actual_group_count', drafts.derived_group_count,
      'derived_group_count', drafts.derived_group_count,
      'group_count_mismatch_confirmed', drafts.group_count_mismatch_confirmed,
      'wizard_prerequisite_state', drafts.wizard_prerequisite_state,
      'mismatch_confirmation_required', drafts.mismatch_confirmation_required,
      'mismatch_confirmed', drafts.mismatch_confirmed,
      'unplaced_count', drafts.unplaced_count,
      'imbalance_warning', drafts.imbalance_warning,
      'primary_responsibilities', drafts.primary_responsibilities,
      'recovery_guidance', drafts.recovery_guidance
    ),
    'teachers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'teacher_id', rows.teacher->>'teacher_id',
          'teacher_name', rows.teacher->>'teacher_name',
          'teacher_email', rows.teacher->>'teacher_email',
          'available', coalesce((rows.teacher->>'available')::boolean, false),
          'last_published_week_start', rows.teacher->>'last_published_week_start',
          'last_published_halaqa_saturday', rows.teacher->>'last_published_halaqa_saturday',
          'last_published_group_name', rows.teacher->>'last_published_group_name'
        ) order by rows.teacher->>'teacher_name', rows.teacher->>'teacher_id'
      )
      from jsonb_array_elements(
        coalesce(private.session_roster_wizard_source_snapshot(drafts.cohort_id, drafts.week_start) -> 'teachers', '[]'::jsonb)
      ) as rows(teacher)
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'teacher_id', rows.teacher->>'teacher_id',
          'teacher_name', rows.teacher->>'teacher_name',
          'teacher_email', rows.teacher->>'teacher_email',
          'available', true,
          'participating', true,
          'is_primary', primary_slot.slot_id is not null,
          'primary_slot_id', primary_slot.slot_id,
          'primary_slot_name', primary_slot.slot_name
        ) order by rows.teacher->>'teacher_name', rows.teacher->>'teacher_id'
      )
      from jsonb_array_elements(coalesce(drafts.source_state -> 'teachers', '[]'::jsonb)) as rows(teacher)
      left join lateral (
        select slots.slot_id, slots.slot_name
        from public.session_roster_draft_slots as slots
        where slots.draft_id = drafts.id
          and slots.primary_teacher_id = (rows.teacher->>'teacher_id')::uuid
        order by slots.slot_sort_order, slots.slot_id
        limit 1
      ) as primary_slot on true
      where coalesce((rows.teacher->>'available')::boolean, false)
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'group_id', slots.slot_id,
          'session_group_slot_id', slots.slot_id,
          'anchor_group_id', slots.anchor_group_id,
          'group_name', slots.slot_name,
          'group_sort_order', slots.slot_sort_order,
          'primary_teacher_id', slots.primary_teacher_id,
          'primary_teacher_name', slots.primary_teacher_name,
          'mismatch_confirmed', slots.mismatch_confirmed,
          'mismatch_reason', slots.mismatch_reason
        ) order by slots.slot_sort_order, slots.slot_name, slots.slot_id
      )
      from public.session_roster_draft_slots as slots
      where slots.draft_id = drafts.id
    ), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'student_id', students.student_id,
          'student_name', students.student_name,
          'attendance_status', students.attendance_status,
          'unavailable_reason', students.unavailable_reason,
          'usual_group_id', students.usual_group_id,
          'usual_group_name', students.usual_group_name,
          'session_group_id', coalesce(students.session_group_slot_id, students.session_group_id),
          'session_group_slot_id', students.session_group_slot_id,
          'placed_by', students.placed_by,
          'placed_at', students.placed_at
        ) order by students.student_name, students.student_id
      )
      from public.session_roster_draft_students as students
      where students.draft_id = drafts.id
    ), '[]'::jsonb),
    'roster', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'student_id', students.student_id,
          'student_name', students.student_name,
          'usual_group_id', students.usual_group_id,
          'usual_group_name', students.usual_group_name,
          'session_group_id', students.session_group_slot_id,
          'session_group_slot_id', students.session_group_slot_id
        ) order by students.session_group_slot_id, students.student_name, students.student_id
      )
      from public.session_roster_draft_students as students
      where students.draft_id = drafts.id
        and students.attendance_status = 'attending'
        and students.session_group_slot_id is not null
    ), '[]'::jsonb),
    'readiness', private.session_roster_wizard_readiness_v2(drafts.id)
  )
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;
$$;

revoke all on function private.session_roster_wizard_draft_payload(uuid)
  from public, anon, authenticated, service_role;

-- Extend the reviewed security-definer inventory for the confirmation trigger.
alter function private.application_security_definer_oids()
  rename to application_security_definer_oids_before_confirmation;

create or replace function private.application_security_definer_oids()
returns table (function_oid oid)
language sql
stable
set search_path = ''
as $$
  select function_oid
  from private.application_security_definer_oids_before_confirmation()
  union
  select 'private.session_roster_wizard_confirmation_lock()'::regprocedure::oid;
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_confirmation_lock()
  from public, anon, authenticated, service_role;
