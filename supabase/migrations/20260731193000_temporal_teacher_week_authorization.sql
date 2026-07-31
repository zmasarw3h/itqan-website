-- Separate Toronto civil-date authorization from the 1:00 AM check-in clock.
-- `week_start` remains the canonical Sunday storage key; teacher eligibility
-- for that key is evaluated on the corresponding Saturday halaqa event date.

create or replace function public.current_toronto_civil_date()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone 'America/Toronto')::date;
$$;

create or replace function public.halaqa_saturday_for_week(input_week_start date)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if input_week_start is null
    or input_week_start <> public.week_start_for_date(input_week_start) then
    raise exception using
      errcode = '22023',
      message = 'input_week_start must be a Sunday tracker week start.';
  end if;

  return input_week_start + 6;
end;
$$;

-- This is the single authoritative eligibility rule for publishing rotation
-- data. It intentionally evaluates staff coverage on the Saturday halaqa
-- event, not the Sunday storage key or the request date.
create or replace function private.raw_teacher_has_halaqa_saturday_eligibility(
  input_actor_id uuid,
  input_masjid_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    join public.masjid_staff_memberships as memberships
      on memberships.profile_id = profiles.id
    join public.masajid on masajid.id = memberships.masjid_id
    where profiles.id = input_actor_id
      and profiles.role in ('teacher', 'admin', 'super_admin')
      and profiles.active = true
      and masajid.id = input_masjid_id
      and masajid.active = true
      and memberships.staff_role = 'teacher'
      and memberships.active = true
      and memberships.starts_on <= public.halaqa_saturday_for_week(input_week_start)
      and (
        memberships.ends_on is null
        or memberships.ends_on >= public.halaqa_saturday_for_week(input_week_start)
      )
  );
$$;

