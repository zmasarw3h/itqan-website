-- Additive review amendment for the teacher-driven rotation wizard.
-- Existing wizard RPC signatures and all legacy roster history remain intact.

alter table public.session_roster_drafts
  add column if not exists default_group_count integer not null default 0,
  add column if not exists requested_group_count integer,
  add column if not exists group_count_mismatch_confirmed boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.session_roster_drafts'::regclass
      and conname = 'session_roster_drafts_requested_group_count_check'
  ) then
    alter table public.session_roster_drafts
      add constraint session_roster_drafts_requested_group_count_check
      check (requested_group_count is null or requested_group_count > 0);
  end if;
end;
$$;

-- This is an immutable publication snapshot. A participant may be a primary
-- teacher for one slot or a cohort co-teacher without a primary slot.
create table if not exists public.session_roster_version_teachers (
  version_id uuid not null references public.session_roster_versions(id) on delete restrict,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  teacher_name text not null,
  teacher_email text,
  participant_sort_order integer not null,
  is_primary boolean not null default false,
  primary_slot_id uuid,
  primary_slot_name text,
  created_at timestamptz not null default now(),
  primary key (version_id, teacher_id),
  constraint session_roster_version_teachers_name_check
    check (char_length(btrim(teacher_name)) > 0),
  constraint session_roster_version_teachers_sort_check
    check (participant_sort_order > 0),
  constraint session_roster_version_teachers_primary_check
    check (
      (is_primary and primary_slot_id is not null)
      or (not is_primary and primary_slot_id is null)
    ),
  constraint session_roster_version_teachers_primary_slot_fk
    foreign key (version_id, primary_slot_id)
    references public.session_roster_version_slots(version_id, slot_id)
    on delete restrict
);

create index if not exists session_roster_version_teachers_teacher_idx
  on public.session_roster_version_teachers(teacher_id, version_id);

create index if not exists session_roster_version_teachers_primary_idx
  on public.session_roster_version_teachers(version_id, is_primary, participant_sort_order);

alter table public.session_roster_version_teachers enable row level security;
revoke all on table public.session_roster_version_teachers
  from public, anon, authenticated;
grant select on table public.session_roster_version_teachers to authenticated;
grant all on table public.session_roster_version_teachers to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'session_roster_version_teachers'
      and policyname = 'Current participants can read published teacher snapshot'
  ) then
    create policy "Current participants can read published teacher snapshot"
      on public.session_roster_version_teachers
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.session_roster_versions as versions
          where versions.id = session_roster_version_teachers.version_id
            and private.teacher_session_current_version_id(versions.cohort_id, versions.week_start) = versions.id
            and (
              public.is_admin_for_masjid(versions.masjid_id)
              or exists (
                select 1
                from public.profiles as actors
                join public.masjid_staff_memberships as staff
                  on staff.profile_id = actors.id
                  and staff.masjid_id = versions.masjid_id
                  and staff.staff_role = 'teacher'
                  and staff.active = true
                  and staff.starts_on <= versions.halaqa_saturday
                  and (staff.ends_on is null or staff.ends_on >= versions.halaqa_saturday)
                where actors.id = (select auth.uid())
                  and actors.id = session_roster_version_teachers.teacher_id
                  and actors.role in ('teacher', 'admin')
                  and actors.active = true
              )
            )
        )
      );
  end if;
end;
$$;

create or replace function private.session_roster_version_teacher_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'PT412', message = 'session_roster_version_teacher_immutable';
end;
$$;

drop trigger if exists session_roster_version_teachers_immutable_trigger
  on public.session_roster_version_teachers;
create trigger session_roster_version_teachers_immutable_trigger
  before update or delete on public.session_roster_version_teachers
  for each row execute function private.session_roster_version_teacher_immutable();

-- Populate the participant snapshot from the draft's canonical availability
-- snapshot whenever a published wizard slot is inserted. The trigger is
-- intentionally non-definer; publication itself is the guarded writer.
create or replace function private.session_roster_snapshot_version_participants()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.session_roster_version_teachers (
    version_id,
    teacher_id,
    teacher_name,
    teacher_email,
    participant_sort_order,
    is_primary,
    primary_slot_id,
    primary_slot_name
  )
  select
    versions.id,
    teachers.teacher_id,
    teachers.teacher_name,
    teachers.teacher_email,
    row_number() over (
      partition by versions.id
      order by teachers.teacher_name, teachers.teacher_id
    )::integer,
    primary_slot.slot_id is not null,
    primary_slot.slot_id,
    primary_slot.slot_name
  from public.session_roster_versions as versions
  join public.session_roster_drafts as drafts
    on drafts.id = versions.source_draft_id
  cross join lateral jsonb_to_recordset(drafts.source_state -> 'teachers') as teachers(
    teacher_id uuid,
    teacher_name text,
    teacher_email text,
    available boolean
  )
  left join lateral (
    select rows.slot_id, rows.slot_name
    from public.session_roster_version_slots as rows
    where rows.version_id = versions.id
      and rows.primary_teacher_id = teachers.teacher_id
    order by rows.slot_sort_order, rows.slot_id
    limit 1
  ) as primary_slot on true
  where drafts.wizard_mode = 'teacher_driven'
    and jsonb_typeof(drafts.source_state -> 'teachers') = 'array'
    and coalesce(teachers.available, false)
  on conflict (version_id, teacher_id) do nothing;

  return null;
end;
$$;

drop trigger if exists session_roster_version_slots_participant_snapshot_trigger
  on public.session_roster_version_slots;
create trigger session_roster_version_slots_participant_snapshot_trigger
  after insert on public.session_roster_version_slots
  for each statement execute function private.session_roster_snapshot_version_participants();

-- Add the known immutable primary-teacher portion for any slot publications
-- that predate this amendment. Co-teacher participation is only knowable from
-- the draft availability snapshot and is therefore captured for new publishes.
insert into public.session_roster_version_teachers (
  version_id,
  teacher_id,
  teacher_name,
  teacher_email,
  participant_sort_order,
  is_primary,
  primary_slot_id,
  primary_slot_name
)
select distinct on (slots.version_id, slots.primary_teacher_id)
  slots.version_id,
  slots.primary_teacher_id,
  slots.primary_teacher_name,
  profiles.email,
  row_number() over (
    partition by slots.version_id
    order by slots.slot_sort_order, slots.slot_id
  )::integer,
  true,
  slots.slot_id,
  slots.slot_name
from public.session_roster_version_slots as slots
join public.profiles
  on profiles.id = slots.primary_teacher_id
