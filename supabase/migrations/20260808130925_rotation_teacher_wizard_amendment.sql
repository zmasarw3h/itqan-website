-- Focused additive amendment for the approved four-screen Saturday rotation
-- wizard.  The existing permanent-group session-roster tables and contracts
-- remain intact for deployed history and compatibility.  New wizard drafts
-- use the slot tables below; a slot may be independent or carry an optional
-- permanent-group anchor.

-- A slot-backed grade keeps the historical permanent-group field nullable and
-- adds a separate immutable slot identity. Legacy grade snapshots continue to
-- satisfy the original group foreign key and identity shape.
alter table public.halaqa_grades
  add column if not exists session_group_slot_id uuid;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'halaqa_grades_session_identity_check'
      and conrelid = 'public.halaqa_grades'::regclass
  ) then
    alter table public.halaqa_grades
      drop constraint halaqa_grades_session_identity_check;
  end if;

  alter table public.halaqa_grades
    add constraint halaqa_grades_session_identity_check
    check (
      (
        session_roster_version_id is null
        and session_roster_version_number is null
        and session_halaqa_saturday is null
        and session_group_id is null
        and session_group_slot_id is null
        and session_group_name is null
        and session_primary_teacher_id is null
        and session_primary_teacher_name is null
      )
      or (
        session_roster_version_id is not null
        and session_roster_version_number is not null
        and session_halaqa_saturday is not null
        and session_group_name is not null
        and session_primary_teacher_id is not null
        and session_primary_teacher_name is not null
        and (
          (session_group_id is not null and session_group_slot_id is null)
          or (session_group_id is null and session_group_slot_id is not null)
        )
      )
    );
end;
$$;

create index if not exists halaqa_grades_session_slot_scope_idx
  on public.halaqa_grades(session_roster_version_id, session_group_slot_id, week_start, student_id)
  where session_group_slot_id is not null;

create or replace function private.enforce_halaqa_grade_session_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.session_roster_versions%rowtype;
  legacy_group_row record;
  slot_row record;
begin
  if new.session_roster_version_id is null
    and new.session_roster_version_number is null
    and new.session_halaqa_saturday is null
    and new.session_group_id is null
    and new.session_group_slot_id is null
    and new.session_group_name is null
    and new.session_primary_teacher_id is null
    and new.session_primary_teacher_name is null then
    if tg_op = 'UPDATE' and old.session_roster_version_id is not null then
      raise exception using errcode = 'PT412', message = 'teacher_session_grade_snapshot_cannot_be_cleared';
    end if;
    return new;
  end if;

  if new.session_roster_version_id is null
    or (new.session_group_id is null and new.session_group_slot_id is null)
    or (new.session_group_id is not null and new.session_group_slot_id is not null) then
    raise exception using errcode = '23514', message = 'teacher_session_grade_snapshot_incomplete';
  end if;

  select versions.*
  into version_row
  from public.session_roster_versions as versions
  where versions.id = new.session_roster_version_id;

  if version_row.id is null then
    raise exception using errcode = 'P0002', message = 'teacher_session_grade_published_roster_not_found';
  end if;

  if private.teacher_session_current_version_id(version_row.cohort_id, version_row.week_start)
    is distinct from version_row.id
    and (tg_op = 'INSERT' or old.session_roster_version_id is distinct from new.session_roster_version_id) then
    raise exception using errcode = 'PT412', message = 'teacher_session_grade_roster_superseded';
  end if;
  if new.week_start is distinct from version_row.week_start then
    raise exception using errcode = '23514', message = 'teacher_session_grade_week_mismatch';
  end if;

  if new.session_group_slot_id is not null then
    select slots.*
    into slot_row
    from public.session_roster_version_slots as slots
    where slots.version_id = new.session_roster_version_id
      and slots.slot_id = new.session_group_slot_id;

    if slot_row.slot_id is null then
      raise exception using errcode = 'P0002', message = 'teacher_session_grade_published_slot_not_found';
    end if;
    if not exists (
      select 1
      from public.session_roster_version_students as students
      where students.version_id = version_row.id
        and students.session_group_slot_id = slot_row.slot_id
        and students.student_id = new.student_id
    ) then
      raise exception using errcode = '42501', message = 'teacher_session_grade_student_not_in_published_roster';
    end if;

    if (new.masjid_id is not null and new.masjid_id is distinct from version_row.masjid_id)
      or (new.cohort_id is not null and new.cohort_id is distinct from version_row.cohort_id)
      or (new.halaqa_group_id is not null and new.halaqa_group_id is distinct from slot_row.anchor_group_id)
      or (new.session_roster_version_number is not null and new.session_roster_version_number is distinct from version_row.version_number)
      or (new.session_halaqa_saturday is not null and new.session_halaqa_saturday is distinct from version_row.halaqa_saturday)
      or (new.session_group_name is not null and new.session_group_name is distinct from slot_row.slot_name)
      or (new.session_primary_teacher_id is not null and new.session_primary_teacher_id is distinct from slot_row.primary_teacher_id)
      or (new.session_primary_teacher_name is not null and new.session_primary_teacher_name is distinct from slot_row.primary_teacher_name) then
      raise exception using errcode = '23514', message = 'teacher_session_grade_snapshot_mismatch';
    end if;

    new.masjid_id := version_row.masjid_id;
    new.cohort_id := version_row.cohort_id;
    new.halaqa_group_id := slot_row.anchor_group_id;
    new.session_roster_version_number := version_row.version_number;
    new.session_halaqa_saturday := version_row.halaqa_saturday;
    new.session_group_id := null;
    new.session_group_slot_id := slot_row.slot_id;
    new.session_group_name := slot_row.slot_name;
    new.session_primary_teacher_id := slot_row.primary_teacher_id;
    new.session_primary_teacher_name := slot_row.primary_teacher_name;
    return new;
  end if;

  select groups.*
  into legacy_group_row
  from public.session_roster_version_groups as groups
  where groups.version_id = new.session_roster_version_id
    and groups.group_id = new.session_group_id;

  if legacy_group_row.group_id is null then
    raise exception using errcode = 'P0002', message = 'teacher_session_grade_published_group_not_found';
  end if;
  if not exists (
    select 1
    from public.session_roster_version_students as students
    where students.version_id = version_row.id
      and students.session_group_id = legacy_group_row.group_id
      and students.student_id = new.student_id
  ) then
    raise exception using errcode = '42501', message = 'teacher_session_grade_student_not_in_published_roster';
  end if;

  if (new.masjid_id is not null and new.masjid_id is distinct from version_row.masjid_id)
    or (new.cohort_id is not null and new.cohort_id is distinct from version_row.cohort_id)
    or (new.halaqa_group_id is not null and new.halaqa_group_id is distinct from legacy_group_row.group_id)
    or (new.session_roster_version_number is not null and new.session_roster_version_number is distinct from version_row.version_number)
    or (new.session_halaqa_saturday is not null and new.session_halaqa_saturday is distinct from version_row.halaqa_saturday)
    or (new.session_group_name is not null and new.session_group_name is distinct from legacy_group_row.group_name)
    or (new.session_primary_teacher_id is not null and new.session_primary_teacher_id is distinct from legacy_group_row.primary_teacher_id)
    or (new.session_primary_teacher_name is not null and new.session_primary_teacher_name is distinct from legacy_group_row.primary_teacher_name) then
    raise exception using errcode = '23514', message = 'teacher_session_grade_snapshot_mismatch';
  end if;

  new.masjid_id := version_row.masjid_id;
  new.cohort_id := version_row.cohort_id;
  new.halaqa_group_id := legacy_group_row.group_id;
  new.session_roster_version_number := version_row.version_number;
  new.session_halaqa_saturday := version_row.halaqa_saturday;
  new.session_group_slot_id := null;
  new.session_group_name := legacy_group_row.group_name;
  new.session_primary_teacher_id := legacy_group_row.primary_teacher_id;
  new.session_primary_teacher_name := legacy_group_row.primary_teacher_name;
  return new;
end;
$$;

drop trigger if exists enforce_halaqa_grade_session_snapshot_trigger on public.halaqa_grades;
create trigger enforce_halaqa_grade_session_snapshot_trigger
  before insert or update on public.halaqa_grades
  for each row execute function private.enforce_halaqa_grade_session_snapshot();

