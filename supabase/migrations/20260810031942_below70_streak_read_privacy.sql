-- Privacy forward-fix for the typed below-70 streak read contracts.
-- Students retain their own active-streak read, but never receive reset
-- ledger metadata. Batch reads are an administrative operation only.

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
         case when actor_role = 'student' then null::uuid else snapshot.latest_reset_id end,
         case when actor_role = 'student' then null::uuid else snapshot.latest_reset_masjid_id end,
         case when actor_role = 'student' then null::uuid else snapshot.latest_reset_cohort_id end,
         case when actor_role = 'student' then null::uuid else snapshot.latest_reset_group_id end,
         case when actor_role = 'student' then null::date else snapshot.latest_reset_effective_through_week_start end,
         case when actor_role = 'student' then null::integer else snapshot.latest_reset_previous_streak_length end,
         case when actor_role = 'student' then null::boolean else snapshot.latest_reset_passed_test_confirmation end,
         case when actor_role = 'student' then null::text else snapshot.latest_reset_admin_note end,
         case when actor_role = 'student' then null::uuid else snapshot.latest_reset_actor_id end,
         case when actor_role = 'student' then null::timestamptz else snapshot.latest_reset_created_at end;
end;
$$;

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
    or actor_role not in ('admin', 'super_admin') then
    raise exception using errcode = '42501', message = 'Administrative below-70 streak read access is required.';
  end if;

  if requested_through_week_start is null
    or requested_through_week_start <> public.week_start_for_date(requested_through_week_start)
    or requested_through_week_start + 6 >= public.current_effective_date() then
    raise exception using errcode = '22023', message = 'The streak read week must be a completed Sunday tracker week.';
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
         snapshot.latest_reset_admin_note,
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

-- Preserve the existing narrow authenticated execute contract while making
-- the function privilege posture explicit in this forward-fix migration.
revoke all on function public.get_student_below70_streak(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_students_below70_streaks(uuid[], date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_student_below70_streak(uuid, date) to authenticated;
grant execute on function public.get_students_below70_streaks(uuid[], date) to authenticated;

alter function public.get_student_below70_streak(uuid, date) set search_path = '';
alter function public.get_students_below70_streaks(uuid[], date) set search_path = '';