where slots.primary_teacher_id is not null
order by slots.version_id, slots.primary_teacher_id, slots.slot_sort_order, slots.slot_id
on conflict (version_id, teacher_id) do nothing;

-- Current participant authorization is cohort-wide and current-version-only.
-- Permanent assignment authorization remains the separate legacy branch.
create or replace function private.raw_teacher_session_cohort_authorized(
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.profiles as actors
    join public.cohorts on cohorts.id = input_cohort_id
    join public.masajid on masajid.id = cohorts.masjid_id
    where actors.id = input_actor_id
      and actors.role in ('teacher', 'admin')
      and actors.active = true
      and cohorts.active = true
      and masajid.active = true
      and exists (
        select 1
        from public.halaqa_groups as groups
        join public.group_teacher_assignments as assignments
          on assignments.group_id = groups.id
          and assignments.teacher_id = input_actor_id
          and assignments.week_start = input_week_start
          and assignments.active = true
        where groups.cohort_id = input_cohort_id
          and private.raw_can_teacher_access_assignment(
            input_actor_id,
            assignments.group_id,
            input_week_start
          )
      )
  )
  or exists (
    select 1
    from public.profiles as actors
    join public.cohorts on cohorts.id = input_cohort_id
    join public.masajid on masajid.id = cohorts.masjid_id
    join public.session_roster_versions as versions
      on versions.cohort_id = cohorts.id
      and versions.week_start = input_week_start
      and private.teacher_session_current_version_id(versions.cohort_id, versions.week_start) = versions.id
    join public.session_roster_version_teachers as participants
      on participants.version_id = versions.id
      and participants.teacher_id = actors.id
    join public.masjid_staff_memberships as staff
      on staff.profile_id = actors.id
      and staff.masjid_id = cohorts.masjid_id
      and staff.staff_role = 'teacher'
      and staff.active = true
      and staff.starts_on <= versions.halaqa_saturday
      and (staff.ends_on is null or staff.ends_on >= versions.halaqa_saturday)
    where actors.id = input_actor_id
      and actors.role in ('teacher', 'admin')
      and actors.active = true
      and cohorts.active = true
      and masajid.active = true
  )
  or exists (
    select 1
    from public.profiles as actors
    join public.cohorts on cohorts.id = input_cohort_id
    join public.masajid on masajid.id = cohorts.masjid_id
    join public.masjid_staff_memberships as staff
      on staff.profile_id = actors.id
      and staff.masjid_id = cohorts.masjid_id
      and staff.staff_role = 'teacher'
      and staff.active = true
      and staff.starts_on <= public.halaqa_saturday_for_week(input_week_start)
      and (staff.ends_on is null or staff.ends_on >= public.halaqa_saturday_for_week(input_week_start))
    join public.session_roster_versions as versions
      on versions.cohort_id = cohorts.id
      and versions.week_start = input_week_start
      and private.teacher_session_current_version_id(versions.cohort_id, versions.week_start) = versions.id
    left join public.session_roster_version_groups as legacy_groups
      on legacy_groups.version_id = versions.id
      and legacy_groups.primary_teacher_id = actors.id
    left join public.session_roster_version_slots as slots
      on slots.version_id = versions.id
      and slots.primary_teacher_id = actors.id
    where actors.id = input_actor_id
      and actors.role in ('teacher', 'admin')
      and actors.active = true
      and cohorts.active = true
      and masajid.active = true
      and (legacy_groups.group_id is not null or slots.slot_id is not null)
  );
end;
$$;