create or replace function public.teacher_session_grade_row_visible_v2(
  input_student_id uuid,
  input_week_start date,
  input_version_id uuid,
  input_session_group_id uuid,
  input_session_group_slot_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return case
    when input_version_id is null then private.raw_teacher_session_student_any_scope(
      (select auth.uid()), input_student_id, input_week_start
    )
    else private.raw_teacher_session_student_authorized(
      (select auth.uid()),
      input_version_id,
      coalesce(input_session_group_slot_id, input_session_group_id),
      input_student_id,
      input_week_start
    )
  end;
end;
$$;

create or replace function public.teacher_session_grade_scope_matches_v2(
  input_student_id uuid,
  input_week_start date,
  input_version_id uuid,
  input_session_group_id uuid,
  input_session_group_slot_id uuid,
  input_masjid_id uuid,
  input_cohort_id uuid,
  input_halaqa_group_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.session_roster_versions as versions
    where versions.id = input_version_id
      and versions.week_start = input_week_start
      and versions.masjid_id = input_masjid_id
      and versions.cohort_id = input_cohort_id
      and private.teacher_session_current_version_id(versions.cohort_id, versions.week_start) = versions.id
      and private.raw_teacher_session_student_authorized(
        (select auth.uid()),
        versions.id,
        coalesce(input_session_group_slot_id, input_session_group_id),
        input_student_id,
        input_week_start
      )
      and (
        input_session_group_slot_id is not null
        or input_session_group_id is not null
      )
      and (
        input_session_group_slot_id is null
        or exists (
          select 1
          from public.session_roster_version_slots as slots
          where slots.version_id = versions.id
            and slots.slot_id = input_session_group_slot_id
        )
      )
      and (
        input_session_group_id is null
        or exists (
          select 1
          from public.session_roster_version_groups as groups
          where groups.version_id = versions.id
            and groups.group_id = input_session_group_id
        )
      )
      and (
        input_halaqa_group_id is null
        or input_halaqa_group_id = input_session_group_id
        or exists (
          select 1
          from public.session_roster_version_slots as slots
          where slots.version_id = versions.id
            and slots.slot_id = input_session_group_slot_id
            and slots.anchor_group_id = input_halaqa_group_id
        )
      )
  );
end;
$$;

create or replace function public.teacher_session_grade_snapshot_matches_v2(
  input_student_id uuid,
  input_week_start date,
  input_version_id uuid,
  input_session_group_id uuid,
  input_session_group_slot_id uuid,
  input_masjid_id uuid,
  input_cohort_id uuid,
  input_halaqa_group_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return not private.raw_is_active_super_admin((select auth.uid()))
    and public.is_admin_for_masjid(input_masjid_id)
    and exists (
      select 1
      from public.profiles as students
      where students.id = input_student_id
        and students.role = 'student'
        and students.active = true
    )
    and exists (
      select 1
      from public.session_roster_versions as versions
      where versions.id = input_version_id
        and versions.week_start = input_week_start
        and versions.masjid_id = input_masjid_id
        and versions.cohort_id = input_cohort_id
        and (
          (
            input_session_group_slot_id is null
            and input_session_group_id is not null
            and exists (
              select 1
              from public.session_roster_version_groups as groups
              join public.session_roster_version_students as roster
                on roster.version_id = groups.version_id
                and roster.session_group_id = groups.group_id
                and roster.student_id = input_student_id
              where groups.version_id = versions.id
                and groups.group_id = input_session_group_id
                and (input_halaqa_group_id is null or input_halaqa_group_id = groups.group_id)
            )
          )
          or (
            input_session_group_slot_id is not null
            and exists (
              select 1
              from public.session_roster_version_slots as slots
              join public.session_roster_version_students as roster
                on roster.version_id = slots.version_id
                and roster.session_group_slot_id = slots.slot_id
                and roster.student_id = input_student_id
              where slots.version_id = versions.id
                and slots.slot_id = input_session_group_slot_id
                and (input_halaqa_group_id is null or input_halaqa_group_id = slots.anchor_group_id)
            )
          )
        )
    );
end;
$$;

alter policy "Admins can read all halaqa grades"
  on public.halaqa_grades
  to authenticated
  using (
    public.is_admin_for_masjid(masjid_id)
    or public.teacher_session_grade_row_visible_v2(
      student_id,
      week_start,
      session_roster_version_id,
      session_group_id,
      session_group_slot_id
    )
  );

alter policy "Admins can insert halaqa grades"
  on public.halaqa_grades
  to authenticated
  with check (
    graded_by = (select auth.uid())
    and (
      (
        public.is_admin_for_masjid(masjid_id)
        and public.can_grade_student_for_week(student_id, week_start)
        and (
          public.student_scope_snapshot_matches(
            student_id, week_start, masjid_id, cohort_id, halaqa_group_id
          )
          or public.teacher_session_grade_snapshot_matches_v2(
            student_id,
            week_start,
            session_roster_version_id,
            session_group_id,
            session_group_slot_id,
            masjid_id,
            cohort_id,
            halaqa_group_id
          )
        )
      )
      or public.teacher_session_grade_scope_matches_v2(
        student_id,
        week_start,
        session_roster_version_id,
        session_group_id,
        session_group_slot_id,
        masjid_id,
        cohort_id,
        halaqa_group_id
      )
    )
  );

alter policy "Admins can update halaqa grades"
  on public.halaqa_grades
  to authenticated
  using (
    (
      public.is_admin_for_masjid(masjid_id)
      and public.can_grade_student_for_week(student_id, week_start)
    )
    or public.teacher_session_grade_row_visible_v2(
      student_id,
      week_start,
      session_roster_version_id,
      session_group_id,
      session_group_slot_id
    )
  )
  with check (
    graded_by = (select auth.uid())
    and (
      (
        public.is_admin_for_masjid(masjid_id)
        and public.can_grade_student_for_week(student_id, week_start)
        and (
          public.student_scope_snapshot_matches(
            student_id, week_start, masjid_id, cohort_id, halaqa_group_id
          )
          or public.teacher_session_grade_snapshot_matches_v2(
            student_id,
            week_start,
            session_roster_version_id,
            session_group_id,
            session_group_slot_id,
            masjid_id,
            cohort_id,
            halaqa_group_id
          )
        )
      )
      or public.teacher_session_grade_scope_matches_v2(
        student_id,
        week_start,
        session_roster_version_id,
        session_group_id,
        session_group_slot_id,
        masjid_id,
        cohort_id,
        halaqa_group_id
      )
    )
  );

create table if not exists private.session_roster_dependency_versions (
  cohort_id uuid not null,
  week_start date not null,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (cohort_id, week_start),
  constraint session_roster_dependency_versions_week_check
    check (week_start = public.week_start_for_date(week_start)),
  constraint session_roster_dependency_versions_revision_check
    check (revision >= 0)
);

alter table private.session_roster_dependency_versions enable row level security;
revoke all on table private.session_roster_dependency_versions
  from public, anon, authenticated, service_role;

create or replace function private.session_roster_current_dependency_revision(
  input_cohort_id uuid,
  input_week_start date
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  current_revision bigint;
begin
  insert into private.session_roster_dependency_versions (cohort_id, week_start)
  values (input_cohort_id, input_week_start)
  on conflict (cohort_id, week_start) do nothing;

  select versions.revision
  into current_revision
  from private.session_roster_dependency_versions as versions
  where versions.cohort_id = input_cohort_id
    and versions.week_start = input_week_start;

  return coalesce(current_revision, 0);
end;
$$;

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

create or replace function private.raw_teacher_session_version_authorized(
  input_actor_id uuid,
  input_version_id uuid,
  input_group_id uuid,
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
    from public.session_roster_versions as versions
    where versions.id = input_version_id
      and versions.week_start = input_week_start
      and private.teacher_session_current_version_id(versions.cohort_id, versions.week_start) = versions.id
      and (
        exists (
          select 1
          from public.session_roster_version_groups as groups
          where groups.version_id = versions.id
            and groups.group_id = input_group_id
        )
        or exists (
          select 1
          from public.session_roster_version_slots as slots
          where slots.version_id = versions.id
            and slots.slot_id = input_group_id
        )
      )
      and private.raw_teacher_session_cohort_authorized(
        input_actor_id,
        versions.cohort_id,
        versions.week_start
      )
  );
end;
$$;

create or replace function public.get_teacher_session_dashboard(
  input_cohort_id uuid,
  input_week_start date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  scope_row record;
  version_row public.session_roster_versions%rowtype;
begin
  perform private.session_roster_assert_week(input_week_start);

  select cohorts.*, masajid.name as masjid_name
  into scope_row
  from public.cohorts
  join public.masajid on masajid.id = cohorts.masjid_id
  where cohorts.id = input_cohort_id;

  if scope_row.id is null then
    raise exception using errcode = 'P0002', message = 'teacher_session_cohort_not_found';
  end if;
  if not private.raw_teacher_session_cohort_authorized(
    (select auth.uid()),
    input_cohort_id,
    input_week_start
  ) then
    raise exception using errcode = '42501', message = 'teacher_session_cohort_unauthorized';
  end if;

  select versions.*
  into version_row
  from public.session_roster_versions as versions
  where versions.cohort_id = input_cohort_id
    and versions.week_start = input_week_start
  order by versions.version_number desc
  limit 1;

  return jsonb_build_object(
    'contract_version', 1,
    'scope', jsonb_build_object(
      'masjid_id', scope_row.masjid_id,
      'masjid_name', scope_row.masjid_name,
      'cohort_id', scope_row.id,
      'cohort_name', scope_row.name,
      'cohort_kind', scope_row.kind,
      'week_start', input_week_start,
      'halaqa_saturday', public.halaqa_saturday_for_week(input_week_start),
      'assigned_group_ids', coalesce((
        select jsonb_agg(assignments.group_id order by groups.sort_order, groups.name, groups.id)
        from public.group_teacher_assignments as assignments
        join public.halaqa_groups as groups on groups.id = assignments.group_id
        where assignments.teacher_id = (select auth.uid())
          and assignments.week_start = input_week_start
          and assignments.active = true
          and groups.cohort_id = input_cohort_id
          and private.raw_can_teacher_access_assignment(
            (select auth.uid()), assignments.group_id, input_week_start
          )
      ), '[]'::jsonb)
    ),
    'publication', case when version_row.id is null then null else jsonb_build_object(
      'version_id', version_row.id,
      'version_number', version_row.version_number,
      'source_draft_revision', version_row.source_draft_revision,
      'week_start', version_row.week_start,
      'halaqa_saturday', version_row.halaqa_saturday,
      'published_by', version_row.published_by,
      'published_at', version_row.published_at
    ) end,
    'groups', case when version_row.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'group_id', metrics.group_id,
          'session_group_slot_id', metrics.session_group_slot_id,
          'anchor_group_id', metrics.anchor_group_id,
          'group_name', metrics.group_name,
          'group_sort_order', metrics.group_sort_order,
          'primary_teacher_id', metrics.primary_teacher_id,
          'primary_teacher_name', metrics.primary_teacher_name,
          'is_assigned_group', metrics.is_highlighted_group,
          'is_primary_group', metrics.primary_teacher_id = (select auth.uid()),
          'roster_count', metrics.roster_count,
          'weekly_plan_count', metrics.weekly_plan_count,
          'grade_progress', jsonb_build_object(
            'graded_count', metrics.graded_count,
            'roster_count', metrics.roster_count,
            'remaining_count', greatest(metrics.roster_count - metrics.graded_count, 0),
            'complete', metrics.roster_count = metrics.graded_count
          )
        ) order by metrics.group_sort_order, metrics.group_name, metrics.group_id
      )
      from (
        select
          rows.group_id,
          rows.session_group_slot_id,
          rows.anchor_group_id,
          rows.group_name,
          rows.group_sort_order,
          rows.primary_teacher_id,
          rows.primary_teacher_name,
          (rows.anchor_group_id = any(coalesce((
            select array_agg(assignments.group_id)
            from public.group_teacher_assignments as assignments
            where assignments.teacher_id = (select auth.uid())
              and assignments.week_start = input_week_start
              and assignments.active = true
              and assignments.group_id = rows.anchor_group_id
              and private.raw_can_teacher_access_assignment(
                (select auth.uid()), assignments.group_id, input_week_start
              )
          ), '{}'::uuid[]))
            or rows.primary_teacher_id = (select auth.uid())) as is_highlighted_group,
          (select count(*)::integer
           from public.session_roster_version_students as students
           where students.version_id = version_row.id
             and (
               students.session_group_id = rows.group_id
               or students.session_group_slot_id = rows.session_group_slot_id
             )) as roster_count,
          (select count(distinct plans.student_id)::integer
           from public.session_roster_version_students as students
           join public.weekly_plans as plans
             on plans.student_id = students.student_id
             and plans.week_start = input_week_start
           where students.version_id = version_row.id
             and (
               students.session_group_id = rows.group_id
               or students.session_group_slot_id = rows.session_group_slot_id
             )) as weekly_plan_count,
          (select count(distinct grades.student_id)::integer
           from public.session_roster_version_students as students
           join public.halaqa_grades as grades
             on grades.student_id = students.student_id
             and grades.week_start = input_week_start
             and grades.session_roster_version_id = version_row.id
             and (
               grades.session_group_id = rows.group_id
               or grades.session_group_slot_id = rows.session_group_slot_id
             )
           where students.version_id = version_row.id
             and (
               students.session_group_id = rows.group_id
               or students.session_group_slot_id = rows.session_group_slot_id
             )) as graded_count
        from (
          select
            groups.group_id,
            null::uuid as session_group_slot_id,
            groups.group_id as anchor_group_id,
            groups.group_name,
            groups.group_sort_order,
            groups.primary_teacher_id,
            groups.primary_teacher_name
          from public.session_roster_version_groups as groups
          where groups.version_id = version_row.id
          union all
          select
            slots.slot_id as group_id,
            slots.slot_id as session_group_slot_id,
            slots.anchor_group_id,
            slots.slot_name as group_name,
            slots.slot_sort_order as group_sort_order,
            slots.primary_teacher_id,
            slots.primary_teacher_name
          from public.session_roster_version_slots as slots
          where slots.version_id = version_row.id
        ) as rows
      ) as metrics
    ), '[]'::jsonb) end
  );
end;
$$;

