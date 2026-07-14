-- Phase 1 multi-masjid authorization hardening.
--
-- This migration keeps the product schema intact while tightening RLS,
-- separating raw scope resolution from application-facing RPCs, and removing
-- inherited execute access from privileged functions.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.raw_student_group_for_week(
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
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  where memberships.student_id = input_student_id
    and memberships.starts_on <= input_week_start
    and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
    and groups.active = true
    and cohorts.active = true
    and masajid.active = true
  order by memberships.starts_on desc
  limit 1;
$$;

create or replace function private.raw_student_cohort_for_week(
  input_student_id uuid,
  input_week_start date
)
returns uuid
language sql
stable
set search_path = ''
as $$
  select groups.cohort_id
  from public.halaqa_groups as groups
  where groups.id = private.raw_student_group_for_week(input_student_id, input_week_start);
$$;

create or replace function private.raw_student_masjid_for_week(
  input_student_id uuid,
  input_week_start date
)
returns uuid
language sql
stable
set search_path = ''
as $$
  select cohorts.masjid_id
  from public.cohorts
  where cohorts.id = private.raw_student_cohort_for_week(input_student_id, input_week_start);
$$;

create or replace function private.raw_group_masjid_id(input_group_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select cohorts.masjid_id
  from public.halaqa_groups as groups
  join public.cohorts on cohorts.id = groups.cohort_id
  where groups.id = input_group_id;
$$;

create or replace function private.raw_cohort_masjid_id(input_cohort_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select cohorts.masjid_id
  from public.cohorts
  where cohorts.id = input_cohort_id;
$$;

create or replace function private.raw_is_admin_for_masjid(
  input_actor_id uuid,
  input_masjid_id uuid,
  input_effective_date date
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
      and profiles.role = 'admin'
      and profiles.active = true
      and masajid.id = input_masjid_id
      and masajid.active = true
      and memberships.staff_role = 'admin'
      and memberships.active = true
      and memberships.starts_on <= input_effective_date
      and (memberships.ends_on is null or memberships.ends_on >= input_effective_date)
  );
$$;

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
      and memberships.starts_on <= input_week_start
      and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
  );
$$;

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
  select exists (
    select 1
    from public.group_teacher_assignments as assignments
    where assignments.group_id = input_group_id
      and assignments.week_start = input_week_start
      and assignments.teacher_id = input_actor_id
      and assignments.active = true
      and private.raw_is_rotation_teacher_for_masjid_week(
        input_actor_id,
        private.raw_group_masjid_id(input_group_id),
        input_week_start
      )
  );
$$;

create or replace function private.raw_is_active_super_admin(input_actor_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = input_actor_id
      and profiles.role = 'super_admin'
      and profiles.active = true
  );
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
      public.current_effective_date()
    )
    or private.raw_is_teacher_for_group_week(
      input_actor_id,
      private.raw_student_group_for_week(input_student_id, input_week_start),
      input_week_start
    );
$$;

create or replace function private.require_tracker_week_start(input_week_start date)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if input_week_start is null
    or input_week_start <> public.week_start_for_date(input_week_start) then
    raise exception using
      errcode = '22023',
      message = 'input_week_start must be a Sunday tracker week start.';
  end if;

  return true;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;

-- Public helpers below expose only caller-relative answers. Raw cross-user ID
-- resolution stays in the unexposed private schema.
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
      public.current_effective_date()
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
    or private.raw_is_admin_for_masjid(
      (select auth.uid()),
      input_masjid_id,
      public.current_effective_date()
    )
    or private.raw_is_rotation_teacher_for_masjid_week(
      (select auth.uid()),
      input_masjid_id,
      public.week_start_for_date(public.current_effective_date())
    );
$$;

create or replace function public.is_teacher_for_group_week(
  input_group_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_is_teacher_for_group_week(
    (select auth.uid()),
    input_group_id,
    input_week_start
  );
$$;

create or replace function public.can_read_student_for_week(
  input_student_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_can_read_student_for_week(
    (select auth.uid()),
    input_student_id,
    input_week_start
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
  select private.raw_is_active_super_admin((select auth.uid()))
    or private.raw_is_admin_for_masjid(
      (select auth.uid()),
      private.raw_student_masjid_for_week(input_student_id, input_week_start),
      public.current_effective_date()
    )
    or private.raw_is_teacher_for_group_week(
      (select auth.uid()),
      private.raw_student_group_for_week(input_student_id, input_week_start),
      input_week_start
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
      public.current_effective_date()
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
            public.current_effective_date()
          )
      )
      -- A normal masjid admin may delete only a profile that has always been
      -- a student. Staff history is global identity history and must not be
      -- removed as a side effect of a local student deletion.
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
      -- Snapshot rows survive group moves. Check their stored masjid directly
      -- so missing/closed membership history cannot make a cross-masjid
      -- cascade appear local.
      and not exists (
        select 1 from public.checkins as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_effective_date()
          )
      )
      and not exists (
        select 1 from public.weekly_plans as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_effective_date()
          )
      )
      and not exists (
        select 1 from public.partner_recitations as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_effective_date()
          )
      )
      and not exists (
        select 1 from public.halaqa_grades as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_effective_date()
          )
      )
      and not exists (
        select 1 from public.accountability_obligations as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_effective_date()
          )
      )
      and not exists (
        select 1 from public.badge_awards as rows
        where rows.student_id = input_student_id
          and not private.raw_is_admin_for_masjid(
            (select auth.uid()), rows.masjid_id, public.current_effective_date()
          )
      )
    );
$$;