-- Retain the established helper name for callers that ask whether a teacher
-- may be scheduled. Operational access uses raw_can_teacher_access_assignment
-- below and is deliberately more restrictive after the event.
create or replace function private.raw_is_rotation_teacher_for_masjid_week(
  input_actor_id uuid,
  input_masjid_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.raw_teacher_has_halaqa_saturday_eligibility(
    input_actor_id,
    input_masjid_id,
    input_week_start
  );
$$;

-- Historical display proves only that this identity was assigned and covered
-- the relevant Saturday. It must not depend on a profile, hierarchy, or staff
-- row still being active today; it is not an authorization grant.
create or replace function private.raw_historical_teacher_assignment_is_valid(
  input_teacher_id uuid,
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
    from public.group_teacher_assignments as assignments
    join public.halaqa_groups as groups on groups.id = assignments.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
    join public.masjid_staff_memberships as staff
      on staff.profile_id = assignments.teacher_id
      and staff.masjid_id = cohorts.masjid_id
      and staff.staff_role = 'teacher'
    where assignments.teacher_id = input_teacher_id
      and assignments.group_id = input_group_id
      and assignments.week_start = input_week_start
      and assignments.active = true
      and staff.starts_on <= public.halaqa_saturday_for_week(input_week_start)
      and (
        staff.ends_on is null
        or staff.ends_on >= public.halaqa_saturday_for_week(input_week_start)
      )
  );
$$;

-- Request-time staff status is intentionally distinct from historical
-- Saturday coverage. In particular, a teacher offboarded on Saturday has no
-- operational access from the following Sunday onward.
create or replace function private.raw_has_current_active_teacher_staff_for_masjid(
  input_actor_id uuid,
  input_masjid_id uuid,
  input_request_date date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    join public.masjid_staff_memberships as staff
      on staff.profile_id = profiles.id
    join public.masajid on masajid.id = staff.masjid_id
    where profiles.id = input_actor_id
      and profiles.role in ('teacher', 'admin', 'super_admin')
      and profiles.active = true
      and masajid.id = input_masjid_id
      and masajid.active = true
      and staff.staff_role = 'teacher'
      and staff.active = true
      and staff.starts_on <= input_request_date
      and (staff.ends_on is null or staff.ends_on >= input_request_date)
  );
$$;

-- Historical student membership is display-only. Unlike the operational
-- membership helper, it intentionally survives a later hierarchy deactivation.
create or replace function private.raw_historical_student_group_for_week(
  input_student_id uuid,
  input_week_start date
)
returns uuid
language sql
stable
set search_path = ''
as $$
  select memberships.group_id
  from public.student_group_memberships as memberships
  where memberships.student_id = input_student_id
    and memberships.starts_on <= input_week_start
    and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
  order by memberships.starts_on desc, memberships.id desc
  limit 1;
$$;

create or replace function private.raw_can_teacher_access_assignment(
  input_actor_id uuid,
  input_group_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.current_toronto_civil_date() >= input_week_start
    and exists (
      select 1
      from public.group_teacher_assignments as assignments
      join public.halaqa_groups as groups on groups.id = assignments.group_id
      join public.cohorts on cohorts.id = groups.cohort_id
      join public.masajid on masajid.id = cohorts.masjid_id
      where assignments.teacher_id = input_actor_id
        and assignments.group_id = input_group_id
        and assignments.week_start = input_week_start
        and assignments.active = true
        and (
          (
            public.current_toronto_civil_date()
              <= public.halaqa_saturday_for_week(input_week_start)
            and groups.active = true
            and cohorts.active = true
            and masajid.active = true
            and private.raw_teacher_has_halaqa_saturday_eligibility(
              input_actor_id,
              masajid.id,
              input_week_start
            )
          )
          or (
            public.current_toronto_civil_date()
              > public.halaqa_saturday_for_week(input_week_start)
            and private.raw_historical_teacher_assignment_is_valid(
              input_actor_id,
              input_group_id,
              input_week_start
            )
            and private.raw_has_current_active_teacher_staff_for_masjid(
              input_actor_id,
              masajid.id,
              public.current_toronto_civil_date()
            )
          )
        )
    );
$$;

-- All legacy group/week authorization call sites are operational paths, so
-- they inherit the exact Sunday-through-Saturday and post-event rules above.
create or replace function private.raw_is_teacher_for_group_week(
  input_actor_id uuid,
  input_group_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.raw_can_teacher_access_assignment(
    input_actor_id,
    input_group_id,
    input_week_start
  );
$$;

-- Navigation may show an assigned teacher an upcoming or completed label,
-- but this predicate is never used for roster, plan, or grading access.
create or replace function private.raw_can_view_teacher_assignment_context(
  input_actor_id uuid,
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
    from public.group_teacher_assignments as assignments
    join public.halaqa_groups as groups on groups.id = assignments.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
    join public.masajid on masajid.id = cohorts.masjid_id
    where assignments.teacher_id = input_actor_id
      and assignments.group_id = input_group_id
      and assignments.week_start = input_week_start
      and assignments.active = true
      and private.raw_historical_teacher_assignment_is_valid(
        input_actor_id,
        input_group_id,
        input_week_start
      )
      and (
        public.halaqa_saturday_for_week(input_week_start) < public.current_toronto_civil_date()
        or (
          groups.active = true
          and cohorts.active = true
          and masajid.active = true
          and private.raw_teacher_has_halaqa_saturday_eligibility(
            input_actor_id,
            masajid.id,
            input_week_start
          )
        )
      )
  );
$$;

create or replace function private.raw_student_scope_for_grade_week(
  input_student_id uuid,
  input_week_start date
)
returns table (
  group_id uuid,
  cohort_id uuid,
  masjid_id uuid
)
language sql
stable
set search_path = ''
as $$
  select groups.id, cohorts.id, masajid.id
  from public.student_group_memberships as memberships
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  where memberships.student_id = input_student_id
    and memberships.starts_on <= input_week_start
    and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
    and (
      public.halaqa_saturday_for_week(input_week_start) < public.current_toronto_civil_date()
      or (groups.active = true and cohorts.active = true and masajid.active = true)
    )
  order by memberships.starts_on desc, memberships.id desc
  limit 1;
$$;

create or replace function private.raw_can_read_student_for_week(
  input_actor_id uuid,
  input_student_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (
      input_actor_id = input_student_id
      and exists (
        select 1 from public.profiles
        where profiles.id = input_actor_id
          and profiles.role = 'student'
          and profiles.active = true
      )
    )
    or private.raw_is_active_super_admin(input_actor_id)
    or private.raw_is_admin_for_masjid(
      input_actor_id,
      private.raw_student_masjid_for_week(input_student_id, input_week_start),
      public.current_toronto_civil_date()
    )
    or private.raw_is_teacher_for_group_week(
      input_actor_id,
      private.raw_student_group_for_week(input_student_id, input_week_start),
      input_week_start
    );
$$;

create or replace function public.is_admin_for_masjid(input_masjid_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_active_super_admin((select auth.uid()))
    or private.raw_is_admin_for_masjid(
      (select auth.uid()),
      input_masjid_id,
      public.current_toronto_civil_date()
    );
$$;

create or replace function public.is_staff_for_masjid(input_masjid_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_active_super_admin((select auth.uid()))
    or exists (
      select 1
      from public.profiles
      join public.masjid_staff_memberships as memberships
        on memberships.profile_id = profiles.id
      join public.masajid on masajid.id = memberships.masjid_id
      where profiles.id = (select auth.uid())
        and profiles.active = true
        and masajid.id = input_masjid_id
        and masajid.active = true
        and memberships.active = true
        and memberships.starts_on <= public.current_toronto_civil_date()
        and (
          memberships.ends_on is null
          or memberships.ends_on >= public.current_toronto_civil_date()
        )
    );
$$;

create or replace function public.is_rotation_teacher_for_masjid_week(
  input_profile_id uuid,
  input_masjid_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_rotation_teacher_for_masjid_week(
      input_profile_id, input_masjid_id, input_week_start
    )
    and (
      coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
      or input_profile_id = (select auth.uid())
      or private.raw_is_active_super_admin((select auth.uid()))
      or private.raw_is_admin_for_masjid(
        (select auth.uid()), input_masjid_id, public.current_toronto_civil_date()
      )
    );
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
      (
        select scope.group_id
        from private.raw_student_scope_for_grade_week(input_student_id, input_week_start) as scope
      ),
      input_week_start
    )
  );
$$;

create or replace function public.can_admin_manage_student_for_week(
  input_student_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_active_super_admin((select auth.uid()))
    or private.raw_is_admin_for_masjid(
      (select auth.uid()),
      private.raw_student_masjid_for_week(input_student_id, input_week_start),
      public.current_toronto_civil_date()
    );
$$;

create or replace function public.can_admin_manage_group_history(input_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_active_super_admin((select auth.uid()))
    or private.raw_is_admin_for_masjid(
      (select auth.uid()),
      private.raw_group_masjid_id(input_group_id),
      public.current_toronto_civil_date()
    );
$$;

create or replace function public.admin_students_for_week(input_week_start date)
returns table (
  student_id uuid,
  student_name text,
  student_email text,
  student_phone text,
  student_created_at timestamptz,
  masjid_id uuid,
  cohort_id uuid,
  cohort_kind text,
  cohort_name text,
  group_id uuid,
  group_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_tracker_week_start(input_week_start);

  return query
  select profiles.id,
         profiles.name,
         profiles.email,
         profiles.phone,
         profiles.created_at,
         cohorts.masjid_id,
         cohorts.id,
         cohorts.kind,
         cohorts.name,
         groups.id,
         groups.name
  from public.student_group_memberships as memberships
  join public.profiles on profiles.id = memberships.student_id
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  where memberships.starts_on <= input_week_start
    and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
    and profiles.role = 'student'
    and profiles.active = true
    and groups.active = true
    and cohorts.active = true
    and masajid.active = true
    and private.raw_is_admin_for_masjid(
      (select auth.uid()), cohorts.masjid_id, public.current_toronto_civil_date()
    )
  order by cohorts.sort_order asc, groups.sort_order asc, profiles.name asc;
end;
$$;

create or replace function public.can_read_operational_student_row(
  input_masjid_id uuid,
  input_group_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_active_super_admin((select auth.uid()))
    or private.raw_is_admin_for_masjid(
      (select auth.uid()), input_masjid_id, public.current_toronto_civil_date()
    )
    or private.raw_can_teacher_access_assignment(
      (select auth.uid()), input_group_id, input_week_start
    );
$$;

create or replace function public.teacher_assignment_contexts()
returns table (
  assignment_id uuid,
  group_id uuid,
  group_name text,
  cohort_id uuid,
  cohort_name text,
  cohort_kind text,
  masjid_id uuid,
  masjid_name text,
  week_start date,
  roster_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    assignments.id as assignment_id,
    groups.id as group_id,
    groups.name as group_name,
    cohorts.id as cohort_id,
    cohorts.name as cohort_name,
    cohorts.kind as cohort_kind,
    masajid.id as masjid_id,
    masajid.name as masjid_name,
    assignments.week_start,
    (
      select count(*)::integer
      from public.student_group_memberships as memberships
      join public.profiles as students on students.id = memberships.student_id
      where memberships.group_id = assignments.group_id
        and memberships.starts_on <= assignments.week_start
        and (memberships.ends_on is null or memberships.ends_on >= assignments.week_start)
        and students.role = 'student'
        and students.active = true
    ) as roster_count
  from public.group_teacher_assignments as assignments
  join public.halaqa_groups as groups on groups.id = assignments.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  where assignments.teacher_id = (select auth.uid())
    and assignments.active = true
    and private.raw_can_view_teacher_assignment_context(
      (select auth.uid()), assignments.group_id, assignments.week_start
    )
  order by assignments.week_start desc, masajid.name, cohorts.sort_order, groups.sort_order, groups.name;
$$;

create or replace function public.teacher_group_roster_context(
  input_group_id uuid,
  input_week_start date
)
returns table (
  student_id uuid,
  student_name text,
  daily_checkin_days integer,
  daily_points numeric,
  partner_rounds integer,
  partner_points integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_tracker_week_start(input_week_start);

  if (select auth.uid()) is null
    or not private.raw_can_teacher_access_assignment(
      (select auth.uid()), input_group_id, input_week_start
    ) then
    raise exception using
      errcode = '42501',
      message = 'The requested group is not assigned to this teacher for the selected week.';
  end if;

  return query
  select
    students.id,
    students.name,
    (
      select count(*)::integer
      from public.checkins
      where checkins.student_id = students.id
        and checkins.date between input_week_start and input_week_start + 6
    ),
    least(700::numeric, greatest(0::numeric, coalesce((
      select sum(coalesce(checkins.daily_score, 0))
      from public.checkins
      where checkins.student_id = students.id
        and checkins.date between input_week_start and input_week_start + 6
    ), 0)::numeric)),
    (
      select count(*)::integer
      from public.partner_recitations as recitations
      where recitations.student_id = students.id
        and recitations.week_start = input_week_start
    ),
    least(150, greatest(0, coalesce((
      select sum(recitations.points)
      from public.partner_recitations as recitations
      where recitations.student_id = students.id
        and recitations.week_start = input_week_start
    ), 0)::integer))
  from public.student_group_memberships as memberships
  join public.profiles as students on students.id = memberships.student_id
  where memberships.group_id = input_group_id
    and memberships.starts_on <= input_week_start
    and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
    and students.role = 'student'
    and students.active = true
  order by students.name, students.id;
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
  assigned_group_id uuid;
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

  select plans.halaqa_group_id
  into assigned_group_id
  from public.weekly_plans as plans
  where plans.student_id = parsed_student_id
    and plans.week_start = parsed_week_start
    and plans.file_path = input_file_path;

  return assigned_group_id is not null
    and private.raw_can_teacher_access_assignment(
      (select auth.uid()), assigned_group_id, parsed_week_start
    )
    and exists (
      select 1
      from public.student_group_memberships as memberships
      join public.profiles as students on students.id = memberships.student_id
      where memberships.student_id = parsed_student_id
        and memberships.group_id = assigned_group_id
        and memberships.starts_on <= parsed_week_start
        and (memberships.ends_on is null or memberships.ends_on >= parsed_week_start)
        and students.role = 'student'
        and students.active = true
    );
end;
$$;

create or replace function public.student_weekly_teacher_name(
  input_week_start date
)
returns table (teacher_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_tracker_week_start(input_week_start);

  return query
  select profiles.name
  from public.group_teacher_assignments as assignments
  join public.profiles on profiles.id = assignments.teacher_id
  where assignments.group_id = private.raw_historical_student_group_for_week(
      (select auth.uid()),
      input_week_start
    )
    and assignments.week_start = input_week_start
    and assignments.active = true
    and exists (
      select 1 from public.profiles as caller
      where caller.id = (select auth.uid())
        and caller.role = 'student'
        and caller.active = true
    )
    and private.raw_historical_teacher_assignment_is_valid(
      assignments.teacher_id,
      assignments.group_id,
      input_week_start
    )
  order by assignments.created_at desc
  limit 1;
end;
$$;

-- Retained for server-side and administrative callers. This projection is
-- deliberately display-only and uses the same historical identity proof as
-- the student-facing name RPC.
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
set search_path = ''
as $$
  select profiles.id, profiles.name
  from public.group_teacher_assignments as assignments
  join public.profiles on profiles.id = assignments.teacher_id
  where assignments.group_id = private.raw_historical_student_group_for_week(
      input_student_id,
      input_week_start
    )
    and assignments.week_start = input_week_start
    and assignments.active = true
    and private.raw_historical_teacher_assignment_is_valid(
      assignments.teacher_id,
      assignments.group_id,
      input_week_start
    )
    and (
      coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
      or (
        input_student_id = (select auth.uid())
        and exists (
          select 1
          from public.profiles as caller
          where caller.id = (select auth.uid())
            and caller.role = 'student'
            and caller.active = true
        )
      )
      or private.raw_is_active_super_admin((select auth.uid()))
      or exists (
        select 1
        from public.profiles as caller
        join public.masjid_staff_memberships as staff
          on staff.profile_id = caller.id
        join public.halaqa_groups as groups
          on groups.id = assignments.group_id
        join public.cohorts on cohorts.id = groups.cohort_id
        where caller.id = (select auth.uid())
          and caller.role = 'admin'
          and caller.active = true
          and staff.masjid_id = cohorts.masjid_id
          and staff.staff_role = 'admin'
          and staff.active = true
          and staff.starts_on <= public.current_toronto_civil_date()
          and (
            staff.ends_on is null
            or staff.ends_on >= public.current_toronto_civil_date()
          )
      )
    )
  order by assignments.created_at desc
  limit 1;
$$;

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
              and masjid_staff_memberships.starts_on <= public.current_toronto_civil_date()
              and (
                masjid_staff_memberships.ends_on is null
                or masjid_staff_memberships.ends_on >= public.current_toronto_civil_date()
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
    or not private.raw_teacher_has_halaqa_saturday_eligibility(
      payload.teacher_id,
      cohort_masjid,
      input_week_start
    );

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

-- Hierarchy reads are request-time access decisions, so they follow the
-- Toronto civil calendar rather than the check-in reset clock.
create or replace function public.student_current_group_id(input_student_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select public.student_group_for_week(
    input_student_id,
    public.week_start_for_date(public.current_toronto_civil_date())
  );
$$;

create or replace function public.can_read_masjid(input_masjid_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_active_super_admin((select auth.uid()))
    or (
      exists (
        select 1 from public.masajid
        where masajid.id = input_masjid_id and masajid.active = true
      )
      and (
        private.raw_is_admin_for_masjid(
          (select auth.uid()), input_masjid_id, public.current_toronto_civil_date()
        )
        or exists (
          select 1
          from public.student_group_memberships as memberships
          join public.halaqa_groups as groups on groups.id = memberships.group_id
          join public.cohorts on cohorts.id = groups.cohort_id
          join public.profiles on profiles.id = memberships.student_id
          where memberships.student_id = (select auth.uid())
            and profiles.role = 'student'
            and profiles.active = true
            and memberships.starts_on <= public.current_toronto_civil_date()
            and (memberships.ends_on is null or memberships.ends_on >= public.current_toronto_civil_date())
            and groups.active = true
            and cohorts.active = true
            and cohorts.masjid_id = input_masjid_id
        )
        or exists (
          select 1
          from public.group_teacher_assignments as assignments
          join public.halaqa_groups as groups on groups.id = assignments.group_id
          join public.cohorts on cohorts.id = groups.cohort_id
          where assignments.teacher_id = (select auth.uid())
            and assignments.active = true
            and assignments.week_start = public.week_start_for_date(public.current_toronto_civil_date())
            and groups.active = true
            and cohorts.active = true
            and cohorts.masjid_id = input_masjid_id
            and private.raw_can_teacher_access_assignment(
              (select auth.uid()), assignments.group_id, assignments.week_start
            )
        )
      )
    );
$$;

create or replace function public.can_read_cohort(input_cohort_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_active_super_admin((select auth.uid()))
    or (
      exists (
        select 1
        from public.cohorts
        join public.masajid on masajid.id = cohorts.masjid_id
        where cohorts.id = input_cohort_id
          and cohorts.active = true
          and masajid.active = true
      )
      and (
        private.raw_is_admin_for_masjid(
          (select auth.uid()),
          private.raw_cohort_masjid_id(input_cohort_id),
          public.current_toronto_civil_date()
        )
        or exists (
          select 1
          from public.student_group_memberships as memberships
          join public.halaqa_groups as groups on groups.id = memberships.group_id
          join public.profiles on profiles.id = memberships.student_id
          where memberships.student_id = (select auth.uid())
            and profiles.role = 'student'
            and profiles.active = true
            and memberships.starts_on <= public.current_toronto_civil_date()
            and (memberships.ends_on is null or memberships.ends_on >= public.current_toronto_civil_date())
            and groups.active = true
            and groups.cohort_id = input_cohort_id
        )
        or exists (
          select 1
          from public.group_teacher_assignments as assignments
          join public.halaqa_groups as groups on groups.id = assignments.group_id
          where assignments.teacher_id = (select auth.uid())
            and assignments.active = true
            and assignments.week_start = public.week_start_for_date(public.current_toronto_civil_date())
            and groups.active = true
            and groups.cohort_id = input_cohort_id
            and private.raw_can_teacher_access_assignment(
              (select auth.uid()), assignments.group_id, assignments.week_start
            )
        )
      )
    );
$$;

create or replace function public.can_read_group(input_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_active_super_admin((select auth.uid()))
    or (
      exists (
        select 1
        from public.halaqa_groups as groups
        join public.cohorts on cohorts.id = groups.cohort_id
        join public.masajid on masajid.id = cohorts.masjid_id
        where groups.id = input_group_id
          and groups.active = true
          and cohorts.active = true
          and masajid.active = true
      )
      and (
        private.raw_is_admin_for_masjid(
          (select auth.uid()),
          private.raw_group_masjid_id(input_group_id),
          public.current_toronto_civil_date()
        )
        or exists (
          select 1
          from public.student_group_memberships as memberships
          join public.profiles on profiles.id = memberships.student_id
          where memberships.student_id = (select auth.uid())
            and memberships.group_id = input_group_id
            and profiles.role = 'student'
            and profiles.active = true
            and memberships.starts_on <= public.current_toronto_civil_date()
            and (memberships.ends_on is null or memberships.ends_on >= public.current_toronto_civil_date())
        )
        or exists (
          select 1
          from public.group_teacher_assignments as assignments
          where assignments.teacher_id = (select auth.uid())
            and assignments.group_id = input_group_id
            and assignments.active = true
            and assignments.week_start = public.week_start_for_date(public.current_toronto_civil_date())
            and private.raw_can_teacher_access_assignment(
              (select auth.uid()), assignments.group_id, assignments.week_start
            )
        )
      )
    );
$$;

create or replace function public.can_read_profile(input_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_active_super_admin((select auth.uid()))
    or (
      input_profile_id = (select auth.uid())
      and exists (
        select 1 from public.profiles
        where profiles.id = input_profile_id and profiles.active = true
      )
    )
    or exists (
      select 1
      from public.profiles as target
      join public.student_group_memberships as memberships
        on memberships.student_id = target.id
      where target.id = input_profile_id
        and target.active = true
        and private.raw_is_admin_for_masjid(
          (select auth.uid()),
          private.raw_group_masjid_id(memberships.group_id),
          public.current_toronto_civil_date()
        )
    )
    or exists (
      select 1
      from public.profiles as target
      join public.masjid_staff_memberships as memberships
        on memberships.profile_id = target.id
      where target.id = input_profile_id
        and target.active = true
        and private.raw_is_admin_for_masjid(
          (select auth.uid()), memberships.masjid_id, public.current_toronto_civil_date()
        )
    );
$$;

create or replace function public.can_admin_delete_student(input_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_active_super_admin((select auth.uid()))
    or (
      exists (
        select 1
        from public.profiles
        join public.student_group_memberships as memberships
          on memberships.student_id = profiles.id
        where profiles.id = input_student_id
          and profiles.role = 'student'
          and profiles.active = true
      )
      and not exists (
        select 1
        from public.student_group_memberships as memberships
        where memberships.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()),
            private.raw_group_masjid_id(memberships.group_id),
            public.current_toronto_civil_date()
          )
      )
      and not exists (
        select 1
        from public.masjid_staff_memberships as memberships
        where memberships.profile_id = input_student_id
      )
      and not exists (
        select 1
        from public.group_teacher_assignments as assignments
        where assignments.teacher_id = input_student_id
      )
      and not exists (
        select 1
        from public.teacher_rotation_availability as availability
        where availability.teacher_id = input_student_id
      )
      and not exists (
        select 1
        from public.checkins as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_toronto_civil_date()
          )
      )
      and not exists (
        select 1
        from public.weekly_plans as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_toronto_civil_date()
          )
      )
      and not exists (
        select 1
        from public.partner_recitations as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_toronto_civil_date()
          )
      )
      and not exists (
        select 1
        from public.halaqa_grades as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_toronto_civil_date()
          )
      )
      and not exists (
        select 1
        from public.accountability_obligations as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_toronto_civil_date()
          )
      )
      and not exists (
        select 1
        from public.badge_awards as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_toronto_civil_date()
          )
      )
    );
$$;

-- The correction date itself is a check-in concept and therefore retains the
-- effective-date cap. The actor's current staff authorization is civil-date.
create or replace function public.apply_admin_checkin_correction(
  input_student_id uuid,
  input_date date,
  input_status text,
  input_note text,
  input_completed_task_keys text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_week_start date;
  target_masjid_id uuid;
  corrected_checkin_id uuid;
  expected_total integer;
  expected_earned integer;
  completed_keys text[] := coalesce(input_completed_task_keys, array[]::text[]);
begin
  if input_student_id is null or input_date is null then
    raise exception using errcode = '22023', message = 'Student and date are required.';
  end if;

  if input_status not in ('submitted', 'missing') then
    raise exception using errcode = '22023', message = 'Invalid correction status.';
  end if;

  if input_date > public.current_effective_date() then
    raise exception using errcode = '22023', message = 'Correction date cannot be in the future.';
  end if;

  if not exists (
    select 1 from public.profiles
    where profiles.id = input_student_id
      and profiles.role = 'student'
      and profiles.active = true
  ) then
    raise exception 'Invalid active student.';
  end if;

  target_week_start := public.week_start_for_date(input_date);

  select checkins.id, checkins.masjid_id
  into corrected_checkin_id, target_masjid_id
  from public.checkins
  where checkins.student_id = input_student_id
    and checkins.date = input_date;

  if corrected_checkin_id is null then
    target_masjid_id := private.raw_student_masjid_for_week(input_student_id, target_week_start);
  end if;

  if target_masjid_id is null
    or not (
      private.raw_is_active_super_admin(actor_id)
      or private.raw_is_admin_for_masjid(
        actor_id, target_masjid_id, public.current_toronto_civil_date()
      )
    ) then
    raise exception 'Actor is not authorized for this student correction.';
  end if;

  if input_status = 'missing' then
    delete from public.checkins
    where checkins.student_id = input_student_id
      and checkins.date = input_date;
    return corrected_checkin_id;
  end if;

  select coalesce(sum(definitions.weight), 0)
  into expected_total
  from private.checkin_task_definition(input_date) as definitions;

  if expected_total = 0 then
    raise exception 'No canonical checklist exists for the correction date.';
  end if;

  insert into public.checkins (
    student_id,
    date,
    completed,
    note,
    earned_weight,
    total_weight,
    daily_score,
    updated_at,
    updated_by_admin
  )
  values (
    input_student_id,
    input_date,
    true,
    input_note,
    0,
    expected_total,
    0,
    now(),
    actor_id
  )
  on conflict (student_id, date) do update
  set completed = true,
      note = excluded.note,
      earned_weight = 0,
      total_weight = excluded.total_weight,
      daily_score = 0,
      updated_at = excluded.updated_at,
      updated_by_admin = excluded.updated_by_admin
  returning checkins.id into corrected_checkin_id;

  delete from public.checkin_items
  where checkin_items.checkin_id = corrected_checkin_id;

  if exists (
      select 1
      from unnest(completed_keys) as submitted(task_key)
      where submitted.task_key is null
        or not exists (
          select 1 from private.checkin_task_definition(input_date, submitted.task_key)
        )
    )
    or cardinality(completed_keys) <> (
      select count(distinct submitted.task_key)
      from unnest(completed_keys) as submitted(task_key)
    ) then
    raise exception using errcode = '22023', message = 'Invalid canonical checklist task selection.';
  end if;

  insert into public.checkin_items (
    checkin_id,
    student_id,
    date,
    task_key,
    task_label,
    weight,
    completed
  )
  select corrected_checkin_id,
         input_student_id,
         input_date,
         definitions.task_key,
         definitions.task_label,
         definitions.weight,
         definitions.task_key = any(completed_keys)
  from private.checkin_task_definition(input_date) as definitions;

  select coalesce(sum(definitions.weight) filter (
           where definitions.task_key = any(completed_keys)
         ), 0)
  into expected_earned
  from private.checkin_task_definition(input_date) as definitions;

  update public.checkins
  set earned_weight = expected_earned,
      total_weight = expected_total,
      daily_score = round((expected_earned::numeric / expected_total::numeric) * 100, 2),
      updated_at = now(),
      updated_by_admin = actor_id
  where checkins.id = corrected_checkin_id;

  return corrected_checkin_id;
end;
$$;

-- Assignment rows are an authorization boundary in their own right. The
-- service-role rotation workflow bypasses RLS, so enforce the same Saturday
-- eligibility invariant in a trigger for every direct insert or update.
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
    if new.active and not private.raw_teacher_has_halaqa_saturday_eligibility(
      new.teacher_id,
      private.raw_group_masjid_id(new.group_id),
      new.week_start
    ) then
      raise exception 'teacher_id must have active teacher staff membership through the Saturday halaqa date.';
    end if;

    return new;
  end if;

  raise exception 'teacher_rotation_row_scope_matches is not attached to table %', tg_table_name;
end;
$$;

drop trigger if exists teacher_assignment_teacher_eligibility_trigger
  on public.group_teacher_assignments;

create trigger teacher_assignment_teacher_eligibility_trigger
  before insert or update of teacher_id, group_id, week_start, active
  on public.group_teacher_assignments
  for each row execute function public.teacher_rotation_row_scope_matches();

revoke all on function public.current_toronto_civil_date() from public, anon, authenticated, service_role;
revoke all on function public.halaqa_saturday_for_week(date) from public, anon, authenticated, service_role;
revoke all on function public.apply_teacher_rotation_generation(
  uuid, date, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, integer, integer, integer, integer
) from public, anon, authenticated;
revoke all on function private.raw_teacher_has_halaqa_saturday_eligibility(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_historical_teacher_assignment_is_valid(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_has_current_active_teacher_staff_for_masjid(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_historical_student_group_for_week(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_can_view_teacher_assignment_context(uuid, uuid, date)
  from public, anon, authenticated, service_role;

grant execute on function public.current_toronto_civil_date() to authenticated;
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
    'public.is_active_admin()',
    'public.is_active_student()',
    'public.is_active_super_admin()',
    'public.is_active_teacher()',
    'public.is_admin_for_masjid(uuid)',
    'public.is_rotation_teacher_for_masjid_week(uuid,uuid,date)',
    'public.is_staff_for_masjid(uuid)',
    'public.is_teacher_for_group_week(uuid,date)',
    'public.prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)',
    'public.preview_official_scoring_start_change(uuid,uuid,date)',
    'public.protect_foundation_row_identity()',
    'public.recalculate_student_checkin_score()',
    'public.set_student_scope_snapshot()',
    'public.set_halaqa_grade_scope_snapshot()',
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
    'public.teacher_assignment_contexts()',
    'public.teacher_can_read_membership(uuid,date,date)',
    'public.teacher_group_roster_context(uuid,date)',
    'public.teacher_grade_scope_snapshot_matches(uuid,date,uuid,uuid,uuid)',
    'public.teacher_rotation_row_scope_matches()',
    'public.validate_accountability_obligation_scope()',
    'private.apply_super_admin_masjid_staff_grant_once(uuid,uuid,uuid,uuid,text,date,jsonb)',
    'private.enforce_masjid_hierarchy_readiness()'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
