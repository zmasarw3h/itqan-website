-- Access-transition semantics and role projection.
--
-- Staff grants are additive. Guided Change uses the guarded access-change RPC
-- for selected-masjid replacement. The profile role is a cached projection of
-- capabilities effective on the current Toronto civil date; it is never used
-- as the sole authorization boundary. Hierarchy activity is a projection
-- dependency and is invalidated atomically by the triggers below.

alter table public.profiles
  add column if not exists access_deactivated_on date;

-- Existing inactive rows are intentionally kept inactive until an explicit
-- guarded access change clears this marker. This prevents a future membership
-- or a later hierarchy transition from acting as an implicit scheduler.
update public.profiles
set access_deactivated_on = public.current_toronto_civil_date()
where active = false
  and access_deactivated_on is null;

create or replace function private.raw_profile_access_projection(
  input_profile_id uuid,
  input_effective_date date default null
)
returns table(role text, active boolean)
language sql
stable
set search_path = ''
as $$
  with effective as (
    select coalesce(input_effective_date, public.current_toronto_civil_date()) as effective_date
  )
  select
    case
      when profiles.access_deactivated_on is not null
        and profiles.access_deactivated_on <= effective.effective_date then profiles.role
      when profiles.role = 'super_admin' then 'super_admin'
      when exists (
        select 1
        from public.masjid_staff_memberships as memberships
        join public.masajid on masajid.id = memberships.masjid_id
        where memberships.profile_id = profiles.id
          and memberships.staff_role = 'admin'
          and memberships.active = true
          and masajid.active = true
          and memberships.starts_on <= effective.effective_date
          and (memberships.ends_on is null or memberships.ends_on >= effective.effective_date)
      ) then 'admin'
      when exists (
        select 1
        from public.masjid_staff_memberships as memberships
        join public.masajid on masajid.id = memberships.masjid_id
        where memberships.profile_id = profiles.id
          and memberships.staff_role = 'teacher'
          and memberships.active = true
          and masajid.active = true
          and memberships.starts_on <= effective.effective_date
          and (memberships.ends_on is null or memberships.ends_on >= effective.effective_date)
      ) then 'teacher'
      when exists (
        select 1
        from public.student_group_memberships as memberships
        join public.halaqa_groups as groups on groups.id = memberships.group_id
        join public.cohorts on cohorts.id = groups.cohort_id
        join public.masajid on masajid.id = cohorts.masjid_id
        where memberships.student_id = profiles.id
          and groups.active = true
          and cohorts.active = true
          and masajid.active = true
          and memberships.starts_on <= effective.effective_date
          and (memberships.ends_on is null or memberships.ends_on >= effective.effective_date)
      ) then 'student'
      else profiles.role
    end as role,
    case
      when profiles.access_deactivated_on is not null
        and profiles.access_deactivated_on <= effective.effective_date then false
      when profiles.role = 'super_admin' then profiles.active
      when exists (
        select 1
        from public.masjid_staff_memberships as memberships
        join public.masajid on masajid.id = memberships.masjid_id
        where memberships.profile_id = profiles.id
          and memberships.staff_role in ('admin', 'teacher')
          and memberships.active = true
          and masajid.active = true
          and memberships.starts_on <= effective.effective_date
          and (memberships.ends_on is null or memberships.ends_on >= effective.effective_date)
      ) then true
      when exists (
        select 1
        from public.student_group_memberships as memberships
        join public.halaqa_groups as groups on groups.id = memberships.group_id
        join public.cohorts on cohorts.id = groups.cohort_id
        join public.masajid on masajid.id = cohorts.masjid_id
        where memberships.student_id = profiles.id
          and groups.active = true
          and cohorts.active = true
          and masajid.active = true
          and memberships.starts_on <= effective.effective_date
          and (memberships.ends_on is null or memberships.ends_on >= effective.effective_date)
      ) then true
      else false
    end as active
  from public.profiles
  cross join effective
  where profiles.id = input_profile_id;
$$;

create or replace function private.recompute_profile_access(
  input_profile_id uuid,
  input_effective_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  projected record;
  current_profile public.profiles%rowtype;
begin
  select profiles.*
  into current_profile
  from public.profiles
  where profiles.id = input_profile_id
  for update;

  if not found then
    return null;
  end if;

  select projection.role, projection.active
  into projected
  from private.raw_profile_access_projection(input_profile_id, input_effective_date) as projection;

  if found and (current_profile.role, current_profile.active) is distinct from (projected.role, projected.active) then
    update public.profiles
    set role = projected.role,
        active = projected.active
    where id = input_profile_id;
  end if;

  return jsonb_build_object(
    'id', input_profile_id,
    'role', coalesce(projected.role, current_profile.role),
    'active', coalesce(projected.active, current_profile.active)
  );
end;
$$;

create or replace function private.project_staff_membership_profile_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.recompute_profile_access(old.profile_id);
    return old;
  end if;

  perform private.recompute_profile_access(new.profile_id);

  if tg_op = 'UPDATE' and old.profile_id is distinct from new.profile_id then
    perform private.recompute_profile_access(old.profile_id);
  end if;

  return new;
end;
$$;

create or replace function private.project_student_membership_profile_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.recompute_profile_access(old.student_id);
    return old;
  end if;

  perform private.recompute_profile_access(new.student_id);

  if tg_op = 'UPDATE' and old.student_id is distinct from new.student_id then
    perform private.recompute_profile_access(old.student_id);
  end if;

  return new;
end;
$$;

drop trigger if exists project_staff_membership_profile_access
  on public.masjid_staff_memberships;

create trigger project_staff_membership_profile_access
  after insert or update or delete on public.masjid_staff_memberships
  for each row
  execute function private.project_staff_membership_profile_access();

drop trigger if exists project_student_membership_profile_access
  on public.student_group_memberships;

create trigger project_student_membership_profile_access
  after insert or update or delete on public.student_group_memberships
  for each row
  execute function private.project_student_membership_profile_access();

create or replace function public.refresh_current_profile_role()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row public.profiles%rowtype;
  projected record;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authenticated user is required.';
  end if;

  select profiles.*
  into profile_row
  from public.profiles
  where profiles.id = auth.uid();

  if not found then
    raise exception using errcode = 'P0002', message = 'profile does not exist.';
  end if;

  select projection.role, projection.active
  into projected
  from private.raw_profile_access_projection(auth.uid(), public.current_toronto_civil_date()) as projection;

  -- This RPC is a guarded repair tool, not a scheduler. An intentionally
  -- inactive profile stays inactive even if a stale/future row would otherwise
  -- make the raw projection active. Hierarchy transitions use the atomic
  -- invalidation triggers above when reactivation is intentional.
  if not profile_row.active and projected.active then
    return jsonb_build_object(
      'id', profile_row.id,
      'role', profile_row.role,
      'active', false,
      'repair_required', true
    );
  end if;

  return private.recompute_profile_access(auth.uid(), public.current_toronto_civil_date());
end;
$$;

grant execute on function public.refresh_current_profile_role() to authenticated;
revoke execute on function public.refresh_current_profile_role() from public, anon, service_role;

do $$
declare
  profile_row record;
begin
  for profile_row in select profiles.id from public.profiles loop
    perform private.recompute_profile_access(profile_row.id, public.current_toronto_civil_date());
  end loop;
end;
$$;

-- Design A: hierarchy activity remains part of the cached projection. Every
-- hierarchy state transition therefore recomputes the profiles whose staff or
-- student capability depends on that masjid, including memberships inserted
-- before the masjid/cohort/group becomes active.
create or replace function private.recompute_profiles_for_masjid(input_masjid_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row record;
begin
  if input_masjid_id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('profile-hierarchy:' || input_masjid_id::text, 0)
  );

  for profile_row in
    select distinct candidates.profile_id
    from (
      select memberships.profile_id
      from public.masjid_staff_memberships as memberships
      where memberships.masjid_id = input_masjid_id
      union
      select memberships.student_id
      from public.student_group_memberships as memberships
      join public.halaqa_groups as groups on groups.id = memberships.group_id
      join public.cohorts on cohorts.id = groups.cohort_id
      where cohorts.masjid_id = input_masjid_id
    ) as candidates
    order by candidates.profile_id
  loop
    perform private.recompute_profile_access(profile_row.profile_id, public.current_toronto_civil_date());
  end loop;
end;
$$;

create or replace function private.project_masjid_profile_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.recompute_profiles_for_masjid(old.id);
    return old;
  end if;

  perform private.recompute_profiles_for_masjid(new.id);
  return new;
end;
$$;

create or replace function private.project_cohort_profile_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.recompute_profiles_for_masjid(old.masjid_id);
    return old;
  end if;

  perform private.recompute_profiles_for_masjid(new.masjid_id);
  if tg_op = 'UPDATE' and old.masjid_id is distinct from new.masjid_id then
    perform private.recompute_profiles_for_masjid(old.masjid_id);
  end if;
  return new;
end;
$$;

create or replace function private.project_group_profile_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_masjid_id uuid;
  old_masjid_id uuid;
begin
  if tg_op <> 'DELETE' then
    select cohorts.masjid_id
    into new_masjid_id
    from public.cohorts
    where cohorts.id = new.cohort_id;
    perform private.recompute_profiles_for_masjid(new_masjid_id);
  end if;

  if tg_op <> 'INSERT' then
    select cohorts.masjid_id
    into old_masjid_id
    from public.cohorts
    where cohorts.id = old.cohort_id;
    if tg_op = 'DELETE' or old_masjid_id is distinct from new_masjid_id then
      perform private.recompute_profiles_for_masjid(old_masjid_id);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists project_masjid_profile_access on public.masajid;
create trigger project_masjid_profile_access
  after insert or update or delete on public.masajid
  for each row execute function private.project_masjid_profile_access();

drop trigger if exists project_cohort_profile_access on public.cohorts;
create trigger project_cohort_profile_access
  after insert or update or delete on public.cohorts
  for each row execute function private.project_cohort_profile_access();

drop trigger if exists project_group_profile_access on public.halaqa_groups;
create trigger project_group_profile_access
  after insert or update or delete on public.halaqa_groups
  for each row execute function private.project_group_profile_access();

create or replace function private.person_access_state(input_target_profile_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', profiles.id,
      'role', projection.role,
      'active', projection.active,
      'access_deactivated_on', profiles.access_deactivated_on
    ),
    'student_memberships', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', memberships.id,
          'student_id', memberships.student_id,
          'group_id', memberships.group_id,
          'starts_on', memberships.starts_on,
          'ends_on', memberships.ends_on,
          'assigned_by', memberships.assigned_by,
          'created_at', memberships.created_at,
          'updated_at', memberships.updated_at
        ) order by memberships.id
      )
      from public.student_group_memberships as memberships
      where memberships.student_id = profiles.id
    ), '[]'::jsonb),
    'staff_memberships', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', memberships.id,
          'profile_id', memberships.profile_id,
          'masjid_id', memberships.masjid_id,
          'staff_role', memberships.staff_role,
          'active', memberships.active,
          'starts_on', memberships.starts_on,
          'ends_on', memberships.ends_on,
          'created_by', memberships.created_by,
          'created_at', memberships.created_at,
          'updated_at', memberships.updated_at
        ) order by memberships.id
      )
      from public.masjid_staff_memberships as memberships
      where memberships.profile_id = profiles.id
    ), '[]'::jsonb)
  )
  from public.profiles
  cross join lateral private.raw_profile_access_projection(
    profiles.id,
    public.current_toronto_civil_date()
  ) as projection
  where profiles.id = input_target_profile_id;
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
    from public.masjid_staff_memberships as memberships
    join public.masajid on masajid.id = memberships.masjid_id
    cross join lateral private.raw_profile_access_projection(input_actor_id, input_effective_date) as projection
    where memberships.profile_id = input_actor_id
      and memberships.masjid_id = input_masjid_id
      and memberships.staff_role = 'admin'
      and memberships.active = true
      and masajid.active = true
      and memberships.starts_on <= input_effective_date
      and (memberships.ends_on is null or memberships.ends_on >= input_effective_date)
      and projection.role = 'admin'
      and projection.active = true
  );