create or replace function public.student_group_for_week(
  input_student_id uuid,
  input_week_start date
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_tracker_week_start(input_week_start);

  return (
    select case
    when private.raw_can_read_student_for_week(
      (select auth.uid()), input_student_id, input_week_start
    ) then private.raw_student_group_for_week(input_student_id, input_week_start)
    end
  );
end;
$$;

create or replace function public.student_cohort_for_week(
  input_student_id uuid,
  input_week_start date
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_tracker_week_start(input_week_start);

  return (
    select case
    when private.raw_can_read_student_for_week(
      (select auth.uid()), input_student_id, input_week_start
    ) then private.raw_student_cohort_for_week(input_student_id, input_week_start)
    end
  );
end;
$$;

create or replace function public.student_masjid_for_week(
  input_student_id uuid,
  input_week_start date
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_tracker_week_start(input_week_start);

  return (
    select case
    when private.raw_can_read_student_for_week(
      (select auth.uid()), input_student_id, input_week_start
    ) then private.raw_student_masjid_for_week(input_student_id, input_week_start)
    end
  );
end;
$$;

create or replace function public.student_current_group_id(input_student_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select public.student_group_for_week(
    input_student_id,
    public.week_start_for_date(public.current_effective_date())
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
          (select auth.uid()), input_masjid_id, public.current_effective_date()
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
            and memberships.starts_on <= public.current_effective_date()
            and (memberships.ends_on is null or memberships.ends_on >= public.current_effective_date())
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
            and assignments.week_start = public.week_start_for_date(public.current_effective_date())
            and groups.active = true
            and cohorts.active = true
            and cohorts.masjid_id = input_masjid_id
            and private.raw_is_teacher_for_group_week(
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
          public.current_effective_date()
        )
        or exists (
          select 1
          from public.student_group_memberships as memberships
          join public.halaqa_groups as groups on groups.id = memberships.group_id
          join public.profiles on profiles.id = memberships.student_id
          where memberships.student_id = (select auth.uid())
            and profiles.role = 'student'
            and profiles.active = true
            and memberships.starts_on <= public.current_effective_date()
            and (memberships.ends_on is null or memberships.ends_on >= public.current_effective_date())
            and groups.active = true
            and groups.cohort_id = input_cohort_id
        )
        or exists (
          select 1
          from public.group_teacher_assignments as assignments
          join public.halaqa_groups as groups on groups.id = assignments.group_id
          where assignments.teacher_id = (select auth.uid())
            and assignments.active = true
            and assignments.week_start = public.week_start_for_date(public.current_effective_date())
            and groups.active = true
            and groups.cohort_id = input_cohort_id
            and private.raw_is_teacher_for_group_week(
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
          public.current_effective_date()
        )
        or exists (
          select 1
          from public.student_group_memberships as memberships
          join public.profiles on profiles.id = memberships.student_id
          where memberships.student_id = (select auth.uid())
            and memberships.group_id = input_group_id
            and profiles.role = 'student'
            and profiles.active = true
            and memberships.starts_on <= public.current_effective_date()
            and (memberships.ends_on is null or memberships.ends_on >= public.current_effective_date())
        )
        or exists (
          select 1
          from public.group_teacher_assignments as assignments
          where assignments.teacher_id = (select auth.uid())
            and assignments.group_id = input_group_id
            and assignments.active = true
            and assignments.week_start = public.week_start_for_date(public.current_effective_date())
            and private.raw_is_teacher_for_group_week(
              (select auth.uid()), assignments.group_id, assignments.week_start
            )
        )
      )
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
      public.current_effective_date()
    );
$$;

create or replace function public.group_masjid_id(input_group_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.can_read_group(input_group_id)
      then private.raw_group_masjid_id(input_group_id)
  end;
$$;

create or replace function public.cohort_masjid_id(input_cohort_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.can_read_cohort(input_cohort_id)
      then private.raw_cohort_masjid_id(input_cohort_id)
  end;
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
          public.current_effective_date()
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
          (select auth.uid()), memberships.masjid_id, public.current_effective_date()
        )
    )
    or exists (
      select 1
      from public.profiles as target
      join public.student_group_memberships as memberships
        on memberships.student_id = target.id
      join public.group_teacher_assignments as assignments
        on assignments.group_id = memberships.group_id
      where target.id = input_profile_id
        and target.active = true
        and assignments.teacher_id = (select auth.uid())
        and assignments.active = true
        and assignments.week_start between memberships.starts_on and coalesce(memberships.ends_on, 'infinity'::date)
        and private.raw_is_teacher_for_group_week(
          (select auth.uid()), assignments.group_id, assignments.week_start
        )
    );
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
      (select auth.uid()), input_masjid_id, public.current_effective_date()
    )
    or private.raw_is_teacher_for_group_week(
      (select auth.uid()), input_group_id, input_week_start
    );
$$;

create or replace function public.student_scope_snapshot_matches(
  input_student_id uuid,
  input_week_start date,
  input_masjid_id uuid,
  input_cohort_id uuid,
  input_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.raw_can_read_student_for_week(
      (select auth.uid()), input_student_id, input_week_start
    )
    and input_group_id = private.raw_student_group_for_week(input_student_id, input_week_start)
    and input_cohort_id = private.raw_student_cohort_for_week(input_student_id, input_week_start)
    and input_masjid_id = private.raw_student_masjid_for_week(input_student_id, input_week_start);
$$;

create or replace function public.teacher_can_read_membership(
  input_group_id uuid,
  input_starts_on date,
  input_ends_on date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_teacher_assignments as assignments
    where assignments.teacher_id = (select auth.uid())
      and assignments.group_id = input_group_id
      and assignments.active = true
      and assignments.week_start >= input_starts_on
      and (input_ends_on is null or assignments.week_start <= input_ends_on)
      and private.raw_is_teacher_for_group_week(
        (select auth.uid()), assignments.group_id, assignments.week_start
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
        (select auth.uid()), input_masjid_id, public.current_effective_date()
      )
    );
$$;

create or replace function public.weekly_plan_path_is_owned(
  input_student_id uuid,
  input_week_start date,
  input_file_path text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select input_file_path like input_student_id::text || '/' || input_week_start::text || '/%'
    and position('..' in input_file_path) = 0;
$$;

create or replace function public.can_admin_read_weekly_plan_path(input_file_path text)
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

  return public.can_admin_manage_student_for_week(parsed_student_id, parsed_week_start);
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
  where assignments.group_id = private.raw_student_group_for_week((select auth.uid()), input_week_start)
    and assignments.week_start = input_week_start
    and assignments.active = true
    and profiles.active = true
    and exists (
      select 1 from public.profiles as caller
      where caller.id = (select auth.uid())
        and caller.role = 'student'
        and caller.active = true
    )
    and private.raw_is_rotation_teacher_for_masjid_week(
      assignments.teacher_id,
      private.raw_group_masjid_id(assignments.group_id),
      input_week_start
    )
  order by assignments.created_at desc
  limit 1;
end;
$$;

create or replace function public.student_cohort_leaderboard_for_week(
  input_week_start date
)
returns table (
  student_name text,
  rank integer,
  previous_rank integer,
  rank_change integer,
  total_points numeric,
  score_percentage numeric,
  is_current_student boolean,
  status_label text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_tracker_week_start(input_week_start);

  return query
  with caller as (
    select profiles.id,
           private.raw_student_cohort_for_week(profiles.id, input_week_start) as cohort_id,
           private.raw_student_cohort_for_week(profiles.id, input_week_start - 7) as previous_cohort_id
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'student'
      and profiles.active = true
  ),
  current_students as (
    select distinct profiles.id, profiles.name
    from caller
    join public.halaqa_groups as groups on groups.cohort_id = caller.cohort_id
    join public.student_group_memberships as memberships on memberships.group_id = groups.id
    join public.profiles on profiles.id = memberships.student_id
    where caller.cohort_id is not null
      and groups.active = true
      and memberships.starts_on <= input_week_start
      and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
      and profiles.role = 'student'
      and profiles.active = true
      and profiles.created_at < (input_week_start + 7)::timestamp
  ),
  current_scores as (
    select students.id,
           students.name,
           least(700::numeric, greatest(0::numeric, coalesce((
             select sum(coalesce(checkins.daily_score, 0))
             from public.checkins
             where checkins.student_id = students.id
               and checkins.date between input_week_start and input_week_start + 6
           ), 0)::numeric)) as daily_points,
           least(150, greatest(0, coalesce((
             select sum(recitations.points)
             from public.partner_recitations as recitations
             where recitations.student_id = students.id
               and recitations.week_start = input_week_start
           ), 0)::integer)) as partner_points,
           least(150, greatest(0, coalesce((
             select grades.attendance_points + grades.recitation_points
             from public.halaqa_grades as grades
             where grades.student_id = students.id
               and grades.week_start = input_week_start
           ), 0)::integer)) as halaqa_points
    from current_students as students
  ),
  current_ranked as (
    select scores.*,
           row_number() over (
             order by (scores.daily_points + scores.partner_points + scores.halaqa_points) desc,
                      scores.name asc
           )::integer as rank
    from current_scores as scores
  ),
  previous_students as (
    select distinct profiles.id, profiles.name
    from caller
    join public.halaqa_groups as groups on groups.cohort_id = caller.previous_cohort_id
    join public.student_group_memberships as memberships on memberships.group_id = groups.id
    join public.profiles on profiles.id = memberships.student_id
    where caller.previous_cohort_id is not null
      and groups.active = true
      and memberships.starts_on <= input_week_start - 7
      and (memberships.ends_on is null or memberships.ends_on >= input_week_start - 7)
      and profiles.role = 'student'
      and profiles.active = true
      and profiles.created_at < input_week_start::timestamp
  ),
  previous_activity as (
    select exists (
      select 1
      from previous_students as students
      where exists (
          select 1 from public.checkins
          where checkins.student_id = students.id
            and checkins.date between input_week_start - 7 and input_week_start - 1
        )
        or exists (
          select 1 from public.partner_recitations as recitations
          where recitations.student_id = students.id
            and recitations.week_start = input_week_start - 7
        )
        or exists (
          select 1 from public.halaqa_grades as grades
          where grades.student_id = students.id
            and grades.week_start = input_week_start - 7
        )
    ) as has_activity
  ),
  previous_scores as (
    select students.id,
           students.name,
           least(700::numeric, greatest(0::numeric, coalesce((
             select sum(coalesce(checkins.daily_score, 0))
             from public.checkins
             where checkins.student_id = students.id
               and checkins.date between input_week_start - 7 and input_week_start - 1
           ), 0)::numeric))
           + least(150::numeric, greatest(0::numeric, coalesce((
             select sum(recitations.points)
             from public.partner_recitations as recitations
             where recitations.student_id = students.id
               and recitations.week_start = input_week_start - 7
           ), 0)::numeric))
           + least(150::numeric, greatest(0::numeric, coalesce((
             select grades.attendance_points + grades.recitation_points
             from public.halaqa_grades as grades
             where grades.student_id = students.id
               and grades.week_start = input_week_start - 7
           ), 0)::numeric)) as total_points
    from previous_students as students
    cross join previous_activity
    where previous_activity.has_activity
  ),
  previous_ranked as (
    select scores.id,
           row_number() over (order by scores.total_points desc, scores.name asc)::integer as rank
    from previous_scores as scores
  )
  select current_ranked.name,
         current_ranked.rank,
         previous_ranked.rank,
         case
           when previous_ranked.rank is null then null
           else previous_ranked.rank - current_ranked.rank
         end,
         (current_ranked.daily_points + current_ranked.partner_points + current_ranked.halaqa_points)::numeric,
         round((current_ranked.daily_points + current_ranked.partner_points + current_ranked.halaqa_points) / 10, 2),
         current_ranked.id = (select caller.id from caller),
         case
           when input_week_start + 6 < public.current_effective_date() then
             case
               when (current_ranked.daily_points + current_ranked.partner_points + current_ranked.halaqa_points) < 700
                 then 'Below 70%'
               else 'Passing'
             end
           when (current_ranked.daily_points + current_ranked.partner_points + current_ranked.halaqa_points) < 700
             then 'Below 70% so far'
           else 'In progress'
         end
  from current_ranked
  left join previous_ranked on previous_ranked.id = current_ranked.id
  order by current_ranked.rank;
end;
$$;

create or replace function public.student_leaderboard_available_weeks()
returns table (week_start date)
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (
    select profiles.id
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'student'
      and profiles.active = true
  ),
  candidate_weeks as (
    select public.week_start_for_date(public.current_effective_date()) as week_start
    union
    select public.week_start_for_date(checkins.date)
    from public.checkins, caller
    where checkins.cohort_id = private.raw_student_cohort_for_week(
      caller.id, public.week_start_for_date(checkins.date)
    )
    union
    select recitations.week_start
    from public.partner_recitations as recitations, caller
    where recitations.cohort_id = private.raw_student_cohort_for_week(caller.id, recitations.week_start)
    union
    select grades.week_start
    from public.halaqa_grades as grades, caller
    where grades.cohort_id = private.raw_student_cohort_for_week(caller.id, grades.week_start)
  )
  select candidate_weeks.week_start
  from candidate_weeks
  where candidate_weeks.week_start is not null
  order by candidate_weeks.week_start desc;
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
      (select auth.uid()), cohorts.masjid_id, public.current_effective_date()
    )
  order by cohorts.sort_order asc, groups.sort_order asc, profiles.name asc;
end;
$$;

-- Existing application RPCs are retained for compatibility, but the two
-- superseded student RPCs are no longer executable by browser roles.
revoke all on function public.student_weekly_teacher(uuid, date) from public, anon, authenticated;
revoke all on function public.student_cohort_students_for_week(uuid, date) from public, anon, authenticated;

-- Keep the weighted checklist authoritative in the database. Students may
-- toggle canonical tasks and edit their note, but may not forge task weights,
-- derived scores, attribution, or the day/scope of a submitted check-in.
create or replace function private.checkin_task_definition(
  input_date date,
  input_task_key text default null
)
returns table (task_key text, task_label text, weight integer)
language sql
immutable
set search_path = ''
as $$
  select definitions.task_key, definitions.task_label, definitions.weight
  from (values
    ('new_memorization_listening', 'New memorization & Listening', 20, array[0,1,2,3]),
    ('repeat_new_memorization_3x_listen_1x', 'Repeat new memorization 3 times & listen one time', 20, array[4]),
    ('repeat_new_memorization_5x_listen_1x', 'Repeat new memorization 5 times & listen one time', 20, array[5]),
    ('revise_old', 'Revise old', 40, array[0,1,2,3,4,5]),
    ('revise_new', 'Revise new', 20, array[0,1,2,3,4,5]),
    ('tafsir', 'Tafsir', 10, array[0,1,2,3,4,5]),
    ('recite_next_week_memorization', 'Recite next week memorization', 5, array[0,1,2,3,4,5]),
    ('read_during_salat', 'Read during Salat', 5, array[0,1,2,3,4,5]),
    ('tafsir_reflection_group', 'Tafsir and sharing reflection on the group', 50, array[6]),
    ('repeat_week_memorization_2x', 'Repeat the memorization of the week 2 times', 50, array[6])
  ) as definitions(task_key, task_label, weight, weekdays)
  where extract(dow from input_date)::integer = any(definitions.weekdays)
    and (input_task_key is null or definitions.task_key = input_task_key);
$$;

revoke all on function private.checkin_task_definition(date, text)
  from public, anon, authenticated, service_role;

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

  if not exists (
    select 1 from public.profiles
    where profiles.id = input_student_id
      and profiles.role = 'student'
      and profiles.active = true
  ) then
    raise exception 'Invalid active student.';
  end if;

  target_week_start := public.week_start_for_date(input_date);

  -- Existing immutable snapshots remain correct even if the historical group
  -- is later deactivated. New corrections require an active effective scope.
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
        actor_id, target_masjid_id, public.current_effective_date()
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

  -- Validation intentionally remains inside the same transaction after the
  -- parent/item mutations so any exception proves the complete correction is
  -- rolled back rather than leaving a partial parent or item set.
  if exists (
      select 1
      from unnest(completed_keys) as submitted(task_key)
      where submitted.task_key is null
        or not exists (
          select 1
          from private.checkin_task_definition(input_date, submitted.task_key)
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

create or replace function public.enforce_student_checkin_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_total integer;
  expected_earned integer;
  expected_score numeric;
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'student'
      and profiles.active = true
  ) then
    return new;
  end if;

  select coalesce(sum(definitions.weight), 0)
    into expected_total
  from private.checkin_task_definition(new.date) as definitions;

  if tg_op = 'INSERT' then
    if new.student_id is distinct from (select auth.uid())
      or new.date is distinct from public.current_effective_date()
      or new.completed is distinct from true
      or coalesce(new.earned_weight, 0) <> 0
      or new.total_weight is distinct from expected_total
      or coalesce(new.daily_score, 0) <> 0
      or new.updated_by_admin is not null
    then
      raise exception 'Invalid student check-in values.';
    end if;

    new.submitted_at := now();
    new.updated_at := now();
    return new;
  end if;

  select coalesce(sum(case when items.completed then items.weight else 0 end), 0)
    into expected_earned
  from public.checkin_items as items
  where items.checkin_id = old.id;
  expected_score := case
    when expected_total = 0 then 0
    else round((expected_earned::numeric / expected_total::numeric) * 100, 2)
  end;

  if new.id is distinct from old.id
    or new.student_id is distinct from old.student_id
    or new.date is distinct from old.date
    or old.date is distinct from public.current_effective_date()
    or new.completed is distinct from old.completed
    or new.submitted_at is distinct from old.submitted_at
    or new.updated_by_admin is distinct from old.updated_by_admin
    or new.masjid_id is distinct from old.masjid_id
    or new.cohort_id is distinct from old.cohort_id
    or new.halaqa_group_id is distinct from old.halaqa_group_id
    or new.earned_weight is distinct from expected_earned
    or new.total_weight is distinct from expected_total
    or new.daily_score is distinct from expected_score
  then
    raise exception 'Students may edit only their note or canonical checklist completion.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_student_checkin_item_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition record;
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'student'
      and profiles.active = true
  ) then
    return new;
  end if;

  select * into definition
  from private.checkin_task_definition(new.date, new.task_key);

  if definition.task_key is null
    or new.student_id is distinct from (select auth.uid())
    or new.task_label is distinct from definition.task_label
    or new.weight is distinct from definition.weight
    or not exists (
      select 1 from public.checkins
      where checkins.id = new.checkin_id
        and checkins.student_id = new.student_id
        and checkins.date = new.date
        and checkins.date = public.current_effective_date()
    )
  then
    raise exception 'Invalid student checklist task.';
  end if;

  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.checkin_id is distinct from old.checkin_id
    or new.student_id is distinct from old.student_id
    or new.date is distinct from old.date
    or new.task_key is distinct from old.task_key
    or new.task_label is distinct from old.task_label
    or new.weight is distinct from old.weight
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Students may update only checklist completion.';
  end if;

  return new;
end;
$$;

create or replace function public.recalculate_student_checkin_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_total integer;
  expected_earned integer;
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'student'
      and profiles.active = true
  ) then
    return new;
  end if;

  select coalesce(sum(definitions.weight), 0)
    into expected_total
  from private.checkin_task_definition(new.date) as definitions;
  select coalesce(sum(case when items.completed then items.weight else 0 end), 0)
    into expected_earned
  from public.checkin_items as items
  where items.checkin_id = new.checkin_id;

  update public.checkins
  set earned_weight = expected_earned,
      total_weight = expected_total,
      daily_score = case
        when expected_total = 0 then 0
        else round((expected_earned::numeric / expected_total::numeric) * 100, 2)
      end,
      updated_at = now()
  where checkins.id = new.checkin_id
    and checkins.student_id = (select auth.uid());

  return new;
end;
$$;

create trigger enforce_student_checkin_integrity_trigger
  before insert or update on public.checkins
  for each row execute function public.enforce_student_checkin_integrity();

create trigger enforce_student_checkin_item_integrity_trigger
  before insert or update on public.checkin_items
  for each row execute function public.enforce_student_checkin_item_integrity();

create trigger recalculate_student_checkin_score_trigger
  after insert or update of completed on public.checkin_items
  for each row execute function public.recalculate_student_checkin_score();

-- Snapshot triggers already set scope on ownership/date changes. These
-- additional triggers prevent a direct client from editing only snapshot IDs.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'protect_checkins_scope_snapshot_trigger') then
    create trigger protect_checkins_scope_snapshot_trigger
      before update of masjid_id, cohort_id, halaqa_group_id on public.checkins
      for each row execute function public.set_student_scope_snapshot();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'protect_weekly_plans_scope_snapshot_trigger') then
    create trigger protect_weekly_plans_scope_snapshot_trigger
      before update of masjid_id, cohort_id, halaqa_group_id on public.weekly_plans
      for each row execute function public.set_student_scope_snapshot();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'protect_partner_recitations_scope_snapshot_trigger') then
    create trigger protect_partner_recitations_scope_snapshot_trigger
      before update of masjid_id, cohort_id, halaqa_group_id on public.partner_recitations
      for each row execute function public.set_student_scope_snapshot();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'protect_halaqa_grades_scope_snapshot_trigger') then
    create trigger protect_halaqa_grades_scope_snapshot_trigger
      before update of masjid_id, cohort_id, halaqa_group_id on public.halaqa_grades
      for each row execute function public.set_student_scope_snapshot();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'protect_accountability_scope_snapshot_trigger') then
    create trigger protect_accountability_scope_snapshot_trigger
      before update of masjid_id, cohort_id, halaqa_group_id on public.accountability_obligations
      for each row execute function public.set_student_scope_snapshot();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'protect_badge_awards_scope_snapshot_trigger') then
    create trigger protect_badge_awards_scope_snapshot_trigger
      before update of masjid_id, cohort_id, halaqa_group_id on public.badge_awards
      for each row execute function public.set_student_scope_snapshot();
  end if;
