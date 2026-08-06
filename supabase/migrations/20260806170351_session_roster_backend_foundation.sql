-- Attendance-aware Saturday session rosters.
--
-- This is deliberately separate from permanent student_group_memberships and
-- group_teacher_assignments.  The former remains the authoritative usual
-- placement/history; the latter remains the existing weekly teacher contract.
-- Session-roster rows are a Saturday-specific planning and historical layer.

create table if not exists private.session_roster_mutation_requests (
  request_id uuid primary key,
  operation text not null check (operation in (
    'load_or_create_draft',
    'move_student',
    'assign_primary_teacher',
    'review_draft',
    'publish_draft',
    'create_revision'
  )),
  actor_id uuid not null,
  target_id uuid not null,
  input_payload jsonb not null,
  result jsonb not null,
  completed_at timestamptz not null default now()
);

alter table private.session_roster_mutation_requests enable row level security;
revoke all on table private.session_roster_mutation_requests
  from public, anon, authenticated, service_role;

create index if not exists session_roster_mutation_requests_actor_completed_idx
  on private.session_roster_mutation_requests(actor_id, completed_at desc);

create table if not exists public.session_roster_versions (
  id uuid primary key default gen_random_uuid(),
  masjid_id uuid not null references public.masajid(id) on delete restrict,
  cohort_id uuid not null references public.cohorts(id) on delete restrict,
  week_start date not null,
  halaqa_saturday date not null,
  version_number bigint not null,
  source_draft_id uuid not null,
  source_draft_revision bigint not null,
  source_state_digest text not null,
  published_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz not null default now(),
  constraint session_roster_versions_scope_unique
    unique (cohort_id, week_start, version_number),
  constraint session_roster_versions_version_number_check
    check (version_number > 0),
  constraint session_roster_versions_revision_check
    check (source_draft_revision > 0),
  constraint session_roster_versions_week_start_check
    check (week_start = public.week_start_for_date(week_start)),
  constraint session_roster_versions_saturday_check
    check (halaqa_saturday = public.halaqa_saturday_for_week(week_start)),
  constraint session_roster_versions_digest_check
    check (char_length(source_state_digest) = 32)
);

create index if not exists session_roster_versions_scope_published_idx
  on public.session_roster_versions(cohort_id, week_start, version_number desc);

create table if not exists public.session_roster_drafts (
  id uuid primary key default gen_random_uuid(),
  masjid_id uuid not null references public.masajid(id) on delete restrict,
  cohort_id uuid not null references public.cohorts(id) on delete restrict,
  week_start date not null,
  halaqa_saturday date not null,
  revision_number bigint not null,
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  base_published_version_id uuid references public.session_roster_versions(id) on delete restrict,
  source_state jsonb not null,
  source_state_digest text not null,
  state_version bigint not null default 0,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_state_version bigint,
  published_version_id uuid references public.session_roster_versions(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_roster_drafts_scope_revision_unique
    unique (cohort_id, week_start, revision_number),
  constraint session_roster_drafts_revision_check
    check (revision_number > 0),
  constraint session_roster_drafts_state_version_check
    check (state_version >= 0),
  constraint session_roster_drafts_reviewed_state_check
    check (reviewed_state_version is null or reviewed_state_version >= 0),
  constraint session_roster_drafts_week_start_check
    check (week_start = public.week_start_for_date(week_start)),
  constraint session_roster_drafts_saturday_check
    check (halaqa_saturday = public.halaqa_saturday_for_week(week_start)),
  constraint session_roster_drafts_digest_check
    check (char_length(source_state_digest) = 32),
  constraint session_roster_drafts_published_link_check
    check (
      (status = 'draft' and published_version_id is null)
      or (status = 'published' and published_version_id is not null)
    )
);

alter table public.session_roster_versions
  add constraint session_roster_versions_source_draft_fk
  foreign key (source_draft_id) references public.session_roster_drafts(id) on delete restrict;

create unique index if not exists session_roster_drafts_current_unique_idx
  on public.session_roster_drafts(cohort_id, week_start)
  where status = 'draft';

create index if not exists session_roster_drafts_scope_status_idx
  on public.session_roster_drafts(cohort_id, week_start, status, revision_number desc);

create table if not exists public.session_roster_draft_groups (
  draft_id uuid not null references public.session_roster_drafts(id) on delete restrict,
  group_id uuid not null references public.halaqa_groups(id) on delete restrict,
  group_name text not null,
  group_sort_order integer not null,
  primary_teacher_id uuid,
  primary_teacher_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (draft_id, group_id),
  constraint session_roster_draft_groups_name_check
    check (char_length(btrim(group_name)) > 0),
  constraint session_roster_draft_groups_teacher_name_check
    check (primary_teacher_id is null or primary_teacher_name is not null)
);

create index if not exists session_roster_draft_groups_group_idx
  on public.session_roster_draft_groups(group_id, draft_id);

create table if not exists public.session_roster_draft_students (
  draft_id uuid not null references public.session_roster_drafts(id) on delete restrict,
  student_id uuid not null,
  student_name text not null,
  attendance_status text not null check (attendance_status in ('attending', 'unavailable')),
  unavailable_reason text,
  usual_group_id uuid not null references public.halaqa_groups(id) on delete restrict,
  usual_group_name text not null,
  session_group_id uuid,
  placed_by uuid references public.profiles(id) on delete restrict,
  placed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (draft_id, student_id),
  constraint session_roster_draft_students_group_fk
    foreign key (draft_id, session_group_id)
    references public.session_roster_draft_groups(draft_id, group_id)
    on delete restrict,
  constraint session_roster_draft_students_unavailable_placement_check
    check (attendance_status = 'attending' or session_group_id is null),
  constraint session_roster_draft_students_reason_check
    check (
      unavailable_reason is null
      or char_length(btrim(unavailable_reason)) between 1 and 240
    ),
  constraint session_roster_draft_students_name_check
    check (char_length(btrim(student_name)) > 0),
  constraint session_roster_draft_students_usual_group_name_check
    check (char_length(btrim(usual_group_name)) > 0)
);

create index if not exists session_roster_draft_students_group_idx
  on public.session_roster_draft_students(draft_id, session_group_id, attendance_status);

create index if not exists session_roster_draft_students_student_idx
  on public.session_roster_draft_students(student_id, draft_id);

create table if not exists public.session_roster_version_groups (
  version_id uuid not null references public.session_roster_versions(id) on delete restrict,
  group_id uuid not null references public.halaqa_groups(id) on delete restrict,
  group_name text not null,
  group_sort_order integer not null,
  primary_teacher_id uuid,
  primary_teacher_name text,
  primary key (version_id, group_id),
  constraint session_roster_version_groups_name_check
    check (char_length(btrim(group_name)) > 0),
  constraint session_roster_version_groups_teacher_name_check
    check (primary_teacher_id is not null and primary_teacher_name is not null)
);

create index if not exists session_roster_version_groups_group_idx
  on public.session_roster_version_groups(group_id, version_id);

create table if not exists public.session_roster_version_students (
  version_id uuid not null references public.session_roster_versions(id) on delete restrict,
  student_id uuid not null,
  student_name text not null,
  usual_group_id uuid not null references public.halaqa_groups(id) on delete restrict,
  usual_group_name text not null,
  session_group_id uuid not null,
  placement_order integer not null,
  primary key (version_id, student_id),
  constraint session_roster_version_students_group_fk
    foreign key (version_id, session_group_id)
    references public.session_roster_version_groups(version_id, group_id)
    on delete restrict,
  constraint session_roster_version_students_order_check
    check (placement_order > 0),
  constraint session_roster_version_students_name_check
    check (char_length(btrim(student_name)) > 0),
  constraint session_roster_version_students_usual_group_name_check
    check (char_length(btrim(usual_group_name)) > 0),
  constraint session_roster_version_students_group_order_unique
    unique (version_id, session_group_id, placement_order)
);

create index if not exists session_roster_version_students_group_idx
  on public.session_roster_version_students(version_id, session_group_id, placement_order);

create index if not exists session_roster_version_students_student_idx
  on public.session_roster_version_students(student_id, version_id);

create table if not exists public.session_roster_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in (
    'draft_created',
    'student_moved',
    'primary_teacher_assigned',
    'draft_reviewed',
    'version_published',
    'revision_created'
  )),
  masjid_id uuid not null references public.masajid(id) on delete restrict,
  cohort_id uuid not null references public.cohorts(id) on delete restrict,
  week_start date not null,
  halaqa_saturday date not null,
  draft_id uuid references public.session_roster_drafts(id) on delete restrict,
  version_id uuid references public.session_roster_versions(id) on delete restrict,
  request_id uuid not null,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb,
  constraint session_roster_audit_week_start_check
    check (week_start = public.week_start_for_date(week_start)),
  constraint session_roster_audit_saturday_check
    check (halaqa_saturday = public.halaqa_saturday_for_week(week_start)),
  constraint session_roster_audit_target_check
    check (draft_id is not null or version_id is not null)
);