create or replace function public.save_teacher_session_halaqa_grade(
  input_version_id uuid,
  input_group_id uuid,
  input_student_id uuid,
  input_week_start date,
  input_attended boolean,
  input_recitation_points integer,
  input_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.session_roster_versions%rowtype;
  group_row record;
  existing_grade public.halaqa_grades%rowtype;
  saved_grade public.halaqa_grades%rowtype;
  now_at timestamptz := statement_timestamp();
  normalized_notes text := nullif(btrim(coalesce(input_notes, '')), '');
  session_group_id_value uuid;
  session_group_slot_id_value uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'teacher_session_grade_authentication_required';
  end if;

  perform private.session_roster_assert_week(input_week_start);

  select versions.*
  into version_row
  from public.session_roster_versions as versions
  where versions.id = input_version_id;

  if version_row.id is null then
    raise exception using errcode = 'P0002', message = 'teacher_session_grade_published_roster_not_found';
  end if;

  perform private.session_roster_lock(version_row.cohort_id, input_week_start);

  if private.teacher_session_current_version_id(version_row.cohort_id, version_row.week_start)
    is distinct from version_row.id then
    raise exception using errcode = 'PT412', message = 'teacher_session_grade_roster_superseded';
  end if;

  if version_row.week_start is distinct from input_week_start
    or not private.raw_teacher_session_student_authorized(
      (select auth.uid()),
      input_version_id,
      input_group_id,
      input_student_id,
      input_week_start
    ) then
    raise exception using errcode = '42501', message = 'teacher_session_grade_unauthorized';
  end if;

  select resolved.*
  into group_row
  from (
    select
      groups.group_id,
      null::uuid as session_group_slot_id,
      groups.group_id as anchor_group_id,
      groups.group_name,
      groups.primary_teacher_id,
      groups.primary_teacher_name
    from public.session_roster_version_groups as groups
    where groups.version_id = input_version_id
      and groups.group_id = input_group_id
    union all
    select
      slots.slot_id as group_id,
      slots.slot_id as session_group_slot_id,
      slots.anchor_group_id,
      slots.slot_name as group_name,
      slots.primary_teacher_id,
      slots.primary_teacher_name
    from public.session_roster_version_slots as slots
    where slots.version_id = input_version_id
      and slots.slot_id = input_group_id
  ) as resolved;

  if group_row.group_id is null then
    raise exception using errcode = 'P0002', message = 'teacher_session_grade_published_group_not_found';
  end if;

  if input_attended = true
    and (input_recitation_points is null or input_recitation_points < 10 or input_recitation_points > 50) then
    raise exception using errcode = '22023', message = 'teacher_session_grade_invalid_recitation_points';
  end if;
  if input_attended = false and coalesce(input_recitation_points, 0) <> 0 then
    raise exception using errcode = '22023', message = 'teacher_session_grade_absent_points_mismatch';
  end if;

  session_group_id_value := case when group_row.session_group_slot_id is null then group_row.group_id else null end;
  session_group_slot_id_value := group_row.session_group_slot_id;

  select grades.*
  into existing_grade
  from public.halaqa_grades as grades
  where grades.student_id = input_student_id
    and grades.week_start = input_week_start
  for update;

  if existing_grade.id is null then
    insert into public.halaqa_grades (
      student_id,
      week_start,
      attended,
      attendance_points,
      recitation_points,
      notes,
      graded_by,
      graded_at,
      updated_at,
      masjid_id,
      cohort_id,
      halaqa_group_id,
      session_roster_version_id,
      session_roster_version_number,
      session_halaqa_saturday,
      session_group_id,
      session_group_slot_id,
      session_group_name,
      session_primary_teacher_id,
      session_primary_teacher_name
    ) values (
      input_student_id,
      input_week_start,
      input_attended,
      case when input_attended then 100 else 0 end,
      case when input_attended then input_recitation_points else 0 end,
      normalized_notes,
      (select auth.uid()),
      now_at,
      now_at,
      version_row.masjid_id,
      version_row.cohort_id,
      group_row.anchor_group_id,
      input_version_id,
      version_row.version_number,
      version_row.halaqa_saturday,
      session_group_id_value,
      session_group_slot_id_value,
      group_row.group_name,
      group_row.primary_teacher_id,
      group_row.primary_teacher_name
    )
    returning * into saved_grade;
  else
    update public.halaqa_grades
    set attended = input_attended,
        attendance_points = case when input_attended then 100 else 0 end,
        recitation_points = case when input_attended then input_recitation_points else 0 end,
        notes = normalized_notes,
        graded_by = (select auth.uid()),
        graded_at = now_at,
        updated_at = now_at,
        masjid_id = version_row.masjid_id,
        cohort_id = version_row.cohort_id,
        halaqa_group_id = group_row.anchor_group_id,
        session_roster_version_id = input_version_id,
        session_roster_version_number = version_row.version_number,
        session_halaqa_saturday = version_row.halaqa_saturday,
        session_group_id = session_group_id_value,
        session_group_slot_id = session_group_slot_id_value,
        session_group_name = group_row.group_name,
        session_primary_teacher_id = group_row.primary_teacher_id,
        session_primary_teacher_name = group_row.primary_teacher_name
    where id = existing_grade.id
    returning * into saved_grade;
  end if;

  return jsonb_build_object(
    'contract_version', 1,
    'grade', jsonb_build_object(
      'id', saved_grade.id,
      'student_id', saved_grade.student_id,
      'week_start', saved_grade.week_start,
      'attended', saved_grade.attended,
      'attendance_points', saved_grade.attendance_points,
      'recitation_points', saved_grade.recitation_points,
      'notes', saved_grade.notes,
      'graded_by', saved_grade.graded_by,
      'graded_at', saved_grade.graded_at,
      'updated_at', saved_grade.updated_at,
      'masjid_id', saved_grade.masjid_id,
      'cohort_id', saved_grade.cohort_id,
      'halaqa_group_id', saved_grade.halaqa_group_id,
      'session_roster_version_id', saved_grade.session_roster_version_id,
      'session_roster_version_number', saved_grade.session_roster_version_number,
      'session_halaqa_saturday', saved_grade.session_halaqa_saturday,
      'session_group_id', saved_grade.session_group_id,
      'session_group_slot_id', saved_grade.session_group_slot_id,
      'session_group_name', saved_grade.session_group_name,
      'session_primary_teacher_id', saved_grade.session_primary_teacher_id,
      'session_primary_teacher_name', saved_grade.session_primary_teacher_name
    )
  );
end;
$$;

create or replace function public.get_teacher_session_group_roster(
  input_version_id uuid,
  input_group_id uuid,
  input_week_start date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  version_row public.session_roster_versions%rowtype;
  group_row record;
begin
  perform private.session_roster_assert_week(input_week_start);

  select versions.*
  into version_row
  from public.session_roster_versions as versions
  where versions.id = input_version_id;

  if version_row.id is null then
    raise exception using errcode = 'P0002', message = 'teacher_session_published_roster_not_found';
  end if;
  if private.teacher_session_current_version_id(version_row.cohort_id, version_row.week_start)
    is distinct from version_row.id then
    raise exception using errcode = 'PT412', message = 'teacher_session_roster_superseded';
  end if;
  if version_row.week_start is distinct from input_week_start
    or not private.raw_teacher_session_version_authorized(
      (select auth.uid()), input_version_id, input_group_id, input_week_start
    ) then
    raise exception using errcode = '42501', message = 'teacher_session_group_unauthorized';
  end if;

  select resolved.*
  into group_row
  from (
    select
      groups.group_id,
      null::uuid as session_group_slot_id,
      groups.group_id as anchor_group_id,
      groups.group_name,
      groups.group_sort_order,
      groups.primary_teacher_id,
      groups.primary_teacher_name
    from public.session_roster_version_groups as groups
    where groups.version_id = input_version_id
      and groups.group_id = input_group_id
    union all
    select
      slots.slot_id as group_id,
      slots.slot_id as session_group_slot_id,
      slots.anchor_group_id,
      slots.slot_name as group_name,
      slots.slot_sort_order as group_sort_order,
      slots.primary_teacher_id,
      slots.primary_teacher_name
    from public.session_roster_version_slots as slots
    where slots.version_id = input_version_id
      and slots.slot_id = input_group_id
  ) as resolved;

  if group_row.group_id is null then
    raise exception using errcode = 'P0002', message = 'teacher_session_group_not_found';
  end if;

  return jsonb_build_object(
    'contract_version', 1,
    'publication', jsonb_build_object(
      'version_id', version_row.id,
      'version_number', version_row.version_number,
      'week_start', version_row.week_start,
      'halaqa_saturday', version_row.halaqa_saturday,
      'published_by', version_row.published_by,
      'published_at', version_row.published_at
    ),
    'group', jsonb_build_object(
      'group_id', group_row.group_id,
      'session_group_slot_id', group_row.session_group_slot_id,
      'anchor_group_id', group_row.anchor_group_id,
      'group_name', group_row.group_name,
      'group_sort_order', group_row.group_sort_order,
      'primary_teacher_id', group_row.primary_teacher_id,
      'primary_teacher_name', group_row.primary_teacher_name
    ),
    'roster', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'student_id', students.student_id,
          'student_name', students.student_name,
          'usual_group_id', students.usual_group_id,
          'usual_group_name', students.usual_group_name,
          'session_group_id', coalesce(students.session_group_slot_id, students.session_group_id),
          'session_group_slot_id', students.session_group_slot_id,
          'placement_order', students.placement_order,
          'weekly_plan_available', exists (
            select 1
            from public.weekly_plans as plans
            where plans.student_id = students.student_id
              and plans.week_start = input_week_start
          ),
          'grade_is_current', coalesce(grades.session_roster_version_id = version_row.id, false),
          'grade', case when grades.id is null then null else jsonb_build_object(
            'id', grades.id,
            'attended', grades.attended,
            'attendance_points', grades.attendance_points,
            'recitation_points', grades.recitation_points,
            'notes', grades.notes,
            'graded_by', grades.graded_by,
            'graded_at', grades.graded_at,
            'updated_at', grades.updated_at,
            'session_roster_version_id', grades.session_roster_version_id,
            'session_group_id', grades.session_group_id,
            'session_group_slot_id', grades.session_group_slot_id
          ) end
        ) order by students.placement_order, students.student_name, students.student_id
      )
      from public.session_roster_version_students as students
      left join public.halaqa_grades as grades
        on grades.student_id = students.student_id
        and grades.week_start = input_week_start
      where students.version_id = input_version_id
        and (
          students.session_group_id = input_group_id
          or students.session_group_slot_id = input_group_id
        )
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_teacher_session_student_context(
  input_student_id uuid,
  input_week_start date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  context_row record;
begin
  perform private.session_roster_assert_week(input_week_start);

  select
    versions.id as version_id,
    versions.version_number,
    versions.masjid_id,
    versions.cohort_id,
    versions.week_start,
    versions.halaqa_saturday,
    versions.published_by,
    versions.published_at,
    students.student_id,
    students.student_name,
    students.usual_group_id,
    students.usual_group_name,
    coalesce(students.session_group_slot_id, students.session_group_id) as session_group_id,
    students.session_group_slot_id,
    students.placement_order,
    groups.group_name,
    groups.group_sort_order,
    groups.anchor_group_id,
    groups.primary_teacher_id,
    groups.primary_teacher_name
  into context_row
  from public.session_roster_versions as versions
  join public.session_roster_version_students as students
    on students.version_id = versions.id
  left join lateral (
    select
      legacy_groups.group_id,
      null::uuid as session_group_slot_id,
      legacy_groups.group_id as anchor_group_id,
      legacy_groups.group_name,
      legacy_groups.group_sort_order,
      legacy_groups.primary_teacher_id,
      legacy_groups.primary_teacher_name
    from public.session_roster_version_groups as legacy_groups
    where legacy_groups.version_id = versions.id
      and legacy_groups.group_id = students.session_group_id
    union all
    select
      slots.slot_id as group_id,
      slots.slot_id as session_group_slot_id,
      slots.anchor_group_id,
      slots.slot_name as group_name,
      slots.slot_sort_order as group_sort_order,
      slots.primary_teacher_id,
      slots.primary_teacher_name
    from public.session_roster_version_slots as slots
    where slots.version_id = versions.id
      and slots.slot_id = students.session_group_slot_id
  ) as groups on true
  where versions.week_start = input_week_start
    and private.teacher_session_current_version_id(versions.cohort_id, versions.week_start) = versions.id
    and students.student_id = input_student_id
  order by versions.version_number desc
  limit 1;

  if context_row.version_id is null
    or not private.raw_teacher_session_student_authorized(
      (select auth.uid()),
      context_row.version_id,
      context_row.session_group_id,
      input_student_id,
      input_week_start
    ) then
    raise exception using errcode = '42501', message = 'teacher_session_student_unauthorized';
  end if;

  return jsonb_build_object(
    'contract_version', 1,
    'student', jsonb_build_object(
      'student_id', context_row.student_id,
      'student_name', context_row.student_name,
      'usual_group_id', context_row.usual_group_id,
      'usual_group_name', context_row.usual_group_name,
      'session_group_id', context_row.session_group_id,
      'session_group_slot_id', context_row.session_group_slot_id,
      'placement_order', context_row.placement_order
    ),
    'group', jsonb_build_object(
      'group_id', context_row.session_group_id,
      'session_group_slot_id', context_row.session_group_slot_id,
      'anchor_group_id', context_row.anchor_group_id,
      'group_name', context_row.group_name,
      'group_sort_order', context_row.group_sort_order,
      'primary_teacher_id', context_row.primary_teacher_id,
      'primary_teacher_name', context_row.primary_teacher_name
    ),
    'publication', jsonb_build_object(
      'version_id', context_row.version_id,
      'version_number', context_row.version_number,
      'masjid_id', context_row.masjid_id,
      'cohort_id', context_row.cohort_id,
      'week_start', context_row.week_start,
      'halaqa_saturday', context_row.halaqa_saturday,
      'published_by', context_row.published_by,
      'published_at', context_row.published_at
    )
  );
end;
$$;

create or replace function private.raw_teacher_session_student_authorized(
  input_actor_id uuid,
  input_version_id uuid,
  input_group_id uuid,
  input_student_id uuid,
  input_week_start date
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  return private.raw_teacher_session_version_authorized(
    input_actor_id,
    input_version_id,
    input_group_id,
    input_week_start
  )
  and exists (
    select 1
    from public.session_roster_version_students as students
    where students.version_id = input_version_id
      and students.student_id = input_student_id
      and (
        students.session_group_id = input_group_id
        or students.session_group_slot_id = input_group_id
      )
  );
end;
$$;

create or replace function public.assign_session_roster_wizard_primary_teacher(
  input_request_id uuid,
  input_actor_id uuid,
  input_draft_id uuid,
  input_session_group_slot_id uuid,
  input_primary_teacher_id uuid,
  input_expected_state_version bigint,
  input_confirm_mismatch boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_row record;
  slot_row record;
  target_masjid_id uuid;
  teacher_name text;
  assigned_mismatch_reason text := null;
  assigned_mismatch_confirmed boolean := false;
  request_payload jsonb;
  replay_result jsonb;
  before_data jsonb;
  result_payload jsonb;
begin
  select drafts.*
  into draft_row
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'session_roster_wizard_draft_not_found';
  end if;

  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, draft_row.cohort_id);
  perform private.session_roster_lock(draft_row.cohort_id, draft_row.week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'draft_id', input_draft_id,
    'session_group_slot_id', input_session_group_slot_id,
    'primary_teacher_id', input_primary_teacher_id,
    'expected_state_version', input_expected_state_version,
    'confirm_mismatch', coalesce(input_confirm_mismatch, false),
    'workflow', 'teacher_driven'
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
  into draft_row
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id
  for update;

  if draft_row.wizard_mode <> 'teacher_driven' then
    raise exception using errcode = 'PT409', message = 'session_roster_wizard_mode_required';
  end if;
  if draft_row.status <> 'draft' then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_draft_not_editable';
  end if;
  if draft_row.state_version is distinct from input_expected_state_version then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_stale_draft';
  end if;
  if draft_row.dependency_revision is distinct from private.session_roster_dependency_revision_read(
    draft_row.cohort_id,
    draft_row.week_start
  ) or draft_row.dependency_digest is distinct from private.session_roster_wizard_source_digest(
    draft_row.cohort_id,
    draft_row.week_start
  ) then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_source_stale';
  end if;

  select slots.*
  into slot_row
  from public.session_roster_draft_slots as slots
  where slots.draft_id = input_draft_id
    and slots.slot_id = input_session_group_slot_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'session_roster_wizard_session_group_invalid';
  end if;

  if input_primary_teacher_id is not null then
    select teachers.teacher_name
    into teacher_name
    from private.session_roster_wizard_available_teachers(
      draft_row.cohort_id,
      draft_row.week_start
    ) as teachers
    where teachers.teacher_id = input_primary_teacher_id;

    if teacher_name is null then
      raise exception using errcode = '42501', message = 'session_roster_wizard_primary_teacher_unavailable';
    end if;

    if slot_row.anchor_group_id is not null and not exists (
      select 1
      from public.group_teacher_assignments as assignments
      join public.profiles as teachers on teachers.id = assignments.teacher_id
      join public.masjid_staff_memberships as staff
        on staff.profile_id = teachers.id
        and staff.masjid_id = target_masjid_id
        and staff.staff_role = 'teacher'
        and staff.active = true
        and staff.starts_on <= draft_row.halaqa_saturday
        and (staff.ends_on is null or staff.ends_on >= draft_row.halaqa_saturday)
      where assignments.teacher_id = input_primary_teacher_id
        and assignments.group_id = slot_row.anchor_group_id
        and assignments.week_start = draft_row.week_start
        and assignments.active = true
        and teachers.role in ('teacher', 'admin')
        and teachers.active = true
    ) then
      assigned_mismatch_reason := 'Primary teacher is not assigned to the anchored permanent group for this cohort/week.';
      assigned_mismatch_confirmed := coalesce(input_confirm_mismatch, false);
      if not assigned_mismatch_confirmed then
        raise exception using errcode = 'PT422', message = 'session_roster_wizard_teacher_group_mismatch_confirmation_required';
      end if;
    end if;
  end if;

  before_data := jsonb_build_object(
    'session_group_slot_id', slot_row.slot_id,
    'primary_teacher_id', slot_row.primary_teacher_id,
    'primary_teacher_name', slot_row.primary_teacher_name,
    'mismatch_confirmed', slot_row.mismatch_confirmed,
    'mismatch_reason', slot_row.mismatch_reason
  );

  update public.session_roster_draft_slots
  set primary_teacher_id = input_primary_teacher_id,
      primary_teacher_name = teacher_name,
      mismatch_confirmed = assigned_mismatch_confirmed,
      mismatch_reason = assigned_mismatch_reason,
      primary_teacher_manually_set = true,
      updated_at = statement_timestamp()
  where draft_id = input_draft_id
    and slot_id = input_session_group_slot_id;

  update public.session_roster_drafts
  set state_version = state_version + 1,
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
    before_data,
    after_data,
    metadata
  ) values (
    input_actor_id,
    'primary_teacher_assigned',
    target_masjid_id,
    draft_row.cohort_id,
    draft_row.week_start,
    draft_row.halaqa_saturday,
    input_draft_id,
    input_request_id,
    before_data,
    jsonb_build_object(
      'session_group_slot_id', input_session_group_slot_id,
      'primary_teacher_id', input_primary_teacher_id,
      'primary_teacher_name', teacher_name,
      'mismatch_confirmed', assigned_mismatch_confirmed,
      'mismatch_reason', assigned_mismatch_reason
    ),
    jsonb_build_object(
      'workflow', 'teacher_driven',
      'mismatch_override', assigned_mismatch_reason is not null,
      'explicit_confirmation', coalesce(input_confirm_mismatch, false)
    )
  );

  result_payload := private.session_roster_wizard_draft_payload(input_draft_id);
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

-- Defined before the additive tables so the final migration remains easy to
-- review as one workflow. PL/pgSQL resolves the referenced rows on first use;
-- the tables and private helpers are created below in the same transaction.
create or replace function public.generate_session_roster_wizard_groups(
  input_request_id uuid,
  input_actor_id uuid,
  input_draft_id uuid,
  input_expected_state_version bigint,
  input_confirm_discard_changes boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft record;
  target_masjid_id uuid;
  wizard_source_state jsonb;
  source_digest text;
  current_revision bigint;
  available_teacher_count integer := 0;
  has_manual_changes boolean := false;
  source_stale boolean := false;
  request_payload jsonb;
  replay_result jsonb;
  result_payload jsonb;
  teacher_row record;
  anchor_group_id uuid;
  anchor_group_name text;
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
    'confirm_discard_changes', coalesce(input_confirm_discard_changes, false),
    'workflow', 'teacher_driven'
  );

  replay_result := private.session_roster_replay_result(
    input_request_id,
    'generate_groups',
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

  wizard_source_state := private.session_roster_wizard_source_snapshot(draft.cohort_id, draft.week_start);
  source_digest := private.session_roster_wizard_source_digest(draft.cohort_id, draft.week_start);
  current_revision := private.session_roster_dependency_revision_read(draft.cohort_id, draft.week_start);

  select count(*)::integer
  into available_teacher_count
  from private.session_roster_wizard_available_teachers(draft.cohort_id, draft.week_start);

  if available_teacher_count = 0 then
    raise exception using errcode = 'PT422', message = 'session_roster_wizard_no_available_teachers';
  end if;

  source_stale := draft.dependency_revision is distinct from current_revision
    or draft.dependency_digest is distinct from source_digest;
  has_manual_changes := exists (
    select 1
    from public.session_roster_draft_students as students
    where students.draft_id = input_draft_id
      and students.placed_by is not null
  ) or exists (
    select 1
    from public.session_roster_draft_slots as slots
    where slots.draft_id = input_draft_id
      and slots.primary_teacher_manually_set = true
  );

  if (has_manual_changes or source_stale)
    and coalesce(input_confirm_discard_changes, false) = false then
    raise exception using errcode = 'PT409', message = 'session_roster_wizard_regeneration_discard_confirmation_required';
  end if;

  -- Clear only the unpublished slot placement layer. Permanent groups and
  -- memberships are never written by this workflow.
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

    perform private.session_roster_wizard_materialize_students(input_draft_id, wizard_source_state);
  end if;

  for teacher_row in
    select teachers.*
    from private.session_roster_wizard_available_teachers(
      draft.cohort_id,
      draft.week_start
    ) as teachers
    order by teachers.teacher_sort_order
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

  -- Deterministic round-robin assignment keeps the size difference at most
  -- one while remaining stable for identical source rows.
  with ranked_slots as (
    select
      slots.slot_id,
      row_number() over (order by slots.slot_sort_order, slots.slot_name, slots.slot_id)::integer as slot_number
    from public.session_roster_draft_slots as slots
    where slots.draft_id = input_draft_id
  ),
  ranked_students as (
    select
      students.student_id,
      row_number() over (order by students.student_name, students.student_id)::integer as student_number
    from public.session_roster_draft_students as students
    where students.draft_id = input_draft_id
      and students.attendance_status = 'attending'
  ),
  placements as (
    select
      ranked_students.student_id,
      ranked_slots.slot_id
    from ranked_students
    join ranked_slots
      on ranked_slots.slot_number = ((ranked_students.student_number - 1) % available_teacher_count) + 1
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
  set source_state = wizard_source_state,
      source_state_digest = source_digest,
      dependency_revision = current_revision,
      dependency_digest = source_digest,
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
      'workflow', 'teacher_driven',
      'available_teacher_count', available_teacher_count,
      'derived_group_count', available_teacher_count,
      'dependency_revision', current_revision,
      'dependency_digest', source_digest
    ),
    jsonb_build_object(
      'regeneration', true,
      'discard_confirmed', coalesce(input_confirm_discard_changes, false),
      'discarded_manual_changes', has_manual_changes,
      'source_refreshed', source_stale,
      'permanent_memberships_changed', false
    )
  );

  result_payload := private.session_roster_wizard_draft_payload(input_draft_id);
  perform private.session_roster_write_request(
    input_request_id,
    'generate_groups',
    input_actor_id,
    input_draft_id,
    request_payload,
    result_payload
  );
  return result_payload;
end;
$$;

create or replace function private.session_roster_dependency_revision_read(
  input_cohort_id uuid,
  input_week_start date
)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select versions.revision
      from private.session_roster_dependency_versions as versions
      where versions.cohort_id = input_cohort_id
        and versions.week_start = input_week_start
    ),
    0
  );
$$;

create or replace function private.session_roster_advance_dependency(
  input_cohort_id uuid,
  input_week_start date
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  next_revision bigint;
begin
  insert into private.session_roster_dependency_versions (cohort_id, week_start, revision, updated_at)
  values (input_cohort_id, input_week_start, 1, statement_timestamp())
  on conflict (cohort_id, week_start) do update
    set revision = private.session_roster_dependency_versions.revision + 1,
        updated_at = statement_timestamp()
  returning revision into next_revision;

  return next_revision;
end;
$$;

-- A new slot identity is deliberately separate from halaqa_groups.  The
-- legacy group_id columns remain populated for legacy drafts/versions and
-- preserve their existing foreign keys and response fields.
create table if not exists public.session_roster_draft_slots (
  draft_id uuid not null references public.session_roster_drafts(id) on delete restrict,
  slot_id uuid not null default gen_random_uuid(),
  slot_name text not null,
  slot_sort_order integer not null,
  anchor_group_id uuid references public.halaqa_groups(id) on delete restrict,
  primary_teacher_id uuid,
  primary_teacher_name text,
  mismatch_confirmed boolean not null default false,
  mismatch_reason text,
  primary_teacher_manually_set boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (draft_id, slot_id),
  constraint session_roster_draft_slots_name_check
    check (char_length(btrim(slot_name)) > 0),
  constraint session_roster_draft_slots_sort_check
    check (slot_sort_order > 0),
  constraint session_roster_draft_slots_teacher_name_check
    check (primary_teacher_id is null or primary_teacher_name is not null),
  constraint session_roster_draft_slots_mismatch_check
    check (not mismatch_confirmed or primary_teacher_id is not null)
);

create index if not exists session_roster_draft_slots_order_idx
  on public.session_roster_draft_slots(draft_id, slot_sort_order, slot_id);

create index if not exists session_roster_draft_slots_anchor_idx
  on public.session_roster_draft_slots(anchor_group_id, draft_id);

create table if not exists public.session_roster_version_slots (
  version_id uuid not null references public.session_roster_versions(id) on delete restrict,
  slot_id uuid not null,
  slot_name text not null,
  slot_sort_order integer not null,
  anchor_group_id uuid references public.halaqa_groups(id) on delete restrict,
  primary_teacher_id uuid not null references public.profiles(id) on delete restrict,
  primary_teacher_name text not null,
  mismatch_confirmed boolean not null default false,
  mismatch_reason text,
  primary key (version_id, slot_id),
  constraint session_roster_version_slots_name_check
    check (char_length(btrim(slot_name)) > 0),
  constraint session_roster_version_slots_sort_check
    check (slot_sort_order > 0),
  constraint session_roster_version_slots_teacher_name_check
    check (char_length(btrim(primary_teacher_name)) > 0),
  constraint session_roster_version_slots_mismatch_check
    check (not mismatch_confirmed or primary_teacher_id is not null)
);

create index if not exists session_roster_version_slots_order_idx
  on public.session_roster_version_slots(version_id, slot_sort_order, slot_id);

create index if not exists session_roster_version_slots_anchor_idx
  on public.session_roster_version_slots(anchor_group_id, version_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'halaqa_grades_session_version_slot_fk'
      and conrelid = 'public.halaqa_grades'::regclass
  ) then
    alter table public.halaqa_grades
      add constraint halaqa_grades_session_version_slot_fk
      foreign key (session_roster_version_id, session_group_slot_id)
      references public.session_roster_version_slots(version_id, slot_id)
      on delete restrict;
  end if;
end;
$$;

alter table public.session_roster_drafts
  add column if not exists wizard_mode text not null default 'legacy',
  add column if not exists dependency_revision bigint not null default 0,
  add column if not exists dependency_digest text,
  add column if not exists available_teacher_count integer not null default 0,
  add column if not exists derived_group_count integer not null default 0,
  add column if not exists wizard_prerequisite_state jsonb not null default '{}'::jsonb,
  add column if not exists mismatch_confirmation_required boolean not null default false,
  add column if not exists mismatch_confirmed boolean not null default false,
  add column if not exists unplaced_count integer not null default 0,
  add column if not exists imbalance_warning boolean not null default false,
  add column if not exists primary_responsibilities jsonb not null default '[]'::jsonb,
  add column if not exists recovery_guidance text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.session_roster_drafts'::regclass
      and conname = 'session_roster_drafts_wizard_mode_check'
  ) then
    alter table public.session_roster_drafts
      add constraint session_roster_drafts_wizard_mode_check
      check (wizard_mode in ('legacy', 'teacher_driven'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.session_roster_drafts'::regclass
      and conname = 'session_roster_drafts_dependency_revision_check'
  ) then
    alter table public.session_roster_drafts
      add constraint session_roster_drafts_dependency_revision_check
      check (dependency_revision >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.session_roster_drafts'::regclass
      and conname = 'session_roster_drafts_wizard_counts_check'
  ) then
    alter table public.session_roster_drafts
      add constraint session_roster_drafts_wizard_counts_check
      check (
        available_teacher_count >= 0
        and derived_group_count >= 0
        and unplaced_count >= 0
      );
  end if;
end;
$$;

alter table public.session_roster_draft_students
  add column if not exists session_group_slot_id uuid;

alter table public.session_roster_version_students
  add column if not exists session_group_slot_id uuid;

-- Legacy publication rows keep their permanent-group identity.  Slot-backed
-- publication rows deliberately leave that legacy column null and use the
-- additive slot identity instead.
alter table public.session_roster_version_students
  alter column session_group_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.session_roster_draft_students'::regclass
      and conname = 'session_roster_draft_students_slot_unavailable_check'
  ) then
    alter table public.session_roster_draft_students
      add constraint session_roster_draft_students_slot_unavailable_check
      check (attendance_status = 'attending' or session_group_slot_id is null);
  end if;
end;
$$;

create or replace function private.session_roster_draft_slot_scope_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.session_roster_drafts as drafts
    join public.cohorts on cohorts.id = drafts.cohort_id
    where drafts.id = new.draft_id
      and drafts.wizard_mode = 'teacher_driven'
      and drafts.status = 'draft'
      and (
        new.anchor_group_id is null
        or exists (
          select 1
          from public.halaqa_groups as groups
          where groups.id = new.anchor_group_id
            and groups.cohort_id = drafts.cohort_id
        )
      )
  ) then
    raise exception using errcode = '23514', message = 'session_roster_draft_slot_out_of_scope';
  end if;

  if new.primary_teacher_id is not null and new.primary_teacher_name is null then
    raise exception using errcode = '23514', message = 'session_roster_slot_primary_teacher_name_required';
  end if;

  return new;