end;
$$;

-- Preserve the student-only attestation transition while allowing the global
-- operational access intentionally granted to active super admins.
create or replace function public.enforce_student_accountability_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_active_admin() or public.is_active_super_admin() then
    return new;
  end if;

  if public.is_active_student() then
    if old.student_id <> (select auth.uid())
      or old.status <> 'pending'
      or new.id is distinct from old.id
      or new.student_id is distinct from old.student_id
      or new.week_start is distinct from old.week_start
      or new.weekly_percentage is distinct from old.weekly_percentage
      or new.amount_cents is distinct from old.amount_cents
      or new.status <> 'attested_paid'
      or new.attested_paid_at is null
      or new.waived_at is distinct from old.waived_at
      or new.waived_by is distinct from old.waived_by
      or new.admin_note is distinct from old.admin_note
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Students may only attest their own pending accountability obligation as paid.';
    end if;

    return new;
  end if;

  raise exception 'Only active students, admins, or super admins may update accountability obligations.';
end;
$$;

create or replace function public.protect_foundation_row_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Rotation/setup mutations already passed a guarded server-side scope check
  -- and need to replace same-week membership/assignment rows atomically.
  if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' then
    return new;
  end if;

  -- Keep table-specific record fields in separate branches. PostgreSQL may
  -- evaluate boolean terms in any order, so a heterogeneous NEW record must
  -- never reference columns belonging to another trigger table.
  if tg_table_name = 'student_group_memberships' then
    if new.id is distinct from old.id
      or new.student_id is distinct from old.student_id
      or new.group_id is distinct from old.group_id
      or new.starts_on is distinct from old.starts_on
      or new.assigned_by is distinct from old.assigned_by
      or new.created_at is distinct from old.created_at
      or (old.ends_on is not null and new.ends_on is distinct from old.ends_on)
    then
      raise exception 'Membership history is immutable; close the open membership instead.';
    end if;
  elsif tg_table_name = 'masjid_staff_memberships' then
    if new.id is distinct from old.id
      or new.profile_id is distinct from old.profile_id
      or new.masjid_id is distinct from old.masjid_id
      or new.staff_role is distinct from old.staff_role
      or new.starts_on is distinct from old.starts_on
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or (old.ends_on is not null and new.ends_on is distinct from old.ends_on)
      or (old.active = false and new.active = true)
    then
      raise exception 'Staff history is immutable; close or deactivate the open membership instead.';
    end if;
  elsif tg_table_name = 'group_teacher_assignments' then
    if new.id is distinct from old.id
      or new.group_id is distinct from old.group_id
      or new.teacher_id is distinct from old.teacher_id
      or new.week_start is distinct from old.week_start
      or new.assigned_by is distinct from old.assigned_by
      or new.created_at is distinct from old.created_at
      or (old.active = false and new.active = true)
    then
      raise exception 'Teacher assignment history is immutable; deactivate the assignment instead.';
    end if;
  end if;

  new.updated_at := now();

  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'protect_student_membership_identity_trigger') then
    create trigger protect_student_membership_identity_trigger
      before update on public.student_group_memberships
      for each row execute function public.protect_foundation_row_identity();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'protect_staff_membership_identity_trigger') then
    create trigger protect_staff_membership_identity_trigger
      before update on public.masjid_staff_memberships
      for each row execute function public.protect_foundation_row_identity();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'protect_teacher_assignment_identity_trigger') then
    create trigger protect_teacher_assignment_identity_trigger
      before update on public.group_teacher_assignments
      for each row execute function public.protect_foundation_row_identity();
  end if;