create unique index if not exists session_roster_audit_request_unique_idx
  on public.session_roster_audit_events(request_id);

create index if not exists session_roster_audit_scope_time_idx
  on public.session_roster_audit_events(cohort_id, week_start, occurred_at desc);

create index if not exists session_roster_audit_actor_time_idx
  on public.session_roster_audit_events(actor_id, occurred_at desc);

-- The same cohort/week is the serialization boundary for draft creation,
-- source refresh, and publication.  The lock is advisory because the source
-- tables are owned by older workflows that cannot share a new FK/state row.
create or replace function private.session_roster_lock(
  input_cohort_id uuid,
  input_week_start date
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'session-roster:' || input_cohort_id::text || ':' || input_week_start::text,
      0
    )
  );
end;
$$;

create or replace function private.session_roster_assert_week(
  input_week_start date
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if input_week_start is null
    or input_week_start <> public.week_start_for_date(input_week_start) then
    raise exception using
      errcode = '22023',
      message = 'session_roster_invalid_week_start';
  end if;
end;
$$;

-- This intentionally excludes super_admin.  The session-roster admin
-- workflow is a normal-admin contract; a future super-admin workflow must
-- make its broader authority explicit instead of inheriting this scope.
create or replace function private.session_roster_admin_masjid(
  input_actor_id uuid,
  input_cohort_id uuid
)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  target_masjid_id uuid;
  civil_date date := public.current_toronto_civil_date();
begin
  select cohorts.masjid_id
  into target_masjid_id
  from public.cohorts
  join public.masajid on masajid.id = cohorts.masjid_id
  where cohorts.id = input_cohort_id
    and cohorts.active = true
    and masajid.active = true;

  if target_masjid_id is null then
    raise exception using errcode = '22023', message = 'session_roster_inactive_scope';
  end if;

  if not exists (
    select 1
    from public.profiles
    join public.masjid_staff_memberships
      on masjid_staff_memberships.profile_id = profiles.id
    where profiles.id = input_actor_id
      and profiles.role = 'admin'
      and profiles.active = true
      and masjid_staff_memberships.masjid_id = target_masjid_id
      and masjid_staff_memberships.staff_role = 'admin'
      and masjid_staff_memberships.active = true
      and masjid_staff_memberships.starts_on <= civil_date
      and (masjid_staff_memberships.ends_on is null or masjid_staff_memberships.ends_on >= civil_date)
  ) then
    raise exception using errcode = '42501', message = 'session_roster_unauthorized_actor';
  end if;

  return target_masjid_id;
end;
$$;

create or replace function public.can_read_session_roster_cohort(
  input_cohort_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cohorts
    join public.masajid on masajid.id = cohorts.masjid_id
    join public.masjid_staff_memberships
      on masjid_staff_memberships.masjid_id = cohorts.masjid_id
    join public.profiles on profiles.id = masjid_staff_memberships.profile_id
    where cohorts.id = input_cohort_id
      and cohorts.active = true
      and masajid.active = true
      and profiles.id = (select auth.uid())
      and profiles.role = 'admin'
      and profiles.active = true
      and masjid_staff_memberships.staff_role = 'admin'
      and masjid_staff_memberships.active = true
      and masjid_staff_memberships.starts_on <= public.current_toronto_civil_date()
      and (
        masjid_staff_memberships.ends_on is null
        or masjid_staff_memberships.ends_on >= public.current_toronto_civil_date()
      )
  );
$$;

-- Canonical source for the draft.  Missing student availability rows are
-- deliberately converted to attending here; the absence ledger is the only
-- override.  Names are included so a published version is a human-readable
-- historical snapshot, while the digest also detects scope/name changes that
-- require the admin to review the draft again.
create or replace function private.session_roster_source_snapshot(
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
      masajid.name as masjid_name,
      masajid.active as masjid_active
    from public.cohorts
    join public.masajid on masajid.id = cohorts.masjid_id
    where cohorts.id = input_cohort_id
  ),
  group_rows as (
    select jsonb_build_object(
      'group_id', groups.id,
      'group_name', groups.name,
      'group_sort_order', groups.sort_order
    ) as value
    from public.halaqa_groups as groups
    where groups.cohort_id = input_cohort_id
      and groups.active = true
    order by groups.sort_order, groups.name, groups.id
  ),
  student_rows as (
    select jsonb_build_object(
      'student_id', students.id,
      'student_name', students.name,
      'usual_group_id', groups.id,
      'usual_group_name', groups.name,
      'attendance_status', case when availability.id is null then 'attending' else 'unavailable' end,
      'unavailable_reason', availability.reason
    ) as value
    from public.student_group_memberships as memberships
    join public.halaqa_groups as groups on groups.id = memberships.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
    join public.masajid on masajid.id = cohorts.masjid_id
    join public.profiles as students on students.id = memberships.student_id
    left join public.student_rotation_availability as availability
      on availability.student_id = students.id
      and availability.cohort_id = input_cohort_id
      and availability.week_start = input_week_start
    where groups.cohort_id = input_cohort_id
      and groups.active = true
      and cohorts.active = true
      and masajid.active = true
      and students.role = 'student'
      and students.active = true
      and memberships.starts_on <= input_week_start
      and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
    order by students.name, students.id
  )
  select case when scope.cohort_id is null then null else jsonb_build_object(
    'cohort_id', scope.cohort_id,
    'masjid_id', scope.masjid_id,
    'cohort_name', scope.cohort_name,
    'cohort_kind', scope.cohort_kind,
    'cohort_active', scope.cohort_active,
    'masjid_name', scope.masjid_name,
    'masjid_active', scope.masjid_active,
    'week_start', input_week_start,
    'halaqa_saturday', public.halaqa_saturday_for_week(input_week_start),
    'groups', coalesce((select jsonb_agg(group_rows.value) from group_rows), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(student_rows.value) from student_rows), '[]'::jsonb)
  ) end
  from scope;
$$;