create or replace function private.session_roster_wizard_readiness_v2(
  input_draft_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  draft_row public.session_roster_drafts%rowtype;
  current_digest text;
  current_revision bigint;
  current_source jsonb;
  default_group_count integer := 0;
  requested_group_count integer;
  actual_group_count integer := 0;
  attending_count integer := 0;
  unavailable_count integer := 0;
  placed_count integer := 0;
  unplaced_count integer := 0;
  largest_group_count integer := 0;
  smallest_group_count integer := 0;
  duplicate_primary_count integer := 0;
  imbalance_warning boolean := false;
  source_stale boolean := false;
  reviewed_current boolean := false;
  group_count_mismatch boolean := false;
  actual_group_count_mismatch boolean := false;
  group_count_mismatch_confirmation_required boolean := false;
  group_count_mismatch_confirmed boolean := false;
  permanent_anchor_mismatch_confirmation_required boolean := false;
  permanent_anchor_mismatch_confirmed boolean := true;
  group_count_mismatch_direction text := 'none';
  group_counts jsonb := '[]'::jsonb;
  unplaced_students jsonb := '[]'::jsonb;
  missing_primary_teachers jsonb := '[]'::jsonb;
  mismatch_groups jsonb := '[]'::jsonb;
  primary_responsibilities jsonb := '[]'::jsonb;
  participating_teachers jsonb := '[]'::jsonb;
  blocker_codes jsonb := '[]'::jsonb;
  warning_codes jsonb := '[]'::jsonb;
  prerequisite_state jsonb := '{}'::jsonb;
  recovery_guidance text := null;
begin
  select drafts.*
  into draft_row
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if draft_row.id is null then
    return null;
  end if;

  current_source := private.session_roster_wizard_source_snapshot(
    draft_row.cohort_id,
    draft_row.week_start
  );
  current_digest := private.session_roster_wizard_source_digest(
    draft_row.cohort_id,
    draft_row.week_start
  );
  current_revision := private.session_roster_dependency_revision_read(
    draft_row.cohort_id,
    draft_row.week_start
  );

  select count(*)::integer
  into default_group_count
  from jsonb_array_elements(coalesce(current_source -> 'teachers', '[]'::jsonb)) as rows(teacher)
  where coalesce((teacher->>'available')::boolean, false);

  select count(*)::integer
  into actual_group_count
  from public.session_roster_draft_slots as slots
  where slots.draft_id = input_draft_id;

  requested_group_count := coalesce(draft_row.requested_group_count, nullif(actual_group_count, 0));

  select
    count(*) filter (where students.attendance_status = 'attending')::integer,
    count(*) filter (where students.attendance_status = 'unavailable')::integer,
    count(*) filter (
      where students.attendance_status = 'attending'
        and (students.session_group_slot_id is not null or students.session_group_id is not null)
    )::integer,
    count(*) filter (
      where students.attendance_status = 'attending'
        and students.session_group_slot_id is null
        and students.session_group_id is null
    )::integer
  into attending_count, unavailable_count, placed_count, unplaced_count
  from public.session_roster_draft_students as students
  where students.draft_id = input_draft_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'group_id', slots.slot_id,
      'session_group_slot_id', slots.slot_id,
      'anchor_group_id', slots.anchor_group_id,
      'group_name', slots.slot_name,
      'group_sort_order', slots.slot_sort_order,
      'primary_teacher_id', slots.primary_teacher_id,
      'primary_teacher_name', slots.primary_teacher_name,
      'attending_count', counts.attending_count
    ) order by slots.slot_sort_order, slots.slot_name, slots.slot_id
  ), '[]'::jsonb)
  into group_counts
  from public.session_roster_draft_slots as slots
  left join lateral (
    select count(*) filter (where students.attendance_status = 'attending')::integer as attending_count
    from public.session_roster_draft_students as students
    where students.draft_id = slots.draft_id
      and students.session_group_slot_id = slots.slot_id
  ) as counts on true
  where slots.draft_id = input_draft_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'student_id', students.student_id,
      'student_name', students.student_name,
      'usual_group_id', students.usual_group_id,
      'usual_group_name', students.usual_group_name
    ) order by students.student_name, students.student_id
  ), '[]'::jsonb)
  into unplaced_students
  from public.session_roster_draft_students as students
  where students.draft_id = input_draft_id
    and students.attendance_status = 'attending'
    and students.session_group_slot_id is null
    and students.session_group_id is null;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'group_id', slots.slot_id,
      'group_name', slots.slot_name
    ) order by slots.slot_sort_order, slots.slot_name, slots.slot_id
  ), '[]'::jsonb)
  into missing_primary_teachers
  from public.session_roster_draft_slots as slots
  where slots.draft_id = input_draft_id
    and slots.primary_teacher_id is null;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'group_id', slots.slot_id,
      'group_name', slots.slot_name,
      'anchor_group_id', slots.anchor_group_id,
      'primary_teacher_id', slots.primary_teacher_id,
      'primary_teacher_name', slots.primary_teacher_name,
      'reason', slots.mismatch_reason,
      'confirmed', slots.mismatch_confirmed
    ) order by slots.slot_sort_order, slots.slot_name, slots.slot_id
  ), '[]'::jsonb)
  into mismatch_groups
  from public.session_roster_draft_slots as slots
  where slots.draft_id = input_draft_id
    and slots.mismatch_reason is not null;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'group_id', slots.slot_id,
      'group_name', slots.slot_name,
      'primary_teacher_id', slots.primary_teacher_id,
      'primary_teacher_name', slots.primary_teacher_name,
      'mismatch_confirmed', slots.mismatch_confirmed,
      'mismatch_reason', slots.mismatch_reason
    ) order by slots.slot_sort_order, slots.slot_name, slots.slot_id
  ), '[]'::jsonb)
  into primary_responsibilities
  from public.session_roster_draft_slots as slots
  where slots.draft_id = input_draft_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'teacher_id', rows.teacher_id,
      'teacher_name', rows.teacher_name,
      'teacher_email', rows.teacher_email,
      'available', true,
      'participating', true,
      'is_primary', primary_slot.slot_id is not null,
      'primary_slot_id', primary_slot.slot_id,
      'primary_slot_name', primary_slot.slot_name
    ) order by rows.teacher_sort_order, rows.teacher_name, rows.teacher_id
  ), '[]'::jsonb)
  into participating_teachers
  from private.session_roster_wizard_available_teachers(
    draft_row.cohort_id,
    draft_row.week_start
  ) as rows
  left join lateral (
    select slots.slot_id, slots.slot_name
    from public.session_roster_draft_slots as slots
    where slots.draft_id = input_draft_id
      and slots.primary_teacher_id = rows.teacher_id
    order by slots.slot_sort_order, slots.slot_id
    limit 1
  ) as primary_slot on true;

  select
    coalesce(max(counts.attending_count), 0),
    coalesce(min(counts.attending_count), 0)
  into largest_group_count, smallest_group_count
  from (
    select slots.slot_id,
      count(*) filter (where students.attendance_status = 'attending')::integer as attending_count
    from public.session_roster_draft_slots as slots
    left join public.session_roster_draft_students as students
      on students.draft_id = slots.draft_id
      and students.session_group_slot_id = slots.slot_id
    where slots.draft_id = input_draft_id
    group by slots.slot_id
  ) as counts;

  select count(*) - count(distinct slots.primary_teacher_id)
  into duplicate_primary_count
  from public.session_roster_draft_slots as slots
  where slots.draft_id = input_draft_id
    and slots.primary_teacher_id is not null;

  group_count_mismatch := requested_group_count is not null
    and requested_group_count <> default_group_count;
  actual_group_count_mismatch := requested_group_count is not null
    and requested_group_count <> actual_group_count;
  group_count_mismatch_direction := case
    when not group_count_mismatch then 'none'
    when requested_group_count < default_group_count then 'fewer'
    else 'more'
  end;
  group_count_mismatch_confirmation_required := group_count_mismatch
    and requested_group_count < default_group_count
    and not draft_row.group_count_mismatch_confirmed;
  group_count_mismatch_confirmed := not group_count_mismatch
    or draft_row.group_count_mismatch_confirmed;
  permanent_anchor_mismatch_confirmation_required := exists (
    select 1
    from public.session_roster_draft_slots as slots
    where slots.draft_id = input_draft_id
      and slots.mismatch_reason is not null
      and not slots.mismatch_confirmed
  );
  permanent_anchor_mismatch_confirmed := not permanent_anchor_mismatch_confirmation_required;
  imbalance_warning := actual_group_count > 0
    and attending_count > 0
    and largest_group_count - smallest_group_count > 1;
  source_stale := draft_row.dependency_revision is distinct from current_revision
    or draft_row.dependency_digest is distinct from current_digest;
  reviewed_current := draft_row.reviewed_state_version is not null
    and draft_row.reviewed_state_version = draft_row.state_version;

  if default_group_count = 0 then
    blocker_codes := blocker_codes || jsonb_build_array('no_available_teachers');
  end if;
  if requested_group_count is not null and requested_group_count <= 0 then
    blocker_codes := blocker_codes || jsonb_build_array('target_group_count_invalid');
  end if;
  if requested_group_count is not null and requested_group_count > default_group_count then
    blocker_codes := blocker_codes || jsonb_build_array('group_count_exceeds_available_teachers');
    blocker_codes := blocker_codes || jsonb_build_array('session_group_count_mismatch');
  end if;
  if group_count_mismatch_confirmation_required then
    blocker_codes := blocker_codes || jsonb_build_array('group_count_mismatch_confirmation_required');
    blocker_codes := blocker_codes || jsonb_build_array('session_group_count_mismatch');
  end if;
  if actual_group_count > default_group_count and not group_count_mismatch then
    blocker_codes := blocker_codes || jsonb_build_array('group_count_exceeds_available_teachers');
    blocker_codes := blocker_codes || jsonb_build_array('session_group_count_mismatch');
  end if;
  if actual_group_count_mismatch then
    blocker_codes := blocker_codes || jsonb_build_array('requested_group_count_not_generated');
    blocker_codes := blocker_codes || jsonb_build_array('session_group_count_mismatch');
  end if;
  if unplaced_count > 0 then
    blocker_codes := blocker_codes || jsonb_build_array('unplaced_attending_students');
  end if;
  if jsonb_array_length(missing_primary_teachers) > 0 then
    blocker_codes := blocker_codes || jsonb_build_array('missing_primary_teacher_responsibility');
  end if;
  if duplicate_primary_count > 0 then
    blocker_codes := blocker_codes || jsonb_build_array('duplicate_primary_teacher');
  end if;
  if permanent_anchor_mismatch_confirmation_required then
    blocker_codes := blocker_codes || jsonb_build_array('teacher_group_mismatch_confirmation_required');
  end if;
  if source_stale then
    blocker_codes := blocker_codes || jsonb_build_array('source_changed');
  end if;
  if not reviewed_current then
    blocker_codes := blocker_codes || jsonb_build_array('review_required');
  end if;
  if attending_count > 0 and actual_group_count = 0 then
    blocker_codes := blocker_codes || jsonb_build_array('no_session_groups');
  end if;
  if imbalance_warning then
    warning_codes := warning_codes || jsonb_build_array('group_imbalance');
  end if;

  if source_stale then
    recovery_guidance := 'Refresh the draft after confirming that unpublished placements and responsibilities may be discarded.';
  elsif requested_group_count is not null and requested_group_count > default_group_count then
    recovery_guidance := 'Choose the default group count or a smaller positive count; an unstaffed group is not allowed.';
  elsif group_count_mismatch_confirmation_required then
    recovery_guidance := 'Confirm the deliberate smaller group count before review; remaining available teachers will participate without a primary group.';
  elsif actual_group_count_mismatch then
    recovery_guidance := 'Generate the requested group count before review.';
  elsif unplaced_count > 0 then
    recovery_guidance := 'Place every attending student in one Saturday session group.';
  elsif permanent_anchor_mismatch_confirmation_required then
    recovery_guidance := 'Review each permanent-group anchor mismatch and explicitly confirm the deliberate exception.';
  elsif default_group_count = 0 then
    recovery_guidance := 'Mark at least one eligible teacher available for this Saturday before generating groups.';
  elsif not reviewed_current then
    recovery_guidance := 'Review the current draft before publishing.';
  end if;

  prerequisite_state := jsonb_build_object(
    'students', jsonb_build_object(
      'ready', true,
      'attending_count', attending_count,
      'unavailable_count', unavailable_count
    ),
    'teachers', jsonb_build_object(
      'ready', default_group_count > 0,
      'available_teacher_count', default_group_count
    ),
    'groups', jsonb_build_object(
      'ready', default_group_count > 0
        and not group_count_mismatch_confirmation_required
        and not actual_group_count_mismatch
        and requested_group_count is not null
        and requested_group_count <= default_group_count
        and unplaced_count = 0
        and not source_stale,
      'default_group_count', default_group_count,
      'requested_group_count', requested_group_count,
      'actual_group_count', actual_group_count,
      'group_count_mismatch', group_count_mismatch,
      'group_count_mismatch_direction', group_count_mismatch_direction,
      'group_count_mismatch_confirmation_required', group_count_mismatch_confirmation_required,
      'group_count_mismatch_confirmed', group_count_mismatch_confirmed,
      'permanent_anchor_mismatch_confirmation_required', permanent_anchor_mismatch_confirmation_required,
      'unplaced_count', unplaced_count,
      'imbalance_warning', imbalance_warning
    ),
    'review', jsonb_build_object(
      'ready', not source_stale
        and not group_count_mismatch_confirmation_required
        and not permanent_anchor_mismatch_confirmation_required,
      'reviewed_current', reviewed_current
    )
  );

  return jsonb_build_object(
    'can_publish', jsonb_array_length(blocker_codes) = 0,
    'attending_count', attending_count,
    'unavailable_count', unavailable_count,
    'placed_count', placed_count,
    'unplaced_count', unplaced_count,
    'group_counts', group_counts,
    'unplaced_students', unplaced_students,
    'missing_primary_teachers', missing_primary_teachers,
    'warning_codes', warning_codes,
    'blocker_codes', blocker_codes,
    'source_stale', source_stale,
    'reviewed_current', reviewed_current,
    'current_source_digest', current_digest,
    'available_teacher_count', default_group_count,
    'teacher_count', default_group_count,
    'default_group_count', default_group_count,
    'requested_group_count', requested_group_count,
    'actual_group_count', actual_group_count,
    'derived_group_count', actual_group_count,
    'group_count_mismatch', group_count_mismatch,
    'group_count_mismatch_direction', group_count_mismatch_direction,
    'group_count_mismatch_confirmation_required', group_count_mismatch_confirmation_required,
    'group_count_mismatch_confirmed', group_count_mismatch_confirmed,
    'actual_group_count_mismatch', actual_group_count_mismatch,
    'permanent_anchor_mismatch_confirmation_required', permanent_anchor_mismatch_confirmation_required,
    'permanent_anchor_mismatch_confirmed', permanent_anchor_mismatch_confirmed,
    'dependency_revision', current_revision,
    'dependency_digest', current_digest,
    'mismatch_confirmation_required', permanent_anchor_mismatch_confirmation_required,
    'mismatch_confirmed', permanent_anchor_mismatch_confirmed,
    'mismatch_groups', mismatch_groups,
    'participating_teachers', participating_teachers,
    'imbalance_warning', imbalance_warning,
    'primary_responsibilities', primary_responsibilities,
    'prerequisite_state', prerequisite_state,
    'recovery_guidance', recovery_guidance
  );