end;
$$;

-- Profiles: direct reads are caller-, assignment-, or masjid-scoped. Global
-- profile writes remain super-admin-only from the Phase 0 migration.
alter policy "Users can read own active profile"
  on public.profiles
  to authenticated
  using (id = (select auth.uid()) and active = true);

alter policy "Admins can read all profiles"
  on public.profiles
  to authenticated
  using ((select public.can_read_profile(id)));

alter policy "Admins can insert profiles"
  on public.profiles
  to authenticated
  with check ((select public.is_active_super_admin()));

alter policy "Admins can update profiles"
  on public.profiles
  to authenticated
  using ((select public.is_active_super_admin()))
  with check ((select public.is_active_super_admin()));

-- Check-ins.
alter policy "Students can read own checkins"
  on public.checkins
  to authenticated
  using (student_id = (select auth.uid()) and (select public.is_active_student()));

alter policy "Students can create own checkins"
  on public.checkins
  to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.is_active_student())
    and public.student_scope_snapshot_matches(
      student_id,
      public.week_start_for_date(date),
      masjid_id,
      cohort_id,
      halaqa_group_id
    )
  );

alter policy "Students can update own checkins"
  on public.checkins
  to authenticated
  using (student_id = (select auth.uid()) and (select public.is_active_student()))
  with check (
    student_id = (select auth.uid())
    and (select public.is_active_student())
    and public.student_scope_snapshot_matches(
      student_id,
      public.week_start_for_date(date),
      masjid_id,
      cohort_id,
      halaqa_group_id
    )
  );

