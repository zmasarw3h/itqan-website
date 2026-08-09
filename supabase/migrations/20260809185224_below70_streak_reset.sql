-- Additive below-70 streak reset support.
--
-- The reset row is an immutable historical boundary. It never rewrites a
-- grade, activity row, or historical report snapshot. The only browser write
-- surface is the authenticated, scoped RPC below.

create table public.below70_streak_resets (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete restrict,
  masjid_id uuid not null references public.masajid(id) on delete restrict,
  cohort_id uuid not null references public.cohorts(id) on delete restrict,
  halaqa_group_id uuid not null references public.halaqa_groups(id) on delete restrict,
  effective_through_week_start date not null,
  previous_streak_length integer not null,
  passed_test_confirmation boolean not null,
  admin_note text,
  request_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint below70_streak_resets_week_start_check check (
    effective_through_week_start = public.week_start_for_date(effective_through_week_start)
  ),
  constraint below70_streak_resets_previous_streak_check check (previous_streak_length >= 3),
  constraint below70_streak_resets_passed_test_check check (passed_test_confirmation is true),
  constraint below70_streak_resets_note_check check (
    admin_note is null
    or (
      btrim(admin_note) <> ''
      and char_length(btrim(admin_note)) <= 280
      and admin_note !~ '[[:cntrl:]]'
    )
  ),
  constraint below70_streak_resets_request_unique unique (request_id),
  constraint below70_streak_resets_student_week_unique unique (student_id, effective_through_week_start)
);

create index below70_streak_resets_student_effective_week_idx
  on public.below70_streak_resets(student_id, effective_through_week_start desc);

-- Scope identifiers are retained as immutable snapshots. RESTRICT foreign keys
-- prevent later hierarchy deletion from erasing the meaning of an audit row.
alter table public.below70_streak_resets enable row level security;

-- No Data API role can read or mutate the reset ledger directly. The typed
-- read RPC below is the only browser read surface, and the command RPC is the
-- only write surface.
revoke all on table public.below70_streak_resets from public, anon, authenticated, service_role;

create policy "Below-70 reset ledger is server-mediated"
  on public.below70_streak_resets
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

-- Keep the append-only invariant at the table boundary as well as at the
-- privilege boundary. The function is a trigger helper, not an API function.
create or replace function private.prevent_below70_streak_reset_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Below-70 streak reset records are append-only.';
end;
$$;

create trigger below70_streak_resets_immutable_update
  before update on public.below70_streak_resets
  for each row
  execute function private.prevent_below70_streak_reset_mutation();

create trigger below70_streak_resets_immutable_delete
  before delete on public.below70_streak_resets
  for each row
  execute function private.prevent_below70_streak_reset_mutation();

revoke all on function private.prevent_below70_streak_reset_mutation()
  from public, anon, authenticated, service_role;

-- A reset and its audit event are one logical operation. This index protects
-- the audit side of the duplicate/concurrency invariant independently of the
-- reset ledger's unique student/week boundary.
create unique index super_admin_audit_events_below70_reset_unique_idx
  on public.super_admin_audit_events(target_id)
  where action = 'below70_streak_reset'
    and target_table = 'below70_streak_resets';

-- This is the database's canonical active-streak calculation. Missing daily,
-- partner, or halaqa activity is scored according to the existing weekly
-- scoring policy (zero contribution). A week with no qualifying historical
-- membership, an ambiguous membership, an incomplete week, or a passing week
-- ends the consecutive streak. The reset boundary is exclusive: only weeks
-- strictly after it can start the next active streak.
create or replace function private.raw_below70_streak(
  input_student_id uuid,
  input_through_week_start date
)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  minimum_week_start date;
  reset_boundary date;
  week_start date;
  weekly_percentage numeric;
  historical_scope_count integer;
  streak_length integer := 0;
