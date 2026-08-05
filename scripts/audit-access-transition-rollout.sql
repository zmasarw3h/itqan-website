-- Read-only pre-deployment audit for the access-transition migration.
--
-- Run this file against the current production-schema equivalent (the main
-- branch through 20260731224257_temporal_teacher_week_authorization_followup)
-- before applying any Slice 3 migration:
--
--   psql "$DATABASE_URL" --no-psqlrc -v ON_ERROR_STOP=1 \
--     -f scripts/audit-access-transition-rollout.sql
--
-- The report intentionally emits only row identifiers, dates, roles, and
-- reason codes. It does not mutate persistent data or include names, emails,
-- phone numbers, or embedded person identifiers.

\set ON_ERROR_STOP on

\echo '=== access transition rollout audit ==='
\echo '=== projection changes that the migration would write ==='

with access_context as (
  select public.current_toronto_civil_date() as access_date
),
staff_capabilities as (
  select
    memberships.profile_id,
    bool_or(memberships.staff_role = 'admin') as has_admin,
    bool_or(memberships.staff_role = 'teacher') as has_teacher
  from public.masjid_staff_memberships as memberships
  join public.masajid on masajid.id = memberships.masjid_id
  cross join access_context
  where memberships.active = true
    and masajid.active = true
    and memberships.starts_on <= access_context.access_date
    and (memberships.ends_on is null or memberships.ends_on >= access_context.access_date)
  group by memberships.profile_id
),
student_capabilities as (
  select distinct memberships.student_id as profile_id
  from public.student_group_memberships as memberships
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  cross join access_context
  where groups.active = true
    and cohorts.active = true
    and masajid.active = true
    and memberships.starts_on <= access_context.access_date
    and (memberships.ends_on is null or memberships.ends_on >= access_context.access_date)
),
projected as (
  select
    profiles.id,
    profiles.role as stored_role,
    profiles.active as stored_active,
    case
      when not profiles.active then profiles.role
      when profiles.role = 'super_admin' then 'super_admin'
      when coalesce(staff_capabilities.has_admin, false) then 'admin'
      when coalesce(staff_capabilities.has_teacher, false) then 'teacher'
      when student_capabilities.profile_id is not null then 'student'
      else profiles.role
    end as projected_role,
    case
      when not profiles.active then false
      when profiles.role = 'super_admin' then profiles.active
      when coalesce(staff_capabilities.has_admin, false)
        or coalesce(staff_capabilities.has_teacher, false)
        or student_capabilities.profile_id is not null then true
      else false
    end as projected_active
  from public.profiles
  left join staff_capabilities on staff_capabilities.profile_id = profiles.id
  left join student_capabilities on student_capabilities.profile_id = profiles.id
)
select
  projected.id as profile_id,
  projected.stored_role,
  projected.projected_role,
  projected.stored_active,
  projected.projected_active,
  case
    when projected.stored_role is distinct from projected.projected_role
      and projected.stored_active is distinct from projected.projected_active
      then 'role_and_active_projection_mismatch'
    when projected.stored_role is distinct from projected.projected_role
      then 'role_projection_mismatch'
    else 'active_projection_mismatch'
  end as reason
from projected
where projected.stored_role is distinct from projected.projected_role
   or projected.stored_active is distinct from projected.projected_active
order by projected.id;

\echo '=== inactive profiles that would receive access_deactivated_on ==='

select
  profiles.id as profile_id,
  profiles.role,
  profiles.active,
  public.current_toronto_civil_date() as access_deactivated_on,
  'inactive_profile_backfill' as reason
from public.profiles
where profiles.active = false
order by profiles.id;

\echo '=== current role/scope contradictions ==='