alter policy "Admins can read all checkins"
  on public.checkins
  to authenticated
  using (
    public.can_read_operational_student_row(
      masjid_id,
      halaqa_group_id,
      public.week_start_for_date(date)
    )
  );

alter policy "Admins can insert checkins"
  on public.checkins
  to authenticated
  with check (false);

alter policy "Admins can update checkins"
  on public.checkins
  to authenticated
  using (false)
  with check (false);

alter policy "Admins can delete checkins"
  on public.checkins
  to authenticated
  using (false);

-- Check-in items inherit their authorization and row identity from the parent.
alter policy "Students can read own checkin items"
  on public.checkin_items
  to authenticated
  using (student_id = (select auth.uid()) and (select public.is_active_student()));

alter policy "Students can create own checkin items"
  on public.checkin_items
  to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.is_active_student())
    and exists (
      select 1 from public.checkins
      where checkins.id = checkin_items.checkin_id
        and checkins.student_id = checkin_items.student_id
        and checkins.date = checkin_items.date
    )
  );

alter policy "Students can update own checkin items"
  on public.checkin_items
  to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.is_active_student())
    and exists (
      select 1 from public.checkins
      where checkins.id = checkin_items.checkin_id
        and checkins.student_id = checkin_items.student_id
        and checkins.date = checkin_items.date
    )
  )
  with check (
    student_id = (select auth.uid())
    and (select public.is_active_student())
    and exists (
      select 1 from public.checkins
      where checkins.id = checkin_items.checkin_id
        and checkins.student_id = checkin_items.student_id
        and checkins.date = checkin_items.date
    )
  );

alter policy "Admins can read all checkin items"
  on public.checkin_items
  to authenticated
  using (
    exists (
      select 1 from public.checkins
      where checkins.id = checkin_items.checkin_id
        and checkins.student_id = checkin_items.student_id
        and checkins.date = checkin_items.date
        and public.can_read_operational_student_row(
          checkins.masjid_id,
          checkins.halaqa_group_id,
          public.week_start_for_date(checkins.date)
        )
    )
  );

alter policy "Admins can insert checkin items"
  on public.checkin_items
  to authenticated
  with check (false);

alter policy "Admins can update checkin items"
  on public.checkin_items
  to authenticated
  using (false)
  with check (false);

alter policy "Admins can delete checkin items"
  on public.checkin_items
  to authenticated
  using (false);

-- Weekly plan metadata and storage-path ownership.
alter policy "Students can read own weekly plans"
  on public.weekly_plans
  to authenticated
  using (student_id = (select auth.uid()) and (select public.is_active_student()));

alter policy "Students can insert own weekly plans"
  on public.weekly_plans
  to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.is_active_student())
    and public.weekly_plan_path_is_owned(student_id, week_start, file_path)
    and public.student_scope_snapshot_matches(
      student_id,
      public.week_start_for_date(week_start + 1),
      masjid_id,
      cohort_id,
      halaqa_group_id
    )
  );

alter policy "Students can update own weekly plans"
  on public.weekly_plans
  to authenticated
  using (student_id = (select auth.uid()) and (select public.is_active_student()))
  with check (
    student_id = (select auth.uid())
    and (select public.is_active_student())
    and public.weekly_plan_path_is_owned(student_id, week_start, file_path)
    and public.student_scope_snapshot_matches(
      student_id,
      public.week_start_for_date(week_start + 1),
      masjid_id,
      cohort_id,
      halaqa_group_id
    )
  );