begin
  if input_through_week_start is null
    or input_through_week_start <> public.week_start_for_date(input_through_week_start)
    or input_through_week_start + 6 >= public.current_effective_date() then
    return 0;
  end if;

  select profiles.score_starts_on
  into minimum_week_start
  from public.profiles
  where profiles.id = input_student_id;

  if minimum_week_start is null or minimum_week_start > input_through_week_start then
    return 0;
  end if;

  select max(resets.effective_through_week_start)
  into reset_boundary
  from public.below70_streak_resets as resets
  where resets.student_id = input_student_id
    and resets.effective_through_week_start <= input_through_week_start;

  for week_start in
    select generated.week_start::date
    from generate_series(
      input_through_week_start::timestamp,
      date '2026-05-31'::timestamp,
      interval '-7 days'
    ) as generated(week_start)
  loop
    if week_start < minimum_week_start
      or (reset_boundary is not null and week_start <= reset_boundary) then
      exit;
    end if;

    select count(*)
    into historical_scope_count
    from public.student_group_memberships as memberships
    join public.halaqa_groups as groups on groups.id = memberships.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
    where memberships.student_id = input_student_id
      and memberships.starts_on <= week_start
      and (memberships.ends_on is null or memberships.ends_on >= week_start);

    if historical_scope_count <> 1 then
      exit;
    end if;

    weekly_percentage := private.raw_historical_weekly_percentage(
      input_student_id,
      week_start
    );

    if weekly_percentage is null or weekly_percentage >= 70 then
      exit;
    end if;

    streak_length := streak_length + 1;
  end loop;

  return streak_length;
end;
$$;

-- A shared private read snapshot keeps the single-student and batch read
-- contracts on the same calculation and reset-boundary semantics.
create or replace function private.raw_below70_streak_snapshot(
  input_student_id uuid,
  input_through_week_start date
)
returns table (
  student_id uuid,
  active_streak_length integer,
  streak_through_week_start date,
  latest_reset_id uuid,
  latest_reset_masjid_id uuid,
  latest_reset_cohort_id uuid,
  latest_reset_group_id uuid,
  latest_reset_effective_through_week_start date,
  latest_reset_previous_streak_length integer,
  latest_reset_passed_test_confirmation boolean,
  latest_reset_admin_note text,
  latest_reset_actor_id uuid,
  latest_reset_created_at timestamptz,
  authorization_masjid_id uuid
)
language sql
stable
set search_path = ''
as $$
  with latest_reset as (
    select resets.*
    from public.below70_streak_resets as resets
    where resets.student_id = input_student_id
      and resets.effective_through_week_start <= input_through_week_start
    order by resets.effective_through_week_start desc, resets.created_at desc, resets.id desc
    limit 1
  ), historical_scope as (
    select groups.id as group_id,
           cohorts.id as cohort_id,
           cohorts.masjid_id
    from public.student_group_memberships as memberships
    join public.halaqa_groups as groups on groups.id = memberships.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
    where memberships.student_id = input_student_id
      and memberships.starts_on <= input_through_week_start
      and (memberships.ends_on is null or memberships.ends_on >= input_through_week_start)
    order by memberships.starts_on desc, memberships.id desc
    limit 1
  )
  select input_student_id,
         private.raw_below70_streak(input_student_id, input_through_week_start),
         input_through_week_start,
         latest_reset.id,
         latest_reset.masjid_id,
         latest_reset.cohort_id,
         latest_reset.halaqa_group_id,
         latest_reset.effective_through_week_start,
         latest_reset.previous_streak_length,
         latest_reset.passed_test_confirmation,
         latest_reset.admin_note,
         latest_reset.actor_id,
         latest_reset.created_at,
         coalesce(historical_scope.masjid_id, latest_reset.masjid_id)
  from (select 1) as anchor
  left join historical_scope on true
  left join latest_reset on true;
$$;

