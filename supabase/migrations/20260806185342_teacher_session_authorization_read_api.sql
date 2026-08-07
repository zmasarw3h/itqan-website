-- Teacher authorization and read APIs for immutable published Saturday rosters.
--
-- A teacher-capable actor is authorized at the cohort/week level when the
-- actor has an active teacher staff capability for the masjid and an active
-- weekly assignment to any group in that cohort. The assigned group is only
-- a highlight; it is never used as the student/group permission boundary.
-- Every teacher-facing roster contract below requires the current published
-- session-roster version. Drafts and superseded versions are not live teacher
-- surfaces, while grade rows retain the version that was used to save them.

alter table public.halaqa_grades
  add column if not exists session_roster_version_id uuid,
  add column if not exists session_roster_version_number bigint,
  add column if not exists session_halaqa_saturday date,
  add column if not exists session_group_id uuid,
  add column if not exists session_group_name text,
  add column if not exists session_primary_teacher_id uuid,
  add column if not exists session_primary_teacher_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'halaqa_grades_session_version_group_fk'
      and conrelid = 'public.halaqa_grades'::regclass
  ) then
    alter table public.halaqa_grades
      add constraint halaqa_grades_session_version_group_fk
      foreign key (session_roster_version_id, session_group_id)
      references public.session_roster_version_groups(version_id, group_id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'halaqa_grades_session_identity_check'
      and conrelid = 'public.halaqa_grades'::regclass
  ) then
    alter table public.halaqa_grades
      add constraint halaqa_grades_session_identity_check
      check (
        (
          session_roster_version_id is null
          and session_roster_version_number is null
          and session_halaqa_saturday is null
          and session_group_id is null
          and session_group_name is null
          and session_primary_teacher_id is null
          and session_primary_teacher_name is null
        )
        or (
          session_roster_version_id is not null
          and session_roster_version_number is not null
          and session_halaqa_saturday is not null
          and session_group_id is not null
          and session_group_name is not null
          and session_primary_teacher_id is not null
          and session_primary_teacher_name is not null
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'halaqa_grades_session_version_number_check'
      and conrelid = 'public.halaqa_grades'::regclass
  ) then
    alter table public.halaqa_grades
      add constraint halaqa_grades_session_version_number_check
      check (session_roster_version_number is null or session_roster_version_number > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'halaqa_grades_session_saturday_check'
      and conrelid = 'public.halaqa_grades'::regclass
  ) then
    alter table public.halaqa_grades
      add constraint halaqa_grades_session_saturday_check
      check (
        session_halaqa_saturday is null
        or session_halaqa_saturday = week_start + 6
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'halaqa_grades_session_group_name_check'
      and conrelid = 'public.halaqa_grades'::regclass
  ) then
    alter table public.halaqa_grades
      add constraint halaqa_grades_session_group_name_check
      check (session_group_name is null or char_length(btrim(session_group_name)) > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'halaqa_grades_session_primary_teacher_name_check'
      and conrelid = 'public.halaqa_grades'::regclass
  ) then
    alter table public.halaqa_grades
      add constraint halaqa_grades_session_primary_teacher_name_check
      check (session_primary_teacher_name is null or char_length(btrim(session_primary_teacher_name)) > 0);
  end if;
end;
$$;

create index if not exists halaqa_grades_session_scope_idx
  on public.halaqa_grades(session_roster_version_id, session_group_id, week_start, student_id)
  where session_roster_version_id is not null;

-- The guard only validates its argument and raises on malformed input. Mark
-- it STABLE so read-only SECURITY DEFINER contracts can remain STABLE without
-- the database linter treating their validation call as a volatile side
-- effect.
alter function private.session_roster_assert_week(date) stable;

create or replace function private.teacher_session_current_version_id(
  input_cohort_id uuid,
  input_week_start date
)
returns uuid
language sql
stable
set search_path = ''
as $$
  select versions.id
  from public.session_roster_versions as versions
  where versions.cohort_id = input_cohort_id
    and versions.week_start = input_week_start
  order by versions.version_number desc
  limit 1;
$$;

create or replace function private.raw_teacher_session_cohort_authorized(
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as actors
    join public.cohorts on cohorts.id = input_cohort_id
    join public.masajid on masajid.id = cohorts.masjid_id
    join public.halaqa_groups as groups on groups.cohort_id = cohorts.id
    join public.group_teacher_assignments as assignments
      on assignments.group_id = groups.id
      and assignments.week_start = input_week_start
      and assignments.active = true
    where actors.id = input_actor_id
      and actors.role in ('teacher', 'admin')
      and actors.active = true
      and cohorts.active = true
      and masajid.active = true
      and private.raw_can_teacher_access_assignment(
        input_actor_id,
        assignments.group_id,
        input_week_start
      )
  );
$$;

create or replace function private.raw_teacher_session_version_authorized(
  input_actor_id uuid,
  input_version_id uuid,
  input_group_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.session_roster_versions as versions
    join public.session_roster_version_groups as groups
      on groups.version_id = versions.id
      and groups.group_id = input_group_id
    where versions.id = input_version_id
      and versions.week_start = input_week_start
      and private.teacher_session_current_version_id(versions.cohort_id, versions.week_start) = versions.id
      and private.raw_teacher_session_cohort_authorized(
        input_actor_id,
        versions.cohort_id,
        versions.week_start
      )
  );
$$;

create or replace function private.raw_teacher_session_student_authorized(
  input_actor_id uuid,
  input_version_id uuid,
  input_group_id uuid,
  input_student_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.raw_teacher_session_version_authorized(
    input_actor_id,
    input_version_id,
    input_group_id,
    input_week_start
  )
  and exists (
    select 1
    from public.session_roster_version_students as students
    where students.version_id = input_version_id
      and students.session_group_id = input_group_id
      and students.student_id = input_student_id
  );
$$;

create or replace function private.raw_teacher_session_student_any_scope(
  input_actor_id uuid,
  input_student_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.session_roster_versions as versions
    join public.session_roster_version_students as students
      on students.version_id = versions.id
      and students.student_id = input_student_id
    where versions.week_start = input_week_start
      and private.teacher_session_current_version_id(versions.cohort_id, versions.week_start) = versions.id
      and private.raw_teacher_session_cohort_authorized(
        input_actor_id,
        versions.cohort_id,
        versions.week_start
      )
  );
$$;

-- Admin correction paths must be able to preserve a session grade's exact
-- historical snapshot even after permanent membership changes. This helper
-- validates the stored identity without granting teacher access and does not
-- require the version to remain current.
create or replace function private.raw_teacher_session_grade_snapshot_matches(
  input_student_id uuid,
  input_week_start date,
  input_version_id uuid,
  input_session_group_id uuid,
  input_masjid_id uuid,
  input_cohort_id uuid,
  input_halaqa_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.session_roster_versions as versions
    join public.session_roster_version_groups as groups
      on groups.version_id = versions.id
      and groups.group_id = input_session_group_id
    join public.session_roster_version_students as students
      on students.version_id = versions.id
      and students.session_group_id = groups.group_id
      and students.student_id = input_student_id
    where versions.id = input_version_id
      and versions.week_start = input_week_start
      and versions.masjid_id = input_masjid_id
      and versions.cohort_id = input_cohort_id
      and groups.group_id = input_halaqa_group_id
  );
$$;

create or replace function public.teacher_session_plan_scope_matches(
  input_student_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_teacher_session_student_any_scope(
    (select auth.uid()),
    input_student_id,
    input_week_start
  );
$$;

create or replace function public.teacher_session_grade_scope_matches(
  input_student_id uuid,
  input_week_start date,
  input_version_id uuid,
  input_session_group_id uuid,
  input_masjid_id uuid,
  input_cohort_id uuid,
  input_halaqa_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.session_roster_versions as versions
    join public.session_roster_version_groups as groups
      on groups.version_id = versions.id
      and groups.group_id = input_session_group_id
    join public.session_roster_version_students as students
      on students.version_id = versions.id
      and students.session_group_id = groups.group_id
      and students.student_id = input_student_id
    where versions.id = input_version_id
      and versions.week_start = input_week_start
      and versions.masjid_id = input_masjid_id
      and versions.cohort_id = input_cohort_id
      and groups.group_id = input_halaqa_group_id
      and private.teacher_session_current_version_id(versions.cohort_id, versions.week_start) = versions.id
      and private.raw_teacher_session_cohort_authorized(
        (select auth.uid()),
        versions.cohort_id,
        versions.week_start
      )
  );
$$;

create or replace function public.teacher_session_grade_row_visible(
  input_student_id uuid,
  input_week_start date,
  input_version_id uuid,
  input_session_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when input_version_id is null then private.raw_teacher_session_student_any_scope(
      (select auth.uid()),
      input_student_id,
      input_week_start
    )
    else private.raw_teacher_session_student_authorized(
      (select auth.uid()),
      input_version_id,
      input_session_group_id,
      input_student_id,
      input_week_start
    )
  end;
$$;

-- A session-backed grade always stores the exact published snapshot identity.
-- The trigger also runs for service-role writes, so a trusted client cannot
-- accidentally create a forged cross-version snapshot.
create or replace function private.enforce_halaqa_grade_session_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.session_roster_versions%rowtype;
  group_row public.session_roster_version_groups%rowtype;
begin
  if new.session_roster_version_id is null
    and new.session_roster_version_number is null
    and new.session_halaqa_saturday is null
    and new.session_group_id is null
    and new.session_group_name is null
    and new.session_primary_teacher_id is null
    and new.session_primary_teacher_name is null then
    if tg_op = 'UPDATE' and old.session_roster_version_id is not null then
      raise exception using errcode = 'PT412', message = 'teacher_session_grade_snapshot_cannot_be_cleared';
    end if;
    return new;
  end if;

  if new.session_roster_version_id is null
    or new.session_group_id is null then
    raise exception using errcode = '23514', message = 'teacher_session_grade_snapshot_incomplete';
  end if;

  select versions.*
  into version_row
  from public.session_roster_versions as versions
  where versions.id = new.session_roster_version_id;

  select groups.*
  into group_row
  from public.session_roster_version_groups as groups
  where groups.version_id = new.session_roster_version_id
    and groups.group_id = new.session_group_id;

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

  if not exists (
    select 1
    from public.session_roster_version_students as students
    where students.version_id = version_row.id
      and students.session_group_id = group_row.group_id
      and students.student_id = new.student_id
  ) then
    raise exception using errcode = '42501', message = 'teacher_session_grade_student_not_in_published_roster';
  end if;

  if (new.masjid_id is not null and new.masjid_id is distinct from version_row.masjid_id)
    or (new.cohort_id is not null and new.cohort_id is distinct from version_row.cohort_id)
    or (new.halaqa_group_id is not null and new.halaqa_group_id is distinct from group_row.group_id)
    or (new.session_roster_version_number is not null and new.session_roster_version_number is distinct from version_row.version_number)
    or (new.session_halaqa_saturday is not null and new.session_halaqa_saturday is distinct from version_row.halaqa_saturday)
    or (new.session_group_name is not null and new.session_group_name is distinct from group_row.group_name)
    or (new.session_primary_teacher_id is not null and new.session_primary_teacher_id is distinct from group_row.primary_teacher_id)
    or (new.session_primary_teacher_name is not null and new.session_primary_teacher_name is distinct from group_row.primary_teacher_name) then
    raise exception using errcode = '23514', message = 'teacher_session_grade_snapshot_mismatch';
  end if;

  new.masjid_id := version_row.masjid_id;
  new.cohort_id := version_row.cohort_id;
  new.halaqa_group_id := group_row.group_id;
  new.session_roster_version_number := version_row.version_number;
  new.session_halaqa_saturday := version_row.halaqa_saturday;
  new.session_group_name := group_row.group_name;
  new.session_primary_teacher_id := group_row.primary_teacher_id;
  new.session_primary_teacher_name := group_row.primary_teacher_name;

  return new;
end;
$$;

drop trigger if exists enforce_halaqa_grade_session_snapshot_trigger on public.halaqa_grades;
create trigger enforce_halaqa_grade_session_snapshot_trigger
  before insert or update on public.halaqa_grades
  for each row execute function private.enforce_halaqa_grade_session_snapshot();

-- Preserve the historical permanent-placement snapshot for legacy/admin
-- grades, but do not overwrite the exact session placement filled above.
create or replace function public.set_halaqa_grade_scope_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  scope_group_id uuid;
  scope_cohort_id uuid;
  scope_masjid_id uuid;
begin
  if new.session_roster_version_id is not null then
    return new;
  end if;

  select resolved.group_id, resolved.cohort_id, resolved.masjid_id
  into scope_group_id, scope_cohort_id, scope_masjid_id
  from private.raw_student_scope_for_grade_week(new.student_id, new.week_start) as resolved;

  if scope_group_id is null or scope_cohort_id is null or scope_masjid_id is null then
    raise exception using errcode = '23514', message = 'Exact grade scope is required.';
  end if;

  if (new.halaqa_group_id is not null and new.halaqa_group_id <> scope_group_id)
    or (new.cohort_id is not null and new.cohort_id <> scope_cohort_id)
    or (new.masjid_id is not null and new.masjid_id <> scope_masjid_id) then
    raise exception using errcode = '23514', message = 'Grade scope must match the exact historical placement.';
  end if;

  new.halaqa_group_id := scope_group_id;
  new.cohort_id := scope_cohort_id;
  new.masjid_id := scope_masjid_id;
  return new;
end;
$$;

create or replace function public.can_grade_student_for_week(
  input_student_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as target
    where target.id = input_student_id
      and target.role = 'student'
      and target.active = true
  )
  and (
    private.raw_is_active_super_admin((select auth.uid()))
    or private.raw_is_admin_for_masjid(
      (select auth.uid()),
      private.raw_student_masjid_for_week(input_student_id, input_week_start),
      public.current_toronto_civil_date()
    )
    or private.raw_can_teacher_access_assignment(
      (select auth.uid()),
      private.raw_student_group_for_week(input_student_id, input_week_start),
      input_week_start
    )
    or private.raw_teacher_session_student_any_scope(
      (select auth.uid()),
      input_student_id,
      input_week_start
    )
  );
$$;

-- Read-only cohort/week capability. The assigned group IDs are an explicit
-- presentation hint and never a filter for the published group rows.
create or replace function public.teacher_session_authorized_scopes(input_week_start date)
returns table (
  masjid_id uuid,
  masjid_name text,
  cohort_id uuid,
  cohort_name text,
  cohort_kind text,
  week_start date,
  halaqa_saturday date,
  publication_version_id uuid,
  publication_version_number bigint,
  publication_published_at timestamptz,
  publication_published_by uuid,
  assigned_group_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.session_roster_assert_week(input_week_start);

  return query
  select
    cohorts.masjid_id,
    masajid.name,
    cohorts.id,
    cohorts.name,
    cohorts.kind,
    input_week_start,
    public.halaqa_saturday_for_week(input_week_start),
    current_versions.id,
    current_versions.version_number,
    current_versions.published_at,
    current_versions.published_by,
    coalesce((
      select array_agg(assignments.group_id order by groups.sort_order, groups.name, groups.id)
      from public.group_teacher_assignments as assignments
      join public.halaqa_groups as groups on groups.id = assignments.group_id
      where assignments.teacher_id = (select auth.uid())
        and assignments.week_start = input_week_start
        and assignments.active = true
        and groups.cohort_id = cohorts.id
        and private.raw_can_teacher_access_assignment(
          (select auth.uid()), assignments.group_id, input_week_start
        )
    ), '{}'::uuid[])
  from public.cohorts
  join public.masajid on masajid.id = cohorts.masjid_id
  left join lateral (
    select versions.*
    from public.session_roster_versions as versions
    where versions.cohort_id = cohorts.id
      and versions.week_start = input_week_start
    order by versions.version_number desc
    limit 1
  ) as current_versions on true
  where private.raw_teacher_session_cohort_authorized(
    (select auth.uid()), cohorts.id, input_week_start
  )
  order by masajid.name, cohorts.sort_order, cohorts.name, cohorts.id;
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
    (select auth.uid()), input_cohort_id, input_week_start
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
          'group_name', metrics.group_name,
          'group_sort_order', metrics.group_sort_order,
          'primary_teacher_id', metrics.primary_teacher_id,
          'primary_teacher_name', metrics.primary_teacher_name,
          'is_assigned_group', metrics.is_assigned_group,
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
          groups.group_id,
          groups.group_name,
          groups.group_sort_order,
          groups.primary_teacher_id,
          groups.primary_teacher_name,
          (groups.group_id = any(coalesce((
            select array_agg(assignments.group_id)
            from public.group_teacher_assignments as assignments
            where assignments.teacher_id = (select auth.uid())
              and assignments.group_id = groups.group_id
              and assignments.week_start = input_week_start
              and assignments.active = true
              and private.raw_can_teacher_access_assignment(
                (select auth.uid()), assignments.group_id, input_week_start
              )
          ), '{}'::uuid[]))) as is_assigned_group,
          count(distinct students.student_id)::integer as roster_count,
          count(distinct plans.student_id)::integer as weekly_plan_count,
          count(distinct grades.student_id)::integer as graded_count
        from public.session_roster_version_groups as groups
        left join public.session_roster_version_students as students
          on students.version_id = groups.version_id
          and students.session_group_id = groups.group_id
        left join public.weekly_plans as plans
          on plans.student_id = students.student_id
          and plans.week_start = input_week_start
        left join public.halaqa_grades as grades
          on grades.student_id = students.student_id
          and grades.week_start = input_week_start
          and grades.session_roster_version_id = version_row.id
          and grades.session_group_id = groups.group_id
        where groups.version_id = version_row.id
        group by
          groups.group_id,
          groups.group_name,
          groups.group_sort_order,
          groups.primary_teacher_id,
          groups.primary_teacher_name
      ) as metrics
    ), '[]'::jsonb) end
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
  group_row public.session_roster_version_groups%rowtype;
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

  select groups.*
  into group_row
  from public.session_roster_version_groups as groups
  where groups.version_id = input_version_id
    and groups.group_id = input_group_id;

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
          'session_group_id', students.session_group_id,
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
            'session_group_id', grades.session_group_id
          ) end
        ) order by students.placement_order, students.student_name, students.student_id
      )
      from public.session_roster_version_students as students
      left join public.halaqa_grades as grades
        on grades.student_id = students.student_id
        and grades.week_start = input_week_start
      where students.version_id = input_version_id
        and students.session_group_id = input_group_id
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
    students.session_group_id,
    students.placement_order,
    groups.group_name,
    groups.group_sort_order,
    groups.primary_teacher_id,
    groups.primary_teacher_name
  into context_row
  from public.session_roster_versions as versions
  join public.session_roster_version_students as students on students.version_id = versions.id
  join public.session_roster_version_groups as groups
    on groups.version_id = students.version_id
    and groups.group_id = students.session_group_id
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
      'placement_order', context_row.placement_order
    ),
    'group', jsonb_build_object(
      'group_id', context_row.session_group_id,
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

create or replace function public.get_teacher_session_checklist_details(
  input_version_id uuid,
  input_group_id uuid,
  input_student_id uuid,
  input_week_start date,
  input_checklist_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  checkin_row record;
  item_count integer := 0;
  completed_count integer := 0;
  record_state text;
begin
  perform private.session_roster_assert_week(input_week_start);

  if input_checklist_date is null
    or input_checklist_date < input_week_start
    or input_checklist_date > input_week_start + 6 then
    raise exception using errcode = '22023', message = 'teacher_session_checklist_date_out_of_week';
  end if;

  if not private.raw_teacher_session_student_authorized(
    (select auth.uid()),
    input_version_id,
    input_group_id,
    input_student_id,
    input_week_start
  ) then
    raise exception using errcode = '42501', message = 'teacher_session_checklist_unauthorized';
  end if;

  select
    checkins.id,
    checkins.completed,
    checkins.earned_weight,
    checkins.total_weight,
    checkins.daily_score
  into checkin_row
  from public.checkins
  where checkins.student_id = input_student_id
    and checkins.date = input_checklist_date;

  if checkin_row.id is not null then
    select count(*)::integer,
           count(*) filter (where items.completed)::integer
    into item_count, completed_count
    from public.checkin_items as items
    where items.checkin_id = checkin_row.id
      and items.student_id = input_student_id
      and items.date = input_checklist_date;

    if checkin_row.completed = false or item_count = 0 or completed_count = 0 then
      record_state := 'in_progress';
    elsif completed_count = item_count then
      record_state := 'complete';
    else
      record_state := 'partial';
    end if;
  else
    record_state := 'missing';
  end if;

  return jsonb_build_object(
    'contract_version', 1,
    'checklist_date', input_checklist_date,
    'tracker_week_start', input_week_start,
    'record_state', record_state,
    'stored_daily_totals', case when checkin_row.id is null then null else jsonb_build_object(
      'earned_weight', checkin_row.earned_weight,
      'total_weight', checkin_row.total_weight,
      'daily_score', checkin_row.daily_score
    ) end,
    'items', case when checkin_row.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'saved_item_label', items.task_label,
          'completed', items.completed,
          'weight', items.weight,
          'earned_points', case when items.completed then items.weight else 0 end
        ) order by items.id
      )
      from public.checkin_items as items
      where items.checkin_id = checkin_row.id
        and items.student_id = input_student_id
        and items.date = input_checklist_date
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
  group_row public.session_roster_version_groups%rowtype;
  existing_grade public.halaqa_grades%rowtype;
  now_at timestamptz := statement_timestamp();
  normalized_notes text := nullif(btrim(coalesce(input_notes, '')), '');
  saved_grade public.halaqa_grades%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'teacher_session_grade_authentication_required';
  end if;

  perform private.session_roster_assert_week(input_week_start);

  -- Publication and grade writes share this lock. A revision cannot become
  -- current between the authorization check and the saved snapshot.
  select versions.*
  into version_row
  from public.session_roster_versions as versions
  where versions.id = input_version_id;

  if version_row.id is null then
    raise exception using errcode = 'P0002', message = 'teacher_session_grade_published_roster_not_found';
  end if;

  perform private.session_roster_lock(version_row.cohort_id, input_week_start);

  select versions.*
  into version_row
  from public.session_roster_versions as versions
  where versions.id = input_version_id;

  select groups.*
  into group_row
  from public.session_roster_version_groups as groups
  where groups.version_id = input_version_id
    and groups.group_id = input_group_id;

  if version_row.id is null or group_row.group_id is null then
    raise exception using errcode = 'P0002', message = 'teacher_session_grade_published_group_not_found';
  end if;

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

  if input_attended = true
    and (input_recitation_points is null or input_recitation_points < 10 or input_recitation_points > 50) then
    raise exception using errcode = '22023', message = 'teacher_session_grade_invalid_recitation_points';
  end if;

  if input_attended = false and coalesce(input_recitation_points, 0) <> 0 then
    raise exception using errcode = '22023', message = 'teacher_session_grade_absent_points_mismatch';
  end if;

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
      group_row.group_id,
      input_version_id,
      version_row.version_number,
      version_row.halaqa_saturday,
      group_row.group_id,
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
        halaqa_group_id = group_row.group_id,
        session_roster_version_id = input_version_id,
        session_roster_version_number = version_row.version_number,
        session_halaqa_saturday = version_row.halaqa_saturday,
        session_group_id = group_row.group_id,
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
      'session_group_name', saved_grade.session_group_name,
      'session_primary_teacher_id', saved_grade.session_primary_teacher_id,
      'session_primary_teacher_name', saved_grade.session_primary_teacher_name
    )
  );