end;
$$;

create or replace function private.session_roster_wizard_readiness(
  input_draft_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.session_roster_wizard_readiness_v2(input_draft_id);
$$;

create or replace function private.session_roster_wizard_sync_fields(
  input_draft_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  readiness jsonb;
begin
  readiness := private.session_roster_wizard_readiness_v2(input_draft_id);
  if readiness is null then
    return;
  end if;

  update public.session_roster_drafts
  set default_group_count = coalesce((readiness ->> 'default_group_count')::integer, 0),
      requested_group_count = (readiness ->> 'requested_group_count')::integer,
      group_count_mismatch_confirmed = coalesce((readiness ->> 'group_count_mismatch_confirmed')::boolean, false),
      available_teacher_count = coalesce((readiness ->> 'available_teacher_count')::integer, 0),
      derived_group_count = coalesce((readiness ->> 'actual_group_count')::integer, 0),
      wizard_prerequisite_state = coalesce(readiness -> 'prerequisite_state', '{}'::jsonb),
      mismatch_confirmation_required = coalesce((readiness ->> 'permanent_anchor_mismatch_confirmation_required')::boolean, false),
      mismatch_confirmed = coalesce((readiness ->> 'permanent_anchor_mismatch_confirmed')::boolean, false),
      unplaced_count = coalesce((readiness ->> 'unplaced_count')::integer, 0),
      imbalance_warning = coalesce((readiness ->> 'imbalance_warning')::boolean, false),
      primary_responsibilities = coalesce(readiness -> 'primary_responsibilities', '[]'::jsonb),
      recovery_guidance = readiness ->> 'recovery_guidance'
  where id = input_draft_id;
end;
$$;

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
          'available', coalesce((rows.teacher->>'available')::boolean, false)
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

create or replace function private.session_roster_wizard_published_payload(
  input_version_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when base_payload is null then null
    else base_payload || jsonb_build_object(
      'participants', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'teacher_id', participants.teacher_id,
            'teacher_name', participants.teacher_name,
            'teacher_email', participants.teacher_email,
            'participant_sort_order', participants.participant_sort_order,
            'is_primary', participants.is_primary,
            'primary_slot_id', participants.primary_slot_id,
            'primary_slot_name', participants.primary_slot_name
          ) order by participants.participant_sort_order, participants.teacher_id
        )
        from public.session_roster_version_teachers as participants
        where participants.version_id = input_version_id
      ), '[]'::jsonb)
    )
  end
  from private.session_roster_published_payload(input_version_id) as base_payload;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.session_roster_audit_events'::regclass
      and conname = 'session_roster_audit_events_action_check'
  ) then
    alter table public.session_roster_audit_events
      drop constraint session_roster_audit_events_action_check;
  end if;

  alter table public.session_roster_audit_events
    add constraint session_roster_audit_events_action_check
    check (action in (
      'draft_created',
      'student_moved',
      'primary_teacher_assigned',
      'draft_reviewed',
      'version_published',
      'revision_created',
      'draft_refreshed',
      'source_dependency_changed',
      'participant_snapshot_recorded',
      'legacy_draft_transition'
    ));
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'private.session_roster_mutation_requests'::regclass
      and conname = 'session_roster_mutation_requests_operation_check'
  ) then
    alter table private.session_roster_mutation_requests
      drop constraint session_roster_mutation_requests_operation_check;
  end if;

  alter table private.session_roster_mutation_requests
    add constraint session_roster_mutation_requests_operation_check
    check (operation in (
      'load_or_create_draft',
      'move_student',
      'assign_primary_teacher',
      'review_draft',
      'publish_draft',
      'create_revision',
      'refresh_draft',
      'generate_groups',
      'generate_groups_v2',
      'legacy_draft_transition'
    ));