alter policy "Admins can read all weekly plans"
  on public.weekly_plans
  to authenticated
  using (
    public.can_read_operational_student_row(masjid_id, halaqa_group_id, week_start)
  );

-- Partner recitation.
alter policy "Students can read own partner recitations"
  on public.partner_recitations
  to authenticated
  using (student_id = (select auth.uid()) and (select public.is_active_student()));

alter policy "Students can create current partner recitations"
  on public.partner_recitations
  to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.is_active_student())
    and week_start = public.week_start_for_date(public.current_effective_date())
    and round = public.current_partner_recitation_round()
    and points = 75
    and public.student_scope_snapshot_matches(
      student_id, week_start, masjid_id, cohort_id, halaqa_group_id
    )
  );

alter policy "Admins can read all partner recitations"
  on public.partner_recitations
  to authenticated
  using (public.can_read_operational_student_row(masjid_id, halaqa_group_id, week_start));

alter policy "Admins can insert partner recitations"
  on public.partner_recitations
  to authenticated
  with check (
    public.is_admin_for_masjid(masjid_id)
    and public.student_scope_snapshot_matches(
      student_id, week_start, masjid_id, cohort_id, halaqa_group_id
    )
  );

alter policy "Admins can update partner recitations"
  on public.partner_recitations
  to authenticated
  using (public.is_admin_for_masjid(masjid_id))
  with check (
    public.is_admin_for_masjid(masjid_id)
    and public.student_scope_snapshot_matches(
      student_id, week_start, masjid_id, cohort_id, halaqa_group_id
    )
  );

alter policy "Admins can delete partner recitations"
  on public.partner_recitations
  to authenticated
  using (public.is_admin_for_masjid(masjid_id));

-- Halaqa grades: teachers are exact assignment/week scoped.
alter policy "Students can read own halaqa grades"
  on public.halaqa_grades
  to authenticated
  using (student_id = (select auth.uid()) and (select public.is_active_student()));

alter policy "Admins can read all halaqa grades"
  on public.halaqa_grades
  to authenticated
  using (public.can_read_operational_student_row(masjid_id, halaqa_group_id, week_start));

alter policy "Admins can insert halaqa grades"
  on public.halaqa_grades
  to authenticated
  with check (
    public.can_grade_student_for_week(student_id, week_start)
    and graded_by = (select auth.uid())
    and public.student_scope_snapshot_matches(
      student_id, week_start, masjid_id, cohort_id, halaqa_group_id
    )
  );

alter policy "Admins can update halaqa grades"
  on public.halaqa_grades
  to authenticated
  using (public.can_grade_student_for_week(student_id, week_start))
  with check (
    public.can_grade_student_for_week(student_id, week_start)
    and graded_by = (select auth.uid())
    and public.student_scope_snapshot_matches(
      student_id, week_start, masjid_id, cohort_id, halaqa_group_id
    )
  );

-- Incentive and accountability rows are masjid-scoped for admins. Students
-- retain only the existing owned reads and self-attestation update.
alter policy "Admins can read weekly incentive runs"
  on public.weekly_incentive_runs
  to authenticated
  using (public.is_admin_for_masjid(masjid_id));

alter policy "Admins can insert weekly incentive runs"
  on public.weekly_incentive_runs
  to authenticated
  with check (public.is_admin_for_masjid(masjid_id));

alter policy "Admins can update weekly incentive runs"
  on public.weekly_incentive_runs
  to authenticated
  using (public.is_admin_for_masjid(masjid_id))
  with check (public.is_admin_for_masjid(masjid_id));

alter policy "Students can read own accountability obligations"
  on public.accountability_obligations
  to authenticated
  using (student_id = (select auth.uid()) and (select public.is_active_student()));

alter policy "Students can attest own pending accountability obligations"
  on public.accountability_obligations
  to authenticated
  using (
    student_id = (select auth.uid())
    and (select public.is_active_student())
    and status = 'pending'
  )
  with check (
    student_id = (select auth.uid())
    and (select public.is_active_student())
    and status = 'attested_paid'
    and attested_paid_at is not null
    and public.student_scope_snapshot_matches(
      student_id, week_start, masjid_id, cohort_id, halaqa_group_id
    )
  );

alter policy "Admins can read all accountability obligations"
  on public.accountability_obligations
  to authenticated
  using (public.is_admin_for_masjid(masjid_id));

alter policy "Admins can insert accountability obligations"
  on public.accountability_obligations
  to authenticated
  with check (
    public.is_admin_for_masjid(masjid_id)
    and public.student_scope_snapshot_matches(
      student_id, week_start, masjid_id, cohort_id, halaqa_group_id
    )
  );

alter policy "Admins can update accountability obligations"
  on public.accountability_obligations
  to authenticated
  using (public.is_admin_for_masjid(masjid_id))
  with check (
    public.is_admin_for_masjid(masjid_id)
    and public.student_scope_snapshot_matches(
      student_id, week_start, masjid_id, cohort_id, halaqa_group_id
    )
  );

alter policy "Students can read own badge awards"
  on public.badge_awards
  to authenticated
  using (student_id = (select auth.uid()) and (select public.is_active_student()));

alter policy "Admins can read all badge awards"
  on public.badge_awards
  to authenticated
  using (public.is_admin_for_masjid(masjid_id));

alter policy "Admins can insert badge awards"
  on public.badge_awards
  to authenticated
  with check (
    public.is_admin_for_masjid(masjid_id)
    and public.student_scope_snapshot_matches(
      student_id, week_start, masjid_id, cohort_id, halaqa_group_id
    )
  );

alter policy "Admins can update badge awards"
  on public.badge_awards
  to authenticated
  using (public.is_admin_for_masjid(masjid_id))
  with check (
    public.is_admin_for_masjid(masjid_id)
    and public.student_scope_snapshot_matches(
      student_id, week_start, masjid_id, cohort_id, halaqa_group_id
    )
  );

-- Foundation hierarchy reads now follow caller scope instead of exposing all
-- active masajid/cohorts/groups to every signed-in user.
alter policy "Active users can read active masajid"
  on public.masajid
  to authenticated
  using ((select public.can_read_masjid(id)));

alter policy "Active users can read active cohorts"
  on public.cohorts
  to authenticated
  using ((select public.can_read_cohort(id)));

alter policy "Active users can read active halaqa groups"
  on public.halaqa_groups
  to authenticated
  using ((select public.can_read_group(id)));

-- Foundation setup remains a super-admin capability. Rotation's scoped group
-- creation continues through its guarded server-only service path.
alter policy "Admins can manage masajid foundation data"
  on public.masajid
  to authenticated
  using ((select public.is_active_super_admin()))
  with check ((select public.is_active_super_admin()));

alter policy "Admins can manage cohort foundation data"
  on public.cohorts
  to authenticated
  using ((select public.is_active_super_admin()))
  with check ((select public.is_active_super_admin()));

alter policy "Admins can manage halaqa group foundation data"
  on public.halaqa_groups
  to authenticated
  using ((select public.is_active_super_admin()))
  with check ((select public.is_active_super_admin()));

alter policy "Students can read own group memberships"
  on public.student_group_memberships
  to authenticated
  using (student_id = (select auth.uid()) and (select public.is_active_student()));

