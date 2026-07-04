-- Allow admins with active teacher staff memberships to participate in teacher rotation.
-- The profile role remains the primary app route role; staff_role='teacher' is the
-- rotation eligibility signal.

create or replace function public.is_rotation_teacher_for_masjid_week(
  input_profile_id uuid,
  input_masjid_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    join public.masjid_staff_memberships
      on masjid_staff_memberships.profile_id = profiles.id
    where profiles.id = input_profile_id
      and profiles.role in ('teacher', 'admin', 'super_admin')
      and profiles.active = true
      and masjid_staff_memberships.masjid_id = input_masjid_id
      and masjid_staff_memberships.staff_role = 'teacher'
      and masjid_staff_memberships.active = true
      and masjid_staff_memberships.starts_on <= input_week_start
      and (
        masjid_staff_memberships.ends_on is null
        or masjid_staff_memberships.ends_on >= input_week_start
      )
  );
$$;

revoke all on function public.is_rotation_teacher_for_masjid_week(uuid, uuid, date) from public;
grant execute on function public.is_rotation_teacher_for_masjid_week(uuid, uuid, date) to authenticated, service_role;

create or replace function public.teacher_rotation_row_scope_matches()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.cohorts
    where cohorts.id = new.cohort_id
      and cohorts.masjid_id = new.masjid_id
  ) then
    raise exception 'cohort_id must belong to masjid_id';
  end if;

  if tg_table_name = 'teacher_rotation_availability' then
    if not public.is_rotation_teacher_for_masjid_week(new.teacher_id, new.masjid_id, new.week_start) then
      raise exception 'teacher_id must be active teacher staff for masjid_id and week_start';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.student_weekly_teacher(
  input_student_id uuid,
  input_week_start date
)
returns table (
  teacher_id uuid,
  teacher_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select profiles.id, profiles.name
  from public.group_teacher_assignments
  join public.profiles on profiles.id = group_teacher_assignments.teacher_id
  where group_teacher_assignments.group_id = public.student_group_for_week(input_student_id, input_week_start)
    and group_teacher_assignments.week_start = input_week_start
    and group_teacher_assignments.active = true
    and profiles.active = true
    and public.is_rotation_teacher_for_masjid_week(
      profiles.id,
      public.group_masjid_id(group_teacher_assignments.group_id),
      input_week_start
    )
    and public.can_read_student_for_week(input_student_id, input_week_start)
  order by group_teacher_assignments.created_at desc
  limit 1;
$$;

revoke all on function public.student_weekly_teacher(uuid, date) from public;
grant execute on function public.student_weekly_teacher(uuid, date) to authenticated;

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
set search_path = public
as $$
declare
  cohort_masjid uuid;
  generated_run_id uuid;
  invalid_count integer;
  now_timestamp timestamptz := now();
begin
  select cohorts.masjid_id
  into cohort_masjid
  from public.cohorts
  where cohorts.id = input_cohort_id
    and cohorts.active = true;

  if cohort_masjid is null then
    raise exception 'Invalid active cohort.';
  end if;

  if input_week_start <> public.week_start_for_date(input_week_start) then
    raise exception 'week_start must be the tracker week start.';
  end if;

  if available_teacher_count < 0
    or group_count < 0
    or assigned_count < 0
    or warning_count < 0
    or assigned_count > available_teacher_count
    or assigned_count > group_count then
    raise exception 'Invalid rotation run counts.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where profiles.id = input_generated_by
      and profiles.active = true
      and (
        profiles.role = 'super_admin'
        or (
          profiles.role = 'admin'
          and exists (
            select 1
            from public.masjid_staff_memberships
            where masjid_staff_memberships.profile_id = input_generated_by
              and masjid_staff_memberships.masjid_id = cohort_masjid
              and masjid_staff_memberships.staff_role = 'admin'
              and masjid_staff_memberships.active = true
              and masjid_staff_memberships.starts_on <= public.current_effective_date()
              and (
                masjid_staff_memberships.ends_on is null
                or masjid_staff_memberships.ends_on >= public.current_effective_date()
              )
          )
        )
      )
  ) then
    raise exception 'generated_by is not an active admin for the cohort masjid.';
  end if;

  select count(*)
  into invalid_count
  from jsonb_to_recordset(membership_closes) as payload(id uuid, ends_on date)
  where payload.id is null
    or payload.ends_on is null
    or payload.ends_on <> input_week_start - 1
    or not exists (
      select 1
      from public.student_group_memberships
      join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
      where student_group_memberships.id = payload.id
        and halaqa_groups.cohort_id = input_cohort_id
    );

  if invalid_count > 0 then
    raise exception 'Invalid membership close rows.';
  end if;

  select count(*)
  into invalid_count
  from jsonb_to_recordset(membership_replaces) as payload(id uuid, student_id uuid, group_id uuid, starts_on date)
  where payload.id is null
    or payload.student_id is null
    or payload.group_id is null
    or payload.starts_on is null
    or payload.starts_on <> input_week_start
    or not exists (
      select 1
      from public.student_group_memberships
      join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
      where student_group_memberships.id = payload.id
        and student_group_memberships.student_id = payload.student_id
        and student_group_memberships.starts_on = payload.starts_on
        and halaqa_groups.cohort_id = input_cohort_id
    )
    or not exists (
      select 1
      from public.halaqa_groups
      where halaqa_groups.id = payload.group_id
        and halaqa_groups.cohort_id = input_cohort_id
        and halaqa_groups.active = true
    );

  if invalid_count > 0 then
    raise exception 'Invalid membership replace rows.';
  end if;

  select count(*)
  into invalid_count
  from jsonb_to_recordset(membership_inserts) as payload(student_id uuid, group_id uuid, starts_on date)
  where payload.student_id is null
    or payload.group_id is null
    or payload.starts_on is null
    or payload.starts_on <> input_week_start
    or not exists (
      select 1
      from public.profiles
      where profiles.id = payload.student_id
        and profiles.role = 'student'
        and profiles.active = true
    )
    or not exists (
      select 1
      from public.halaqa_groups
      where halaqa_groups.id = payload.group_id
        and halaqa_groups.cohort_id = input_cohort_id
        and halaqa_groups.active = true
    );

  if invalid_count > 0 then
    raise exception 'Invalid membership insert rows.';
  end if;

  select count(*)
  into invalid_count
  from jsonb_to_recordset(assignment_upserts) as payload(group_id uuid, teacher_id uuid, week_start date)
  where payload.group_id is null
    or payload.teacher_id is null
    or payload.week_start is null
    or payload.week_start <> input_week_start
    or not exists (
      select 1
      from public.halaqa_groups
      where halaqa_groups.id = payload.group_id
        and halaqa_groups.cohort_id = input_cohort_id
        and halaqa_groups.active = true
    )
    or not public.is_rotation_teacher_for_masjid_week(payload.teacher_id, cohort_masjid, input_week_start);

  if invalid_count > 0 then
    raise exception 'Invalid assignment upsert rows.';
  end if;

  select count(*)
  into invalid_count
  from jsonb_to_recordset(assignment_deactivations) as payload(group_id uuid, week_start date)
  where payload.group_id is null
    or payload.week_start is null
    or payload.week_start <> input_week_start
    or not exists (
      select 1
      from public.halaqa_groups
      where halaqa_groups.id = payload.group_id
        and halaqa_groups.cohort_id = input_cohort_id
        and halaqa_groups.active = true
    );

  if invalid_count > 0 then
    raise exception 'Invalid assignment deactivation rows.';
  end if;

  update public.student_group_memberships
  set ends_on = payload.ends_on,
      assigned_by = input_generated_by,
      updated_at = now_timestamp
  from jsonb_to_recordset(membership_closes) as payload(id uuid, ends_on date)
  where student_group_memberships.id = payload.id;

  update public.student_group_memberships
  set group_id = payload.group_id,
      assigned_by = input_generated_by,
      updated_at = now_timestamp
  from jsonb_to_recordset(membership_replaces) as payload(id uuid, student_id uuid, group_id uuid, starts_on date)
  where student_group_memberships.id = payload.id
    and student_group_memberships.student_id = payload.student_id
    and student_group_memberships.starts_on = payload.starts_on;

  insert into public.student_group_memberships (student_id, group_id, starts_on, assigned_by)
  select payload.student_id, payload.group_id, payload.starts_on, input_generated_by
  from jsonb_to_recordset(membership_inserts) as payload(student_id uuid, group_id uuid, starts_on date);

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
         input_generated_by,
         now_timestamp
  from jsonb_to_recordset(assignment_upserts) as payload(group_id uuid, teacher_id uuid, week_start date)
  on conflict (group_id, week_start) do update
  set teacher_id = excluded.teacher_id,
      active = true,
      assigned_by = excluded.assigned_by,
      updated_at = excluded.updated_at;

  update public.group_teacher_assignments
  set active = false,
      assigned_by = input_generated_by,
      updated_at = now_timestamp
  from jsonb_to_recordset(assignment_deactivations) as payload(group_id uuid, week_start date)
  where group_teacher_assignments.group_id = payload.group_id
    and group_teacher_assignments.week_start = payload.week_start;

  insert into public.teacher_rotation_runs (
    cohort_id,
    week_start,
    generated_by,
    available_teacher_count,
    group_count,
    assigned_count,
    warning_count
  )
  values (
    input_cohort_id,
    input_week_start,
    input_generated_by,
    available_teacher_count,
    group_count,
    assigned_count,
    warning_count
  )
  returning id into generated_run_id;

  return generated_run_id;
end;
$$;

revoke all on function public.apply_teacher_rotation_generation(
  uuid,
  date,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  integer,
  integer,
  integer,
  integer
) from public;

revoke execute on function public.apply_teacher_rotation_generation(
  uuid,
  date,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  integer,
  integer,
  integer,
  integer
) from anon, authenticated;

grant execute on function public.apply_teacher_rotation_generation(
  uuid,
  date,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  integer,
  integer,
  integer,
  integer
) to service_role;