end;
$$;

create or replace function public.can_teacher_read_weekly_plan_path(input_file_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parsed_student_id uuid;
  parsed_week_start date;
begin
  if input_file_path !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[^/]+$' then
    return false;
  end if;

  begin
    parsed_student_id := split_part(input_file_path, '/', 1)::uuid;
    parsed_week_start := split_part(input_file_path, '/', 2)::date;
  exception
    when invalid_text_representation or datetime_field_overflow then
      return false;
  end;

  return exists (
    select 1
    from public.weekly_plans as plans
    where plans.student_id = parsed_student_id
      and plans.week_start = parsed_week_start
      and plans.file_path = input_file_path
  )
  and private.raw_teacher_session_student_any_scope(
    (select auth.uid()),
    parsed_student_id,
    parsed_week_start
  );
end;
$$;

-- The direct metadata policies use the same published-snapshot boundary as
-- the signed Storage link. Admin reads remain masjid-scoped; teacher reads
-- never fall back to the permanent group assignment.
alter policy "Admins can read all weekly plans"
  on public.weekly_plans
  to authenticated
  using (
    public.is_admin_for_masjid(masjid_id)
    or public.teacher_session_plan_scope_matches(student_id, week_start)
  );

alter policy "Admins can read all halaqa grades"
  on public.halaqa_grades
  to authenticated
  using (
    public.is_admin_for_masjid(masjid_id)
    or public.teacher_session_grade_row_visible(
      student_id,
      week_start,
      session_roster_version_id,
      session_group_id
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
          or private.raw_teacher_session_grade_snapshot_matches(
            student_id,
            week_start,
            session_roster_version_id,
            session_group_id,
            masjid_id,
            cohort_id,
            halaqa_group_id
          )
        )
      )
      or public.teacher_session_grade_scope_matches(
        student_id,
        week_start,
        session_roster_version_id,
        session_group_id,
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
    or public.teacher_session_grade_row_visible(
      student_id,
      week_start,
      session_roster_version_id,
      session_group_id
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
          or private.raw_teacher_session_grade_snapshot_matches(
            student_id,
            week_start,
            session_roster_version_id,
            session_group_id,
            masjid_id,
            cohort_id,
            halaqa_group_id
          )
        )
      )
      or public.teacher_session_grade_scope_matches(
        student_id,
        week_start,
        session_roster_version_id,
        session_group_id,
        masjid_id,
        cohort_id,
        halaqa_group_id
      )
    )
  );