alter policy "Teachers can read assigned group memberships"
  on public.student_group_memberships
  to authenticated
  using (public.teacher_can_read_membership(group_id, starts_on, ends_on));

drop policy "Admins can manage student group memberships" on public.student_group_memberships;

create policy "Admins can read student membership history"
  on public.student_group_memberships
  for select
  to authenticated
  using (public.can_admin_manage_group_history(group_id));

create policy "Admins can insert student memberships"
  on public.student_group_memberships
  for insert
  to authenticated
  with check (
    (select public.is_active_super_admin())
    or (
      public.is_admin_for_masjid(public.group_masjid_id(group_id))
      and assigned_by = (select auth.uid())
      and exists (
        select 1 from public.profiles
        where profiles.id = student_id
          and profiles.role = 'student'
          and profiles.active = true
      )
      and public.can_read_profile(student_id)
    )
  );

create policy "Admins can close student memberships"
  on public.student_group_memberships
  for update
  to authenticated
  using (public.can_admin_manage_group_history(group_id))
  with check (public.can_admin_manage_group_history(group_id));

create policy "Super admins can delete student membership history"
  on public.student_group_memberships
  for delete
  to authenticated
  using ((select public.is_active_super_admin()));

alter policy "Users can read own staff memberships"
  on public.masjid_staff_memberships
  to authenticated
  using (
    profile_id = (select auth.uid())
    and exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.active = true
        and profiles.role in ('teacher', 'admin', 'super_admin')
    )
  );

drop policy "Admins can manage staff memberships" on public.masjid_staff_memberships;

create policy "Admins can read staff membership history"
  on public.masjid_staff_memberships
  for select
  to authenticated
  using (
    (select public.is_active_super_admin())
    or (staff_role = 'teacher' and public.is_admin_for_masjid(masjid_id))
  );

create policy "Admins can insert teacher staff memberships"
  on public.masjid_staff_memberships
  for insert
  to authenticated
  with check (
    (select public.is_active_super_admin())
    or (
      staff_role = 'teacher'
      and public.is_admin_for_masjid(masjid_id)
      and created_by = (select auth.uid())
      and exists (
        select 1 from public.profiles
        where profiles.id = profile_id
          and profiles.role = 'teacher'
          and profiles.active = true
      )
      and public.can_read_profile(profile_id)
    )
  );

create policy "Admins can close teacher staff memberships"
  on public.masjid_staff_memberships
  for update
  to authenticated
  using (
    (select public.is_active_super_admin())
    or (staff_role = 'teacher' and public.is_admin_for_masjid(masjid_id))
  )
  with check (
    (select public.is_active_super_admin())
    or (staff_role = 'teacher' and public.is_admin_for_masjid(masjid_id))
  );

create policy "Super admins can delete staff membership history"
  on public.masjid_staff_memberships
  for delete
  to authenticated
  using ((select public.is_active_super_admin()));

alter policy "Teachers can read own group assignments"
  on public.group_teacher_assignments
  to authenticated
  using (
    teacher_id = (select auth.uid())
    and active = true
    and public.is_rotation_teacher_for_masjid_week(
      teacher_id,
      public.group_masjid_id(group_id),
      week_start
    )
  );

drop policy "Admins can manage group teacher assignments" on public.group_teacher_assignments;

create policy "Admins can read teacher assignment history"
  on public.group_teacher_assignments
  for select
  to authenticated
  using (public.can_admin_manage_group_history(group_id));

create policy "Admins can insert teacher assignments"
  on public.group_teacher_assignments
  for insert
  to authenticated
  with check (
    (select public.is_active_super_admin())
    or (
      public.is_admin_for_masjid(public.group_masjid_id(group_id))
      and assigned_by = (select auth.uid())
      and public.is_rotation_teacher_for_masjid_week(
        teacher_id,
        public.group_masjid_id(group_id),
        week_start
      )
    )
  );

create policy "Admins can deactivate teacher assignments"
  on public.group_teacher_assignments
  for update
  to authenticated
  using (public.can_admin_manage_group_history(group_id))
  with check (public.can_admin_manage_group_history(group_id));

create policy "Super admins can delete teacher assignment history"
  on public.group_teacher_assignments
  for delete
  to authenticated
  using ((select public.is_active_super_admin()));

-- Rotation reads use the row's week instead of today's staff membership.
alter policy "Teachers can read own rotation availability"
  on public.teacher_rotation_availability
  to authenticated
  using (
    teacher_id = (select auth.uid())
    and public.is_rotation_teacher_for_masjid_week(teacher_id, masjid_id, week_start)
  );

alter policy "Admins can manage teacher rotation availability"
  on public.teacher_rotation_availability
  to authenticated
  using (public.is_admin_for_masjid(masjid_id))
  with check (public.is_admin_for_masjid(masjid_id));

alter policy "Admins can manage cohort rotation settings"
  on public.cohort_rotation_settings
  to authenticated
  using (public.is_admin_for_masjid(masjid_id))
  with check (public.is_admin_for_masjid(masjid_id));

drop policy "Admins can manage teacher rotation runs" on public.teacher_rotation_runs;

create policy "Admins can read teacher rotation runs"
  on public.teacher_rotation_runs
  for select
  to authenticated
  using (public.is_admin_for_masjid(public.cohort_masjid_id(cohort_id)));

-- Weekly-plan objects are mutated only by guarded server actions. Signed-in
-- clients retain scoped SELECT for signed-link creation, but cannot bypass the
-- metadata workflow by directly inserting, replacing, or deleting objects.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Students can upload own weekly plan files'
  ) then
    alter policy "Students can upload own weekly plan files"
      on storage.objects to authenticated
      with check (false);
  else
    create policy "Students can upload own weekly plan files"
      on storage.objects for insert to authenticated
      with check (false);
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Students can update own weekly plan files'
  ) then
    alter policy "Students can update own weekly plan files"
      on storage.objects to authenticated
      using (false)
      with check (false);
  else
    create policy "Students can update own weekly plan files"
      on storage.objects for update to authenticated
      using (false)
      with check (false);
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Students can read own weekly plan files'
  ) then
    alter policy "Students can read own weekly plan files"
      on storage.objects to authenticated
      using (
        bucket_id = 'weekly-plans'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and public.is_active_student()
      );
  else
    create policy "Students can read own weekly plan files"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'weekly-plans'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and public.is_active_student()
      );
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Students can delete replaced weekly plan files'
  ) then
    alter policy "Students can delete replaced weekly plan files"
      on storage.objects to authenticated
      using (false);
  else
    create policy "Students can delete replaced weekly plan files"
      on storage.objects for delete to authenticated
      using (false);
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Admins can read weekly plan files'
  ) then
    alter policy "Admins can read weekly plan files"
      on storage.objects
      to authenticated
      using (
        bucket_id = 'weekly-plans'
        and public.can_admin_read_weekly_plan_path(name)
      );
  else
    create policy "Admins can read weekly plan files"
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'weekly-plans'
        and public.can_admin_read_weekly_plan_path(name)
      );
  end if;
end;
$$;

-- Restrictive policies make direct signed-client writes impossible even if an
-- existing deployment has additional permissive policies under other names.
create policy "Weekly plan object inserts are server-only"
  on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (bucket_id <> 'weekly-plans');