create or replace function private.session_roster_source_digest(
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
    else md5(snapshot::text)
  end
  from private.session_roster_source_snapshot(input_cohort_id, input_week_start) as snapshot;
$$;

create or replace function private.session_roster_replay_result(
  input_request_id uuid,
  input_operation text,
  input_actor_id uuid,
  input_target_id uuid,
  input_payload jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  existing_request private.session_roster_mutation_requests%rowtype;
begin
  if input_request_id is null then
    raise exception using errcode = '22023', message = 'session_roster_request_id_required';
  end if;

  select requests.*
  into existing_request
  from private.session_roster_mutation_requests as requests
  where requests.request_id = input_request_id
  for update;

  if not found then
    return null;
  end if;

  if existing_request.operation <> input_operation
    or existing_request.actor_id <> input_actor_id
    or existing_request.target_id <> input_target_id
    or existing_request.input_payload <> input_payload then
    raise exception using errcode = '22023', message = 'session_roster_request_reused';
  end if;

  return existing_request.result;
end;
$$;

create or replace function private.session_roster_write_request(
  input_request_id uuid,
  input_operation text,
  input_actor_id uuid,
  input_target_id uuid,
  input_payload jsonb,
  input_result jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into private.session_roster_mutation_requests (
    request_id, operation, actor_id, target_id, input_payload, result
  ) values (
    input_request_id, input_operation, input_actor_id, input_target_id, input_payload, input_result
  );
$$;

create or replace function private.session_roster_readiness(
  input_draft_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with draft as (
    select
      drafts.id,
      drafts.state_version,
      drafts.source_state_digest,
      drafts.reviewed_state_version
    from public.session_roster_drafts as drafts
    where drafts.id = input_draft_id
  ),
  group_counts as (
    select
      groups.group_id,
      groups.group_name,
      groups.group_sort_order,
      groups.primary_teacher_id,
      groups.primary_teacher_name,
      count(students.student_id) filter (
        where students.attendance_status = 'attending'
      )::integer as attending_count
    from public.session_roster_draft_groups as groups
    left join public.session_roster_draft_students as students
      on students.draft_id = groups.draft_id
      and students.session_group_id = groups.group_id
    where groups.draft_id = input_draft_id
    group by
      groups.group_id,
      groups.group_name,
      groups.group_sort_order,
      groups.primary_teacher_id,
      groups.primary_teacher_name
  ),
  student_counts as (
    select
      count(*) filter (where students.attendance_status = 'attending')::integer as attending_count,
      count(*) filter (where students.attendance_status = 'unavailable')::integer as unavailable_count,
      count(*) filter (
        where students.attendance_status = 'attending'
          and students.session_group_id is not null
      )::integer as placed_count,
      count(*) filter (
        where students.attendance_status = 'attending'
          and students.session_group_id is null
      )::integer as unplaced_count
    from public.session_roster_draft_students as students
    where students.draft_id = input_draft_id
  ),
  unplaced as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'student_id', students.student_id,
          'student_name', students.student_name,
          'usual_group_id', students.usual_group_id,
          'usual_group_name', students.usual_group_name
        ) order by students.student_name, students.student_id
      ),
      '[]'::jsonb
    ) as value
    from public.session_roster_draft_students as students
    where students.draft_id = input_draft_id
      and students.attendance_status = 'attending'
      and students.session_group_id is null
  ),
  missing_teachers as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'group_id', groups.group_id,
          'group_name', groups.group_name
        ) order by groups.group_sort_order, groups.group_name, groups.group_id
      ),
      '[]'::jsonb
    ) as value
    from public.session_roster_draft_groups as groups
    where groups.draft_id = input_draft_id
      and groups.primary_teacher_id is null
  ),
  group_summary as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'group_id', group_counts.group_id,
          'group_name', group_counts.group_name,
          'group_sort_order', group_counts.group_sort_order,
          'attending_count', group_counts.attending_count,
          'primary_teacher_id', group_counts.primary_teacher_id,
          'primary_teacher_name', group_counts.primary_teacher_name
        ) order by group_counts.group_sort_order, group_counts.group_name, group_counts.group_id
      ),
      '[]'::jsonb
    ) as value,
    coalesce(max(group_counts.attending_count), 0) as largest_group_count,
    coalesce(min(group_counts.attending_count), 0) as smallest_group_count,
    count(*)::integer as group_count
    from group_counts
  ),
  source_state as (
    select private.session_roster_source_digest(drafts.cohort_id, drafts.week_start) as current_digest
    from public.session_roster_drafts as drafts
    where drafts.id = input_draft_id
  ),
  summary as (
    select
      draft.*,
      coalesce(student_counts.attending_count, 0) as attending_count,
      coalesce(student_counts.unavailable_count, 0) as unavailable_count,
      coalesce(student_counts.placed_count, 0) as placed_count,
      coalesce(student_counts.unplaced_count, 0) as unplaced_count,
      group_summary.value as group_counts,
      group_summary.group_count,
      group_summary.largest_group_count,
      group_summary.smallest_group_count,
      source_state.current_digest,
      (draft.source_state_digest is distinct from source_state.current_digest) as source_stale,
      (draft.reviewed_state_version is not null and draft.reviewed_state_version = draft.state_version) as reviewed_current,
      unplaced.value as unplaced_students,
      missing_teachers.value as missing_primary_teachers
    from draft
    cross join student_counts
    cross join group_summary
    cross join source_state
    cross join unplaced
    cross join missing_teachers
  ),
  codes as (
    select
      summary.*,
      case
        when summary.unplaced_count > 0 then jsonb_build_array('unplaced_attending_students')
        else '[]'::jsonb
      end
      || case
        when jsonb_array_length(summary.missing_primary_teachers) > 0 then jsonb_build_array('missing_primary_teacher_responsibility')
        else '[]'::jsonb
      end
      || case
        when summary.source_stale then jsonb_build_array('source_changed')
        else '[]'::jsonb
      end
      || case
        when not summary.reviewed_current then jsonb_build_array('review_required')
        else '[]'::jsonb
      end
      || case
        when summary.attending_count > 0 and summary.group_count = 0 then jsonb_build_array('no_session_groups')
        else '[]'::jsonb
      end as blocker_codes,
      case
        when summary.attending_count > 0
          and summary.largest_group_count - summary.smallest_group_count > 1
          then jsonb_build_array('group_imbalance')
        else '[]'::jsonb
      end as warning_codes
    from summary
  )
  select jsonb_build_object(
    'can_publish',
      codes.unplaced_count = 0
      and jsonb_array_length(codes.missing_primary_teachers) = 0
      and not codes.source_stale
      and codes.reviewed_current
      and (codes.attending_count = 0 or codes.group_count > 0),
    'attending_count', codes.attending_count,
    'unavailable_count', codes.unavailable_count,
    'placed_count', codes.placed_count,
    'unplaced_count', codes.unplaced_count,
    'group_counts', codes.group_counts,
    'unplaced_students', codes.unplaced_students,
    'missing_primary_teachers', codes.missing_primary_teachers,
    'warning_codes', codes.warning_codes,
    'blocker_codes', codes.blocker_codes,
    'source_stale', codes.source_stale,
    'reviewed_current', codes.reviewed_current,
    'current_source_digest', codes.current_digest
  )
  from codes;
$$;

create or replace function private.session_roster_draft_payload(
  input_draft_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'contract_version', 1,
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
      'current_source_digest', private.session_roster_source_digest(drafts.cohort_id, drafts.week_start),
      'source_stale', drafts.source_state_digest is distinct from private.session_roster_source_digest(drafts.cohort_id, drafts.week_start),
      'state_version', drafts.state_version,
      'reviewed_at', drafts.reviewed_at,
      'reviewed_by', drafts.reviewed_by,
      'reviewed_state_version', drafts.reviewed_state_version,
      'published_version_id', drafts.published_version_id,
      'created_by', drafts.created_by,
      'updated_by', drafts.updated_by,
      'created_at', drafts.created_at,
      'updated_at', drafts.updated_at
    ),
    'groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'group_id', groups.group_id,
          'group_name', groups.group_name,
          'group_sort_order', groups.group_sort_order,
          'primary_teacher_id', groups.primary_teacher_id,
          'primary_teacher_name', groups.primary_teacher_name
        ) order by groups.group_sort_order, groups.group_name, groups.group_id
      )
      from public.session_roster_draft_groups as groups
      where groups.draft_id = drafts.id
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
          'session_group_id', students.session_group_id,
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
          'session_group_id', students.session_group_id
        ) order by students.session_group_id, students.student_name, students.student_id
      )
      from public.session_roster_draft_students as students
      where students.draft_id = drafts.id
        and students.attendance_status = 'attending'
        and students.session_group_id is not null
    ), '[]'::jsonb),
    'readiness', private.session_roster_readiness(drafts.id)
  )
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;
$$;

create or replace function private.session_roster_published_payload(
  input_version_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'contract_version', 1,
    'version', jsonb_build_object(
      'id', versions.id,
      'masjid_id', versions.masjid_id,
      'cohort_id', versions.cohort_id,
      'week_start', versions.week_start,
      'halaqa_saturday', versions.halaqa_saturday,
      'version_number', versions.version_number,
      'source_draft_id', versions.source_draft_id,
      'source_draft_revision', versions.source_draft_revision,
      'source_state_digest', versions.source_state_digest,
      'published_by', versions.published_by,
      'published_at', versions.published_at
    ),
    'groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'group_id', groups.group_id,
          'group_name', groups.group_name,
          'group_sort_order', groups.group_sort_order,
          'primary_teacher_id', groups.primary_teacher_id,
          'primary_teacher_name', groups.primary_teacher_name
        ) order by groups.group_sort_order, groups.group_name, groups.group_id
      )
      from public.session_roster_version_groups as groups
      where groups.version_id = versions.id
    ), '[]'::jsonb),
    'roster', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'student_id', students.student_id,
          'student_name', students.student_name,
          'usual_group_id', students.usual_group_id,
          'usual_group_name', students.usual_group_name,
          'session_group_id', students.session_group_id,
          'placement_order', students.placement_order
        ) order by students.session_group_id, students.placement_order, students.student_id
      )
      from public.session_roster_version_students as students
      where students.version_id = versions.id
    ), '[]'::jsonb)
  )
  from public.session_roster_versions as versions
  where versions.id = input_version_id;
$$;

create or replace function private.session_roster_draft_scope_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.week_start is null
    or new.week_start <> public.week_start_for_date(new.week_start)
    or new.halaqa_saturday is distinct from public.halaqa_saturday_for_week(new.week_start) then
    raise exception using errcode = '23514', message = 'session_roster_draft_invalid_week';
  end if;

  if not exists (
    select 1
    from public.cohorts
    join public.masajid on masajid.id = cohorts.masjid_id
    where cohorts.id = new.cohort_id
      and cohorts.masjid_id = new.masjid_id
      and cohorts.active = true
      and masajid.active = true
  ) then
    raise exception using errcode = '23514', message = 'session_roster_draft_invalid_scope';
  end if;

  return new;
end;
$$;

create or replace function private.session_roster_draft_group_scope_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.session_roster_drafts as drafts
    join public.halaqa_groups as groups on groups.cohort_id = drafts.cohort_id
    where drafts.id = new.draft_id
      and groups.id = new.group_id
      and groups.active = true
  ) then
    raise exception using errcode = '23514', message = 'session_roster_draft_group_out_of_scope';
  end if;

  if new.primary_teacher_id is not null and new.primary_teacher_name is null then
    raise exception using errcode = '23514', message = 'session_roster_primary_teacher_name_required';
  end if;

  return new;
end;
$$;