revoke all on function private.raw_below70_streak(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_below70_streak_snapshot(uuid, date)
  from public, anon, authenticated, service_role;

-- Return a typed current-or-historical snapshot for one student. A null
-- through-week means the latest completed Sunday-start tracker week under the
-- existing Toronto 1:00 a.m. effective-date rule.
create or replace function public.get_student_below70_streak(
  input_student_id uuid,
  input_through_week_start date default null
)
returns table (
  student_id uuid,
  active_streak_length integer,
  streak_through_week_start date,
  latest_reset_id uuid,
  latest_reset_masjid_id uuid,
  latest_reset_cohort_id uuid,
  latest_reset_group_id uuid,
  latest_reset_effective_through_week_start date,
  latest_reset_previous_streak_length integer,
  latest_reset_passed_test_confirmation boolean,
  latest_reset_admin_note text,
  latest_reset_actor_id uuid,
  latest_reset_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  actor_active boolean;
  requested_through_week_start date := coalesce(
    input_through_week_start,
    public.week_start_for_date(public.current_effective_date()) - 7
  );
  snapshot record;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  select profiles.role, profiles.active
  into actor_role, actor_active
  from public.profiles
  where profiles.id = actor_id;

  if not coalesce(actor_active, false)
    or actor_role not in ('student', 'admin', 'super_admin') then
    raise exception using errcode = '42501', message = 'Below-70 streak read access is required.';
  end if;

  if requested_through_week_start is null
    or requested_through_week_start <> public.week_start_for_date(requested_through_week_start)
    or requested_through_week_start + 6 >= public.current_effective_date() then
    raise exception using errcode = '22023', message = 'The streak read week must be a completed Sunday tracker week.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where profiles.id = input_student_id
      and profiles.role = 'student'
  ) then
    raise exception using errcode = '42501', message = 'A student target is required.';
  end if;

  if actor_role = 'student'
    and not exists (
      select 1
      from public.profiles
      where profiles.id = input_student_id
        and profiles.active = true
    ) then
    raise exception using errcode = '42501', message = 'An active student is required.';
  end if;

  select *
  into snapshot
  from private.raw_below70_streak_snapshot(input_student_id, requested_through_week_start);

  if actor_role = 'student' then
    if actor_id <> input_student_id then
      raise exception using errcode = '42501', message = 'Students may read only their own below-70 streak.';
    end if;
  elsif actor_role = 'admin' then
    if snapshot.authorization_masjid_id is null
      or not private.raw_is_admin_for_masjid(
        actor_id,
        snapshot.authorization_masjid_id,
        public.current_toronto_civil_date()
      ) then
      raise exception using errcode = '42501', message = 'Scoped administration is required for this student.';
    end if;
  end if;

  return query
  select snapshot.student_id,
         snapshot.active_streak_length,
         snapshot.streak_through_week_start,
         snapshot.latest_reset_id,
         snapshot.latest_reset_masjid_id,
         snapshot.latest_reset_cohort_id,
         snapshot.latest_reset_group_id,
         snapshot.latest_reset_effective_through_week_start,
         snapshot.latest_reset_previous_streak_length,
         snapshot.latest_reset_passed_test_confirmation,
         case when actor_role in ('admin', 'super_admin') then snapshot.latest_reset_admin_note end,
         snapshot.latest_reset_actor_id,
         snapshot.latest_reset_created_at;
end;
$$;

-- The admin leaderboard uses this batch contract so reset boundaries do not
-- cause one read RPC per visible student. Unauthorized IDs are omitted rather
-- than returned with scope metadata.
create or replace function public.get_students_below70_streaks(
  input_student_ids uuid[],
  input_through_week_start date default null
)
returns table (
  student_id uuid,
  active_streak_length integer,
  streak_through_week_start date,
  latest_reset_id uuid,
  latest_reset_masjid_id uuid,
  latest_reset_cohort_id uuid,
  latest_reset_group_id uuid,
  latest_reset_effective_through_week_start date,
  latest_reset_previous_streak_length integer,
  latest_reset_passed_test_confirmation boolean,
  latest_reset_admin_note text,
  latest_reset_actor_id uuid,
  latest_reset_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  actor_active boolean;
  requested_through_week_start date := coalesce(
    input_through_week_start,
    public.week_start_for_date(public.current_effective_date()) - 7
  );
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if input_student_ids is null
    or cardinality(input_student_ids) = 0
    or array_position(input_student_ids, null) is not null then
    raise exception using errcode = '22023', message = 'At least one student id is required.';
  end if;

  select profiles.role, profiles.active
  into actor_role, actor_active
  from public.profiles
  where profiles.id = actor_id;

  if not coalesce(actor_active, false)
    or actor_role not in ('student', 'admin', 'super_admin') then
    raise exception using errcode = '42501', message = 'Below-70 streak read access is required.';
  end if;

  if requested_through_week_start is null
    or requested_through_week_start <> public.week_start_for_date(requested_through_week_start)
    or requested_through_week_start + 6 >= public.current_effective_date() then
    raise exception using errcode = '22023', message = 'The streak read week must be a completed Sunday tracker week.';
  end if;

  if actor_role = 'student'
    and (cardinality(input_student_ids) <> 1 or input_student_ids[1] <> actor_id) then
    raise exception using errcode = '42501', message = 'Students may read only their own below-70 streak.';
  end if;

  return query
  with requested_students as (
    select distinct requested.student_id
    from unnest(input_student_ids) as requested(student_id)
  )
  select snapshot.student_id,
         snapshot.active_streak_length,
         snapshot.streak_through_week_start,
         snapshot.latest_reset_id,
         snapshot.latest_reset_masjid_id,
         snapshot.latest_reset_cohort_id,
         snapshot.latest_reset_group_id,
         snapshot.latest_reset_effective_through_week_start,
         snapshot.latest_reset_previous_streak_length,
         snapshot.latest_reset_passed_test_confirmation,
         case when actor_role in ('admin', 'super_admin') then snapshot.latest_reset_admin_note end,
         snapshot.latest_reset_actor_id,
         snapshot.latest_reset_created_at
  from requested_students
  join public.profiles as students on students.id = requested_students.student_id
  cross join lateral private.raw_below70_streak_snapshot(
    students.id,
    requested_through_week_start
  ) as snapshot
  where students.role = 'student'
    and (students.active or actor_role in ('admin', 'super_admin'))
    and (
      actor_role = 'super_admin'
      or (actor_role = 'student' and students.id = actor_id)
      or (
        actor_role = 'admin'
        and snapshot.authorization_masjid_id is not null
        and private.raw_is_admin_for_masjid(
          actor_id,
          snapshot.authorization_masjid_id,
          public.current_toronto_civil_date()
        )
      )
    );
end;
$$;

-- The command revalidates target profile, historical scope, current scoped
-- authority, completed-week boundary, active streak, confirmation, and note
-- inside one transaction. The advisory transaction lock serializes retries for
-- a student; the two unique constraints cover both request replay and the
-- logical one-reset-per-student-per-completed-week invariant.
create or replace function public.reset_student_below70_streak(
  input_request_id uuid,
  input_student_id uuid,
  input_passed_test boolean,
  input_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_completed_week_start date;
  normalized_note text;
  target_role text;
  target_active boolean;
  scope_count integer;
  scope_masjid_id uuid;
  scope_cohort_id uuid;
  scope_group_id uuid;
  previous_streak_length integer;
  existing_reset public.below70_streak_resets%rowtype;
  inserted_reset public.below70_streak_resets%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if input_request_id is null or input_student_id is null then
    raise exception using errcode = '22023', message = 'Request id and student id are required.';
  end if;

  if input_passed_test is distinct from true then
    raise exception using errcode = '22023', message = 'Explicit passed-test confirmation is required.';
  end if;

  normalized_note := nullif(btrim(input_note), '');
  if normalized_note is not null
    and (
      char_length(normalized_note) > 280
      or normalized_note ~ '[[:cntrl:]]'
    ) then
    raise exception using errcode = '22023', message = 'Admin note must be at most 280 characters and contain no control characters.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('below70-streak-reset:' || input_student_id::text, 0)
  );

  current_completed_week_start := public.week_start_for_date(public.current_effective_date()) - 7;

  select profiles.role, profiles.active
  into target_role, target_active
  from public.profiles
  where profiles.id = input_student_id;

  if target_role is distinct from 'student' or not coalesce(target_active, false) then
    raise exception using errcode = '42501', message = 'An active student target is required.';
  end if;

  select count(*)
  into scope_count
  from public.student_group_memberships as memberships
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  where memberships.student_id = input_student_id
    and memberships.starts_on <= current_completed_week_start
    and (memberships.ends_on is null or memberships.ends_on >= current_completed_week_start);

  if scope_count <> 1 then
    raise exception using errcode = '42501', message = 'Exactly one historical student scope is required for the completed week.';
  end if;

  select groups.id, cohorts.id, cohorts.masjid_id
  into scope_group_id, scope_cohort_id, scope_masjid_id
  from public.student_group_memberships as memberships
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  where memberships.student_id = input_student_id
    and memberships.starts_on <= current_completed_week_start
    and (memberships.ends_on is null or memberships.ends_on >= current_completed_week_start)
  order by memberships.starts_on desc, memberships.id desc
  limit 1;

  if not private.raw_is_admin_for_masjid(
    actor_id,
    scope_masjid_id,
    public.current_toronto_civil_date()
  ) then
    raise exception using errcode = '42501', message = 'Active scoped administration is required for the student''s masjid.';
  end if;

  select resets.*
  into existing_reset
  from public.below70_streak_resets as resets
  where resets.request_id = input_request_id
  for update;

  if existing_reset.id is not null then
    if not private.raw_is_admin_for_masjid(
      actor_id,
      existing_reset.masjid_id,
      public.current_toronto_civil_date()
    ) then
      raise exception using errcode = '42501', message = 'Active administration for the original reset masjid is required.';
    end if;

    if existing_reset.student_id <> input_student_id
      or existing_reset.admin_note is distinct from normalized_note
      or existing_reset.passed_test_confirmation is distinct from input_passed_test then
      raise exception using errcode = '22023', message = 'Request id was already used for a different reset.';
    end if;

    return jsonb_build_object(
      'status', 'replayed',
      'reset_id', existing_reset.id,
      'student_id', existing_reset.student_id,
      'masjid_id', existing_reset.masjid_id,
      'cohort_id', existing_reset.cohort_id,
      'halaqa_group_id', existing_reset.halaqa_group_id,
      'effective_through_week_start', existing_reset.effective_through_week_start,
      'previous_streak_length', existing_reset.previous_streak_length,
      'passed_test_confirmation', existing_reset.passed_test_confirmation,
      'admin_note', existing_reset.admin_note,
      'actor_id', existing_reset.actor_id,
      'created_at', existing_reset.created_at,
      'active_streak_length', 0
    );
  end if;

  select resets.*
  into existing_reset
  from public.below70_streak_resets as resets
  where resets.student_id = input_student_id
    and resets.effective_through_week_start = current_completed_week_start
  for update;

  if existing_reset.id is not null then
    if not private.raw_is_admin_for_masjid(
      actor_id,
      existing_reset.masjid_id,
      public.current_toronto_civil_date()
    ) then
      raise exception using errcode = '42501', message = 'Active administration for the original reset masjid is required.';
    end if;

    return jsonb_build_object(
      'status', 'replayed',
      'reset_id', existing_reset.id,
      'student_id', existing_reset.student_id,
      'masjid_id', existing_reset.masjid_id,
      'cohort_id', existing_reset.cohort_id,
      'halaqa_group_id', existing_reset.halaqa_group_id,
      'effective_through_week_start', existing_reset.effective_through_week_start,
      'previous_streak_length', existing_reset.previous_streak_length,
      'passed_test_confirmation', existing_reset.passed_test_confirmation,
      'admin_note', existing_reset.admin_note,
      'actor_id', existing_reset.actor_id,
      'created_at', existing_reset.created_at,
      'active_streak_length', 0
    );
  end if;

  previous_streak_length := private.raw_below70_streak(
    input_student_id,
    current_completed_week_start
  );

  if previous_streak_length < 3 then
    raise exception using
      errcode = '22023',
      message = 'The active below-70 streak must be at least 3 completed weeks.';
  end if;

  insert into public.below70_streak_resets (
    student_id,
    masjid_id,
    cohort_id,
    halaqa_group_id,
    effective_through_week_start,
    previous_streak_length,
    passed_test_confirmation,
    admin_note,
    request_id,
    actor_id
  )
  values (
    input_student_id,
    scope_masjid_id,
    scope_cohort_id,
    scope_group_id,
    current_completed_week_start,
    previous_streak_length,
    input_passed_test,
    normalized_note,
    input_request_id,
    actor_id
  )
  returning * into inserted_reset;

  insert into public.super_admin_audit_events (
    actor_id,
    action,
    target_table,
    target_id,
    target_masjid_id,
    before_data,
    after_data,
    metadata
  )
  values (
    actor_id,
    'below70_streak_reset',
    'below70_streak_resets',
    inserted_reset.id,
    inserted_reset.masjid_id,
    jsonb_build_object(
      'active_streak_length', previous_streak_length,
      'effective_through_week_start', current_completed_week_start
    ),
    jsonb_build_object(
      'active_streak_length', 0,
      'effective_through_week_start', current_completed_week_start
    ),
    jsonb_build_object(
      'student_id', inserted_reset.student_id,
      'masjid_id', inserted_reset.masjid_id,
      'cohort_id', inserted_reset.cohort_id,
      'halaqa_group_id', inserted_reset.halaqa_group_id,
      'effective_through_week_start', inserted_reset.effective_through_week_start,
      'previous_streak_length', inserted_reset.previous_streak_length,
      'passed_test_confirmation', inserted_reset.passed_test_confirmation
    )
  );

  return jsonb_build_object(
    'status', 'reset',
    'reset_id', inserted_reset.id,
    'student_id', inserted_reset.student_id,
    'masjid_id', inserted_reset.masjid_id,
    'cohort_id', inserted_reset.cohort_id,
    'halaqa_group_id', inserted_reset.halaqa_group_id,
    'effective_through_week_start', inserted_reset.effective_through_week_start,
    'previous_streak_length', inserted_reset.previous_streak_length,
    'passed_test_confirmation', inserted_reset.passed_test_confirmation,
    'admin_note', inserted_reset.admin_note,
    'actor_id', inserted_reset.actor_id,
    'created_at', inserted_reset.created_at,
    'active_streak_length', 0
  );
end;
$$;

-- Extend the reviewed SECURITY DEFINER inventory for the new API surface.
alter function private.application_security_definer_oids()
  rename to application_security_definer_oids_before_below70_reset;

create or replace function private.application_security_definer_oids()
returns table (function_oid oid)
language sql
stable
set search_path = ''
as $$
  select function_oid
  from private.application_security_definer_oids_before_below70_reset()
  union
  select 'public.get_student_below70_streak(uuid,date)'::regprocedure::oid
  union
  select 'public.get_students_below70_streaks(uuid[],date)'::regprocedure::oid
  union
  select 'public.reset_student_below70_streak(uuid,uuid,boolean,text)'::regprocedure::oid;
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;

revoke all on function public.get_student_below70_streak(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_students_below70_streaks(uuid[], date)
  from public, anon, authenticated, service_role;
revoke all on function public.reset_student_below70_streak(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;

grant execute on function public.get_student_below70_streak(uuid, date) to authenticated;
grant execute on function public.get_students_below70_streaks(uuid[], date) to authenticated;
grant execute on function public.reset_student_below70_streak(uuid, uuid, boolean, text) to authenticated;

alter function public.get_student_below70_streak(uuid, date) set search_path = '';
alter function public.get_students_below70_streaks(uuid[], date) set search_path = '';
alter function public.reset_student_below70_streak(uuid, uuid, boolean, text) set search_path = '';