with access_context as (
  select public.current_toronto_civil_date() as access_date
),
effective_scopes as (
  select
    profiles.id as profile_id,
    profiles.role,
    profiles.active,
    exists (
      select 1
      from public.masjid_staff_memberships as memberships
      join public.masajid on masajid.id = memberships.masjid_id
      where memberships.profile_id = profiles.id
        and memberships.staff_role = 'admin'
        and memberships.active = true
        and masajid.active = true
        and memberships.starts_on <= access_context.access_date
        and (memberships.ends_on is null or memberships.ends_on >= access_context.access_date)
    ) as has_admin_scope,
    exists (
      select 1
      from public.masjid_staff_memberships as memberships
      join public.masajid on masajid.id = memberships.masjid_id
      where memberships.profile_id = profiles.id
        and memberships.staff_role = 'teacher'
        and memberships.active = true
        and masajid.active = true
        and memberships.starts_on <= access_context.access_date
        and (memberships.ends_on is null or memberships.ends_on >= access_context.access_date)
    ) as has_teacher_scope,
    exists (
      select 1
      from public.student_group_memberships as memberships
      join public.halaqa_groups as groups on groups.id = memberships.group_id
      join public.cohorts on cohorts.id = groups.cohort_id
      join public.masajid on masajid.id = cohorts.masjid_id
      where memberships.student_id = profiles.id
        and groups.active = true
        and cohorts.active = true
        and masajid.active = true
        and memberships.starts_on <= access_context.access_date
        and (memberships.ends_on is null or memberships.ends_on >= access_context.access_date)
    ) as has_student_scope
  from public.profiles
  cross join access_context
)
select
  effective_scopes.profile_id,
  effective_scopes.role,
  effective_scopes.active,
  effective_scopes.has_admin_scope,
  effective_scopes.has_teacher_scope,
  effective_scopes.has_student_scope,
  case
    when effective_scopes.role = 'admin' and not effective_scopes.has_admin_scope
      then 'admin_role_without_current_admin_scope'
    when effective_scopes.role = 'teacher'
      and not effective_scopes.has_teacher_scope
      and not effective_scopes.has_admin_scope
      then 'teacher_role_without_current_staff_scope'
    when effective_scopes.role = 'student' and not effective_scopes.has_student_scope
      then 'student_role_without_current_student_scope'
    when effective_scopes.role <> 'super_admin'
      and effective_scopes.active
      and not effective_scopes.has_admin_scope
      and not effective_scopes.has_teacher_scope
      and not effective_scopes.has_student_scope
      then 'active_profile_without_current_scope'
  end as reason
from effective_scopes
where (
    effective_scopes.role = 'admin' and not effective_scopes.has_admin_scope
  ) or (
    effective_scopes.role = 'teacher'
    and not effective_scopes.has_teacher_scope
    and not effective_scopes.has_admin_scope
  ) or (
    effective_scopes.role = 'student' and not effective_scopes.has_student_scope
  ) or (
    effective_scopes.role <> 'super_admin'
    and effective_scopes.active
    and not effective_scopes.has_admin_scope
    and not effective_scopes.has_teacher_scope
    and not effective_scopes.has_student_scope
  )
order by effective_scopes.profile_id;

\echo '=== future staff/student membership transitions that would change projection ==='