end;
$$;

create or replace function public.generate_session_roster_wizard_groups_v2(
  input_request_id uuid,
  input_actor_id uuid,
  input_draft_id uuid,
  input_expected_state_version bigint,
  input_expected_dependency_digest text,
  input_target_group_count integer,
  input_confirm_group_count_mismatch boolean,
  input_confirm_discard_changes boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.session_roster_drafts%rowtype;
  target_masjid_id uuid;
  source_state jsonb;
  source_digest text;
  current_revision bigint;
  default_group_count integer := 0;
  target_group_count integer;
  has_manual_changes boolean := false;
  manual_placement_changes boolean := false;
  manual_primary_changes boolean := false;
  source_stale boolean := false;
  request_payload jsonb;
  replay_result jsonb;
  result_payload jsonb;
  teacher_row record;
  anchor_group_id uuid;
  anchor_group_name text;
  discarded_edit_kinds jsonb := '[]'::jsonb;
begin
  select drafts.*
  into draft
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'session_roster_wizard_draft_not_found';
  end if;

  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, draft.cohort_id);
  perform private.session_roster_lock(draft.cohort_id, draft.week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'draft_id', input_draft_id,
    'expected_state_version', input_expected_state_version,
    'expected_dependency_digest', input_expected_dependency_digest,
    'target_group_count', input_target_group_count,
    'confirm_group_count_mismatch', coalesce(input_confirm_group_count_mismatch, false),
    'confirm_discard_changes', coalesce(input_confirm_discard_changes, false),
    'workflow', 'teacher_driven_v2'
  );

  replay_result := private.session_roster_replay_result(
    input_request_id,
    'generate_groups_v2',
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

  if draft.wizard_mode <> 'teacher_driven' then
    raise exception using errcode = 'PT409', message = 'session_roster_wizard_mode_required';
  end if;
  if draft.status <> 'draft' then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_draft_not_editable';
  end if;
  if draft.state_version is distinct from input_expected_state_version then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_stale_draft';
  end if;
  if input_expected_dependency_digest is null
    or draft.dependency_digest is distinct from input_expected_dependency_digest then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_dependency_digest_stale';
  end if;

  source_state := private.session_roster_wizard_source_snapshot(draft.cohort_id, draft.week_start);
  source_digest := private.session_roster_wizard_source_digest(draft.cohort_id, draft.week_start);
  current_revision := private.session_roster_dependency_revision_read(draft.cohort_id, draft.week_start);

  select count(*)::integer
  into default_group_count
  from private.session_roster_wizard_available_teachers(draft.cohort_id, draft.week_start);

  if default_group_count = 0 then
    raise exception using errcode = 'PT422', message = 'session_roster_wizard_no_available_teachers';
  end if;

  target_group_count := coalesce(input_target_group_count, default_group_count);
  if target_group_count <= 0 then
    raise exception using errcode = 'PT422', message = 'session_roster_wizard_target_group_count_invalid';
  end if;
  if target_group_count > default_group_count then
    raise exception using errcode = 'PT422', message = 'session_roster_wizard_target_group_count_exceeds_available_teachers';
  end if;
  if target_group_count < default_group_count
    and coalesce(input_confirm_group_count_mismatch, false) = false then
    raise exception using errcode = 'PT422', message = 'session_roster_wizard_group_count_mismatch_confirmation_required';
  end if;

  source_stale := draft.dependency_revision is distinct from current_revision
    or draft.dependency_digest is distinct from source_digest;
  manual_placement_changes := exists (
    select 1
    from public.session_roster_draft_students as students
    where students.draft_id = input_draft_id
      and students.placed_by is not null
  );
  manual_primary_changes := exists (
    select 1
    from public.session_roster_draft_slots as slots
    where slots.draft_id = input_draft_id
      and slots.primary_teacher_manually_set = true
  );
  has_manual_changes := manual_placement_changes or manual_primary_changes;

  if manual_placement_changes then
    discarded_edit_kinds := discarded_edit_kinds || jsonb_build_array('student_placement');
  end if;
  if manual_primary_changes then
    discarded_edit_kinds := discarded_edit_kinds || jsonb_build_array('primary_teacher_responsibility');
  end if;

  if (has_manual_changes or source_stale)
    and coalesce(input_confirm_discard_changes, false) = false then
    raise exception using errcode = 'PT409', message = 'session_roster_wizard_regeneration_discard_confirmation_required';
  end if;

  update public.session_roster_draft_students
  set session_group_id = null,
      session_group_slot_id = null,
      placed_by = null,
      placed_at = null,
      updated_at = statement_timestamp()
  where draft_id = input_draft_id;

  delete from public.session_roster_draft_slots
  where draft_id = input_draft_id;

  if source_stale then
    delete from public.session_roster_draft_students
    where draft_id = input_draft_id;
    perform private.session_roster_wizard_materialize_students(input_draft_id, source_state);
  end if;

  for teacher_row in
    select teachers.*
    from private.session_roster_wizard_available_teachers(draft.cohort_id, draft.week_start) as teachers
    order by teachers.teacher_sort_order
    limit target_group_count
  loop
    anchor_group_id := null;
    anchor_group_name := null;

    select groups.id, groups.name
    into anchor_group_id, anchor_group_name
    from public.halaqa_groups as groups
    join public.group_teacher_assignments as assignments
      on assignments.group_id = groups.id
      and assignments.teacher_id = teacher_row.teacher_id
      and assignments.week_start = draft.week_start
      and assignments.active = true
    where groups.cohort_id = draft.cohort_id
      and groups.active = true
    order by groups.sort_order, groups.name, groups.id
    limit 1;

    insert into public.session_roster_draft_slots (
      draft_id,
      slot_name,
      slot_sort_order,
      anchor_group_id,
      primary_teacher_id,
      primary_teacher_name,
      mismatch_confirmed,
      mismatch_reason,
      primary_teacher_manually_set
    ) values (
      input_draft_id,
      coalesce(anchor_group_name, 'Session group ' || teacher_row.teacher_sort_order::text),
      teacher_row.teacher_sort_order,
      anchor_group_id,
      teacher_row.teacher_id,
      teacher_row.teacher_name,
      false,
      null,
      false
    );
  end loop;

  with ranked_slots as (
    select slots.slot_id,
      row_number() over (order by slots.slot_sort_order, slots.slot_name, slots.slot_id)::integer as slot_number
    from public.session_roster_draft_slots as slots
    where slots.draft_id = input_draft_id
  ), ranked_students as (
    select students.student_id,
      row_number() over (order by students.student_name, students.student_id)::integer as student_number
    from public.session_roster_draft_students as students
    where students.draft_id = input_draft_id
      and students.attendance_status = 'attending'
  ), placements as (
    select ranked_students.student_id, ranked_slots.slot_id
    from ranked_students
    join ranked_slots
      on ranked_slots.slot_number = ((ranked_students.student_number - 1) % target_group_count) + 1
  )
  update public.session_roster_draft_students as students
  set session_group_slot_id = placements.slot_id,
      session_group_id = null,
      placed_by = null,
      placed_at = null,
      updated_at = statement_timestamp()
  from placements
  where students.draft_id = input_draft_id
    and students.student_id = placements.student_id;

  update public.session_roster_drafts
  set source_state = private.session_roster_wizard_source_snapshot(draft.cohort_id, draft.week_start),
      source_state_digest = source_digest,
      dependency_revision = current_revision,
      dependency_digest = source_digest,
      default_group_count = (
        select count(*)::integer
        from private.session_roster_wizard_available_teachers(draft.cohort_id, draft.week_start)
      ),
      requested_group_count = target_group_count,
      group_count_mismatch_confirmed = target_group_count < (
        select count(*)::integer
        from private.session_roster_wizard_available_teachers(draft.cohort_id, draft.week_start)
      ),
      state_version = state_version + 1,
      reviewed_at = null,
      reviewed_by = null,
      reviewed_state_version = null,
      updated_by = input_actor_id,
      updated_at = statement_timestamp()
  where id = input_draft_id;

  perform private.session_roster_wizard_sync_fields(input_draft_id);

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
    'draft_refreshed',
    target_masjid_id,
    draft.cohort_id,
    draft.week_start,
    draft.halaqa_saturday,
    input_draft_id,
    input_request_id,
    jsonb_build_object(
      'workflow', 'teacher_driven_v2',
      'default_group_count', default_group_count,
      'requested_group_count', target_group_count,
      'actual_group_count', target_group_count,
      'mismatch_direction', case
        when target_group_count = default_group_count then 'none'
        else 'fewer'
      end,
      'group_count_mismatch', target_group_count <> default_group_count,
      'group_count_mismatch_confirmed', target_group_count < default_group_count,
      'participating_teachers', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'teacher_id', teachers.teacher_id,
            'teacher_name', teachers.teacher_name,
            'teacher_email', teachers.teacher_email,
            'is_primary', teachers.teacher_sort_order <= target_group_count
          ) order by teachers.teacher_sort_order
        )
        from private.session_roster_wizard_available_teachers(draft.cohort_id, draft.week_start) as teachers
      ), '[]'::jsonb),
      'primary_responsibilities', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'slot_id', slots.slot_id,
            'slot_name', slots.slot_name,
            'primary_teacher_id', slots.primary_teacher_id,
            'primary_teacher_name', slots.primary_teacher_name
          ) order by slots.slot_sort_order, slots.slot_id
        )
        from public.session_roster_draft_slots as slots
        where slots.draft_id = input_draft_id
      ), '[]'::jsonb)
    ),
    jsonb_build_object(
      'regeneration', true,
      'discard_confirmed', coalesce(input_confirm_discard_changes, false),
      'discarded_manual_changes', has_manual_changes,
      'discarded_edit_kinds', discarded_edit_kinds,
      'source_refreshed', source_stale,
      'permanent_memberships_changed', false
    )
  );

  result_payload := private.session_roster_wizard_draft_payload(input_draft_id);
  perform private.session_roster_write_request(
    input_request_id,
    'generate_groups_v2',
    input_actor_id,
    input_draft_id,
    request_payload,
    result_payload
  );
  return result_payload;