create or replace function private.session_roster_draft_student_scope_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.session_roster_drafts as drafts
    join public.halaqa_groups as groups on groups.cohort_id = drafts.cohort_id
    where drafts.id = new.draft_id
      and groups.id = new.usual_group_id
      and groups.active = true
  ) then
    raise exception using errcode = '23514', message = 'session_roster_usual_group_out_of_scope';
  end if;

  if not exists (
    select 1
    from public.profiles as students
    where students.id = new.student_id
      and students.role = 'student'
  ) then
    raise exception using errcode = '23514', message = 'session_roster_student_identity_invalid';
  end if;

  return new;
end;
$$;

create or replace function private.session_roster_version_scope_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.session_roster_versions as versions
    join public.halaqa_groups as groups on groups.cohort_id = versions.cohort_id
    where versions.id = new.version_id
      and groups.id = new.group_id
      and groups.active = true
  ) then
    raise exception using errcode = '23514', message = 'session_roster_version_group_out_of_scope';
  end if;

  if new.primary_teacher_id is null or new.primary_teacher_name is null then
    raise exception using errcode = '23514', message = 'session_roster_version_primary_teacher_required';
  end if;

  return new;
end;
$$;

create or replace function private.session_roster_version_student_scope_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.session_roster_versions as versions
    join public.halaqa_groups as groups on groups.cohort_id = versions.cohort_id
    where versions.id = new.version_id
      and groups.id = new.usual_group_id
      and groups.active = true
  ) then
    raise exception using errcode = '23514', message = 'session_roster_version_usual_group_out_of_scope';
  end if;

  return new;
end;
$$;

create trigger session_roster_drafts_scope_trigger
  before insert or update of masjid_id, cohort_id, week_start, halaqa_saturday
  on public.session_roster_drafts
  for each row execute function private.session_roster_draft_scope_matches();

create trigger session_roster_draft_groups_scope_trigger
  before insert or update of draft_id, group_id, primary_teacher_id, primary_teacher_name
  on public.session_roster_draft_groups
  for each row execute function private.session_roster_draft_group_scope_matches();

create trigger session_roster_draft_students_scope_trigger
  before insert or update of draft_id, student_id, usual_group_id, session_group_id
  on public.session_roster_draft_students
  for each row execute function private.session_roster_draft_student_scope_matches();

create trigger session_roster_version_groups_scope_trigger
  before insert or update of version_id, group_id, primary_teacher_id, primary_teacher_name
  on public.session_roster_version_groups
  for each row execute function private.session_roster_version_scope_matches();

create trigger session_roster_version_students_scope_trigger
  before insert or update of version_id, student_id, usual_group_id, session_group_id
  on public.session_roster_version_students
  for each row execute function private.session_roster_version_student_scope_matches();

create or replace function private.session_roster_lock_draft_sources_for_group(
  input_group_id uuid,
  input_starts_on date,
  input_ends_on date
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  draft_row record;
begin
  for draft_row in
    select distinct drafts.cohort_id, drafts.week_start
    from public.session_roster_drafts as drafts
    join public.halaqa_groups as groups on groups.cohort_id = drafts.cohort_id
    where groups.id = input_group_id
      and drafts.status = 'draft'
      and drafts.week_start >= input_starts_on
      and (input_ends_on is null or drafts.week_start <= input_ends_on)
    order by drafts.cohort_id, drafts.week_start
  loop
    perform private.session_roster_lock(draft_row.cohort_id, draft_row.week_start);
  end loop;
end;
$$;

-- Existing availability and membership workflows remain authoritative.  These
-- before triggers only acquire the shared source lock when a live draft could
-- be affected; they never rewrite the source rows.
create or replace function private.session_roster_source_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_profile_id uuid;
  source_row record;
begin
  if tg_table_name = 'student_rotation_availability' then
    if tg_op = 'DELETE' then
      perform private.session_roster_lock(old.cohort_id, old.week_start);
      return old;
    end if;

    perform private.session_roster_lock(new.cohort_id, new.week_start);
    return new;
  end if;

  if tg_table_name = 'student_group_memberships' then
    if tg_op <> 'INSERT' then
      perform private.session_roster_lock_draft_sources_for_group(
        old.group_id,
        old.starts_on,
        old.ends_on
      );
    end if;
    if tg_op <> 'DELETE' then
      perform private.session_roster_lock_draft_sources_for_group(
        new.group_id,
        new.starts_on,
        new.ends_on
      );
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'halaqa_groups' then
    if tg_op <> 'INSERT' then
      for source_row in
        select drafts.cohort_id, drafts.week_start
        from public.session_roster_drafts as drafts
        where drafts.cohort_id = old.cohort_id
          and drafts.status = 'draft'
      loop
        perform private.session_roster_lock(source_row.cohort_id, source_row.week_start);
      end loop;
    end if;
    if tg_op <> 'DELETE' then
      for source_row in
        select drafts.cohort_id, drafts.week_start
        from public.session_roster_drafts as drafts
        where drafts.cohort_id = new.cohort_id
          and drafts.status = 'draft'
      loop
        perform private.session_roster_lock(source_row.cohort_id, source_row.week_start);
      end loop;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'profiles' then
    source_profile_id := case when tg_op = 'DELETE' then old.id else new.id end;
    for source_row in
      select distinct drafts.cohort_id, drafts.week_start
      from public.session_roster_drafts as drafts
      join public.halaqa_groups as groups on groups.cohort_id = drafts.cohort_id
      join public.student_group_memberships as memberships on memberships.group_id = groups.id
      where drafts.status = 'draft'
        and memberships.student_id = source_profile_id
        and memberships.starts_on <= drafts.week_start
        and (memberships.ends_on is null or memberships.ends_on >= drafts.week_start)
      order by drafts.cohort_id, drafts.week_start
    loop
      perform private.session_roster_lock(source_row.cohort_id, source_row.week_start);
    end loop;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  raise exception 'session roster source lock trigger attached to unsupported table %', tg_table_name;
end;
$$;

create trigger session_roster_availability_source_lock_trigger
  before insert or update or delete on public.student_rotation_availability
  for each row execute function private.session_roster_source_lock();

create trigger session_roster_membership_source_lock_trigger
  before insert or update or delete on public.student_group_memberships
  for each row execute function private.session_roster_source_lock();

create trigger session_roster_group_source_lock_trigger
  before insert or update or delete on public.halaqa_groups
  for each row execute function private.session_roster_source_lock();

create trigger session_roster_profile_source_lock_trigger
  before update or delete on public.profiles
  for each row execute function private.session_roster_source_lock();

alter table public.session_roster_versions enable row level security;
alter table public.session_roster_drafts enable row level security;
alter table public.session_roster_draft_groups enable row level security;
alter table public.session_roster_draft_students enable row level security;
alter table public.session_roster_version_groups enable row level security;
alter table public.session_roster_version_students enable row level security;
alter table public.session_roster_audit_events enable row level security;

revoke all on table public.session_roster_versions
  from public, anon, authenticated;
revoke all on table public.session_roster_drafts
  from public, anon, authenticated;
revoke all on table public.session_roster_draft_groups
  from public, anon, authenticated;
revoke all on table public.session_roster_draft_students
  from public, anon, authenticated;
revoke all on table public.session_roster_version_groups
  from public, anon, authenticated;
revoke all on table public.session_roster_version_students
  from public, anon, authenticated;
revoke all on table public.session_roster_audit_events
  from public, anon, authenticated;

grant select on table public.session_roster_versions to authenticated;
grant select on table public.session_roster_drafts to authenticated;
grant select on table public.session_roster_draft_groups to authenticated;
grant select on table public.session_roster_draft_students to authenticated;
grant select on table public.session_roster_version_groups to authenticated;
grant select on table public.session_roster_version_students to authenticated;
grant select on table public.session_roster_audit_events to authenticated;

grant all on table public.session_roster_versions to service_role;
grant all on table public.session_roster_drafts to service_role;
grant all on table public.session_roster_draft_groups to service_role;
grant all on table public.session_roster_draft_students to service_role;
grant all on table public.session_roster_version_groups to service_role;
grant all on table public.session_roster_version_students to service_role;
grant all on table public.session_roster_audit_events to service_role;

create policy "Scoped admins can read session roster versions"
  on public.session_roster_versions
  for select
  to authenticated
  using (public.can_read_session_roster_cohort(cohort_id));

create policy "Scoped admins can read session roster drafts"
  on public.session_roster_drafts
  for select
  to authenticated
  using (public.can_read_session_roster_cohort(cohort_id));

create policy "Scoped admins can read session roster draft groups"
  on public.session_roster_draft_groups
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.session_roster_drafts as drafts
      where drafts.id = session_roster_draft_groups.draft_id
        and public.can_read_session_roster_cohort(drafts.cohort_id)
    )
  );

create policy "Scoped admins can read session roster draft students"
  on public.session_roster_draft_students
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.session_roster_drafts as drafts
      where drafts.id = session_roster_draft_students.draft_id
        and public.can_read_session_roster_cohort(drafts.cohort_id)
    )
  );