with access_context as (
  select public.current_toronto_civil_date() as access_date
),
events as (
  select
    memberships.id as membership_id,
    memberships.profile_id,
    memberships.starts_on as transition_date,
    'staff_membership_start'::text as transition,
    memberships.masjid_id,
    memberships.staff_role,
    null::uuid as group_id
  from public.masjid_staff_memberships as memberships
  cross join access_context
  where memberships.active = true
    and memberships.starts_on > access_context.access_date
  union all
  select
    memberships.id,
    memberships.profile_id,
    memberships.ends_on + 1,
    'staff_membership_end',
    memberships.masjid_id,
    memberships.staff_role,
    null::uuid
  from public.masjid_staff_memberships as memberships
  cross join access_context
  where memberships.active = true
    and memberships.ends_on is not null
    and memberships.ends_on + 1 > access_context.access_date
  union all
  select
    memberships.id,
    memberships.student_id,
    memberships.starts_on,
    'student_membership_start',
    null::uuid,
    null::text,
    memberships.group_id
  from public.student_group_memberships as memberships
  cross join access_context
  where memberships.starts_on > access_context.access_date
  union all
  select
    memberships.id,
    memberships.student_id,
    memberships.ends_on + 1,
    'student_membership_end',
    null::uuid,
    null::text,
    memberships.group_id
  from public.student_group_memberships as memberships
  cross join access_context
  where memberships.ends_on is not null
    and memberships.ends_on + 1 > access_context.access_date
),
projections as (
  select
    events.*,
    profiles.role as stored_role,
    profiles.active as stored_active,
    case
      when not profiles.active then profiles.role
      when profiles.role = 'super_admin' then 'super_admin'
      when exists (
        select 1
        from public.masjid_staff_memberships as memberships
        join public.masajid on masajid.id = memberships.masjid_id
        where memberships.profile_id = events.profile_id
          and memberships.staff_role = 'admin'
          and memberships.active = true
          and masajid.active = true
          and memberships.starts_on <= access_context.access_date
          and (memberships.ends_on is null or memberships.ends_on >= access_context.access_date)
      ) then 'admin'
      when exists (
        select 1
        from public.masjid_staff_memberships as memberships
        join public.masajid on masajid.id = memberships.masjid_id
        where memberships.profile_id = events.profile_id
          and memberships.staff_role = 'teacher'
          and memberships.active = true
          and masajid.active = true
          and memberships.starts_on <= access_context.access_date
          and (memberships.ends_on is null or memberships.ends_on >= access_context.access_date)
      ) then 'teacher'
      when exists (
        select 1
        from public.student_group_memberships as memberships
        join public.halaqa_groups as groups on groups.id = memberships.group_id
        join public.cohorts on cohorts.id = groups.cohort_id
        join public.masajid on masajid.id = cohorts.masjid_id
        where memberships.student_id = events.profile_id
          and groups.active = true
          and cohorts.active = true
          and masajid.active = true
          and memberships.starts_on <= access_context.access_date
          and (memberships.ends_on is null or memberships.ends_on >= access_context.access_date)
      ) then 'student'
      else profiles.role
    end as current_role,
    case
      when not profiles.active then false
      when profiles.role = 'super_admin' then profiles.active
      when exists (
        select 1
        from public.masjid_staff_memberships as memberships
        join public.masajid on masajid.id = memberships.masjid_id
        where memberships.profile_id = events.profile_id
          and memberships.staff_role in ('admin', 'teacher')
          and memberships.active = true
          and masajid.active = true
          and memberships.starts_on <= access_context.access_date
          and (memberships.ends_on is null or memberships.ends_on >= access_context.access_date)
      ) then true
      when exists (
        select 1
        from public.student_group_memberships as memberships
        join public.halaqa_groups as groups on groups.id = memberships.group_id
        join public.cohorts on cohorts.id = groups.cohort_id
        join public.masajid on masajid.id = cohorts.masjid_id
        where memberships.student_id = events.profile_id
          and groups.active = true
          and cohorts.active = true
          and masajid.active = true
          and memberships.starts_on <= access_context.access_date
          and (memberships.ends_on is null or memberships.ends_on >= access_context.access_date)
      ) then true
      else false
    end as current_active,
    case
      when not profiles.active then profiles.role
      when profiles.role = 'super_admin' then 'super_admin'
      when exists (
        select 1
        from public.masjid_staff_memberships as memberships
        join public.masajid on masajid.id = memberships.masjid_id
        where memberships.profile_id = events.profile_id
          and memberships.staff_role = 'admin'
          and memberships.active = true
          and masajid.active = true
          and memberships.starts_on <= events.transition_date
          and (memberships.ends_on is null or memberships.ends_on >= events.transition_date)
      ) then 'admin'
      when exists (
        select 1
        from public.masjid_staff_memberships as memberships
        join public.masajid on masajid.id = memberships.masjid_id
        where memberships.profile_id = events.profile_id
          and memberships.staff_role = 'teacher'
          and memberships.active = true
          and masajid.active = true
          and memberships.starts_on <= events.transition_date
          and (memberships.ends_on is null or memberships.ends_on >= events.transition_date)
      ) then 'teacher'
      when exists (
        select 1
        from public.student_group_memberships as memberships
        join public.halaqa_groups as groups on groups.id = memberships.group_id
        join public.cohorts on cohorts.id = groups.cohort_id
        join public.masajid on masajid.id = cohorts.masjid_id
        where memberships.student_id = events.profile_id
          and groups.active = true
          and cohorts.active = true
          and masajid.active = true
          and memberships.starts_on <= events.transition_date
          and (memberships.ends_on is null or memberships.ends_on >= events.transition_date)
      ) then 'student'
      else profiles.role
    end as future_role,
    case
      when not profiles.active then false
      when profiles.role = 'super_admin' then profiles.active
      when exists (
        select 1
        from public.masjid_staff_memberships as memberships
        join public.masajid on masajid.id = memberships.masjid_id
        where memberships.profile_id = events.profile_id
          and memberships.staff_role in ('admin', 'teacher')
          and memberships.active = true
          and masajid.active = true
          and memberships.starts_on <= events.transition_date
          and (memberships.ends_on is null or memberships.ends_on >= events.transition_date)
      ) then true
      when exists (
        select 1
        from public.student_group_memberships as memberships
        join public.halaqa_groups as groups on groups.id = memberships.group_id
        join public.cohorts on cohorts.id = groups.cohort_id
        join public.masajid on masajid.id = cohorts.masjid_id
        where memberships.student_id = events.profile_id
          and groups.active = true
          and cohorts.active = true
          and masajid.active = true
          and memberships.starts_on <= events.transition_date
          and (memberships.ends_on is null or memberships.ends_on >= events.transition_date)
      ) then true
      else false
    end as future_active
  from events
  join public.profiles on profiles.id = events.profile_id
  cross join access_context
)
select
  projections.membership_id,
  projections.profile_id,
  projections.transition,
  projections.transition_date,
  projections.current_role,
  projections.current_active,
  projections.future_role,
  projections.future_active,
  case
    when projections.current_role is distinct from projections.future_role
      and projections.current_active is distinct from projections.future_active
      then 'role_and_active_would_change'
    when projections.current_role is distinct from projections.future_role
      then 'role_would_change'
    else 'active_would_change'
  end as reason