$$;

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select projection.role = 'admin' and projection.active
    from private.raw_profile_access_projection(auth.uid(), public.current_toronto_civil_date()) as projection), false);
$$;

create or replace function public.is_active_student()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select projection.role = 'student' and projection.active
    from private.raw_profile_access_projection(auth.uid(), public.current_toronto_civil_date()) as projection), false);
$$;

create or replace function public.is_active_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.masjid_staff_memberships as memberships
    join public.masajid on masajid.id = memberships.masjid_id
    cross join lateral private.raw_profile_access_projection(auth.uid(), public.current_toronto_civil_date()) as projection
    where memberships.profile_id = auth.uid()
      and memberships.staff_role = 'teacher'
      and memberships.active = true
      and masajid.active = true
      and memberships.starts_on <= public.current_toronto_civil_date()
      and (memberships.ends_on is null or memberships.ends_on >= public.current_toronto_civil_date())
      and projection.active = true
      and projection.role in ('teacher', 'admin')
  );
$$;

create or replace function public.is_admin_for_masjid(input_masjid_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_super_admin()
    or private.raw_is_admin_for_masjid(auth.uid(), input_masjid_id, public.current_toronto_civil_date());
$$;

create or replace function public.is_staff_for_masjid(input_masjid_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_super_admin()
    or exists (
      select 1
      from public.masjid_staff_memberships as memberships
      join public.masajid on masajid.id = memberships.masjid_id
      cross join lateral private.raw_profile_access_projection(auth.uid(), public.current_toronto_civil_date()) as projection
      where memberships.profile_id = auth.uid()
        and memberships.masjid_id = input_masjid_id
        and memberships.active = true
        and masajid.active = true
        and memberships.starts_on <= public.current_toronto_civil_date()
        and (memberships.ends_on is null or memberships.ends_on >= public.current_toronto_civil_date())
        and projection.active = true
        and projection.role in ('admin', 'teacher')
    );
$$;

create or replace function private.assert_masjid_admin_coverage(input_masjid_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  boundary_date date;
  current_date_in_app date := public.current_toronto_civil_date();
begin
  if not exists (
    select 1
    from public.masajid
    where masajid.id = input_masjid_id
      and masajid.active = true
  ) then
    return;
  end if;

  if not exists (
    select 1
    from public.masjid_staff_memberships as memberships
    join lateral private.raw_profile_access_projection(memberships.profile_id, memberships.starts_on) as projection on true
    where memberships.masjid_id = input_masjid_id
      and memberships.staff_role = 'admin'
      and memberships.active = true
      and memberships.ends_on is null
      and projection.role = 'admin'
      and projection.active = true
  ) then
    raise exception using errcode = '23514', message = 'an active masjid must retain open-ended future admin coverage.';
  end if;

  for boundary_date in
    select distinct boundaries.coverage_date
    from (
      select current_date_in_app as coverage_date
      union all
      select memberships.starts_on
      from public.masjid_staff_memberships as memberships
      where memberships.masjid_id = input_masjid_id
        and memberships.staff_role = 'admin'
        and memberships.active = true
        and memberships.starts_on >= current_date_in_app
      union all
      select memberships.ends_on + 1
      from public.masjid_staff_memberships as memberships
      where memberships.masjid_id = input_masjid_id
        and memberships.staff_role = 'admin'
        and memberships.active = true
        and memberships.ends_on is not null
        and memberships.ends_on + 1 >= current_date_in_app
    ) as boundaries
    order by boundaries.coverage_date
  loop
    if not exists (
      select 1
      from public.masjid_staff_memberships as memberships
      join lateral private.raw_profile_access_projection(memberships.profile_id, boundary_date) as projection on true
      join public.masajid on masajid.id = memberships.masjid_id
      where memberships.masjid_id = input_masjid_id
        and memberships.staff_role = 'admin'
        and memberships.active = true
        and memberships.starts_on <= boundary_date
        and (memberships.ends_on is null or memberships.ends_on >= boundary_date)
        and masajid.active = true
        and projection.role = 'admin'
        and projection.active = true
    ) then
      raise exception using errcode = '23514', message = 'an active masjid must retain continuous future admin coverage.';
    end if;
  end loop;
end;
$$;

create or replace function private.assert_teacher_assignment_removal_safe(
  input_teacher_id uuid,
  input_ends_on date,
  input_masjid_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.group_teacher_assignments as assignments
    join public.halaqa_groups as groups on groups.id = assignments.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
    where assignments.teacher_id = input_teacher_id
      and assignments.active = true
      and (input_masjid_id is null or cohorts.masjid_id = input_masjid_id)
      and public.halaqa_saturday_for_week(assignments.week_start) > input_ends_on
  ) then
    raise exception using
      errcode = '23514',
      message = 'teacher access cannot end before all active assignments'' halaqa Saturdays.';
  end if;
end;
$$;

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
    from public.masjid_staff_memberships as memberships
    join public.masajid on masajid.id = memberships.masjid_id
    cross join lateral private.raw_profile_access_projection(
      input_actor_id,
      public.halaqa_saturday_for_week(input_week_start)
    ) as projection
    where memberships.profile_id = input_actor_id
      and memberships.masjid_id = input_masjid_id
      and memberships.staff_role = 'teacher'
      and memberships.active = true
      and masajid.active = true
      and memberships.starts_on <= public.halaqa_saturday_for_week(input_week_start)
      and (memberships.ends_on is null or memberships.ends_on >= public.halaqa_saturday_for_week(input_week_start))
      and projection.active = true
      and projection.role in ('teacher', 'admin')
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
  select private.raw_teacher_has_halaqa_saturday_eligibility(
    input_actor_id,
    input_masjid_id,
    input_week_start
  );
$$;

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
    from public.masjid_staff_memberships as memberships
    join public.masajid on masajid.id = memberships.masjid_id
    cross join lateral private.raw_profile_access_projection(input_actor_id, input_request_date) as projection
    where memberships.profile_id = input_actor_id
      and memberships.masjid_id = input_masjid_id
      and memberships.staff_role = 'teacher'
      and memberships.active = true
      and masajid.active = true
      and memberships.starts_on <= input_request_date
      and (memberships.ends_on is null or memberships.ends_on >= input_request_date)
      and projection.active = true
      and projection.role in ('teacher', 'admin')
  );
$$;

-- Pure future-state simulation used by every future-dated access mutation.
-- The operation is evaluated at its transition date without writing a row, so
-- SQL enforcement and the TypeScript review can apply the same role/active
-- invariant before the mutation begins.
create or replace function private.project_profile_access_for_transition(
  input_profile_id uuid,
  input_transition_date date,
  input_operation text,
  input_masjid_id uuid default null,
  input_desired_staff_roles text[] default array[]::text[],
  input_student_group_id uuid default null,
  input_excluded_staff_membership_id uuid default null
)
returns table(role text, active boolean)
language sql
stable
set search_path = ''
as $$
  with profile_row as (
    select profiles.id, profiles.role as current_role, profiles.active as current_active
    from public.profiles
    where profiles.id = input_profile_id
  ),
  staff_roles as (
    select memberships.staff_role
    from public.masjid_staff_memberships as memberships
    join public.masajid on masajid.id = memberships.masjid_id
    where memberships.profile_id = input_profile_id
      and memberships.id is distinct from input_excluded_staff_membership_id
      and memberships.staff_role in ('admin', 'teacher')
      and memberships.active = true
      and masajid.active = true
      and memberships.starts_on <= input_transition_date
      and (memberships.ends_on is null or memberships.ends_on >= input_transition_date)
      and (
        input_operation not in ('replace_staff', 'student', 'inactive')
        or (input_operation = 'replace_staff' and memberships.masjid_id is distinct from input_masjid_id)
      )
    union all
    select desired.staff_role
    from unnest(coalesce(input_desired_staff_roles, array[]::text[])) as desired(staff_role)
    join public.masajid on masajid.id = input_masjid_id and masajid.active = true
    where input_operation in ('add_staff', 'replace_staff')
  ),
  staff_projection as (
    select
      coalesce(bool_or(staff_roles.staff_role = 'admin'), false) as has_admin,
      coalesce(bool_or(staff_roles.staff_role = 'teacher'), false) as has_teacher
    from staff_roles
  ),
  student_projection as (
    select exists (
      select 1
      from public.student_group_memberships as memberships
      join public.halaqa_groups as groups on groups.id = memberships.group_id
      join public.cohorts on cohorts.id = groups.cohort_id
      join public.masajid on masajid.id = cohorts.masjid_id
      where memberships.student_id = input_profile_id
        and groups.active = true
        and cohorts.active = true
        and masajid.active = true
        and memberships.starts_on <= input_transition_date
        and (memberships.ends_on is null or memberships.ends_on >= input_transition_date)
        and input_operation not in ('student', 'inactive')
    )
    or exists (
      select 1
      from public.halaqa_groups as groups
      join public.cohorts on cohorts.id = groups.cohort_id
      join public.masajid on masajid.id = cohorts.masjid_id
      where input_operation in ('student', 'add_student')
        and groups.id = input_student_group_id
        and groups.active = true
        and cohorts.active = true
        and masajid.active = true
    ) as has_student
  )
  select
    case
      when profile_row.current_role = 'super_admin' then 'super_admin'
      when staff_projection.has_admin then 'admin'
      when staff_projection.has_teacher then 'teacher'
      when student_projection.has_student then 'student'
      else profile_row.current_role
    end as role,
    case
      when profile_row.current_role = 'super_admin' then profile_row.current_active
      when staff_projection.has_admin or staff_projection.has_teacher or student_projection.has_student then true
      else false
    end as active
  from profile_row
  cross join staff_projection
  cross join student_projection;
$$;

create or replace function private.assert_future_profile_projection_unchanged(
  input_profile_id uuid,
  input_transition_date date,
  input_operation text,
  input_masjid_id uuid default null,
  input_desired_staff_roles text[] default array[]::text[],
  input_student_group_id uuid default null,
  input_excluded_staff_membership_id uuid default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  current_projection record;
  future_projection record;
begin
  if input_transition_date <= public.current_toronto_civil_date() then
    return;
  end if;

  select projection.role, projection.active
  into current_projection
  from private.raw_profile_access_projection(input_profile_id, public.current_toronto_civil_date()) as projection;

  select projection.role, projection.active
  into future_projection
  from private.project_profile_access_for_transition(
    input_profile_id,
    input_transition_date,
    input_operation,
    input_masjid_id,
    input_desired_staff_roles,
    input_student_group_id,
    input_excluded_staff_membership_id
  ) as projection;

  if (current_projection.role, current_projection.active)
    is distinct from (future_projection.role, future_projection.active) then
    raise exception using
      errcode = '23514',
      message = 'future access change would alter the profile role or active state; use an immediate change or preserve the current projection.';
  end if;
end;
$$;

-- The preparation RPC is the additive-grant preview boundary. Its snapshot
-- table is private, but enforce the same date and future-projection rules at
-- the table boundary so the preview cannot drift from the apply RPC.
create or replace function private.enforce_staff_grant_preview_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_date date;
  desired_roles text[];
  grant_masjid_id uuid;
begin
  if new.workflow <> 'masjid_staff_grant' then
    return new;
  end if;

  grant_date := (new.input_payload ->> 'starts_on')::date;
  grant_masjid_id := (new.input_payload ->> 'masjid_id')::uuid;

  if grant_date is null or grant_masjid_id is null then
    raise exception using errcode = '22023', message = 'staff grant preview is missing its effective date or masjid.';
  end if;

  if grant_date < public.current_toronto_civil_date() then
    raise exception using errcode = '22023', message = 'staff grant date cannot be historical.';
  end if;

  desired_roles := case new.input_payload ->> 'grant'
    when 'admin' then array['admin']::text[]
    when 'teacher' then array['teacher']::text[]
    when 'admin_teacher' then array['admin', 'teacher']::text[]
    else null
  end;

  if desired_roles is null then
    raise exception using errcode = '22023', message = 'staff grant preview has an invalid grant.';
  end if;

  if grant_date > public.current_toronto_civil_date() then
    perform private.assert_future_profile_projection_unchanged(
      new.target_id,
      grant_date,
      'add_staff',
      grant_masjid_id,
      desired_roles,
      null,
      null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_staff_grant_preview_transition
  on private.workflow_expected_state_snapshots;

create trigger enforce_staff_grant_preview_transition
  before insert on private.workflow_expected_state_snapshots
  for each row
  execute function private.enforce_staff_grant_preview_transition();

create or replace function public.apply_super_admin_access_change(
  input_request_id uuid,
  input_actor_id uuid,
  input_target_profile_id uuid,
  input_preset text,
  input_starts_on date,
  input_selected_masjid_id uuid,
  input_selected_group_id uuid,
  input_expected_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_request private.workflow_mutation_requests%rowtype;
  request_payload jsonb;
  target_profile public.profiles%rowtype;
  selected_masjid_id uuid;
  selected_group_masjid_id uuid;
  existing_selected_student_membership_id uuid;
  next_role text;
  next_active boolean;
  close_end_date date;
  membership record;
  desired_staff_role text;
  desired_staff_roles text[] := array[]::text[];
  undesired_staff_roles text[] := array[]::text[];
  impacted_admin_masjid_ids uuid[] := array[]::uuid[];
  impacted_masjid_id uuid;
  membership_id uuid;
  assignment record;
  affected_assignment_ids uuid[] := array[]::uuid[];
  result_payload jsonb;
begin
  if input_request_id is null or input_actor_id is null or input_target_profile_id is null then
    raise exception using errcode = '22023', message = 'request_id, actor_id, and target_profile_id are required.';
  end if;

  if input_preset not in ('student', 'teacher', 'admin', 'admin_teacher', 'inactive') then
    raise exception using errcode = '22023', message = 'invalid access preset.';
  end if;

  if input_starts_on is null or input_expected_state is null then
    raise exception using errcode = '22023', message = 'starts_on and expected access state are required.';
  end if;

  if input_starts_on < public.current_toronto_civil_date() then
    raise exception using errcode = '22023', message = 'effective date cannot be historical.';
  end if;

  if input_preset = 'inactive' and input_starts_on <> public.current_toronto_civil_date() then
    raise exception using errcode = '23514', message = 'future account deactivation is not supported because no scheduled role transition service is available.';
  end if;

  request_payload := jsonb_build_object(
    'actor_id', input_actor_id,
    'target_profile_id', input_target_profile_id,
    'preset', input_preset,
    'starts_on', input_starts_on,
    'selected_masjid_id', input_selected_masjid_id,
    'selected_group_id', input_selected_group_id,
    'expected_state', input_expected_state
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workflow-request:' || input_request_id::text, 0)
  );

  select requests.*
  into existing_request
  from private.workflow_mutation_requests as requests
  where requests.request_id = input_request_id;

  if found then
    if existing_request.workflow <> 'super_admin_access_change'
      or existing_request.actor_id <> input_actor_id
      or existing_request.target_id <> input_target_profile_id
      or existing_request.input_payload <> request_payload then
      raise exception using errcode = '22023', message = 'request_id was already used with different input.';
    end if;

    if not private.raw_is_active_super_admin(input_actor_id) then
      raise exception using errcode = '42501', message = 'actor is not an active super admin.';
    end if;

    return existing_request.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('super-admin-access-change', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('profile-access:' || input_target_profile_id::text, 0)
  );

  perform 1
  from public.profiles
  where profiles.id = input_actor_id
  for share;

  if not private.raw_is_active_super_admin(input_actor_id) then
    raise exception using errcode = '42501', message = 'actor is not an active super admin.';
  end if;

  select profiles.*
  into target_profile
  from public.profiles
  where profiles.id = input_target_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'target profile does not exist.';
  end if;

  if input_preset = 'inactive' and target_profile.role = 'super_admin' then
    if input_actor_id = input_target_profile_id then
      raise exception using errcode = '42501', message = 'super admins cannot deactivate their own account.';
    end if;

    perform 1
    from public.profiles
    where profiles.role = 'super_admin'
      and profiles.active = true
    order by profiles.id
    for update;

    if (
      select count(*)
      from public.profiles
      where profiles.role = 'super_admin'
        and profiles.active = true
    ) <= 1 then
      raise exception using errcode = '23514', message = 'at least one active super admin must remain.';
    end if;
  end if;

  perform 1
  from public.student_group_memberships as memberships
  where memberships.student_id = input_target_profile_id
  for update;

  perform 1
  from public.masjid_staff_memberships as memberships
  where memberships.profile_id = input_target_profile_id
  for update;

  if private.person_access_state(input_target_profile_id) is distinct from input_expected_state then
    raise exception using errcode = 'P0001', message = 'access state changed; reload before saving.';
  end if;

  if input_preset = 'student' then
    if input_selected_group_id is null then
      raise exception using errcode = '22023', message = 'selected_group_id is required for student access.';
    end if;

    select masajid.id
    into selected_group_masjid_id
    from public.halaqa_groups as groups
    join public.cohorts on cohorts.id = groups.cohort_id
    join public.masajid on masajid.id = cohorts.masjid_id
    where groups.id = input_selected_group_id
      and groups.active = true
      and cohorts.active = true
      and masajid.active = true
    for share of groups, cohorts, masajid;

    if selected_group_masjid_id is null then
      raise exception using errcode = '22023', message = 'selected_group_id must identify an active group in an active cohort and masjid.';
    end if;

    if input_selected_masjid_id is not null and input_selected_masjid_id <> selected_group_masjid_id then
      raise exception using errcode = '22023', message = 'selected group does not belong to selected masjid.';
    end if;
  elsif input_preset in ('teacher', 'admin', 'admin_teacher') then
    if input_selected_masjid_id is null then
      raise exception using errcode = '22023', message = 'selected_masjid_id is required for staff access.';
    end if;

    select masajid.id
    into selected_masjid_id
    from public.masajid
    where masajid.id = input_selected_masjid_id
      and masajid.active = true
    for update;

    if selected_masjid_id is null then
      raise exception using errcode = '22023', message = 'selected_masjid_id must identify an active masjid.';
    end if;

    if input_selected_group_id is not null then
      raise exception using errcode = '22023', message = 'selected_group_id must be null for staff access.';
    end if;
  elsif input_selected_masjid_id is not null or input_selected_group_id is not null then
    raise exception using errcode = '22023', message = 'inactive access does not accept masjid or group scope.';
  end if;

  -- Deactivation has no access on its selected date. Membership end dates are
  -- otherwise inclusive, so a current open row closes the day before and a
  -- same-day future row is marked inactive below.
  close_end_date := input_starts_on - 1;

  if input_preset = 'admin' then
    desired_staff_roles := array['admin'];
    undesired_staff_roles := array['teacher'];
  elsif input_preset = 'teacher' then
    desired_staff_roles := array['teacher'];
    undesired_staff_roles := array['admin'];
  elsif input_preset = 'admin_teacher' then
    desired_staff_roles := array['admin', 'teacher'];
  end if;

  if input_preset = 'student' then
    select memberships.id
    into existing_selected_student_membership_id
    from public.student_group_memberships as memberships
    where memberships.student_id = input_target_profile_id
      and memberships.group_id = input_selected_group_id
      and memberships.starts_on <= input_starts_on
      and (memberships.ends_on is null or memberships.ends_on >= input_starts_on)
    order by memberships.starts_on desc, memberships.id
    limit 1;
  end if;

  if input_starts_on > public.current_toronto_civil_date() then
    if input_preset = 'inactive' then
      raise exception using errcode = '23514', message = 'future account deactivation is not supported.';
    elsif input_preset = 'student' then
      perform private.assert_future_profile_projection_unchanged(
        input_target_profile_id,
        input_starts_on,
        'student',
        selected_group_masjid_id,
        array[]::text[],
        input_selected_group_id,
        null
      );
    else
      perform private.assert_future_profile_projection_unchanged(
        input_target_profile_id,
        input_starts_on,
        'replace_staff',
        selected_masjid_id,
        desired_staff_roles,
        null,
        null
      );
    end if;
  end if;

  -- A current Guided Change is an explicit reactivation decision. Normal
  -- login/profile reads and future membership passage never clear this marker.
  if input_preset <> 'inactive' and target_profile.access_deactivated_on is not null then
    update public.profiles
    set access_deactivated_on = null,
        active = true
    where id = input_target_profile_id;
    target_profile.access_deactivated_on := null;
    target_profile.active := true;
  end if;

  -- Student reassignment and account deactivation close student placement at
  -- the selected boundary. Selected-masjid staff replacement does not change
  -- student placement; additive grants use a separate RPC and never run this
  -- block.
  if input_preset in ('inactive', 'student') then
    for membership in
      select memberships.*,
             cohorts.masjid_id
      from public.student_group_memberships as memberships
      join public.halaqa_groups as groups on groups.id = memberships.group_id
      join public.cohorts on cohorts.id = groups.cohort_id
      where memberships.student_id = input_target_profile_id
        and (memberships.ends_on is null or memberships.ends_on > close_end_date)
        and (input_preset <> 'student' or memberships.id <> existing_selected_student_membership_id)
      order by memberships.id
    loop
      if input_preset = 'inactive' and membership.starts_on >= input_starts_on then
        delete from public.student_group_memberships
        where id = membership.id;

        insert into public.super_admin_audit_events (
          actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data, metadata
        ) values (
          input_actor_id,
          'student_membership_cancelled',
          'student_group_memberships',
          membership.id,
          membership.masjid_id,
          jsonb_build_object(
            'student_id', membership.student_id,
            'group_id', membership.group_id,
            'starts_on', membership.starts_on,
            'ends_on', membership.ends_on
          ),
          null,
          jsonb_build_object('reason', 'account_deactivation', 'deactivation_date', input_starts_on)
        );
        continue;
      end if;

      if membership.starts_on > close_end_date then
        if membership.starts_on = input_starts_on then
          delete from public.student_group_memberships where id = membership.id;

          insert into public.super_admin_audit_events (
            actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data, metadata
          ) values (
            input_actor_id,
            'student_membership_removed',
            'student_group_memberships',
            membership.id,
            membership.masjid_id,
            jsonb_build_object(
              'student_id', membership.student_id,
              'group_id', membership.group_id,
              'starts_on', membership.starts_on,
              'ends_on', membership.ends_on
            ),
            null,
            jsonb_build_object('reason', 'same-day replacement')
          );
          continue;
        end if;

        raise exception using errcode = '22023', message = 'effective date cannot close a future student membership.';
      end if;

      update public.student_group_memberships
      set ends_on = close_end_date,
          updated_at = now()
      where id = membership.id
        and (ends_on is null or ends_on > close_end_date);

      insert into public.super_admin_audit_events (
        actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data
      ) values (
        input_actor_id,
        'student_membership_closed',
        'student_group_memberships',
        membership.id,
        membership.masjid_id,
        jsonb_build_object(
          'student_id', membership.student_id,
          'group_id', membership.group_id,
          'starts_on', membership.starts_on,
          'ends_on', membership.ends_on
        ),
        jsonb_build_object(
          'student_id', membership.student_id,
          'group_id', membership.group_id,
          'starts_on', membership.starts_on,
          'ends_on', close_end_date
        )
      );
    end loop;
  end if;

  if input_preset = 'student' and existing_selected_student_membership_id is null then
    insert into public.student_group_memberships (
      student_id, group_id, starts_on, assigned_by
    ) values (
      input_target_profile_id, input_selected_group_id, input_starts_on, input_actor_id
    )
    returning id into membership_id;

    insert into public.super_admin_audit_events (
      actor_id, action, target_table, target_id, target_masjid_id, after_data
    ) values (
      input_actor_id,
      'student_membership_created',
      'student_group_memberships',
      membership_id,
      selected_group_masjid_id,
      jsonb_build_object(
        'student_id', input_target_profile_id,
        'group_id', input_selected_group_id,
        'starts_on', input_starts_on,
        'ends_on', null
      )
    );
  end if;

  if input_preset in ('inactive', 'student') then
    for membership in
      select memberships.*
      from public.masjid_staff_memberships as memberships
      where memberships.profile_id = input_target_profile_id
        and memberships.active = true
        and (memberships.ends_on is null or memberships.ends_on > close_end_date)
      order by memberships.id
    loop
      if input_preset <> 'inactive' and membership.staff_role = 'teacher' then
        perform private.assert_teacher_assignment_removal_safe(
          input_target_profile_id,
          close_end_date
        );
      end if;

      if input_preset = 'inactive' and membership.starts_on >= input_starts_on then
        update public.masjid_staff_memberships
        set active = false,
            ends_on = membership.starts_on,
            updated_at = now()
        where id = membership.id
          and active = true;
      elsif membership.starts_on > close_end_date then
        if membership.starts_on <> input_starts_on then
          raise exception using errcode = '22023', message = 'effective date cannot close a future staff membership.';
        end if;

        update public.masjid_staff_memberships
        set active = false,
            ends_on = input_starts_on,
            updated_at = now()
        where id = membership.id;
      else
        update public.masjid_staff_memberships
        set ends_on = close_end_date,
            updated_at = now()
        where id = membership.id
          and active = true;
      end if;

      if membership.staff_role = 'admin' then
        impacted_admin_masjid_ids := array_append(impacted_admin_masjid_ids, membership.masjid_id);
      end if;

      insert into public.super_admin_audit_events (
        actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data, metadata
      ) values (
        input_actor_id,
        case
          when input_preset = 'inactive' and membership.starts_on >= input_starts_on
            then 'staff_membership_cancelled'
          else 'staff_membership_closed'
        end,
        'masjid_staff_memberships',
        membership.id,
        membership.masjid_id,
        jsonb_build_object(
          'profile_id', membership.profile_id,
          'masjid_id', membership.masjid_id,
          'staff_role', membership.staff_role,
          'active', membership.active,
          'starts_on', membership.starts_on,
          'ends_on', membership.ends_on
        ),
        jsonb_build_object(
          'profile_id', membership.profile_id,
          'masjid_id', membership.masjid_id,
          'staff_role', membership.staff_role,
          'active', case
            when membership.starts_on > close_end_date then false
            else membership.active
          end,
          'starts_on', membership.starts_on,
          'ends_on', case
            when input_preset = 'inactive' and membership.starts_on >= input_starts_on then membership.starts_on
            when membership.starts_on > close_end_date then input_starts_on
            else close_end_date
          end
        ),
        case
          when input_preset = 'inactive' and membership.starts_on >= input_starts_on
            then jsonb_build_object('reason', 'account_deactivation', 'deactivation_date', input_starts_on)
          else null
        end
      );
    end loop;

    if input_preset = 'inactive' then
      -- Immediate account deactivation is the deliberate exception to the
      -- ordinary teacher-removal assignment blocker. Disable only assignments
      -- whose halaqa Saturday is D or later; completed historical identities
      -- remain active rows for display and audit history.
      for assignment in
        select assignments.*, cohorts.masjid_id
        from public.group_teacher_assignments as assignments
        join public.halaqa_groups as groups on groups.id = assignments.group_id
        join public.cohorts on cohorts.id = groups.cohort_id
        where assignments.teacher_id = input_target_profile_id
          and assignments.active = true
          and public.halaqa_saturday_for_week(assignments.week_start) >= input_starts_on
        order by assignments.id
        for update of assignments
      loop
        update public.group_teacher_assignments
        set active = false,
            updated_at = now()
        where id = assignment.id
          and active = true;

        affected_assignment_ids := array_append(affected_assignment_ids, assignment.id);

        insert into public.super_admin_audit_events (
          actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data, metadata
        ) values (
          input_actor_id,
          'teacher_assignment_deactivated',
          'group_teacher_assignments',
          assignment.id,
          assignment.masjid_id,
          jsonb_build_object(
            'id', assignment.id,
            'group_id', assignment.group_id,
            'teacher_id', assignment.teacher_id,
            'week_start', assignment.week_start,
            'active', assignment.active,
            'assigned_by', assignment.assigned_by
          ),
          jsonb_build_object(
            'id', assignment.id,
            'group_id', assignment.group_id,
            'teacher_id', assignment.teacher_id,
            'week_start', assignment.week_start,
            'active', false,
            'assigned_by', assignment.assigned_by
          ),
          jsonb_build_object(
            'reason', 'account_deactivation',
            'deactivation_date', input_starts_on,
            'halaqa_saturday', public.halaqa_saturday_for_week(assignment.week_start)
          )
        );
      end loop;
    end if;
  elsif input_preset in ('teacher', 'admin', 'admin_teacher') then
    for membership in
      select memberships.*
      from public.masjid_staff_memberships as memberships
      where memberships.profile_id = input_target_profile_id
        and memberships.masjid_id = selected_masjid_id
        and memberships.staff_role = any(undesired_staff_roles)
        and memberships.active = true
        and (memberships.ends_on is null or memberships.ends_on > close_end_date)
      order by memberships.id
    loop
      if membership.staff_role = 'teacher' then
        perform private.assert_teacher_assignment_removal_safe(
          input_target_profile_id,
          close_end_date,
          selected_masjid_id
        );
      end if;

      if membership.starts_on > close_end_date then
        if membership.starts_on <> input_starts_on then
          raise exception using errcode = '22023', message = 'effective date cannot close a future staff membership.';
        end if;

        update public.masjid_staff_memberships
        set active = false,
            ends_on = input_starts_on,
            updated_at = now()
        where id = membership.id;
      else
        update public.masjid_staff_memberships
        set ends_on = close_end_date,
            updated_at = now()
        where id = membership.id
          and active = true;
      end if;

      if membership.staff_role = 'admin' then
        impacted_admin_masjid_ids := array_append(impacted_admin_masjid_ids, membership.masjid_id);
      end if;

      insert into public.super_admin_audit_events (
        actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data
      ) values (
        input_actor_id,
        'staff_membership_closed',
        'masjid_staff_memberships',
        membership.id,
        membership.masjid_id,
        jsonb_build_object(
          'profile_id', membership.profile_id,
          'masjid_id', membership.masjid_id,
          'staff_role', membership.staff_role,
          'active', membership.active,
          'starts_on', membership.starts_on,
          'ends_on', membership.ends_on
        ),
        jsonb_build_object(
          'profile_id', membership.profile_id,
          'masjid_id', membership.masjid_id,
          'staff_role', membership.staff_role,
          'active', case when membership.starts_on > close_end_date then false else membership.active end,
          'starts_on', membership.starts_on,
          'ends_on', case when membership.starts_on > close_end_date then input_starts_on else close_end_date end
        )
      );
    end loop;

    foreach desired_staff_role in array desired_staff_roles
    loop
      if not exists (
        select 1
        from public.masjid_staff_memberships as memberships
        where memberships.profile_id = input_target_profile_id
          and memberships.masjid_id = selected_masjid_id
          and memberships.staff_role = desired_staff_role
          and memberships.active = true
          and memberships.starts_on <= input_starts_on
          and (memberships.ends_on is null or memberships.ends_on >= input_starts_on)
      ) then
        if exists (
          select 1
          from public.masjid_staff_memberships as memberships
          where memberships.profile_id = input_target_profile_id
            and memberships.masjid_id = selected_masjid_id
            and memberships.staff_role = desired_staff_role
            and memberships.active = true
            and (memberships.ends_on is null or memberships.ends_on > input_starts_on)
            and memberships.starts_on > input_starts_on
        ) then
          raise exception using errcode = '22023', message = 'effective date overlaps a future staff membership.';
        end if;

        insert into public.masjid_staff_memberships (
          profile_id, masjid_id, staff_role, active, starts_on, created_by
        ) values (
          input_target_profile_id,
          selected_masjid_id,
          desired_staff_role,
          true,
          input_starts_on,
          input_actor_id
        )
        returning id into membership_id;

        insert into public.super_admin_audit_events (
          actor_id, action, target_table, target_id, target_masjid_id, after_data
        ) values (
          input_actor_id,
          'staff_membership_created',
          'masjid_staff_memberships',
          membership_id,
          selected_masjid_id,
          jsonb_build_object(
            'profile_id', input_target_profile_id,
            'masjid_id', selected_masjid_id,
            'staff_role', desired_staff_role,
            'active', true,
            'starts_on', input_starts_on,
            'ends_on', null
          )
        );
      end if;
    end loop;

    if input_preset in ('admin', 'admin_teacher') then
      impacted_admin_masjid_ids := array_append(impacted_admin_masjid_ids, selected_masjid_id);
    end if;
  end if;

  if input_preset = 'inactive' then
    update public.profiles
    set role = target_profile.role,
        active = false,
        access_deactivated_on = input_starts_on
    where id = input_target_profile_id;
  end if;

  perform private.recompute_profile_access(input_target_profile_id, public.current_toronto_civil_date());

  select projection.role, projection.active
  into next_role, next_active
  from private.raw_profile_access_projection(input_target_profile_id, public.current_toronto_civil_date()) as projection;

  if target_profile.role = 'super_admin'
    and target_profile.active
    and (next_role <> 'super_admin' or not next_active) then
    if input_actor_id = input_target_profile_id then
      raise exception using errcode = '42501', message = 'super admins cannot demote or deactivate their own account.';
    end if;

    perform 1
    from public.profiles
    where profiles.role = 'super_admin'
      and profiles.active = true
    order by profiles.id
    for update;

    if (
      select count(*)
      from public.profiles
      where profiles.role = 'super_admin'
        and profiles.active = true
    ) <= 1 then
      raise exception using errcode = '23514', message = 'at least one active super admin must remain.';
    end if;
  end if;

  select impacted_admin_masjid_ids
    || coalesce(array_agg(distinct memberships.masjid_id), array[]::uuid[])
  into impacted_admin_masjid_ids
  from public.masjid_staff_memberships as memberships
  where memberships.profile_id = input_target_profile_id
    and memberships.staff_role = 'admin'
    and memberships.active = true;

  for impacted_masjid_id in
    select distinct ids.masjid_id
    from unnest(impacted_admin_masjid_ids) as ids(masjid_id)
    join public.masajid on masajid.id = ids.masjid_id
    where masajid.active = true
    order by ids.masjid_id
  loop
    perform 1 from public.masajid where masajid.id = impacted_masjid_id for update;
    perform private.assert_masjid_admin_coverage(impacted_masjid_id);
  end loop;

  if (target_profile.role, target_profile.active) is distinct from (next_role, next_active) then
    insert into public.super_admin_audit_events (
      actor_id, action, target_table, target_id, before_data, after_data, metadata
    ) values (
      input_actor_id,
      'profile_access_projection_update',
      'profiles',
      input_target_profile_id,
      jsonb_build_object('role', target_profile.role, 'active', target_profile.active),
      jsonb_build_object('role', next_role, 'active', next_active),
      jsonb_build_object('preset', input_preset, 'starts_on', input_starts_on)
    );
  end if;

  result_payload := jsonb_build_object(
    'profile_id', target_profile.id,
    'preset', input_preset,
    'role', next_role,
    'active', next_active,
    'access_state', private.person_access_state(input_target_profile_id),
    'deactivation', case
      when input_preset = 'inactive' then jsonb_build_object(
        'affected_assignment_count', coalesce(array_length(affected_assignment_ids, 1), 0),
        'affected_assignment_ids', to_jsonb(coalesce(affected_assignment_ids, array[]::uuid[]))
      )
      else null
    end
  );

  insert into private.workflow_mutation_requests (
    request_id, workflow, actor_id, target_id, input_payload, result
  ) values (
    input_request_id,
    'super_admin_access_change',
    input_actor_id,
    input_target_profile_id,
    request_payload,
    result_payload
  );

  return result_payload;
end;
$$;

create or replace function private.apply_super_admin_masjid_staff_grant_once(
  input_request_id uuid,
  input_actor_id uuid,
  input_target_profile_id uuid,
  input_masjid_id uuid,
  input_grant text,
  input_starts_on date,
  input_expected_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_request private.workflow_mutation_requests%rowtype;
  request_payload jsonb;
  desired_staff_role text;
  desired_staff_roles text[];
  membership_id uuid;
  next_role text;
  result_payload jsonb;
begin
  if input_request_id is null
    or input_actor_id is null
    or input_target_profile_id is null
    or input_masjid_id is null then
    raise exception using errcode = '22023', message = 'request_id, actor_id, target_profile_id, and masjid_id are required.';
  end if;

  if input_grant not in ('admin', 'teacher', 'admin_teacher') then
    raise exception using errcode = '22023', message = 'grant must be admin, teacher, or admin_teacher.';
  end if;

  if input_starts_on is null or input_expected_state is null then
    raise exception using errcode = '22023', message = 'starts_on and expected access state are required.';
  end if;

  if input_starts_on < public.current_toronto_civil_date() then
    raise exception using errcode = '22023', message = 'staff grant date cannot be historical.';
  end if;

  request_payload := jsonb_build_object(
    'actor_id', input_actor_id,
    'target_profile_id', input_target_profile_id,
    'masjid_id', input_masjid_id,
    'grant', input_grant,
    'starts_on', input_starts_on,
    'expected_state', input_expected_state
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workflow-request:' || input_request_id::text, 0)
  );

  select requests.*
  into existing_request
  from private.workflow_mutation_requests as requests
  where requests.request_id = input_request_id;

  if found then
    if existing_request.workflow <> 'masjid_staff_grant'
      or existing_request.actor_id <> input_actor_id
      or existing_request.target_id <> input_target_profile_id
      or existing_request.input_payload <> request_payload then
      raise exception using errcode = '22023', message = 'request_id was already used with different input.';
    end if;

    if not private.raw_is_active_super_admin(input_actor_id) then
      raise exception using errcode = '42501', message = 'actor is not an active super admin.';
    end if;

    return existing_request.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('super-admin-access-change', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('profile-access:' || input_target_profile_id::text, 0)
  );

  if not private.raw_is_active_super_admin(input_actor_id) then
    raise exception using errcode = '42501', message = 'actor is not an active super admin.';
  end if;

  perform 1
  from public.profiles
  where profiles.id = input_target_profile_id
    and profiles.active = true
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'target profile must be active.';
  end if;

  perform 1
  from public.masajid
  where masajid.id = input_masjid_id
    and masajid.active = true
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'masjid must be active.';
  end if;

  perform 1
  from public.student_group_memberships as memberships
  where memberships.student_id = input_target_profile_id
  for update;

  perform 1
  from public.masjid_staff_memberships as memberships
  where memberships.profile_id = input_target_profile_id
  for update;

  if private.person_access_state(input_target_profile_id) is distinct from input_expected_state then
    raise exception using errcode = 'P0001', message = 'access state changed; reload before saving.';
  end if;

  desired_staff_roles := case input_grant
    when 'admin_teacher' then array['admin', 'teacher']::text[]
    when 'admin' then array['admin']::text[]
    else array['teacher']::text[]
  end;

  if input_starts_on > public.current_toronto_civil_date() then
    perform private.assert_future_profile_projection_unchanged(
      input_target_profile_id,
      input_starts_on,
      'add_staff',
      input_masjid_id,
      desired_staff_roles,
      null,
      null
    );
  end if;

  foreach desired_staff_role in array desired_staff_roles
  loop
    if not exists (
      select 1
      from public.masjid_staff_memberships as memberships
      where memberships.profile_id = input_target_profile_id
        and memberships.masjid_id = input_masjid_id
        and memberships.staff_role = desired_staff_role
        and memberships.active = true
        and memberships.starts_on <= input_starts_on
        and (memberships.ends_on is null or memberships.ends_on >= input_starts_on)
    ) then
      if exists (
        select 1
        from public.masjid_staff_memberships as memberships
        where memberships.profile_id = input_target_profile_id
          and memberships.masjid_id = input_masjid_id
          and memberships.staff_role = desired_staff_role
          and memberships.active = true
          and (memberships.ends_on is null or memberships.ends_on > input_starts_on)
          and memberships.starts_on > input_starts_on
      ) then
        raise exception using errcode = '22023', message = 'effective date overlaps a future staff membership.';
      end if;

      insert into public.masjid_staff_memberships (
        profile_id, masjid_id, staff_role, active, starts_on, created_by
      ) values (
        input_target_profile_id,
        input_masjid_id,
        desired_staff_role,
        true,
        input_starts_on,
        input_actor_id
      ) returning id into membership_id;

      insert into public.super_admin_audit_events (
        actor_id, action, target_table, target_id, target_masjid_id, after_data, metadata
      ) values (
        input_actor_id,
        'staff_membership_created',
        'masjid_staff_memberships',
        membership_id,
        input_masjid_id,
        jsonb_build_object(
          'profile_id', input_target_profile_id,
          'masjid_id', input_masjid_id,
          'staff_role', desired_staff_role,
          'active', true,
          'starts_on', input_starts_on,
          'ends_on', null
        ),
        jsonb_build_object('source', 'masjid_setup', 'semantics', 'additive')
      );
    end if;
  end loop;

  if input_grant in ('admin', 'admin_teacher') then
    perform private.assert_masjid_admin_coverage(input_masjid_id);
  end if;

  perform private.recompute_profile_access(input_target_profile_id, public.current_toronto_civil_date());

  select projection.role
  into next_role
  from private.raw_profile_access_projection(input_target_profile_id, public.current_toronto_civil_date()) as projection;

  result_payload := jsonb_build_object(
    'profile_id', input_target_profile_id,
    'masjid_id', input_masjid_id,
    'grant', input_grant,
    'role', next_role,
    'access_state', private.person_access_state(input_target_profile_id)
  );

  insert into private.workflow_mutation_requests (
    request_id, workflow, actor_id, target_id, input_payload, result
  ) values (
    input_request_id,
    'masjid_staff_grant',
    input_actor_id,
    input_target_profile_id,
    request_payload,
    result_payload
  );

  return result_payload;
end;
$$;

revoke all on function private.apply_super_admin_masjid_staff_grant_once(uuid, uuid, uuid, uuid, text, date, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.apply_super_admin_staff_membership_end(
  input_request_id uuid,
  input_actor_id uuid,
  input_target_profile_id uuid,
  input_membership_id uuid,
  input_ends_on date,
  input_expected_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_request private.workflow_mutation_requests%rowtype;
  request_payload jsonb;
  target_profile public.profiles%rowtype;
  target_membership public.masjid_staff_memberships%rowtype;
  projected_state record;
  result_payload jsonb;
begin
  if input_request_id is null
    or input_actor_id is null
    or input_target_profile_id is null
    or input_membership_id is null then
    raise exception using errcode = '22023', message = 'request_id, actor_id, target_profile_id, and membership_id are required.';
  end if;

  if input_ends_on is null or input_expected_state is null then
    raise exception using errcode = '22023', message = 'ends_on and expected access state are required.';
  end if;

  if input_ends_on < public.current_toronto_civil_date() then
    raise exception using errcode = '22023', message = 'membership end date cannot be historical.';
  end if;

  request_payload := jsonb_build_object(
    'actor_id', input_actor_id,
    'target_profile_id', input_target_profile_id,
    'membership_id', input_membership_id,
    'ends_on', input_ends_on,
    'expected_state', input_expected_state
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('workflow-request:' || input_request_id::text, 0)
  );

  select requests.*
  into existing_request
  from private.workflow_mutation_requests as requests
  where requests.request_id = input_request_id;

  if found then
    if existing_request.workflow <> 'staff_membership_end'
      or existing_request.actor_id <> input_actor_id
      or existing_request.target_id <> input_target_profile_id
      or existing_request.input_payload <> request_payload then
      raise exception using errcode = '22023', message = 'request_id was already used with different input.';
    end if;

    if not private.raw_is_active_super_admin(input_actor_id) then
      raise exception using errcode = '42501', message = 'actor is not an active super admin.';
    end if;

    return existing_request.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('super-admin-access-change', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('profile-access:' || input_target_profile_id::text, 0)
  );

  if not private.raw_is_active_super_admin(input_actor_id) then
    raise exception using errcode = '42501', message = 'actor is not an active super admin.';
  end if;

  select profiles.*
  into target_profile
  from public.profiles
  where profiles.id = input_target_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'target profile does not exist.';
  end if;

  perform 1
  from public.student_group_memberships as memberships
  where memberships.student_id = input_target_profile_id
  for update;

  perform 1
  from public.masjid_staff_memberships as memberships
  where memberships.profile_id = input_target_profile_id
  for update;

  if private.person_access_state(input_target_profile_id) is distinct from input_expected_state then
    raise exception using errcode = 'P0001', message = 'access state changed; reload before saving.';
  end if;

  select memberships.*
  into target_membership
  from public.masjid_staff_memberships as memberships
  where memberships.id = input_membership_id
  for update;

  if not found or target_membership.profile_id <> input_target_profile_id then
    raise exception using errcode = '22023', message = 'membership does not belong to target profile.';
  end if;

  if not target_membership.active or target_membership.ends_on is not null then
    raise exception using errcode = '22023', message = 'membership is not open and active.';
  end if;

  if target_membership.starts_on > input_ends_on then
    raise exception using errcode = '22023', message = 'ends_on cannot precede starts_on.';
  end if;

  perform private.assert_future_profile_projection_unchanged(
    input_target_profile_id,
    input_ends_on + 1,
    'end_staff',
    null,
    array[]::text[],
    null,
    input_membership_id
  );

  if target_membership.staff_role = 'teacher' then
    perform private.assert_teacher_assignment_removal_safe(
      input_target_profile_id,
      input_ends_on,
      target_membership.masjid_id
    );
  end if;

  perform 1
  from public.masajid
  where masajid.id = target_membership.masjid_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'membership masjid does not exist.';
  end if;

  update public.masjid_staff_memberships
  set ends_on = input_ends_on,
      updated_at = now()
  where id = input_membership_id;

  insert into public.super_admin_audit_events (
    actor_id, action, target_table, target_id, target_masjid_id, before_data, after_data
  ) values (
    input_actor_id,
    'staff_membership_ended',
    'masjid_staff_memberships',
    target_membership.id,
    target_membership.masjid_id,
    jsonb_build_object(
      'profile_id', target_membership.profile_id,
      'masjid_id', target_membership.masjid_id,
      'staff_role', target_membership.staff_role,
      'active', target_membership.active,
      'starts_on', target_membership.starts_on,
      'ends_on', target_membership.ends_on
    ),
    jsonb_build_object(
      'profile_id', target_membership.profile_id,
      'masjid_id', target_membership.masjid_id,
      'staff_role', target_membership.staff_role,
      'active', target_membership.active,
      'starts_on', target_membership.starts_on,
      'ends_on', input_ends_on
    )
  );

  if target_membership.staff_role = 'admin' then
    perform private.assert_masjid_admin_coverage(target_membership.masjid_id);
  end if;

  perform private.recompute_profile_access(input_target_profile_id, public.current_toronto_civil_date());

  select projection.role, projection.active
  into projected_state
  from private.raw_profile_access_projection(input_target_profile_id, public.current_toronto_civil_date()) as projection;

  result_payload := jsonb_build_object(
    'profile_id', target_profile.id,
    'membership_id', input_membership_id,
    'ends_on', input_ends_on,
    'role', projected_state.role,
    'active', projected_state.active,
    'access_state', private.person_access_state(input_target_profile_id)
  );

  insert into private.workflow_mutation_requests (
    request_id, workflow, actor_id, target_id, input_payload, result
  ) values (
    input_request_id,
    'staff_membership_end',
    input_actor_id,
    input_target_profile_id,
    request_payload,
    result_payload
  );

  return result_payload;
end;
$$;

-- Read-only rollout diagnostic. It is intentionally service-role-only and
-- reports categories/row identifiers without embedding any person-specific
-- values in the migration. Run it against a disposable or staging database
-- after applying this migration and before recommending production rollout;
-- it does not mutate data.
create or replace function public.access_transition_rollout_diagnostic()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with current_date_context as (
    select public.current_toronto_civil_date() as access_date
  ),
  current_profiles as (
    select
      profiles.id,
      profiles.role as stored_role,
      profiles.active as stored_active,
      projection.role as projected_role,
      projection.active as projected_active
    from public.profiles
    cross join current_date_context
    cross join lateral private.raw_profile_access_projection(profiles.id, current_date_context.access_date) as projection
  ),
  future_memberships as (
    select
      memberships.id as membership_id,
      memberships.profile_id,
      memberships.starts_on as transition_date,
      'staff_membership_start'::text as reason,
      'add_staff'::text as operation,
      memberships.masjid_id,
      array[memberships.staff_role]::text[] as desired_staff_roles,
      null::uuid as student_group_id,
      null::uuid as excluded_staff_membership_id
    from public.masjid_staff_memberships as memberships
    cross join current_date_context
    where memberships.active = true
      and memberships.starts_on > current_date_context.access_date
    union all
    select
      memberships.id,
      memberships.profile_id,
      memberships.ends_on + 1,
      'staff_membership_end',
      'end_staff',
      null::uuid,
      array[]::text[],
      null::uuid,
      memberships.id
    from public.masjid_staff_memberships as memberships
    cross join current_date_context
    where memberships.active = true
      and memberships.ends_on is not null
      and memberships.ends_on + 1 > current_date_context.access_date
    union all
    select
      memberships.id,
      memberships.student_id,
      memberships.starts_on,
      'student_membership_start',
      'add_student',
      null::uuid,
      array[]::text[],
      memberships.group_id,
      null::uuid
    from public.student_group_memberships as memberships
    cross join current_date_context
    where memberships.starts_on > current_date_context.access_date
  ),
  future_rejections as (
    select
      future_memberships.membership_id,
      future_memberships.profile_id,
      future_memberships.transition_date,
      future_memberships.reason,
      current_profiles.projected_role as current_role,
      current_profiles.projected_active as current_active,
      future_projection.role as future_role,
      future_projection.active as future_active
    from future_memberships
    join current_profiles on current_profiles.id = future_memberships.profile_id
    cross join lateral private.project_profile_access_for_transition(
      future_memberships.profile_id,
      future_memberships.transition_date,
      future_memberships.operation,
      future_memberships.masjid_id,
      future_memberships.desired_staff_roles,
      future_memberships.student_group_id,
      future_memberships.excluded_staff_membership_id
    ) as future_projection
    where (current_profiles.projected_role, current_profiles.projected_active)
      is distinct from (future_projection.role, future_projection.active)
  ),
  projection_changes as (
    select
      current_profiles.id as profile_id,
      current_profiles.stored_role as current_role,
      current_profiles.projected_role,
      current_profiles.stored_active as current_active,
      current_profiles.projected_active,
      case
        when current_profiles.stored_role is distinct from current_profiles.projected_role
          and current_profiles.stored_active is distinct from current_profiles.projected_active
          then 'role_and_active_projection_mismatch'
        when current_profiles.stored_role is distinct from current_profiles.projected_role
          then 'role_projection_mismatch'
        else 'active_projection_mismatch'
      end as reason
    from current_profiles
    where current_profiles.stored_role is distinct from current_profiles.projected_role
       or current_profiles.stored_active is distinct from current_profiles.projected_active
  ),
  affected_assignments as (
    select
      assignments.id,
      assignments.teacher_id,
      assignments.group_id,
      assignments.week_start,
      public.halaqa_saturday_for_week(assignments.week_start) as halaqa_saturday
    from public.group_teacher_assignments as assignments
    cross join current_date_context
    where assignments.active = true
      and public.halaqa_saturday_for_week(assignments.week_start) >= current_date_context.access_date
  ),
  coverage_boundaries as (
    select
      masajid.id as masjid_id,
      current_date_context.access_date as coverage_date
    from public.masajid
    cross join current_date_context
    where masajid.active = true
    union
    select
      memberships.masjid_id,
      memberships.starts_on
    from public.masjid_staff_memberships as memberships
    join public.masajid on masajid.id = memberships.masjid_id
    cross join current_date_context
    where masajid.active = true
      and memberships.staff_role = 'admin'
      and memberships.active = true
      and memberships.starts_on > current_date_context.access_date
    union
    select
      memberships.masjid_id,
      memberships.ends_on + 1
    from public.masjid_staff_memberships as memberships
    join public.masajid on masajid.id = memberships.masjid_id
    cross join current_date_context
    where masajid.active = true
      and memberships.staff_role = 'admin'
      and memberships.active = true
      and memberships.ends_on is not null
      and memberships.ends_on + 1 > current_date_context.access_date
  ),
  coverage_risks as (
    select
      masajid.id,
      masajid.name,
      coverage_boundaries.coverage_date,
      case
        when coverage_boundaries.coverage_date = current_date_context.access_date
          then 'no_current_admin_coverage'
        else 'no_future_admin_coverage'
      end as reason
    from coverage_boundaries
    join public.masajid on masajid.id = coverage_boundaries.masjid_id
    cross join current_date_context
    where masajid.active = true
      and not exists (
        select 1
        from public.masjid_staff_memberships as memberships
        join public.profiles on profiles.id = memberships.profile_id
        cross join lateral private.raw_profile_access_projection(
          profiles.id,
          coverage_boundaries.coverage_date
        ) as projection
        where memberships.masjid_id = masajid.id
          and memberships.staff_role = 'admin'
          and memberships.active = true
          and memberships.starts_on <= coverage_boundaries.coverage_date
          and (memberships.ends_on is null or memberships.ends_on >= coverage_boundaries.coverage_date)
          and projection.active = true
          and projection.role = 'admin'
      )
  )
  select jsonb_build_object(
    'access_date', (select access_date from current_date_context),
    'projection_changes', coalesce((
      select jsonb_agg(to_jsonb(projection_changes) order by projection_changes.profile_id)
      from projection_changes
    ), '[]'::jsonb),
    'future_memberships_rejected', coalesce((
      select jsonb_agg(to_jsonb(future_rejections) order by future_rejections.transition_date, future_rejections.membership_id)
      from future_rejections
    ), '[]'::jsonb),
    'assignments_affected_by_immediate_deactivation', coalesce((
      select jsonb_agg(to_jsonb(affected_assignments) order by affected_assignments.halaqa_saturday, affected_assignments.id)
      from affected_assignments
    ), '[]'::jsonb),
    'last_admin_coverage_risks', coalesce((
      select jsonb_agg(to_jsonb(coverage_risks) order by coverage_risks.name, coverage_risks.id)
      from coverage_risks
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.access_transition_rollout_diagnostic()
  from public, anon, authenticated;
grant execute on function public.access_transition_rollout_diagnostic() to service_role;

-- Keep the explicit application SECURITY DEFINER inventory current. The RLS
-- catalog test treats this allowlist as the review boundary for privileged
-- functions, including trigger-owned projection helpers.
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
    'public.access_transition_rollout_diagnostic()',
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
    'public.refresh_current_profile_role()',
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
    'private.assert_teacher_assignment_removal_safe(uuid,date,uuid)',
    'private.enforce_staff_grant_preview_transition()',
    'private.enforce_masjid_hierarchy_readiness()',
    'private.project_cohort_profile_access()',
    'private.project_group_profile_access()',
    'private.project_masjid_profile_access()',
    'private.project_staff_membership_profile_access()',
    'private.project_student_membership_profile_access()',
    'private.recompute_profiles_for_masjid(uuid)',
    'private.recompute_profile_access(uuid,date)'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.raw_profile_access_projection(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.recompute_profile_access(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.project_staff_membership_profile_access()
  from public, anon, authenticated, service_role;
revoke all on function private.project_student_membership_profile_access()
  from public, anon, authenticated, service_role;
revoke all on function private.project_masjid_profile_access()
  from public, anon, authenticated, service_role;
revoke all on function private.project_cohort_profile_access()
  from public, anon, authenticated, service_role;
revoke all on function private.project_group_profile_access()
  from public, anon, authenticated, service_role;
revoke all on function private.recompute_profiles_for_masjid(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_is_admin_for_masjid(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.project_profile_access_for_transition(uuid, date, text, uuid, text[], uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_future_profile_projection_unchanged(uuid, date, text, uuid, text[], uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_teacher_assignment_removal_safe(uuid, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_staff_grant_preview_transition()
  from public, anon, authenticated, service_role;
revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;

-- Teacher roster visibility is request-time staff access and therefore follows
-- the Toronto civil date. Check-in and scoring policies continue to use their
-- separate 1:00 AM effective-date helpers.
drop policy if exists "Teachers can read assigned group memberships"
  on public.student_group_memberships;

create policy "Teachers can read assigned group memberships"
  on public.student_group_memberships
  for select
  using (
    public.is_teacher_for_group_week(
      group_id,
      public.week_start_for_date(public.current_toronto_civil_date())
    )
  );

-- Preserve old review rows for audit history while accepting only the explicit
-- replacement operation names from the current application.
alter table public.super_admin_guided_change_reviews
  drop constraint if exists super_admin_guided_change_reviews_operation_check;

alter table public.super_admin_guided_change_reviews
  add constraint super_admin_guided_change_reviews_operation_check
  check (
    operation in (
      'add_teacher', 'add_admin', 'add_admin_teacher',
      'set_teacher_only', 'set_admin_only', 'set_admin_teacher',
      'assign_student', 'deactivate_account'
    )
  );

alter table public.super_admin_guided_change_reviews
  drop constraint if exists super_admin_guided_change_reviews_scope_check;

alter table public.super_admin_guided_change_reviews
  add constraint super_admin_guided_change_reviews_scope_check
  check (
    (
      operation in (
        'add_teacher', 'add_admin', 'add_admin_teacher',
        'set_teacher_only', 'set_admin_only', 'set_admin_teacher'
      )
      and masjid_id is not null
      and group_id is null
    )
    or (operation = 'assign_student' and masjid_id is not null and group_id is not null)
    or (operation = 'deactivate_account' and masjid_id is null and group_id is null)
  );