end;
$$;

create or replace function private.session_roster_version_slot_scope_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.session_roster_versions as versions
    where versions.id = new.version_id
      and (
        new.anchor_group_id is null
        or exists (
          select 1
          from public.halaqa_groups as groups
          where groups.id = new.anchor_group_id
            and groups.cohort_id = versions.cohort_id
        )
      )
  ) then
    raise exception using errcode = '23514', message = 'session_roster_version_slot_out_of_scope';
  end if;

  return new;
end;
$$;

create or replace function private.session_roster_version_slot_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'session_roster_version_slot_immutable';
end;
$$;

create or replace function private.session_roster_version_slot_student_scope_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.session_roster_version_slots as slots
    where slots.version_id = new.version_id
      and slots.slot_id = new.session_group_slot_id
  ) then
    raise exception using errcode = '23514', message = 'session_roster_version_slot_student_out_of_scope';
  end if;

  return new;
end;
$$;

drop trigger if exists session_roster_draft_slots_scope_trigger
  on public.session_roster_draft_slots;
create trigger session_roster_draft_slots_scope_trigger
  before insert or update of draft_id, anchor_group_id, primary_teacher_id, primary_teacher_name
  on public.session_roster_draft_slots
  for each row execute function private.session_roster_draft_slot_scope_matches();