end;
$$;

create or replace function public.publish_session_roster_wizard_draft_v2(
  input_request_id uuid,
  input_actor_id uuid,
  input_draft_id uuid,
  input_expected_state_version bigint,
  input_confirm_publish boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_result jsonb;
  version_id uuid;
  version_row public.session_roster_versions%rowtype;
begin
  old_result := public.publish_session_roster_wizard_draft(
    input_request_id,
    input_actor_id,
    input_draft_id,
    input_expected_state_version,
    input_confirm_publish
  );
  version_id := (old_result -> 'version' ->> 'id')::uuid;

  select versions.*
  into version_row
  from public.session_roster_versions as versions
  where versions.id = version_id;

  if version_row.id is not null then
    -- The existing publication mutation owns the request/audit row. Extend
    -- that immutable publication audit with the participant snapshot instead
    -- of creating a second row for the same request ID.
    update public.session_roster_audit_events as events
    set after_data = coalesce(events.after_data, '{}'::jsonb) || jsonb_build_object(
          'participant_snapshot', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'teacher_id', participants.teacher_id,
                'teacher_name', participants.teacher_name,
                'is_primary', participants.is_primary,
                'primary_slot_id', participants.primary_slot_id
              ) order by participants.participant_sort_order, participants.teacher_id
            )
            from public.session_roster_version_teachers as participants
            where participants.version_id = version_row.id
          ), '[]'::jsonb)
        ),
        metadata = coalesce(events.metadata, '{}'::jsonb) || jsonb_build_object(
          'participant_snapshot_recorded', true,
          'published_version_remains_current', true,
          'historical_participants_immutable', true
        )
    where events.request_id = input_request_id
      and events.action = 'version_published'
      and events.version_id = version_row.id;
  end if;

  return private.session_roster_wizard_published_payload(version_id);