revoke all on function private.teacher_session_current_version_id(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_teacher_session_cohort_authorized(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_teacher_session_version_authorized(uuid, uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_teacher_session_student_authorized(uuid, uuid, uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_teacher_session_student_any_scope(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_teacher_session_grade_snapshot_matches(uuid, date, uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_halaqa_grade_session_snapshot()
  from public, anon, authenticated, service_role;

revoke all on function public.teacher_session_plan_scope_matches(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.teacher_session_grade_scope_matches(uuid, date, uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.teacher_session_grade_row_visible(uuid, date, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.teacher_session_authorized_scopes(date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_teacher_session_dashboard(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_teacher_session_group_roster(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_teacher_session_student_context(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_teacher_session_checklist_details(uuid, uuid, uuid, date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.save_teacher_session_halaqa_grade(uuid, uuid, uuid, date, boolean, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.can_teacher_read_weekly_plan_path(text)
  from public, anon, authenticated, service_role;

grant execute on function public.teacher_session_plan_scope_matches(uuid, date)
  to authenticated;
grant execute on function public.teacher_session_grade_scope_matches(uuid, date, uuid, uuid, uuid, uuid, uuid)
  to authenticated;
grant execute on function public.teacher_session_grade_row_visible(uuid, date, uuid, uuid)
  to authenticated;
grant execute on function public.teacher_session_authorized_scopes(date)
  to authenticated;
grant execute on function public.get_teacher_session_dashboard(uuid, date)
  to authenticated;
grant execute on function public.get_teacher_session_group_roster(uuid, uuid, date)
  to authenticated;
grant execute on function public.get_teacher_session_student_context(uuid, date)
  to authenticated;
grant execute on function public.get_teacher_session_checklist_details(uuid, uuid, uuid, date, date)
  to authenticated;
grant execute on function public.save_teacher_session_halaqa_grade(uuid, uuid, uuid, date, boolean, integer, text)
  to authenticated;
grant execute on function public.can_teacher_read_weekly_plan_path(text)
  to authenticated;

-- Keep the explicit SECURITY DEFINER inventory current. The list is copied
-- from the session-roster foundation and extended only with this migration's
-- guarded public RPCs/helpers and trigger.
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
    'public.get_teacher_session_checklist_details(uuid,uuid,uuid,date,date)',
    'public.get_teacher_session_dashboard(uuid,date)',
    'public.get_teacher_session_group_roster(uuid,uuid,date)',
    'public.get_teacher_session_student_context(uuid,date)',
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
    'public.teacher_session_grade_scope_matches(uuid,date,uuid,uuid,uuid,uuid,uuid)',
    'public.teacher_session_plan_scope_matches(uuid,date)',
    'public.validate_accountability_obligation_scope()',
    'private.apply_super_admin_masjid_staff_grant_once(uuid,uuid,uuid,uuid,text,date,jsonb)',
    'private.assert_teacher_assignment_removal_safe(uuid,date,uuid)',
    'private.enforce_halaqa_grade_session_snapshot()',
    'private.raw_teacher_session_grade_snapshot_matches(uuid,date,uuid,uuid,uuid,uuid,uuid)',
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