from projections
where (projections.current_role, projections.current_active)
  is distinct from (projections.future_role, projections.future_active)
order by projections.transition_date, projections.membership_id;

\echo '=== teacher assignments relevant to immediate deactivation ==='

select
  assignments.id as assignment_id,
  assignments.teacher_id,
  assignments.group_id,
  assignments.week_start,
  public.halaqa_saturday_for_week(assignments.week_start) as halaqa_saturday,
  'active_assignment_on_or_after_access_date' as reason
from public.group_teacher_assignments as assignments
where assignments.active = true
  and public.halaqa_saturday_for_week(assignments.week_start)
      >= public.current_toronto_civil_date()
order by halaqa_saturday, assignments.id;

\echo '=== current and future admin-coverage risks ==='

with access_context as (
  select public.current_toronto_civil_date() as access_date
),
boundaries as (
  select masajid.id as masjid_id, access_context.access_date as coverage_date
  from public.masajid
  cross join access_context
  where masajid.active = true
  union
  select memberships.masjid_id, memberships.starts_on
  from public.masjid_staff_memberships as memberships
  join public.masajid on masajid.id = memberships.masjid_id
  cross join access_context
  where masajid.active = true
    and memberships.staff_role = 'admin'
    and memberships.active = true
    and memberships.starts_on > access_context.access_date
  union
  select memberships.masjid_id, memberships.ends_on + 1
  from public.masjid_staff_memberships as memberships
  join public.masajid on masajid.id = memberships.masjid_id
  cross join access_context
  where masajid.active = true
    and memberships.staff_role = 'admin'
    and memberships.active = true
    and memberships.ends_on is not null
    and memberships.ends_on + 1 > access_context.access_date
),
risks as (
  select
    boundaries.masjid_id,
    boundaries.coverage_date,
    case
      when boundaries.coverage_date = access_context.access_date
        then 'no_current_admin_coverage'
      else 'no_future_admin_coverage'
    end as reason
  from boundaries
  cross join access_context
  where not exists (
    select 1
    from public.masjid_staff_memberships as memberships
    join public.profiles on profiles.id = memberships.profile_id
    where memberships.masjid_id = boundaries.masjid_id
      and memberships.staff_role = 'admin'
      and memberships.active = true
      and profiles.active = true
      and memberships.starts_on <= boundaries.coverage_date
      and (memberships.ends_on is null or memberships.ends_on >= boundaries.coverage_date)
  )
)
select * from risks order by masjid_id, coverage_date;

\echo '=== rows or conditions that would cause the access migration to fail ==='

select
  'guided_change_review' as source,
  reviews.request_id as row_id,
  reviews.operation,
  reviews.masjid_id,
  reviews.group_id,
  'review operation/scope violates the Slice 3 constraint' as reason
from public.super_admin_guided_change_reviews as reviews
where not (
  (
    reviews.operation in ('add_teacher', 'add_admin', 'add_admin_teacher',
                          'set_teacher_only', 'set_admin_only', 'set_admin_teacher')
    and reviews.masjid_id is not null
    and reviews.group_id is null
  )
  or (reviews.operation = 'assign_student' and reviews.masjid_id is not null and reviews.group_id is not null)
  or (reviews.operation = 'deactivate_account' and reviews.masjid_id is null and reviews.group_id is null)
)
order by reviews.request_id;

select
  required_objects.object_name,
  required_objects.reason
from (
  values
    ('public.current_toronto_civil_date()',
      to_regprocedure('public.current_toronto_civil_date()') is null,
      'required Toronto civil-date function is missing'),
    ('public.prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)',
      to_regprocedure('public.prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)') is null,
      'historical staff-grant preparation function is missing'),
    ('public.apply_super_admin_hierarchy_change(uuid,uuid,text,uuid,uuid,uuid,text,text,integer,boolean,jsonb)',
      to_regprocedure('public.apply_super_admin_hierarchy_change(uuid,uuid,text,uuid,uuid,uuid,text,text,integer,boolean,jsonb)') is null,
      'historical hierarchy mutation function is missing'),
    ('private.workflow_expected_state_snapshots',
      to_regclass('private.workflow_expected_state_snapshots') is null,
      'staff-grant preparation snapshot table is missing'),
    ('private.workflow_mutation_requests',
      to_regclass('private.workflow_mutation_requests') is null,
      'request ledger table is missing')
) as required_objects(object_name, missing, reason)
where required_objects.missing;

\echo '=== end access transition rollout audit ==='