end;
$$;

create or replace function public.preview_session_roster_wizard_legacy_transition(
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
  legacy_draft public.session_roster_drafts%rowtype;
  current_version public.session_roster_versions%rowtype;
begin
  perform private.session_roster_assert_week(input_week_start);
  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, input_cohort_id);

  select drafts.*
  into legacy_draft
  from public.session_roster_drafts as drafts
  where drafts.cohort_id = input_cohort_id
    and drafts.week_start = input_week_start
    and drafts.status = 'draft'
    and drafts.wizard_mode = 'legacy'
  order by drafts.revision_number desc, drafts.created_at desc
  limit 1;

  select versions.*
  into current_version
  from public.session_roster_versions as versions
  where versions.cohort_id = input_cohort_id
    and versions.week_start = input_week_start
  order by versions.version_number desc
  limit 1;

  return jsonb_build_object(
    'contract_version', 2,
    'masjid_id', target_masjid_id,
    'cohort_id', input_cohort_id,
    'week_start', input_week_start,
    'blocking_legacy_draft', case when legacy_draft.id is null then null else jsonb_build_object(
      'id', legacy_draft.id,
      'revision_number', legacy_draft.revision_number,
      'state_version', legacy_draft.state_version,
      'source_state_digest', legacy_draft.source_state_digest,
      'status', legacy_draft.status,
      'created_at', legacy_draft.created_at,
      'updated_at', legacy_draft.updated_at
    ) end,
    'current_published_version', case when current_version.id is null then null else jsonb_build_object(
      'id', current_version.id,
      'version_number', current_version.version_number,
      'published_by', current_version.published_by,
      'published_at', current_version.published_at
    ) end,
    'can_transition', legacy_draft.id is not null,
    'recovery', case when legacy_draft.id is null then jsonb_build_object(
      'code', 'no_legacy_draft',
      'message', 'There is no unpublished legacy draft to transition.'
    ) else jsonb_build_object(
      'code', 'explicit_legacy_draft_transition_required',
      'message', 'Confirm discarding the unpublished legacy draft to create a fresh teacher-driven draft.',
      'confirm_discard_legacy_draft', true,
      'published_version_unchanged', true
    ) end
  );
end;
$$;