drop trigger if exists session_roster_version_slots_scope_trigger
  on public.session_roster_version_slots;
create trigger session_roster_version_slots_scope_trigger
  before insert or update of version_id, anchor_group_id
  on public.session_roster_version_slots
  for each row execute function private.session_roster_version_slot_scope_matches();

drop trigger if exists session_roster_version_slots_immutable_trigger
  on public.session_roster_version_slots;
create trigger session_roster_version_slots_immutable_trigger
  before update or delete on public.session_roster_version_slots
  for each row execute function private.session_roster_version_slot_immutable();

drop trigger if exists session_roster_version_slot_students_scope_trigger
  on public.session_roster_version_students;
create trigger session_roster_version_slot_students_scope_trigger
  before insert or update of version_id, session_group_slot_id
  on public.session_roster_version_students
  for each row
  when (new.session_group_slot_id is not null)
  execute function private.session_roster_version_slot_student_scope_matches();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.session_roster_draft_students'::regclass
      and conname = 'session_roster_draft_students_slot_fk'
  ) then
    alter table public.session_roster_draft_students
      add constraint session_roster_draft_students_slot_fk
      foreign key (draft_id, session_group_slot_id)
      references public.session_roster_draft_slots(draft_id, slot_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.session_roster_draft_students'::regclass
      and conname = 'session_roster_draft_students_one_session_identity_check'
  ) then
    alter table public.session_roster_draft_students
      add constraint session_roster_draft_students_one_session_identity_check
      check (session_group_id is null or session_group_slot_id is null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.session_roster_version_students'::regclass
      and conname = 'session_roster_version_students_slot_fk'
  ) then
    alter table public.session_roster_version_students
      add constraint session_roster_version_students_slot_fk
      foreign key (version_id, session_group_slot_id)
      references public.session_roster_version_slots(version_id, slot_id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.session_roster_version_students'::regclass
      and conname = 'session_roster_version_students_one_session_identity_check'
  ) then
      alter table public.session_roster_version_students
      add constraint session_roster_version_students_one_session_identity_check
      check ((session_group_id is null) <> (session_group_slot_id is null));
  end if;
end;
$$;

create index if not exists session_roster_draft_students_slot_idx
  on public.session_roster_draft_students(draft_id, session_group_slot_id, attendance_status);

create index if not exists session_roster_version_students_slot_idx
  on public.session_roster_version_students(version_id, session_group_slot_id, placement_order);

-- Slot rows are readable only through the same scoped normal-admin policy as
-- the existing draft/version rows.  All writes remain inside guarded RPCs.
alter table public.session_roster_draft_slots enable row level security;
alter table public.session_roster_version_slots enable row level security;
revoke all on table public.session_roster_draft_slots
  from public, anon, authenticated;
revoke all on table public.session_roster_version_slots
  from public, anon, authenticated;
grant select on table public.session_roster_draft_slots to authenticated;
grant select on table public.session_roster_version_slots to authenticated;
grant all on table public.session_roster_draft_slots to service_role;
grant all on table public.session_roster_version_slots to service_role;

create policy "Scoped admins can read session roster draft slots"
  on public.session_roster_draft_slots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.session_roster_drafts as drafts
      where drafts.id = session_roster_draft_slots.draft_id
        and public.can_read_session_roster_cohort(drafts.cohort_id)
    )
  );

create policy "Scoped admins can read session roster version slots"
  on public.session_roster_version_slots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.session_roster_versions as versions
      where versions.id = session_roster_version_slots.version_id
        and public.can_read_session_roster_cohort(versions.cohort_id)
    )
  );

-- A current source edit must invalidate a placed wizard draft even if a value
-- is later changed back to its old digest.  The revision is deliberately a
-- narrow dependency marker, not a generalized availability history table.
create or replace function private.session_roster_wizard_source_lock()
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