create policy "Scoped admins can read session roster version groups"
  on public.session_roster_version_groups
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.session_roster_versions as versions
      where versions.id = session_roster_version_groups.version_id
        and public.can_read_session_roster_cohort(versions.cohort_id)
    )
  );

create policy "Scoped admins can read session roster version students"
  on public.session_roster_version_students
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.session_roster_versions as versions
      where versions.id = session_roster_version_students.version_id
        and public.can_read_session_roster_cohort(versions.cohort_id)
    )
  );

create policy "Scoped admins can read session roster audit events"
  on public.session_roster_audit_events
  for select
  to authenticated
  using (public.can_read_session_roster_cohort(cohort_id));

create or replace function private.session_roster_materialize_draft(
  input_draft_id uuid,
  input_source_state jsonb,
  input_base_version_id uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.session_roster_draft_groups (
    draft_id,
    group_id,
    group_name,
    group_sort_order,
    primary_teacher_id,
    primary_teacher_name
  )
  select
    input_draft_id,
    source_groups.group_id,
    source_groups.group_name,
    source_groups.group_sort_order,
    case when input_base_version_id is null then null else version_groups.primary_teacher_id end,
    case when input_base_version_id is null then null else version_groups.primary_teacher_name end
  from jsonb_to_recordset(input_source_state -> 'groups') as source_groups(
    group_id uuid,
    group_name text,
    group_sort_order integer
  )
  left join public.session_roster_version_groups as version_groups
    on version_groups.version_id = input_base_version_id
    and version_groups.group_id = source_groups.group_id;

  insert into public.session_roster_draft_students (
    draft_id,
    student_id,
    student_name,
    attendance_status,
    unavailable_reason,
    usual_group_id,
    usual_group_name,
    session_group_id
  )
  select
    input_draft_id,
    source_students.student_id,
    source_students.student_name,
    source_students.attendance_status,
    source_students.unavailable_reason,
    source_students.usual_group_id,
    source_students.usual_group_name,
    case
      when source_students.attendance_status <> 'attending' then null
      when input_base_version_id is null then source_students.usual_group_id
      when published_students.session_group_id is not null
        and exists (
          select 1
          from jsonb_to_recordset(input_source_state -> 'groups') as current_groups(group_id uuid)
          where current_groups.group_id = published_students.session_group_id
        ) then published_students.session_group_id
      else source_students.usual_group_id
    end
  from jsonb_to_recordset(input_source_state -> 'students') as source_students(
    student_id uuid,
    student_name text,
    usual_group_id uuid,
    usual_group_name text,
    attendance_status text,
    unavailable_reason text
  )
  left join public.session_roster_version_students as published_students
    on published_students.version_id = input_base_version_id
    and published_students.student_id = source_students.student_id;
end;
$$;

create or replace function public.load_or_create_session_roster_draft(
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
  target_masjid_id uuid;
  source_state jsonb;
  source_digest text;
  request_payload jsonb;
  replay_result jsonb;
  current_draft public.session_roster_drafts%rowtype;
  current_version public.session_roster_versions%rowtype;
  next_revision bigint;
  created_draft_id uuid;
  result_payload jsonb;
begin
  perform private.session_roster_assert_week(input_week_start);
  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, input_cohort_id);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'cohort_id', input_cohort_id,
    'week_start', input_week_start
  );

  perform cohorts.id
  from public.cohorts as cohorts
  where cohorts.id = input_cohort_id
    and cohorts.masjid_id = target_masjid_id
  for update;

  perform private.session_roster_lock(input_cohort_id, input_week_start);

  replay_result := private.session_roster_replay_result(
    input_request_id,
    'load_or_create_draft',
    input_actor_id,
    input_cohort_id,
    request_payload
  );
  if replay_result is not null then
    return replay_result;
  end if;

  select drafts.*
  into current_draft
  from public.session_roster_drafts as drafts
  where drafts.cohort_id = input_cohort_id
    and drafts.week_start = input_week_start
    and drafts.status = 'draft'
  for update;

  if found then
    result_payload := private.session_roster_draft_payload(current_draft.id);
    perform private.session_roster_write_request(
      input_request_id,
      'load_or_create_draft',
      input_actor_id,
      input_cohort_id,
      request_payload,
      result_payload
    );
    return result_payload;
  end if;

  source_state := private.session_roster_source_snapshot(input_cohort_id, input_week_start);
  source_digest := private.session_roster_source_digest(input_cohort_id, input_week_start);

  if source_state is null or source_digest is null then
    raise exception using errcode = '22023', message = 'session_roster_source_unavailable';
  end if;

  select versions.*
  into current_version
  from public.session_roster_versions as versions
  where versions.cohort_id = input_cohort_id
    and versions.week_start = input_week_start
  order by versions.version_number desc
  limit 1;

  select coalesce(max(drafts.revision_number), 0) + 1
  into next_revision
  from public.session_roster_drafts as drafts
  where drafts.cohort_id = input_cohort_id
    and drafts.week_start = input_week_start;

  insert into public.session_roster_drafts (
    masjid_id,
    cohort_id,
    week_start,
    halaqa_saturday,
    revision_number,
    status,
    base_published_version_id,
    source_state,
    source_state_digest,
    state_version,
    created_by,
    updated_by
  ) values (
    target_masjid_id,
    input_cohort_id,
    input_week_start,
    public.halaqa_saturday_for_week(input_week_start),
    next_revision,
    'draft',
    current_version.id,
    source_state,
    source_digest,
    0,
    input_actor_id,
    input_actor_id
  )
  returning id into created_draft_id;

  perform private.session_roster_materialize_draft(
    created_draft_id,
    source_state,
    null
  );

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
    'draft_created',
    target_masjid_id,
    input_cohort_id,
    input_week_start,
    public.halaqa_saturday_for_week(input_week_start),
    created_draft_id,
    input_request_id,
    jsonb_build_object(
      'draft_id', created_draft_id,
      'revision_number', next_revision,
      'source_state_digest', source_digest
    ),
    jsonb_build_object('seed_mode', 'usual_active_group_attendance_override')
  );

  result_payload := private.session_roster_draft_payload(created_draft_id);
  perform private.session_roster_write_request(
    input_request_id,
    'load_or_create_draft',
    input_actor_id,
    input_cohort_id,
    request_payload,
    result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.get_session_roster_draft(
  input_actor_id uuid,
  input_draft_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_cohort_id uuid;
begin
  select drafts.cohort_id
  into target_cohort_id
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if target_cohort_id is null then
    raise exception using errcode = 'P0002', message = 'session_roster_draft_not_found';
  end if;

  perform private.session_roster_admin_masjid(input_actor_id, target_cohort_id);
  return private.session_roster_draft_payload(input_draft_id);
end;
$$;

create or replace function public.move_session_roster_student(
  input_request_id uuid,
  input_actor_id uuid,
  input_draft_id uuid,
  input_student_id uuid,
  input_session_group_id uuid,
  input_expected_state_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.session_roster_drafts%rowtype;
  student_row public.session_roster_draft_students%rowtype;
  target_masjid_id uuid;
  request_payload jsonb;
  replay_result jsonb;
  before_data jsonb;
  result_payload jsonb;
begin
  select drafts.*
  into draft
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'session_roster_draft_not_found';
  end if;

  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, draft.cohort_id);

  perform cohorts.id
  from public.cohorts as cohorts
  where cohorts.id = draft.cohort_id
    and cohorts.masjid_id = target_masjid_id
  for update;
  perform private.session_roster_lock(draft.cohort_id, draft.week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'draft_id', input_draft_id,
    'student_id', input_student_id,
    'session_group_id', input_session_group_id,
    'expected_state_version', input_expected_state_version
  );

  replay_result := private.session_roster_replay_result(
    input_request_id,
    'move_student',
    input_actor_id,
    input_draft_id,
    request_payload
  );
  if replay_result is not null then
    return replay_result;
  end if;

  select drafts.*
  into draft
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id
  for update;

  if draft.status <> 'draft' then
    raise exception using errcode = 'PT412', message = 'session_roster_draft_not_editable';
  end if;

  if draft.state_version is distinct from input_expected_state_version then
    raise exception using errcode = 'PT412', message = 'session_roster_stale_draft';
  end if;

  if draft.source_state_digest is distinct from private.session_roster_source_digest(draft.cohort_id, draft.week_start) then
    raise exception using errcode = 'PT412', message = 'session_roster_source_stale';
  end if;

  select students.*
  into student_row
  from public.session_roster_draft_students as students
  where students.draft_id = input_draft_id
    and students.student_id = input_student_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'session_roster_student_not_in_draft';
  end if;

  if input_session_group_id is not null
    and not exists (
      select 1
      from public.session_roster_draft_groups as groups
      where groups.draft_id = input_draft_id
        and groups.group_id = input_session_group_id
    ) then
    raise exception using errcode = '22023', message = 'session_roster_session_group_invalid';
  end if;

  if student_row.attendance_status = 'unavailable' and input_session_group_id is not null then
    raise exception using errcode = '23514', message = 'session_roster_unavailable_student_cannot_be_placed';
  end if;

  before_data := jsonb_build_object(
    'student_id', student_row.student_id,
    'session_group_id', student_row.session_group_id,
    'attendance_status', student_row.attendance_status
  );

  update public.session_roster_draft_students
  set session_group_id = case
        when student_row.attendance_status = 'unavailable' then null
        else input_session_group_id
      end,
      placed_by = case when input_session_group_id is null then null else input_actor_id end,
      placed_at = case when input_session_group_id is null then null else statement_timestamp() end,
      updated_at = statement_timestamp()
  where draft_id = input_draft_id
    and student_id = input_student_id;

  update public.session_roster_drafts
  set state_version = state_version + 1,
      reviewed_at = null,
      reviewed_by = null,
      reviewed_state_version = null,
      updated_by = input_actor_id,
      updated_at = statement_timestamp()
  where id = input_draft_id;

  insert into public.session_roster_audit_events (
    actor_id,
    action,
    masjid_id,
    cohort_id,
    week_start,
    halaqa_saturday,
    draft_id,
    request_id,
    before_data,
    after_data
  ) values (
    input_actor_id,
    'student_moved',
    target_masjid_id,
    draft.cohort_id,
    draft.week_start,
    draft.halaqa_saturday,
    input_draft_id,
    input_request_id,
    before_data,
    jsonb_build_object(
      'student_id', input_student_id,
      'session_group_id', input_session_group_id,
      'attendance_status', student_row.attendance_status
    )
  );

  result_payload := private.session_roster_draft_payload(input_draft_id);
  perform private.session_roster_write_request(
    input_request_id,
    'move_student',
    input_actor_id,
    input_draft_id,
    request_payload,
    result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.assign_session_roster_primary_teacher(
  input_request_id uuid,
  input_actor_id uuid,
  input_draft_id uuid,
  input_group_id uuid,
  input_primary_teacher_id uuid,
  input_expected_state_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.session_roster_drafts%rowtype;
  group_row public.session_roster_draft_groups%rowtype;
  target_masjid_id uuid;
  resolved_teacher_name text;
  request_payload jsonb;
  replay_result jsonb;
  before_data jsonb;
  result_payload jsonb;
begin
  select drafts.*
  into draft
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'session_roster_draft_not_found';
  end if;

  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, draft.cohort_id);

  perform cohorts.id
  from public.cohorts as cohorts
  where cohorts.id = draft.cohort_id
    and cohorts.masjid_id = target_masjid_id
  for update;
  perform private.session_roster_lock(draft.cohort_id, draft.week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'draft_id', input_draft_id,
    'group_id', input_group_id,
    'primary_teacher_id', input_primary_teacher_id,
    'expected_state_version', input_expected_state_version
  );

  replay_result := private.session_roster_replay_result(
    input_request_id,
    'assign_primary_teacher',
    input_actor_id,
    input_draft_id,
    request_payload
  );
  if replay_result is not null then
    return replay_result;
  end if;

  select drafts.*
  into draft
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id
  for update;

  if draft.status <> 'draft' then
    raise exception using errcode = 'PT412', message = 'session_roster_draft_not_editable';
  end if;

  if draft.state_version is distinct from input_expected_state_version then
    raise exception using errcode = 'PT412', message = 'session_roster_stale_draft';
  end if;

  if draft.source_state_digest is distinct from private.session_roster_source_digest(draft.cohort_id, draft.week_start) then
    raise exception using errcode = 'PT412', message = 'session_roster_source_stale';
  end if;

  select groups.*
  into group_row
  from public.session_roster_draft_groups as groups
  where groups.draft_id = input_draft_id
    and groups.group_id = input_group_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'session_roster_session_group_invalid';
  end if;

  if input_primary_teacher_id is not null then
    select profiles.name
    into resolved_teacher_name
    from public.profiles
    join public.masjid_staff_memberships as staff
      on staff.profile_id = profiles.id
    join public.teacher_rotation_availability as availability
      on availability.teacher_id = profiles.id
      and availability.masjid_id = target_masjid_id
      and availability.cohort_id = draft.cohort_id
      and availability.week_start = draft.week_start
      and availability.available = true
    where profiles.id = input_primary_teacher_id
      and profiles.role in ('teacher', 'admin')
      and profiles.active = true
      and staff.masjid_id = target_masjid_id
      and staff.staff_role = 'teacher'
      and staff.active = true
      and staff.starts_on <= draft.halaqa_saturday
      and (staff.ends_on is null or staff.ends_on >= draft.halaqa_saturday)
    limit 1;

    if resolved_teacher_name is null then
      raise exception using errcode = '42501', message = 'session_roster_primary_teacher_unavailable';
    end if;
  end if;

  before_data := jsonb_build_object(
    'group_id', group_row.group_id,
    'primary_teacher_id', group_row.primary_teacher_id,
    'primary_teacher_name', group_row.primary_teacher_name
  );

  update public.session_roster_draft_groups
  set primary_teacher_id = input_primary_teacher_id,
      primary_teacher_name = resolved_teacher_name,
      updated_at = statement_timestamp()
  where draft_id = input_draft_id
    and group_id = input_group_id;

  update public.session_roster_drafts
  set state_version = state_version + 1,
      reviewed_at = null,
      reviewed_by = null,
      reviewed_state_version = null,
      updated_by = input_actor_id,
      updated_at = statement_timestamp()
  where id = input_draft_id;

  insert into public.session_roster_audit_events (
    actor_id,
    action,
    masjid_id,
    cohort_id,
    week_start,
    halaqa_saturday,
    draft_id,
    request_id,
    before_data,
    after_data
  ) values (
    input_actor_id,
    'primary_teacher_assigned',
    target_masjid_id,
    draft.cohort_id,
    draft.week_start,
    draft.halaqa_saturday,
    input_draft_id,
    input_request_id,
    before_data,
    jsonb_build_object(
      'group_id', input_group_id,
      'primary_teacher_id', input_primary_teacher_id,
      'primary_teacher_name', resolved_teacher_name
    )
  );

  result_payload := private.session_roster_draft_payload(input_draft_id);
  perform private.session_roster_write_request(
    input_request_id,
    'assign_primary_teacher',
    input_actor_id,
    input_draft_id,
    request_payload,
    result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.compute_session_roster_readiness(
  input_actor_id uuid,
  input_draft_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_cohort_id uuid;
begin
  select drafts.cohort_id
  into target_cohort_id
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if target_cohort_id is null then
    raise exception using errcode = 'P0002', message = 'session_roster_draft_not_found';
  end if;

  perform private.session_roster_admin_masjid(input_actor_id, target_cohort_id);
  return private.session_roster_readiness(input_draft_id);
end;
$$;

create or replace function public.review_session_roster_draft(
  input_request_id uuid,
  input_actor_id uuid,
  input_draft_id uuid,
  input_expected_state_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.session_roster_drafts%rowtype;
  target_masjid_id uuid;
  request_payload jsonb;
  replay_result jsonb;
  result_payload jsonb;
  readiness jsonb;
begin
  select drafts.*
  into draft
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'session_roster_draft_not_found';
  end if;

  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, draft.cohort_id);

  perform cohorts.id
  from public.cohorts as cohorts
  where cohorts.id = draft.cohort_id
    and cohorts.masjid_id = target_masjid_id
  for update;
  perform private.session_roster_lock(draft.cohort_id, draft.week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'draft_id', input_draft_id,
    'expected_state_version', input_expected_state_version
  );

  replay_result := private.session_roster_replay_result(
    input_request_id,
    'review_draft',
    input_actor_id,
    input_draft_id,
    request_payload
  );
  if replay_result is not null then
    return replay_result;
  end if;

  select drafts.*
  into draft
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id
  for update;

  if draft.status <> 'draft' then
    raise exception using errcode = 'PT412', message = 'session_roster_draft_not_editable';
  end if;

  if draft.state_version is distinct from input_expected_state_version then
    raise exception using errcode = 'PT412', message = 'session_roster_stale_draft';
  end if;

  if draft.source_state_digest is distinct from private.session_roster_source_digest(draft.cohort_id, draft.week_start) then
    raise exception using errcode = 'PT412', message = 'session_roster_source_stale';
  end if;

  update public.session_roster_drafts
  set reviewed_at = statement_timestamp(),
      reviewed_by = input_actor_id,
      reviewed_state_version = state_version,
      updated_by = input_actor_id,
      updated_at = statement_timestamp()
  where id = input_draft_id;

  readiness := private.session_roster_readiness(input_draft_id);

  insert into public.session_roster_audit_events (
    actor_id,
    action,
    masjid_id,
    cohort_id,
    week_start,
    halaqa_saturday,
    draft_id,
    request_id,
    after_data
  ) values (
    input_actor_id,
    'draft_reviewed',
    target_masjid_id,
    draft.cohort_id,
    draft.week_start,
    draft.halaqa_saturday,
    input_draft_id,
    input_request_id,
    jsonb_build_object(
      'reviewed_state_version', draft.state_version,
      'readiness', readiness
    )
  );

  result_payload := private.session_roster_draft_payload(input_draft_id);
  perform private.session_roster_write_request(
    input_request_id,
    'review_draft',
    input_actor_id,
    input_draft_id,
    request_payload,
    result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.publish_session_roster_draft(
  input_request_id uuid,
  input_actor_id uuid,
  input_draft_id uuid,
  input_expected_state_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.session_roster_drafts%rowtype;
  target_masjid_id uuid;
  current_version public.session_roster_versions%rowtype;
  readiness jsonb;
  request_payload jsonb;
  replay_result jsonb;
  next_version_number bigint;
  new_version_id uuid;
  result_payload jsonb;
begin
  select drafts.*
  into draft
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'session_roster_draft_not_found';
  end if;

  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, draft.cohort_id);

  perform cohorts.id
  from public.cohorts as cohorts
  where cohorts.id = draft.cohort_id
    and cohorts.masjid_id = target_masjid_id
  for update;
  perform private.session_roster_lock(draft.cohort_id, draft.week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'draft_id', input_draft_id,
    'expected_state_version', input_expected_state_version
  );

  replay_result := private.session_roster_replay_result(
    input_request_id,
    'publish_draft',
    input_actor_id,
    input_draft_id,
    request_payload
  );
  if replay_result is not null then
    return replay_result;
  end if;

  select drafts.*
  into draft
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id
  for update;

  if draft.status <> 'draft' then
    raise exception using errcode = 'PT412', message = 'session_roster_draft_not_editable';
  end if;

  if draft.state_version is distinct from input_expected_state_version then
    raise exception using errcode = 'PT412', message = 'session_roster_stale_draft';
  end if;

  if draft.source_state_digest is distinct from private.session_roster_source_digest(draft.cohort_id, draft.week_start) then
    raise exception using errcode = 'PT412', message = 'session_roster_source_stale';
  end if;

  readiness := private.session_roster_readiness(input_draft_id);

  if jsonb_array_length(readiness -> 'unplaced_students') > 0 then
    raise exception using errcode = 'PT422', message = 'session_roster_unplaced_attending_students';
  end if;

  if jsonb_array_length(readiness -> 'missing_primary_teachers') > 0 then
    raise exception using errcode = 'PT422', message = 'session_roster_missing_primary_teacher';
  end if;

  if coalesce((readiness ->> 'reviewed_current')::boolean, false) = false then
    raise exception using errcode = 'PT412', message = 'session_roster_review_required';
  end if;

  if exists (
    select 1
    from public.session_roster_draft_groups as groups
    where groups.draft_id = input_draft_id
      and not exists (
        select 1
        from public.profiles
        join public.masjid_staff_memberships as staff
          on staff.profile_id = profiles.id
        join public.teacher_rotation_availability as availability
          on availability.teacher_id = profiles.id
          and availability.masjid_id = target_masjid_id
          and availability.cohort_id = draft.cohort_id
          and availability.week_start = draft.week_start
          and availability.available = true
        where profiles.id = groups.primary_teacher_id
          and profiles.role in ('teacher', 'admin')
          and profiles.active = true
          and staff.masjid_id = target_masjid_id
          and staff.staff_role = 'teacher'
          and staff.active = true
          and staff.starts_on <= draft.halaqa_saturday
          and (staff.ends_on is null or staff.ends_on >= draft.halaqa_saturday)
      )
  ) then
    raise exception using errcode = 'PT412', message = 'session_roster_primary_teacher_unavailable';
  end if;

  select versions.*
  into current_version
  from public.session_roster_versions as versions
  where versions.cohort_id = draft.cohort_id
    and versions.week_start = draft.week_start
  order by versions.version_number desc
  limit 1;

  next_version_number := coalesce(current_version.version_number, 0) + 1;

  insert into public.session_roster_versions (
    masjid_id,
    cohort_id,
    week_start,
    halaqa_saturday,
    version_number,
    source_draft_id,
    source_draft_revision,
    source_state_digest,
    published_by
  ) values (
    target_masjid_id,
    draft.cohort_id,
    draft.week_start,
    draft.halaqa_saturday,
    next_version_number,
    draft.id,
    draft.revision_number,
    draft.source_state_digest,
    input_actor_id
  )
  returning id into new_version_id;

  insert into public.session_roster_version_groups (
    version_id,
    group_id,
    group_name,
    group_sort_order,
    primary_teacher_id,
    primary_teacher_name
  )
  select
    new_version_id,
    groups.group_id,
    groups.group_name,
    groups.group_sort_order,
    groups.primary_teacher_id,
    groups.primary_teacher_name
  from public.session_roster_draft_groups as groups
  where groups.draft_id = input_draft_id;

  insert into public.session_roster_version_students (
    version_id,
    student_id,
    student_name,
    usual_group_id,
    usual_group_name,
    session_group_id,
    placement_order
  )
  select
    new_version_id,
    students.student_id,
    students.student_name,
    students.usual_group_id,
    students.usual_group_name,
    students.session_group_id,
    row_number() over (
      partition by students.session_group_id
      order by students.student_name, students.student_id
    )::integer
  from public.session_roster_draft_students as students
  where students.draft_id = input_draft_id
    and students.attendance_status = 'attending'
    and students.session_group_id is not null;

  update public.session_roster_drafts
  set status = 'published',
      published_version_id = new_version_id,
      updated_by = input_actor_id,
      updated_at = statement_timestamp()
  where id = input_draft_id;

  insert into public.session_roster_audit_events (
    actor_id,
    action,
    masjid_id,
    cohort_id,
    week_start,
    halaqa_saturday,
    draft_id,
    version_id,
    request_id,
    before_data,
    after_data,
    metadata
  ) values (
    input_actor_id,
    'version_published',
    target_masjid_id,
    draft.cohort_id,
    draft.week_start,
    draft.halaqa_saturday,
    input_draft_id,
    new_version_id,
    input_request_id,
    jsonb_build_object(
      'draft_id', input_draft_id,
      'draft_revision', draft.revision_number,
      'state_version', draft.state_version
    ),
    jsonb_build_object(
      'version_id', new_version_id,
      'version_number', next_version_number
    ),
    jsonb_build_object('warning_codes', readiness -> 'warning_codes')
  );

  result_payload := private.session_roster_published_payload(new_version_id);
  perform private.session_roster_write_request(
    input_request_id,
    'publish_draft',
    input_actor_id,
    input_draft_id,
    request_payload,
    result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.create_session_roster_revision(
  input_request_id uuid,
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date,
  input_expected_published_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_masjid_id uuid;
  current_version public.session_roster_versions%rowtype;
  current_draft public.session_roster_drafts%rowtype;
  source_state jsonb;
  source_digest text;
  request_payload jsonb;
  replay_result jsonb;
  next_revision bigint;
  created_draft_id uuid;
  result_payload jsonb;
begin
  perform private.session_roster_assert_week(input_week_start);
  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, input_cohort_id);

  perform cohorts.id
  from public.cohorts as cohorts
  where cohorts.id = input_cohort_id
    and cohorts.masjid_id = target_masjid_id
  for update;
  perform private.session_roster_lock(input_cohort_id, input_week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'cohort_id', input_cohort_id,
    'week_start', input_week_start,
    'expected_published_version_id', input_expected_published_version_id
  );

  replay_result := private.session_roster_replay_result(
    input_request_id,
    'create_revision',
    input_actor_id,
    input_cohort_id,
    request_payload
  );
  if replay_result is not null then
    return replay_result;
  end if;

  select versions.*
  into current_version
  from public.session_roster_versions as versions
  where versions.cohort_id = input_cohort_id
    and versions.week_start = input_week_start
  order by versions.version_number desc
  limit 1;

  if current_version.id is null then
    raise exception using errcode = 'P0002', message = 'session_roster_published_version_not_found';
  end if;

  if current_version.id is distinct from input_expected_published_version_id then
    raise exception using errcode = 'PT412', message = 'session_roster_published_version_stale';
  end if;

  select drafts.*
  into current_draft
  from public.session_roster_drafts as drafts
  where drafts.cohort_id = input_cohort_id
    and drafts.week_start = input_week_start
    and drafts.status = 'draft'
  for update;

  if found then
    if current_draft.base_published_version_id is distinct from current_version.id then
      raise exception using errcode = 'PT412', message = 'session_roster_revision_conflict';
    end if;

    result_payload := private.session_roster_draft_payload(current_draft.id);
    perform private.session_roster_write_request(
      input_request_id,
      'create_revision',
      input_actor_id,
      input_cohort_id,
      request_payload,
      result_payload
    );
    return result_payload;
  end if;

  source_state := private.session_roster_source_snapshot(input_cohort_id, input_week_start);
  source_digest := private.session_roster_source_digest(input_cohort_id, input_week_start);

  if source_state is null or source_digest is null then
    raise exception using errcode = '22023', message = 'session_roster_source_unavailable';
  end if;

  select coalesce(max(drafts.revision_number), 0) + 1
  into next_revision
  from public.session_roster_drafts as drafts
  where drafts.cohort_id = input_cohort_id
    and drafts.week_start = input_week_start;

  insert into public.session_roster_drafts (
    masjid_id,
    cohort_id,
    week_start,
    halaqa_saturday,
    revision_number,
    status,
    base_published_version_id,
    source_state,
    source_state_digest,
    state_version,
    created_by,
    updated_by
  ) values (
    target_masjid_id,
    input_cohort_id,
    input_week_start,
    public.halaqa_saturday_for_week(input_week_start),
    next_revision,
    'draft',
    current_version.id,
    source_state,
    source_digest,
    0,
    input_actor_id,
    input_actor_id
  )
  returning id into created_draft_id;

  perform private.session_roster_materialize_draft(
    created_draft_id,
    source_state,
    current_version.id
  );

  insert into public.session_roster_audit_events (
    actor_id,
    action,
    masjid_id,
    cohort_id,
    week_start,
    halaqa_saturday,
    draft_id,
    version_id,
    request_id,
    after_data,
    metadata
  ) values (
    input_actor_id,
    'revision_created',
    target_masjid_id,
    input_cohort_id,
    input_week_start,
    public.halaqa_saturday_for_week(input_week_start),
    created_draft_id,
    current_version.id,
    input_request_id,
    jsonb_build_object(
      'draft_id', created_draft_id,
      'revision_number', next_revision,
      'base_published_version_id', current_version.id,
      'source_state_digest', source_digest
    ),
    jsonb_build_object('seed_mode', 'published_snapshot_with_current_attendance_override')
  );

  result_payload := private.session_roster_draft_payload(created_draft_id);
  perform private.session_roster_write_request(
    input_request_id,
    'create_revision',
    input_actor_id,
    input_cohort_id,
    request_payload,
    result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.get_current_session_roster(
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
  current_version_id uuid;
begin
  perform private.session_roster_assert_week(input_week_start);
  perform private.session_roster_admin_masjid(input_actor_id, input_cohort_id);

  select versions.id
  into current_version_id
  from public.session_roster_versions as versions
  where versions.cohort_id = input_cohort_id
    and versions.week_start = input_week_start
  order by versions.version_number desc
  limit 1;

  if current_version_id is null then
    return jsonb_build_object(
      'contract_version', 1,
      'cohort_id', input_cohort_id,
      'week_start', input_week_start,
      'halaqa_saturday', public.halaqa_saturday_for_week(input_week_start),
      'version', null,
      'groups', '[]'::jsonb,
      'roster', '[]'::jsonb
    );
  end if;

  return private.session_roster_published_payload(current_version_id);
end;
$$;

create or replace function public.get_session_roster_history(
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.session_roster_assert_week(input_week_start);
  perform private.session_roster_admin_masjid(input_actor_id, input_cohort_id);

  return jsonb_build_object(
    'contract_version', 1,
    'cohort_id', input_cohort_id,
    'week_start', input_week_start,
    'halaqa_saturday', public.halaqa_saturday_for_week(input_week_start),
    'versions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', versions.id,
          'version_number', versions.version_number,
          'source_draft_id', versions.source_draft_id,
          'source_draft_revision', versions.source_draft_revision,
          'source_state_digest', versions.source_state_digest,
          'published_by', versions.published_by,
          'published_at', versions.published_at
        ) order by versions.version_number desc
      )
      from public.session_roster_versions as versions
      where versions.cohort_id = input_cohort_id
        and versions.week_start = input_week_start
    ), '[]'::jsonb),
    'audit_events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', events.id,
          'occurred_at', events.occurred_at,
          'actor_id', events.actor_id,
          'action', events.action,
          'draft_id', events.draft_id,
          'version_id', events.version_id,
          'request_id', events.request_id,
          'before_data', events.before_data,
          'after_data', events.after_data,
          'metadata', events.metadata
        ) order by events.occurred_at desc, events.id desc
      )
      from public.session_roster_audit_events as events
      where events.cohort_id = input_cohort_id
        and events.week_start = input_week_start
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.can_read_session_roster_cohort(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.can_read_session_roster_cohort(uuid)
  to authenticated;

revoke all on function public.load_or_create_session_roster_draft(uuid, uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_session_roster_draft(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.move_session_roster_student(uuid, uuid, uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.assign_session_roster_primary_teacher(uuid, uuid, uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.compute_session_roster_readiness(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.review_session_roster_draft(uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_session_roster_draft(uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.create_session_roster_revision(uuid, uuid, uuid, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_current_session_roster(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_session_roster_history(uuid, uuid, date)
  from public, anon, authenticated, service_role;

grant execute on function public.load_or_create_session_roster_draft(uuid, uuid, uuid, date)
  to service_role;
grant execute on function public.get_session_roster_draft(uuid, uuid)
  to service_role;
grant execute on function public.move_session_roster_student(uuid, uuid, uuid, uuid, uuid, bigint)
  to service_role;
grant execute on function public.assign_session_roster_primary_teacher(uuid, uuid, uuid, uuid, uuid, bigint)
  to service_role;
grant execute on function public.compute_session_roster_readiness(uuid, uuid)
  to service_role;
grant execute on function public.review_session_roster_draft(uuid, uuid, uuid, bigint)
  to service_role;
grant execute on function public.publish_session_roster_draft(uuid, uuid, uuid, bigint)
  to service_role;
grant execute on function public.create_session_roster_revision(uuid, uuid, uuid, date, uuid)
  to service_role;
grant execute on function public.get_current_session_roster(uuid, uuid, date)
  to service_role;
grant execute on function public.get_session_roster_history(uuid, uuid, date)
  to service_role;

revoke all on function private.session_roster_source_lock()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_lock(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_assert_week(date)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_admin_masjid(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_source_snapshot(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_source_digest(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_replay_result(uuid, text, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_write_request(uuid, text, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_readiness(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_draft_payload(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_published_payload(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_draft_scope_matches()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_draft_group_scope_matches()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_draft_student_scope_matches()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_version_scope_matches()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_version_student_scope_matches()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_lock_draft_sources_for_group(uuid, date, date)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_materialize_draft(uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;

-- Keep the explicit SECURITY DEFINER inventory current.  The catalog RLS
-- suite rejects any application-owned public definer that is not listed here.
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
    'public.apply_student_rotation_availability(uuid,uuid,date,jsonb)',
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
    'public.assign_session_roster_primary_teacher(uuid,uuid,uuid,uuid,uuid,bigint)',
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
    'public.can_read_session_roster_cohort(uuid)',
    'public.can_read_student_for_week(uuid,date)',
    'public.can_teacher_read_weekly_plan_path(text)',
    'public.cohort_masjid_id(uuid)',
    'public.compute_session_roster_readiness(uuid,uuid)',
    'public.create_session_roster_revision(uuid,uuid,uuid,date,uuid)',
    'public.current_effective_date()',
    'public.current_partner_recitation_round()',
    'public.current_toronto_civil_date()',
    'public.enforce_student_accountability_attestation()',
    'public.enforce_student_checkin_integrity()',
    'public.enforce_student_checkin_item_integrity()',
    'public.get_current_session_roster(uuid,uuid,date)',
    'public.get_person_access_state(uuid,uuid)',
    'public.get_scoped_user_setup_auth_recovery(uuid,uuid,text,text,text,text,date,uuid,uuid)',
    'public.get_scoped_user_setup_auth_recovery(uuid,uuid,text,text,text,text,date,date,uuid,uuid)',
    'public.get_scoped_user_setup_request_result(uuid,uuid,text,text,text,text,date,uuid,uuid)',
    'public.get_scoped_user_setup_request_result(uuid,uuid,text,text,text,text,date,date,uuid,uuid)',
    'public.get_session_roster_draft(uuid,uuid)',
    'public.get_session_roster_history(uuid,uuid,date)',
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
    'public.load_or_create_session_roster_draft(uuid,uuid,uuid,date)',
    'public.move_session_roster_student(uuid,uuid,uuid,uuid,uuid,bigint)',
    'public.prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)',
    'public.prepare_teacher_rotation_publication(uuid,uuid,uuid,date)',
    'public.preview_official_scoring_start_change(uuid,uuid,date)',
    'public.protect_foundation_row_identity()',
    'public.publish_session_roster_draft(uuid,uuid,uuid,bigint)',
    'public.recalculate_student_checkin_score()',
    'public.reconcile_historical_accountability_obligation(uuid,date)',
    'public.refresh_current_profile_role()',
    'public.review_session_roster_draft(uuid,uuid,uuid,bigint)',
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
    'public.student_rotation_availability_scope_matches()',
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
    'private.recompute_profile_access(uuid,date)',
    'private.session_roster_source_lock()'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