create or replace function public.transition_session_roster_wizard_legacy_draft(
  input_request_id uuid,
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date,
  input_expected_legacy_draft_id uuid,
  input_expected_legacy_state_version bigint,
  input_expected_legacy_source_state_digest text,
  input_expected_published_version_id uuid,
  input_confirm_discard_legacy_draft boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_masjid_id uuid;
  legacy_draft public.session_roster_drafts%rowtype;
  current_version public.session_roster_versions%rowtype;
  source_state jsonb;
  source_digest text;
  dependency_revision bigint;
  next_revision bigint;
  created_draft_id uuid;
  legacy_student_count integer := 0;
  legacy_group_count integer := 0;
  request_payload jsonb;
  replay_result jsonb;
  result_payload jsonb;
  transition_payload jsonb;
begin
  perform private.session_roster_assert_week(input_week_start);
  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, input_cohort_id);
  perform private.session_roster_lock(input_cohort_id, input_week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'cohort_id', input_cohort_id,
    'week_start', input_week_start,
    'expected_legacy_draft_id', input_expected_legacy_draft_id,
    'expected_legacy_state_version', input_expected_legacy_state_version,
    'expected_legacy_source_state_digest', input_expected_legacy_source_state_digest,
    'expected_published_version_id', input_expected_published_version_id,
    'confirm_discard_legacy_draft', coalesce(input_confirm_discard_legacy_draft, false),
    'workflow', 'legacy_draft_transition'
  );

  replay_result := private.session_roster_replay_result(
    input_request_id,
    'legacy_draft_transition',
    input_actor_id,
    input_cohort_id,
    request_payload
  );
  if replay_result is not null then
    return replay_result;
  end if;

  if coalesce(input_confirm_discard_legacy_draft, false) = false then
    raise exception using errcode = 'PT422', message = 'session_roster_legacy_draft_discard_confirmation_required';
  end if;

  select drafts.*
  into legacy_draft
  from public.session_roster_drafts as drafts
  where drafts.id = input_expected_legacy_draft_id
    and drafts.cohort_id = input_cohort_id
    and drafts.week_start = input_week_start
    and drafts.status = 'draft'
  for update;

  if legacy_draft.id is null then
    raise exception using errcode = 'P0002', message = 'session_roster_legacy_draft_not_found';
  end if;
  if legacy_draft.wizard_mode <> 'legacy' then
    raise exception using errcode = 'PT409', message = 'session_roster_legacy_draft_mode_mismatch';
  end if;
  if legacy_draft.state_version is distinct from input_expected_legacy_state_version
    or legacy_draft.source_state_digest is distinct from input_expected_legacy_source_state_digest then
    raise exception using errcode = 'PT412', message = 'session_roster_legacy_draft_stale';
  end if;

  select versions.*
  into current_version
  from public.session_roster_versions as versions
  where versions.cohort_id = input_cohort_id
    and versions.week_start = input_week_start
  order by versions.version_number desc
  limit 1;

  if current_version.id is distinct from input_expected_published_version_id then
    raise exception using errcode = 'PT412', message = 'session_roster_legacy_published_version_stale';
  end if;

  if exists (
    select 1
    from public.session_roster_drafts as drafts
    where drafts.cohort_id = input_cohort_id
      and drafts.week_start = input_week_start
      and drafts.status = 'draft'
      and drafts.wizard_mode = 'teacher_driven'
  ) then
    raise exception using errcode = 'PT409', message = 'session_roster_wizard_draft_already_exists';
  end if;

  source_state := private.session_roster_wizard_source_snapshot(input_cohort_id, input_week_start);
  source_digest := private.session_roster_wizard_source_digest(input_cohort_id, input_week_start);
  dependency_revision := private.session_roster_dependency_revision_read(input_cohort_id, input_week_start);
  if source_state is null or source_digest is null then
    raise exception using errcode = '22023', message = 'session_roster_wizard_source_unavailable';
  end if;

  select count(*)::integer
  into legacy_student_count
  from public.session_roster_draft_students as students
  where students.draft_id = legacy_draft.id;

  select count(*)::integer
  into legacy_group_count
  from public.session_roster_draft_groups as groups
  where groups.draft_id = legacy_draft.id;

  select coalesce(max(drafts.revision_number), 0) + 1
  into next_revision
  from public.session_roster_drafts as drafts
  where drafts.cohort_id = input_cohort_id
    and drafts.week_start = input_week_start;

  update public.session_roster_drafts
  set status = 'superseded',
      updated_by = input_actor_id,
      updated_at = statement_timestamp()
  where id = legacy_draft.id;

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
    wizard_mode,
    dependency_revision,
    dependency_digest,
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
    'teacher_driven',
    dependency_revision,
    source_digest,
    input_actor_id,
    input_actor_id
  )
  returning id into created_draft_id;

  perform private.session_roster_wizard_materialize_students(created_draft_id, source_state);
  perform private.session_roster_wizard_sync_fields(created_draft_id);

  transition_payload := jsonb_build_object(
    'legacy_draft_id', legacy_draft.id,
    'legacy_draft_state_version', legacy_draft.state_version,
    'legacy_draft_source_state_digest', legacy_draft.source_state_digest,
    'new_draft_id', created_draft_id,
    'new_draft_revision_number', next_revision,
    'discarded_legacy_rows', jsonb_build_object(
      'draft_students', legacy_student_count,
      'draft_groups', legacy_group_count,
      'rows_preserved', true,
      'draft_marked_superseded', true
    ),
    'published_version_id', current_version.id,
    'published_version_unchanged', true,
    'permanent_memberships_changed', false,
    'teacher_assignments_changed', false,
    'grades_changed', false,
    'plans_changed', false
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
    before_data,
    after_data,
    metadata
  ) values (
    input_actor_id,
    'legacy_draft_transition',
    target_masjid_id,
    input_cohort_id,
    input_week_start,
    public.halaqa_saturday_for_week(input_week_start),
    created_draft_id,
    current_version.id,
    input_request_id,
    jsonb_build_object(
      'legacy_draft_id', legacy_draft.id,
      'state_version', legacy_draft.state_version,
      'source_state_digest', legacy_draft.source_state_digest,
      'status_before', 'draft'
    ),
    jsonb_build_object(
      'new_draft_id', created_draft_id,
      'status_after', 'superseded',
      'transition', transition_payload
    ),
    jsonb_build_object(
      'workflow', 'legacy_draft_transition',
      'explicit_discard_confirmation', true,
      'published_version_unchanged', true,
      'historical_rows_preserved', true
    )
  );

  result_payload := private.session_roster_wizard_draft_payload(created_draft_id)
    || jsonb_build_object('legacy_transition', transition_payload);
  perform private.session_roster_write_request(
    input_request_id,
    'legacy_draft_transition',
    input_actor_id,
    input_cohort_id,
    request_payload,
    result_payload
  );
  return result_payload;
end;
$$;

-- Guard the new public functions as service-only server workflows.
revoke all on function public.generate_session_roster_wizard_groups_v2(uuid, uuid, uuid, bigint, text, integer, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.generate_session_roster_wizard_groups_v2(uuid, uuid, uuid, bigint, text, integer, boolean, boolean)
  to service_role;

revoke all on function public.publish_session_roster_wizard_draft_v2(uuid, uuid, uuid, bigint, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_session_roster_wizard_draft_v2(uuid, uuid, uuid, bigint, boolean)
  to service_role;

revoke all on function public.preview_session_roster_wizard_legacy_transition(uuid, uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.preview_session_roster_wizard_legacy_transition(uuid, uuid, date)
  to service_role;

revoke all on function public.transition_session_roster_wizard_legacy_draft(uuid, uuid, uuid, date, uuid, bigint, text, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_session_roster_wizard_legacy_draft(uuid, uuid, uuid, date, uuid, bigint, text, uuid, boolean)
  to service_role;

-- Preserve the existing inventory and append only the new application-facing
-- SECURITY DEFINER RPCs. The legacy function is retained under a private name
-- so all previously registered function OIDs remain present.
alter function private.application_security_definer_oids()
  rename to application_security_definer_oids_legacy;

create or replace function private.application_security_definer_oids()
returns table (function_oid oid)
language sql
stable
set search_path = ''
as $$
  select function_oid
  from private.application_security_definer_oids_legacy()
  union
  select signature::regprocedure::oid
  from unnest(array[
    'public.generate_session_roster_wizard_groups_v2(uuid,uuid,uuid,bigint,text,integer,boolean,boolean)',
    'public.publish_session_roster_wizard_draft_v2(uuid,uuid,uuid,bigint,boolean)',
    'public.preview_session_roster_wizard_legacy_transition(uuid,uuid,date)',
    'public.transition_session_roster_wizard_legacy_draft(uuid,uuid,uuid,date,uuid,bigint,text,uuid,boolean)'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;

revoke all on function private.session_roster_version_teacher_immutable()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_snapshot_version_participants()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_readiness_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_published_payload(uuid)
  from public, anon, authenticated, service_role;