-- Teacher eligibility is part of the wizard source snapshot.  A staff/profile
-- change therefore advances the same narrow dependency revision for affected
-- masjid cohorts, so a placed draft cannot silently survive an eligibility
-- change (including a change that is later reverted before regeneration).
create or replace function private.session_roster_wizard_advance_masjid_dependencies(
  input_masjid_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  affected record;
begin
  if input_masjid_id is null then
    return;
  end if;

  for affected in
    select drafts.cohort_id, drafts.week_start
    from public.session_roster_drafts as drafts
    join public.cohorts
      on cohorts.id = drafts.cohort_id
    where cohorts.masjid_id = input_masjid_id
      and drafts.status = 'draft'
      and drafts.wizard_mode = 'teacher_driven'
  loop
    perform private.session_roster_lock(affected.cohort_id, affected.week_start);
    perform private.session_roster_advance_dependency(affected.cohort_id, affected.week_start);
  end loop;
end;
$$;

create or replace function private.session_roster_wizard_teacher_eligibility_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_masjid_id uuid;
  affected_profile_id uuid;
begin
  if tg_table_name = 'masjid_staff_memberships' then
    if tg_op <> 'INSERT' then
      perform private.session_roster_wizard_advance_masjid_dependencies(old.masjid_id);
    end if;
    if tg_op <> 'DELETE' then
      perform private.session_roster_wizard_advance_masjid_dependencies(new.masjid_id);
    end if;
  elsif tg_table_name = 'profiles' then
    affected_profile_id := case when tg_op = 'DELETE' then old.id else new.id end;
    for affected_masjid_id in
      select distinct staff.masjid_id
      from public.masjid_staff_memberships as staff
      where staff.profile_id = affected_profile_id
    loop
      perform private.session_roster_wizard_advance_masjid_dependencies(affected_masjid_id);
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists session_roster_wizard_teacher_staff_eligibility_trigger
  on public.masjid_staff_memberships;
create trigger session_roster_wizard_teacher_staff_eligibility_trigger
  after insert or update of profile_id, masjid_id, staff_role, active, starts_on, ends_on or delete
  on public.masjid_staff_memberships
  for each row execute function private.session_roster_wizard_teacher_eligibility_lock();

drop trigger if exists session_roster_wizard_teacher_profile_eligibility_trigger
  on public.profiles;
create trigger session_roster_wizard_teacher_profile_eligibility_trigger
  after update of role, active or delete
  on public.profiles
  for each row execute function private.session_roster_wizard_teacher_eligibility_lock();

drop trigger if exists session_roster_wizard_student_availability_source_trigger
  on public.student_rotation_availability;
create trigger session_roster_wizard_student_availability_source_trigger
  before insert or update or delete on public.student_rotation_availability
  for each row execute function private.session_roster_wizard_source_lock();

drop trigger if exists session_roster_wizard_teacher_availability_source_trigger
  on public.teacher_rotation_availability;
create trigger session_roster_wizard_teacher_availability_source_trigger
  before insert or update or delete on public.teacher_rotation_availability
  for each row execute function private.session_roster_wizard_source_lock();

-- Teacher availability is now saved through one guarded service RPC.  This
-- prevents an authenticated browser write from skipping the dependency lock.
revoke insert, update, delete on table public.teacher_rotation_availability
  from public, anon, authenticated;
grant select on table public.teacher_rotation_availability to authenticated;

create policy "Admins can read teacher rotation availability"
  on public.teacher_rotation_availability
  for select
  to authenticated
  using (public.is_admin_for_masjid(masjid_id));

create or replace function public.teacher_rotation_row_scope_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_cohort_id uuid;
begin
  if tg_table_name = 'cohort_rotation_settings' then
    if not exists (
      select 1
      from public.cohorts
      where cohorts.id = new.cohort_id
        and cohorts.masjid_id = new.masjid_id
    ) then
      raise exception using errcode = '23514', message = 'cohort_id must belong to masjid_id';
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
      raise exception using errcode = '23514', message = 'cohort_id must belong to masjid_id';
    end if;

    if not private.raw_teacher_has_halaqa_saturday_eligibility(
      new.teacher_id,
      new.masjid_id,
      new.week_start
    ) then
      raise exception using errcode = '23514', message = 'teacher_id must be an active teacher for masjid_id and Saturday';
    end if;

    return new;
  end if;

  if tg_table_name = 'group_teacher_assignments' then
    select groups.cohort_id
    into target_cohort_id
    from public.halaqa_groups as groups
    where groups.id = new.group_id;

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

    if new.active then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'rotation-assignment:' || target_cohort_id::text || ':' || new.teacher_id::text || ':' || new.week_start::text,
          0
        )
      );

      if exists (
        select 1
        from public.group_teacher_assignments as assignments
        join public.halaqa_groups as assignment_groups on assignment_groups.id = assignments.group_id
        where assignment_groups.cohort_id = target_cohort_id
          and assignments.teacher_id = new.teacher_id
          and assignments.week_start = new.week_start
          and assignments.active
          and assignments.group_id <> new.group_id
      ) then
        raise exception using
          errcode = '23505',
          message = 'teacher_assignment_duplicate_active_teacher_for_cohort_week';
      end if;
    end if;

    return new;
  end if;

  raise exception 'teacher_rotation_row_scope_matches is not attached to table %', tg_table_name;
end;
$$;

-- The current migration's trigger remains attached to the same three tables;
-- only its teacher/admin eligibility and Saturday boundary are amended.

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
  eligible_teachers as (
    select distinct on (profiles.id)
      profiles.id as teacher_id,
      profiles.name as teacher_name,
      profiles.email as teacher_email,
      coalesce(availability.available, false) as available
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
    where cohorts.id = input_cohort_id
      and cohorts.active = true
      and masajid.active = true
    order by profiles.id, staff.starts_on desc, availability.updated_at desc nulls last
  )
  select case
    when base.value is null then null
    else base.value || jsonb_build_object(
      'teachers', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'teacher_id', eligible.teacher_id,
            'teacher_name', eligible.teacher_name,
            'teacher_email', eligible.teacher_email,
            'available', eligible.available
          ) order by eligible.teacher_name, eligible.teacher_id
        )
        from eligible_teachers as eligible
      ), '[]'::jsonb)
    )
  end
  from base;
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
    else md5(snapshot::text)
  end
  from private.session_roster_wizard_source_snapshot(input_cohort_id, input_week_start) as snapshot;
$$;

create or replace function private.session_roster_wizard_available_teachers(
  input_cohort_id uuid,
  input_week_start date
)
returns table (
  teacher_id uuid,
  teacher_name text,
  teacher_email text,
  teacher_sort_order integer
)
language sql
stable
set search_path = ''
as $$
  select
    (teacher->>'teacher_id')::uuid,
    teacher->>'teacher_name',
    teacher->>'teacher_email',
    row_number() over (order by teacher->>'teacher_name', teacher->>'teacher_id')::integer
  from jsonb_array_elements(
    coalesce(
      private.session_roster_wizard_source_snapshot(input_cohort_id, input_week_start) -> 'teachers',
      '[]'::jsonb
    )
  ) as rows(teacher)
  where coalesce((teacher->>'available')::boolean, false);
$$;

create or replace function private.session_roster_wizard_readiness(
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
  available_teacher_count integer := 0;
  slot_count integer := 0;
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
  mismatch_confirmation_required boolean := false;
  mismatch_confirmed boolean := true;
  group_count_mismatch boolean := false;
  group_counts jsonb := '[]'::jsonb;
  unplaced_students jsonb := '[]'::jsonb;
  missing_primary_teachers jsonb := '[]'::jsonb;
  mismatch_groups jsonb := '[]'::jsonb;
  primary_responsibilities jsonb := '[]'::jsonb;
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
  into available_teacher_count
  from jsonb_array_elements(coalesce(current_source -> 'teachers', '[]'::jsonb)) as rows(teacher)
  where coalesce((teacher->>'available')::boolean, false);

  select count(*)::integer
  into slot_count
  from public.session_roster_draft_slots as slots
  where slots.draft_id = input_draft_id;

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

  mismatch_confirmation_required := exists (
    select 1
    from public.session_roster_draft_slots as slots
    where slots.draft_id = input_draft_id
      and slots.mismatch_reason is not null
      and not slots.mismatch_confirmed
  );
  mismatch_confirmed := not mismatch_confirmation_required;
  group_count_mismatch := slot_count <> available_teacher_count;
  imbalance_warning := slot_count > 0
    and attending_count > 0
    and largest_group_count - smallest_group_count > 1;
  source_stale := draft_row.dependency_revision is distinct from current_revision
    or draft_row.dependency_digest is distinct from current_digest;
  reviewed_current := draft_row.reviewed_state_version is not null
    and draft_row.reviewed_state_version = draft_row.state_version;

  if available_teacher_count = 0 then
    blocker_codes := blocker_codes || jsonb_build_array('no_available_teachers');
  end if;
  if group_count_mismatch then
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
  if mismatch_confirmation_required then
    blocker_codes := blocker_codes || jsonb_build_array('teacher_group_mismatch_confirmation_required');
  end if;
  if source_stale then
    blocker_codes := blocker_codes || jsonb_build_array('source_changed');
  end if;
  if not reviewed_current then
    blocker_codes := blocker_codes || jsonb_build_array('review_required');
  end if;
  if attending_count > 0 and slot_count = 0 then
    blocker_codes := blocker_codes || jsonb_build_array('no_session_groups');
  end if;
  if imbalance_warning then
    warning_codes := warning_codes || jsonb_build_array('group_imbalance');
  end if;

  if source_stale then
    recovery_guidance := 'Refresh the draft after confirming that unpublished placements and responsibilities may be discarded.';
  elsif available_teacher_count = 0 then
    recovery_guidance := 'Mark at least one eligible teacher available for this Saturday before generating groups.';
  elsif group_count_mismatch then
    recovery_guidance := 'Generate the default groups again; the group count must equal the available-teacher count.';
  elsif unplaced_count > 0 then
    recovery_guidance := 'Place every attending student in one Saturday session group.';
  elsif mismatch_confirmation_required then
    recovery_guidance := 'Review each teacher/group mismatch and explicitly confirm the deliberate exception.';
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
      'ready', available_teacher_count > 0,
      'available_teacher_count', available_teacher_count
    ),
    'groups', jsonb_build_object(
      'ready', not group_count_mismatch and unplaced_count = 0 and not source_stale,
      'derived_group_count', slot_count,
      'unplaced_count', unplaced_count,
      'imbalance_warning', imbalance_warning
    ),
    'review', jsonb_build_object(
      'ready', not source_stale and not mismatch_confirmation_required,
      'reviewed_current', reviewed_current
    )
  );

  return jsonb_build_object(
    'can_publish',
      jsonb_array_length(blocker_codes) = 0,
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
    'dependency_revision', current_revision,
    'dependency_digest', current_digest,
    'available_teacher_count', available_teacher_count,
    'teacher_count', available_teacher_count,
    'derived_group_count', slot_count,
    'mismatch_confirmation_required', mismatch_confirmation_required,
    'mismatch_confirmed', mismatch_confirmed,
    'mismatch_groups', mismatch_groups,
    'imbalance_warning', imbalance_warning,
    'primary_responsibilities', primary_responsibilities,
    'prerequisite_state', prerequisite_state,
    'recovery_guidance', recovery_guidance
  );
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
      'derived_group_count', drafts.derived_group_count,
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
        coalesce(
          private.session_roster_wizard_source_snapshot(drafts.cohort_id, drafts.week_start) -> 'teachers',
          '[]'::jsonb
        )
      ) as rows(teacher)
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
    'readiness', private.session_roster_wizard_readiness(drafts.id)
  )
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
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
      'source_dependency_changed'
    ));
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
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
      'generate_groups'
    ));
end;
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
  readiness := private.session_roster_wizard_readiness(input_draft_id);
  if readiness is null then
    return;
  end if;

  update public.session_roster_drafts
  set available_teacher_count = coalesce((readiness ->> 'available_teacher_count')::integer, 0),
      derived_group_count = coalesce((readiness ->> 'derived_group_count')::integer, 0),
      wizard_prerequisite_state = coalesce(readiness -> 'prerequisite_state', '{}'::jsonb),
      mismatch_confirmation_required = coalesce((readiness ->> 'mismatch_confirmation_required')::boolean, false),
      mismatch_confirmed = coalesce((readiness ->> 'mismatch_confirmed')::boolean, false),
      unplaced_count = coalesce((readiness ->> 'unplaced_count')::integer, 0),
      imbalance_warning = coalesce((readiness ->> 'imbalance_warning')::boolean, false),
      primary_responsibilities = coalesce(readiness -> 'primary_responsibilities', '[]'::jsonb),
      recovery_guidance = readiness ->> 'recovery_guidance'
  where id = input_draft_id;
end;
$$;

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
        'eligible_teacher_count', eligible_count
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
    'draft_staled', current_draft.id is not null
  );
end;
$$;