create policy "Weekly plan object updates are server-only"
  on storage.objects
  as restrictive
  for update
  to authenticated
  using (bucket_id <> 'weekly-plans')
  with check (bucket_id <> 'weekly-plans');

create policy "Weekly plan object deletes are server-only"
  on storage.objects
  as restrictive
  for delete
  to authenticated
  using (bucket_id <> 'weekly-plans');

-- Audit events remain immutable to ordinary roles even if table defaults vary.
revoke all on table public.super_admin_audit_events from public, anon, authenticated;
grant select on table public.super_admin_audit_events to authenticated;
revoke all on table public.super_admin_audit_events from service_role;
grant select, insert on table public.super_admin_audit_events to service_role;

-- This trigger must keep enforcing rotation row snapshots when the guarded
-- service-role workflow writes them. Run its internal helper calls as the
-- application owner without exposing the trigger function as an RPC.
alter function public.teacher_rotation_row_scope_matches() security definer;
alter function public.teacher_rotation_row_scope_matches() set search_path = '';

-- Harden function ownership boundaries. PostgreSQL grants EXECUTE to PUBLIC by
-- default. Keep the application-owned SECURITY DEFINER surface explicit so an
-- extension or externally managed function installed in public is never swept
-- by this migration. The disposable catalog test consumes this same allowlist.
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
    'public.cohort_masjid_id(uuid)',
    'public.current_effective_date()',
    'public.current_partner_recitation_round()',
    'public.enforce_student_accountability_attestation()',
    'public.enforce_student_checkin_integrity()',
    'public.enforce_student_checkin_item_integrity()',
    'public.group_masjid_id(uuid)',
    'public.is_active_admin()',
    'public.is_active_student()',
    'public.is_active_super_admin()',
    'public.is_active_teacher()',
    'public.is_admin_for_masjid(uuid)',
    'public.is_rotation_teacher_for_masjid_week(uuid,uuid,date)',
    'public.is_staff_for_masjid(uuid)',
    'public.is_teacher_for_group_week(uuid,date)',
    'public.protect_foundation_row_identity()',
    'public.recalculate_student_checkin_score()',
    'public.set_student_scope_snapshot()',
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
    'public.teacher_can_read_membership(uuid,date,date)',
    'public.teacher_rotation_row_scope_matches()'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;

do $$
declare
  function_signature text;
  invalid_functions text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into invalid_functions
  from private.application_security_definer_oids() listed
  join pg_proc p on p.oid = listed.function_oid
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname <> 'public'
    or not p.prosecdef
    or p.proowner <> (
      select anchor.proowner
      from pg_proc anchor
      where anchor.oid = 'public.is_active_admin()'::regprocedure
    )
    or exists (
      select 1
      from pg_depend dependency
      join pg_extension extension on extension.oid = dependency.refobjid
      where dependency.classid = 'pg_proc'::regclass
        and dependency.objid = p.oid
        and dependency.refclassid = 'pg_extension'::regclass
        and dependency.deptype = 'e'
    );

  if invalid_functions is not null then
    raise exception 'Invalid application SECURITY DEFINER allowlist entries: %', invalid_functions;
  end if;

  for function_signature in
    select listed.function_oid::regprocedure::text
    from private.application_security_definer_oids() listed
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated, service_role',
      function_signature
    );
  end loop;
end;
$$;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

grant execute on function public.is_active_admin() to authenticated;
grant execute on function public.is_active_student() to authenticated;
grant execute on function public.is_active_teacher() to authenticated;
grant execute on function public.is_active_super_admin() to authenticated;
grant execute on function public.current_effective_date() to authenticated;
grant execute on function public.week_start_for_date(date) to authenticated;
grant execute on function public.current_partner_recitation_round() to authenticated;
grant execute on function public.is_admin_for_masjid(uuid) to authenticated;
grant execute on function public.is_staff_for_masjid(uuid) to authenticated;
grant execute on function public.is_teacher_for_group_week(uuid, date) to authenticated;
grant execute on function public.can_read_student_for_week(uuid, date) to authenticated;
grant execute on function public.can_grade_student_for_week(uuid, date) to authenticated;
grant execute on function public.can_admin_manage_student_for_week(uuid, date) to authenticated;
grant execute on function public.can_admin_delete_student(uuid) to authenticated;
grant execute on function public.can_admin_manage_group_history(uuid) to authenticated;
grant execute on function public.student_group_for_week(uuid, date) to authenticated;
grant execute on function public.student_current_group_id(uuid) to authenticated;
grant execute on function public.student_cohort_for_week(uuid, date) to authenticated;
grant execute on function public.student_masjid_for_week(uuid, date) to authenticated;
grant execute on function public.group_masjid_id(uuid) to authenticated;
grant execute on function public.cohort_masjid_id(uuid) to authenticated;
grant execute on function public.can_read_profile(uuid) to authenticated;
grant execute on function public.can_read_masjid(uuid) to authenticated;
grant execute on function public.can_read_cohort(uuid) to authenticated;
grant execute on function public.can_read_group(uuid) to authenticated;
grant execute on function public.can_read_operational_student_row(uuid, uuid, date) to authenticated;
grant execute on function public.student_scope_snapshot_matches(uuid, date, uuid, uuid, uuid) to authenticated;
grant execute on function public.teacher_can_read_membership(uuid, date, date) to authenticated;
grant execute on function public.is_rotation_teacher_for_masjid_week(uuid, uuid, date) to authenticated;
grant execute on function public.weekly_plan_path_is_owned(uuid, date, text) to authenticated;
grant execute on function public.can_admin_read_weekly_plan_path(text) to authenticated;
grant execute on function public.student_weekly_teacher_name(date) to authenticated;
grant execute on function public.student_cohort_leaderboard_for_week(date) to authenticated;
grant execute on function public.student_leaderboard_available_weeks() to authenticated;
grant execute on function public.admin_students_for_week(date) to authenticated;
grant execute on function public.apply_admin_checkin_correction(uuid, date, text, text, text[]) to authenticated;

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

-- Definer functions use an empty search path. Trigger functions are invoked by
-- their owning trigger and are intentionally not executable by browser roles.
alter function public.is_active_admin() set search_path = '';
alter function public.is_active_student() set search_path = '';
alter function public.is_active_teacher() set search_path = '';
alter function public.is_active_super_admin() set search_path = '';
alter function public.current_effective_date() set search_path = '';
alter function public.current_partner_recitation_round() set search_path = '';
alter function public.student_weekly_teacher(uuid, date) set search_path = '';
alter function public.student_cohort_students_for_week(uuid, date) set search_path = '';
alter function public.admin_students_for_week(date) set search_path = '';
alter function public.enforce_student_accountability_attestation() set search_path = '';
alter function public.set_student_scope_snapshot() set search_path = '';
alter function public.teacher_rotation_row_scope_matches() set search_path = '';
alter function public.protect_foundation_row_identity() set search_path = '';
alter function public.apply_teacher_rotation_generation(
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
) set search_path = '';

revoke execute on function public.enforce_student_accountability_attestation() from public, anon, authenticated;
revoke execute on function public.set_student_scope_snapshot() from public, anon, authenticated;
revoke execute on function public.teacher_rotation_row_scope_matches() from public, anon, authenticated;
revoke execute on function public.protect_foundation_row_identity() from public, anon, authenticated;