create or replace function private.session_roster_wizard_materialize_students(
  input_draft_id uuid,
  input_source_state jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.session_roster_draft_students (
    draft_id,
    student_id,
    student_name,
    attendance_status,
    unavailable_reason,
    usual_group_id,
    usual_group_name,
    session_group_id,
    session_group_slot_id
  )
  select
    input_draft_id,
    source_students.student_id,
    source_students.student_name,
    source_students.attendance_status,
    source_students.unavailable_reason,
    source_students.usual_group_id,
    source_students.usual_group_name,
    null,
    null
  from jsonb_to_recordset(input_source_state -> 'students') as source_students(
    student_id uuid,
    student_name text,
    usual_group_id uuid,
    usual_group_name text,
    attendance_status text,
    unavailable_reason text
  );
end;
$$;

create or replace function public.load_or_create_session_roster_wizard_draft(
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
  dependency_revision bigint;
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
  perform private.session_roster_lock(input_cohort_id, input_week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'cohort_id', input_cohort_id,
    'week_start', input_week_start,
    'workflow', 'teacher_driven'
  );
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

  if current_draft.id is not null then
    if current_draft.wizard_mode <> 'teacher_driven' then
      raise exception using errcode = 'PT409', message = 'session_roster_legacy_draft_requires_wizard_upgrade';
    end if;
    result_payload := private.session_roster_wizard_draft_payload(current_draft.id);
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

  source_state := private.session_roster_wizard_source_snapshot(input_cohort_id, input_week_start);
  source_digest := private.session_roster_wizard_source_digest(input_cohort_id, input_week_start);
  dependency_revision := private.session_roster_current_dependency_revision(input_cohort_id, input_week_start);
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
      'dependency_revision', dependency_revision,
      'dependency_digest', source_digest
    ),
    jsonb_build_object(
      'seed_mode', 'teacher_availability_balanced_session_slots',
      'published_version_unchanged', true
    )
  );

result_payload := private.session_roster_wizard_draft_payload(created_draft_id);
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

create or replace function public.move_session_roster_wizard_student(
  input_request_id uuid,
  input_actor_id uuid,
  input_draft_id uuid,
  input_student_id uuid,
  input_session_group_slot_id uuid,
  input_expected_state_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_row public.session_roster_drafts%rowtype;
  student_row public.session_roster_draft_students%rowtype;
  target_masjid_id uuid;
  request_payload jsonb;
  replay_result jsonb;
  before_data jsonb;
  result_payload jsonb;
begin
  select drafts.*
  into draft_row
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'session_roster_wizard_draft_not_found';
  end if;

  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, draft_row.cohort_id);
  perform private.session_roster_lock(draft_row.cohort_id, draft_row.week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'draft_id', input_draft_id,
    'student_id', input_student_id,
    'session_group_slot_id', input_session_group_slot_id,
    'expected_state_version', input_expected_state_version,
    'workflow', 'teacher_driven'
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
  into draft_row
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id
  for update;

  if draft_row.wizard_mode <> 'teacher_driven' then
    raise exception using errcode = 'PT409', message = 'session_roster_wizard_mode_required';
  end if;
  if draft_row.status <> 'draft' then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_draft_not_editable';
  end if;
  if draft_row.state_version is distinct from input_expected_state_version then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_stale_draft';
  end if;
  if draft_row.dependency_revision is distinct from private.session_roster_dependency_revision_read(
    draft_row.cohort_id,
    draft_row.week_start
  ) or draft_row.dependency_digest is distinct from private.session_roster_wizard_source_digest(
    draft_row.cohort_id,
    draft_row.week_start
  ) then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_source_stale';
  end if;

  if input_session_group_slot_id is not null and not exists (
    select 1
    from public.session_roster_draft_slots as slots
    where slots.draft_id = input_draft_id
      and slots.slot_id = input_session_group_slot_id
  ) then
    raise exception using errcode = '22023', message = 'session_roster_wizard_session_group_invalid';
  end if;

  select students.*
  into student_row
  from public.session_roster_draft_students as students
  where students.draft_id = input_draft_id
    and students.student_id = input_student_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'session_roster_wizard_student_not_in_draft';
  end if;
  if student_row.attendance_status = 'unavailable' and input_session_group_slot_id is not null then
    raise exception using errcode = '23514', message = 'session_roster_wizard_unavailable_student_cannot_be_placed';
  end if;

  before_data := jsonb_build_object(
    'student_id', student_row.student_id,
    'session_group_slot_id', student_row.session_group_slot_id,
    'attendance_status', student_row.attendance_status
  );

  update public.session_roster_draft_students
  set session_group_id = null,
      session_group_slot_id = case
        when student_row.attendance_status = 'unavailable' then null
        else input_session_group_slot_id
      end,
      placed_by = input_actor_id,
      placed_at = statement_timestamp(),
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
    before_data,
    after_data,
    metadata
  ) values (
    input_actor_id,
    'student_moved',
    target_masjid_id,
    draft_row.cohort_id,
    draft_row.week_start,
    draft_row.halaqa_saturday,
    input_draft_id,
    input_request_id,
    before_data,
    jsonb_build_object(
      'student_id', input_student_id,
      'session_group_slot_id', input_session_group_slot_id,
      'attendance_status', student_row.attendance_status
    ),
    jsonb_build_object('workflow', 'teacher_driven', 'manual_redistribution', true)
  );

  result_payload := private.session_roster_wizard_draft_payload(input_draft_id);
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

create or replace function public.review_session_roster_wizard_draft(
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
  draft_row public.session_roster_drafts%rowtype;
  target_masjid_id uuid;
  request_payload jsonb;
  replay_result jsonb;
  readiness jsonb;
  result_payload jsonb;
  non_review_blockers jsonb;
begin
  select drafts.*
  into draft_row
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'session_roster_wizard_draft_not_found';
  end if;

  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, draft_row.cohort_id);
  perform private.session_roster_lock(draft_row.cohort_id, draft_row.week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'draft_id', input_draft_id,
    'expected_state_version', input_expected_state_version,
    'workflow', 'teacher_driven'
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
  into draft_row
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id
  for update;

  if draft_row.wizard_mode <> 'teacher_driven' then
    raise exception using errcode = 'PT409', message = 'session_roster_wizard_mode_required';
  end if;
  if draft_row.status <> 'draft' then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_draft_not_editable';
  end if;
  if draft_row.state_version is distinct from input_expected_state_version then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_stale_draft';
  end if;

  readiness := private.session_roster_wizard_readiness(input_draft_id);
  non_review_blockers := (readiness -> 'blocker_codes') - 'review_required';
  if jsonb_array_length(non_review_blockers) > 0 then
    raise exception using errcode = 'PT422', message = 'session_roster_wizard_review_blocked', detail = non_review_blockers::text;
  end if;

  update public.session_roster_drafts
  set reviewed_at = statement_timestamp(),
      reviewed_by = input_actor_id,
      reviewed_state_version = state_version,
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
    'draft_reviewed',
    target_masjid_id,
    draft_row.cohort_id,
    draft_row.week_start,
    draft_row.halaqa_saturday,
    input_draft_id,
    input_request_id,
    jsonb_build_object(
      'workflow', 'teacher_driven',
      'reviewed_state_version', draft_row.state_version,
      'readiness', readiness
    ),
    jsonb_build_object('publish_requires_explicit_confirmation', true)
  );

  result_payload := private.session_roster_wizard_draft_payload(input_draft_id);
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

create or replace function public.publish_session_roster_wizard_draft(
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
  draft_row public.session_roster_drafts%rowtype;
  current_version public.session_roster_versions%rowtype;
  target_masjid_id uuid;
  readiness jsonb;
  request_payload jsonb;
  replay_result jsonb;
  next_version_number bigint;
  new_version_id uuid;
  result_payload jsonb;
begin
  select drafts.*
  into draft_row
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'session_roster_wizard_draft_not_found';
  end if;

  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, draft_row.cohort_id);
  perform private.session_roster_lock(draft_row.cohort_id, draft_row.week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'draft_id', input_draft_id,
    'expected_state_version', input_expected_state_version,
    'confirm_publish', coalesce(input_confirm_publish, false),
    'workflow', 'teacher_driven'
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

  if coalesce(input_confirm_publish, false) = false then
    raise exception using errcode = 'PT422', message = 'session_roster_wizard_publish_confirmation_required';
  end if;

  select drafts.*
  into draft_row
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id
  for update;

  if draft_row.wizard_mode <> 'teacher_driven' then
    raise exception using errcode = 'PT409', message = 'session_roster_wizard_mode_required';
  end if;
  if draft_row.status <> 'draft' then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_draft_not_editable';
  end if;
  if draft_row.state_version is distinct from input_expected_state_version then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_stale_draft';
  end if;

  if draft_row.dependency_revision is distinct from private.session_roster_dependency_revision_read(
    draft_row.cohort_id,
    draft_row.week_start
  ) or draft_row.dependency_digest is distinct from private.session_roster_wizard_source_digest(
    draft_row.cohort_id,
    draft_row.week_start
  ) then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_source_stale';
  end if;

  readiness := private.session_roster_wizard_readiness(input_draft_id);
  if coalesce((readiness ->> 'can_publish')::boolean, false) = false then
    raise exception using errcode = 'PT422', message = 'session_roster_wizard_publish_blocked', detail = (readiness -> 'blocker_codes')::text;
  end if;
  if coalesce((readiness ->> 'reviewed_current')::boolean, false) = false then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_review_required';
  end if;

  select versions.*
  into current_version
  from public.session_roster_versions as versions
  where versions.cohort_id = draft_row.cohort_id
    and versions.week_start = draft_row.week_start
  order by versions.version_number desc
  limit 1;

  if draft_row.base_published_version_id is distinct from current_version.id then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_published_version_stale';
  end if;

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
    draft_row.cohort_id,
    draft_row.week_start,
    draft_row.halaqa_saturday,
    next_version_number,
    draft_row.id,
    draft_row.revision_number,
    draft_row.source_state_digest,
    input_actor_id
  )
  returning id into new_version_id;

  insert into public.session_roster_version_slots (
    version_id,
    slot_id,
    slot_name,
    slot_sort_order,
    anchor_group_id,
    primary_teacher_id,
    primary_teacher_name,
    mismatch_confirmed,
    mismatch_reason
  )
  select
    new_version_id,
    slots.slot_id,
    slots.slot_name,
    slots.slot_sort_order,
    slots.anchor_group_id,
    slots.primary_teacher_id,
    slots.primary_teacher_name,
    slots.mismatch_confirmed,
    slots.mismatch_reason
  from public.session_roster_draft_slots as slots
  where slots.draft_id = input_draft_id;

  insert into public.session_roster_version_students (
    version_id,
    student_id,
    student_name,
    usual_group_id,
    usual_group_name,
    session_group_id,
    session_group_slot_id,
    placement_order
  )
  select
    new_version_id,
    students.student_id,
    students.student_name,
    students.usual_group_id,
    students.usual_group_name,
    null,
    students.session_group_slot_id,
    row_number() over (
      partition by students.session_group_slot_id
      order by students.student_name, students.student_id
    )::integer
  from public.session_roster_draft_students as students
  where students.draft_id = input_draft_id
    and students.attendance_status = 'attending'
    and students.session_group_slot_id is not null;

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
    draft_row.cohort_id,
    draft_row.week_start,
    draft_row.halaqa_saturday,
    input_draft_id,
    new_version_id,
    input_request_id,
    jsonb_build_object(
      'draft_id', input_draft_id,
      'draft_revision', draft_row.revision_number,
      'state_version', draft_row.state_version,
      'base_published_version_id', draft_row.base_published_version_id
    ),
    jsonb_build_object(
      'version_id', new_version_id,
      'version_number', next_version_number,
      'slot_count', (readiness ->> 'derived_group_count')::integer,
      'available_teacher_count', (readiness ->> 'available_teacher_count')::integer
    ),
    jsonb_build_object(
      'workflow', 'teacher_driven',
      'publish_confirmation', true,
      'imbalance_warning', coalesce((readiness ->> 'imbalance_warning')::boolean, false),
      'permanent_memberships_changed', false
    )
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

create or replace function public.create_session_roster_wizard_revision(
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
  dependency_revision bigint;
  next_revision bigint;
  created_draft_id uuid;
  request_payload jsonb;
  replay_result jsonb;
  result_payload jsonb;
begin
  perform private.session_roster_assert_week(input_week_start);
  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, input_cohort_id);
  perform private.session_roster_lock(input_cohort_id, input_week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'cohort_id', input_cohort_id,
    'week_start', input_week_start,
    'expected_published_version_id', input_expected_published_version_id,
    'workflow', 'teacher_driven'
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
    raise exception using errcode = 'P0002', message = 'session_roster_wizard_published_version_not_found';
  end if;
  if current_version.id is distinct from input_expected_published_version_id then
    raise exception using errcode = 'PT412', message = 'session_roster_wizard_published_version_stale';
  end if;
  if not exists (
    select 1
    from public.session_roster_version_slots as slots
    where slots.version_id = current_version.id
  ) then
    raise exception using errcode = 'PT409', message = 'session_roster_wizard_revision_requires_slot_publication';
  end if;

  select drafts.*
  into current_draft
  from public.session_roster_drafts as drafts
  where drafts.cohort_id = input_cohort_id
    and drafts.week_start = input_week_start
    and drafts.status = 'draft'
  for update;

  if current_draft.id is not null then
    if current_draft.wizard_mode <> 'teacher_driven'
      or current_draft.base_published_version_id is distinct from current_version.id then
      raise exception using errcode = 'PT412', message = 'session_roster_wizard_revision_conflict';
    end if;

    result_payload := private.session_roster_wizard_draft_payload(current_draft.id);
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

  source_state := private.session_roster_wizard_source_snapshot(input_cohort_id, input_week_start);
  source_digest := private.session_roster_wizard_source_digest(input_cohort_id, input_week_start);
  dependency_revision := private.session_roster_dependency_revision_read(input_cohort_id, input_week_start);

  if source_state is null or source_digest is null then
    raise exception using errcode = '22023', message = 'session_roster_wizard_source_unavailable';
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

  insert into public.session_roster_draft_slots (
    draft_id,
    slot_id,
    slot_name,
    slot_sort_order,
    anchor_group_id,
    primary_teacher_id,
    primary_teacher_name,
    mismatch_confirmed,
    mismatch_reason,
    primary_teacher_manually_set
  )
  select
    created_draft_id,
    slots.slot_id,
    slots.slot_name,
    slots.slot_sort_order,
    slots.anchor_group_id,
    slots.primary_teacher_id,
    slots.primary_teacher_name,
    slots.mismatch_confirmed,
    slots.mismatch_reason,
    false
  from public.session_roster_version_slots as slots
  where slots.version_id = current_version.id;

  update public.session_roster_draft_students as students
  set session_group_slot_id = published_students.session_group_slot_id,
      updated_at = statement_timestamp()
  from public.session_roster_version_students as published_students
  where published_students.version_id = current_version.id
    and published_students.student_id = students.student_id
    and students.draft_id = created_draft_id
    and students.attendance_status = 'attending'
    and published_students.session_group_slot_id is not null;

  perform private.session_roster_wizard_sync_fields(created_draft_id);

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
      'workflow', 'teacher_driven',
      'draft_id', created_draft_id,
      'revision_number', next_revision,
      'base_published_version_id', current_version.id,
      'source_state_digest', source_digest,
      'published_version_remains_current', true
    ),
    jsonb_build_object('seed_mode', 'published_slot_snapshot_with_current_attendance_override')
  );

  result_payload := private.session_roster_wizard_draft_payload(created_draft_id);
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

create or replace function private.session_roster_published_payload(
  input_version_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.session_roster_version_slots as slots
      where slots.version_id = versions.id
    ) then jsonb_build_object(
      'contract_version', 2,
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
        from public.session_roster_version_slots as slots
        where slots.version_id = versions.id
      ), '[]'::jsonb),
      'roster', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'student_id', students.student_id,
            'student_name', students.student_name,
            'usual_group_id', students.usual_group_id,
            'usual_group_name', students.usual_group_name,
            'session_group_id', students.session_group_slot_id,
            'session_group_slot_id', students.session_group_slot_id,
            'placement_order', students.placement_order
          ) order by students.session_group_slot_id, students.placement_order, students.student_id
        )
        from public.session_roster_version_students as students
        where students.version_id = versions.id
          and students.session_group_slot_id is not null
      ), '[]'::jsonb)
    )
    else jsonb_build_object(
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
  end
  from public.session_roster_versions as versions
  where versions.id = input_version_id;
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
  target_mode text;
begin
  select drafts.cohort_id, drafts.wizard_mode
  into target_cohort_id, target_mode
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if target_cohort_id is null then
    raise exception using errcode = 'P0002', message = 'session_roster_draft_not_found';
  end if;

  perform private.session_roster_admin_masjid(input_actor_id, target_cohort_id);
  if target_mode = 'teacher_driven' then
    return private.session_roster_wizard_draft_payload(input_draft_id);
  end if;
  return private.session_roster_draft_payload(input_draft_id);
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
  target_mode text;
begin
  select drafts.cohort_id, drafts.wizard_mode
  into target_cohort_id, target_mode
  from public.session_roster_drafts as drafts
  where drafts.id = input_draft_id;

  if target_cohort_id is null then
    raise exception using errcode = 'P0002', message = 'session_roster_draft_not_found';
  end if;

  perform private.session_roster_admin_masjid(input_actor_id, target_cohort_id);
  if target_mode = 'teacher_driven' then
    return private.session_roster_wizard_readiness(input_draft_id);
  end if;
  return private.session_roster_readiness(input_draft_id);
end;
$$;

-- Guarded RPCs are service-role-only because the server action supplies the
-- authenticated actor and the RPC revalidates scoped admin membership. The
-- teacher-facing v2 policy helpers are callable only by authenticated RLS.
revoke all on function public.apply_teacher_rotation_availability(uuid, uuid, date, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_teacher_rotation_availability(uuid, uuid, date, jsonb)
  to service_role;

revoke all on function public.load_or_create_session_roster_wizard_draft(uuid, uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.generate_session_roster_wizard_groups(uuid, uuid, uuid, bigint, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.move_session_roster_wizard_student(uuid, uuid, uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.assign_session_roster_wizard_primary_teacher(uuid, uuid, uuid, uuid, uuid, bigint, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.review_session_roster_wizard_draft(uuid, uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_session_roster_wizard_draft(uuid, uuid, uuid, bigint, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.create_session_roster_wizard_revision(uuid, uuid, uuid, date, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.load_or_create_session_roster_wizard_draft(uuid, uuid, uuid, date)
  to service_role;
grant execute on function public.generate_session_roster_wizard_groups(uuid, uuid, uuid, bigint, boolean)
  to service_role;
grant execute on function public.move_session_roster_wizard_student(uuid, uuid, uuid, uuid, uuid, bigint)
  to service_role;
grant execute on function public.assign_session_roster_wizard_primary_teacher(uuid, uuid, uuid, uuid, uuid, bigint, boolean)
  to service_role;
grant execute on function public.review_session_roster_wizard_draft(uuid, uuid, uuid, bigint)
  to service_role;
grant execute on function public.publish_session_roster_wizard_draft(uuid, uuid, uuid, bigint, boolean)
  to service_role;
grant execute on function public.create_session_roster_wizard_revision(uuid, uuid, uuid, date, uuid)
  to service_role;

revoke all on function public.teacher_session_grade_row_visible_v2(uuid, date, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.teacher_session_grade_scope_matches_v2(uuid, date, uuid, uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.teacher_session_grade_snapshot_matches_v2(uuid, date, uuid, uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.teacher_session_grade_row_visible_v2(uuid, date, uuid, uuid, uuid)
  to authenticated;
grant execute on function public.teacher_session_grade_scope_matches_v2(uuid, date, uuid, uuid, uuid, uuid, uuid, uuid)
  to authenticated;
grant execute on function public.teacher_session_grade_snapshot_matches_v2(uuid, date, uuid, uuid, uuid, uuid, uuid, uuid)
  to authenticated;

revoke all on function private.session_roster_wizard_source_lock()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_teacher_eligibility_lock()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_advance_masjid_dependencies(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_dependency_revision_read(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_current_dependency_revision(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_advance_dependency(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_source_snapshot(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_source_digest(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_available_teachers(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_readiness(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_draft_payload(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_sync_fields(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_wizard_materialize_students(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_draft_slot_scope_matches()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_version_slot_scope_matches()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_version_slot_immutable()
  from public, anon, authenticated, service_role;
revoke all on function private.session_roster_version_slot_student_scope_matches()
  from public, anon, authenticated, service_role;

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
    'public.apply_teacher_rotation_availability(uuid,uuid,date,jsonb)',
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
    'public.assign_session_roster_wizard_primary_teacher(uuid,uuid,uuid,uuid,uuid,bigint,boolean)',
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
    'public.create_session_roster_wizard_revision(uuid,uuid,uuid,date,uuid)',
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
    'public.get_teacher_session_checklist_details(uuid,uuid,uuid,date,date)',
    'public.get_teacher_session_dashboard(uuid,date)',
    'public.get_teacher_session_group_roster(uuid,uuid,date)',
    'public.get_teacher_session_student_context(uuid,date)',
    'public.generate_session_roster_wizard_groups(uuid,uuid,uuid,bigint,boolean)',
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
    'public.load_or_create_session_roster_wizard_draft(uuid,uuid,uuid,date)',
    'public.move_session_roster_student(uuid,uuid,uuid,uuid,uuid,bigint)',
    'public.move_session_roster_wizard_student(uuid,uuid,uuid,uuid,uuid,bigint)',
    'public.prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)',
    'public.prepare_teacher_rotation_publication(uuid,uuid,uuid,date)',
    'public.preview_official_scoring_start_change(uuid,uuid,date)',
    'public.protect_foundation_row_identity()',
    'public.publish_session_roster_draft(uuid,uuid,uuid,bigint)',
    'public.publish_session_roster_wizard_draft(uuid,uuid,uuid,bigint,boolean)',
    'public.recalculate_student_checkin_score()',
    'public.reconcile_historical_accountability_obligation(uuid,date)',
    'public.refresh_current_profile_role()',
    'public.refresh_session_roster_draft(uuid,uuid,uuid,date,uuid,bigint,text,uuid,boolean)',
    'public.review_session_roster_draft(uuid,uuid,uuid,bigint)',
    'public.review_session_roster_wizard_draft(uuid,uuid,uuid,bigint)',
    'public.rotation_publication_state_version_bump()',
    'public.save_teacher_session_halaqa_grade(uuid,uuid,uuid,date,boolean,integer,text)',
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
    'public.teacher_grade_scope_snapshot_matches(uuid,date,uuid,uuid,uuid)',
    'public.teacher_group_roster_context(uuid,date)',
    'public.teacher_rotation_row_scope_matches()',
    'public.teacher_session_authorized_scopes(date)',
    'public.teacher_session_grade_row_visible(uuid,date,uuid,uuid)',
    'public.teacher_session_grade_row_visible_v2(uuid,date,uuid,uuid,uuid)',
    'public.teacher_session_grade_scope_matches(uuid,date,uuid,uuid,uuid,uuid,uuid)',
    'public.teacher_session_grade_scope_matches_v2(uuid,date,uuid,uuid,uuid,uuid,uuid,uuid)',
    'public.teacher_session_grade_snapshot_matches(uuid,date,uuid,uuid,uuid,uuid,uuid)',
    'public.teacher_session_grade_snapshot_matches_v2(uuid,date,uuid,uuid,uuid,uuid,uuid,uuid)',
    'public.teacher_session_plan_scope_matches(uuid,date)',
    'public.validate_accountability_obligation_scope()',
    'private.apply_super_admin_masjid_staff_grant_once(uuid,uuid,uuid,uuid,text,date,jsonb)',
    'private.assert_teacher_assignment_removal_safe(uuid,date,uuid)',
    'private.enforce_halaqa_grade_session_snapshot()',
    'private.enforce_staff_grant_preview_transition()',
    'private.enforce_masjid_hierarchy_readiness()',
    'private.project_cohort_profile_access()',
    'private.project_group_profile_access()',
    'private.project_masjid_profile_access()',
    'private.project_staff_membership_profile_access()',
    'private.project_student_membership_profile_access()',
    'private.raw_teacher_session_grade_snapshot_matches(uuid,date,uuid,uuid,uuid,uuid,uuid)',
    'private.recompute_profiles_for_masjid(uuid)',
    'private.recompute_profile_access(uuid,date)',
    'private.session_roster_source_lock()',
    'private.session_roster_wizard_source_lock()',
    'private.session_roster_wizard_teacher_eligibility_lock()'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
