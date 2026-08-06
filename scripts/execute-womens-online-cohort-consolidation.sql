-- ITQAN Lite women's online cohort consolidation.
--
-- PREPARED ONLY. This file was not executed as part of the preparation task.
-- It is a production mutation script and is intentionally fail-closed:
--   * it requires an explicit confirmation token;
--   * it requires a fresh preview digest and exact UUID parameters;
--   * it requires the Toronto civil date to equal the approved cutover date;
--   * it uses SERIALIZABLE + an advisory lock and aborts on stale/ambiguous state;
--   * all database changes and audit events are committed in one transaction;
--   * an exact retry returns the prior operation event without duplicating rows.
--
-- Run only after the approval gate in docs/WOMENS_ONLINE_COHORT_CONSOLIDATION_RUNBOOK.md
-- is satisfied, after the fresh database and Storage backups are complete, and
-- while production writes are frozen for this masjid/cohort.
--
-- Required psql variables:
--   confirm, operation_request_id, actor_id, masjid_id, cohort_id,
--   retained_group_id, retired_group_id, effective_date,
--   expected_before_state_digest
--
-- The operator must use a privileged direct PostgreSQL connection. Do not run
-- this through an anon/authenticated client or an application RPC call.

\set ON_ERROR_STOP on
\pset pager off

\if :{?dry_run}
\else
  \set dry_run false
\endif

\if :{?confirm}
\else
  \echo 'Refusing to run: missing psql variable confirm.'
  \quit 3
\endif
\if :{?operation_request_id}
\else
  \echo 'Refusing to run: missing psql variable operation_request_id.'
  \quit 3
\endif
\if :{?actor_id}
\else
  \echo 'Refusing to run: missing psql variable actor_id.'
  \quit 3
\endif
\if :{?masjid_id}
\else
  \echo 'Refusing to run: missing psql variable masjid_id.'
  \quit 3
\endif
\if :{?cohort_id}
\else
  \echo 'Refusing to run: missing psql variable cohort_id.'
  \quit 3
\endif
\if :{?retained_group_id}
\else
  \echo 'Refusing to run: missing psql variable retained_group_id.'
  \quit 3
\endif
\if :{?retired_group_id}
\else
  \echo 'Refusing to run: missing psql variable retired_group_id.'
  \quit 3
\endif
\if :{?effective_date}
\else
  \echo 'Refusing to run: missing psql variable effective_date.'
  \quit 3
\endif
\if :{?expected_before_state_digest}
\else
  \echo 'Refusing to run: missing psql variable expected_before_state_digest.'
  \quit 3
\endif

BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

create temporary table consolidation_params (
  confirm text not null,
  operation_request_id uuid not null,
  actor_id uuid not null,
  masjid_id uuid not null,
  cohort_id uuid not null,
  retained_group_id uuid not null,
  retired_group_id uuid not null,
  effective_date date not null,
  expected_before_state_digest text not null,
  idempotent boolean not null default false,
  result_status text,
  result_event_id uuid
) on commit preserve rows;

insert into consolidation_params (
  confirm, operation_request_id, actor_id, masjid_id, cohort_id,
  retained_group_id, retired_group_id, effective_date, expected_before_state_digest
)
values (
  :'confirm',
  :'operation_request_id'::uuid,
  :'actor_id'::uuid,
  :'masjid_id'::uuid,
  :'cohort_id'::uuid,
  :'retained_group_id'::uuid,
  :'retired_group_id'::uuid,
  :'effective_date'::date,
  :'expected_before_state_digest'
);

create temporary table consolidation_affected_students as
select distinct memberships.student_id
from public.student_group_memberships memberships
join consolidation_params params
  on memberships.group_id in (params.retained_group_id, params.retired_group_id);

create temporary table consolidation_source_memberships as
select memberships.*
from public.student_group_memberships memberships
where false;

create temporary table consolidation_retired_group_before as
select groups.*
from public.halaqa_groups groups
where false;

create temporary table consolidation_setting_before as
select settings.*
from public.cohort_rotation_settings settings
where false;

create temporary table consolidation_replacements as
select memberships.*
from public.student_group_memberships memberships
where false;

create temporary table consolidation_group_result (result jsonb);
create temporary table consolidation_event_ids (event_id uuid);
create temporary table consolidation_before_state (state jsonb, state_digest text);
create temporary table consolidation_after_state (state jsonb, state_digest text);

-- Serialize this operation with any other prepared work for this cohort.
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'itqan-womens-online-cohort-consolidation:' || params.cohort_id::text,
    0
  )
)
from consolidation_params params;

-- Lock hierarchy and affected rows in a stable order before comparing state.
select masajid.id
from public.masajid
join consolidation_params params on params.masjid_id = masajid.id
for update;

select cohorts.id
from public.cohorts
join consolidation_params params on params.cohort_id = cohorts.id
for update;

select groups.id
from public.halaqa_groups groups
join consolidation_params params
  on groups.cohort_id = params.cohort_id
 and groups.id in (params.retained_group_id, params.retired_group_id)
order by groups.id
for update;

select settings.id
from public.cohort_rotation_settings settings
join consolidation_params params on params.cohort_id = settings.cohort_id
order by settings.id
for update;

select memberships.id
from public.student_group_memberships memberships
join consolidation_params params
  on memberships.group_id in (params.retained_group_id, params.retired_group_id)
order by memberships.student_id, memberships.starts_on, memberships.id
for update;

select profiles.id
from public.profiles
join consolidation_affected_students affected on affected.student_id = profiles.id
order by profiles.id
for update;

select assignments.id
from public.group_teacher_assignments assignments
join consolidation_params params
  on assignments.group_id in (params.retained_group_id, params.retired_group_id)
order by assignments.week_start, assignments.group_id, assignments.id
for update;

insert into consolidation_source_memberships
select memberships.*
from public.student_group_memberships memberships
join consolidation_params params on memberships.group_id = params.retired_group_id
order by memberships.student_id, memberships.starts_on, memberships.id;

insert into consolidation_retired_group_before
select groups.*
from public.halaqa_groups groups
join consolidation_params params on groups.id = params.retired_group_id;

insert into consolidation_setting_before
select settings.*
from public.cohort_rotation_settings settings
join consolidation_params params on params.cohort_id = settings.cohort_id
where settings.active;

-- An exact operation retry is a successful no-op only when the operation
-- audit event exists and the complete final-state shape still matches.
do $$
declare
  params record;
  existing_event public.super_admin_audit_events%rowtype;
  bad_count integer;
  placement_bad_count integer;
begin
  select * into params from consolidation_params limit 1;

  if params.confirm <> 'I_UNDERSTAND_THIS_MUTATES_PRODUCTION' then
    raise exception using errcode = '42501', message = 'Explicit production mutation confirmation token is required.';
  end if;

  if not private.raw_is_active_super_admin(params.actor_id) then
    raise exception using errcode = '42501', message = 'The supplied actor is not an active super admin.';
  end if;

  select * into existing_event
  from public.super_admin_audit_events events
  where events.action = 'womens_online_cohort_consolidated'
    and events.metadata->>'request_id' = params.operation_request_id::text
  order by events.occurred_at desc, events.id desc
  limit 1
  for share;

  if found then
    if existing_event.actor_id <> params.actor_id
      or existing_event.target_masjid_id <> params.masjid_id
      or existing_event.target_id <> params.cohort_id
      or existing_event.metadata->>'effective_date' <> params.effective_date::text
      or existing_event.metadata->>'retained_group_id' <> params.retained_group_id::text
      or existing_event.metadata->>'retired_group_id' <> params.retired_group_id::text
    then
      raise exception using errcode = '22023', message = 'Operation request ID is bound to different consolidation inputs.';
    end if;

    if not exists (
      select 1
      from public.halaqa_groups groups
      where groups.id = params.retired_group_id
        and groups.cohort_id = params.cohort_id
        and groups.active = false
    )
    or not exists (
      select 1
      from public.halaqa_groups groups
      where groups.id = params.retained_group_id
        and groups.cohort_id = params.cohort_id
        and groups.active = true
    )
    or not exists (
      select 1
      from public.cohort_rotation_settings settings
      where settings.cohort_id = params.cohort_id
        and settings.active
        and settings.target_group_count = 1
    )
    then
      raise exception using errcode = '40001', message = 'Existing consolidation audit event does not match final state.';
    end if;

    select count(*) into bad_count
    from consolidation_source_memberships source
    where source.starts_on <= params.effective_date
      and (source.ends_on is null or source.ends_on >= params.effective_date);

    select count(*) into placement_bad_count
    from (
      select affected.student_id,
             count(memberships.id) as effective_membership_count,
             count(*) filter (where memberships.group_id = params.retained_group_id) as retained_count,
             count(*) filter (where memberships.group_id = params.retired_group_id) as retired_count
      from consolidation_affected_students affected
      left join public.student_group_memberships memberships
        on memberships.student_id = affected.student_id
       and memberships.starts_on <= params.effective_date
       and (memberships.ends_on is null or memberships.ends_on >= params.effective_date)
      group by affected.student_id
    ) placements
    where placements.effective_membership_count <> 1
       or placements.retained_count <> 1
       or placements.retired_count <> 0;

    if exists (
      select 1
      from public.student_group_memberships memberships
      join consolidation_affected_students affected on affected.student_id = memberships.student_id
      where memberships.starts_on <= params.effective_date
        and (memberships.ends_on is null or memberships.ends_on >= params.effective_date)
        and memberships.group_id <> params.retained_group_id
    )
    or bad_count <> 0
    or placement_bad_count <> 0
    then
      raise exception using errcode = '40001', message = 'Existing consolidation audit event has unsafe current membership state.';
    end if;

    update consolidation_params
    set idempotent = true,
        result_status = 'already_applied',
        result_event_id = existing_event.id;
    return;
  end if;

  if exists (
    select 1
    from private.workflow_mutation_requests requests
    where requests.request_id = params.operation_request_id
  ) then
    raise exception using errcode = '22023', message = 'Operation request ID is already used by another workflow.';
  end if;
end;
$$;

-- Every non-idempotent run must occur on the approved civil date and no later
-- than that tracker week's halaqa Saturday. A retry may be
-- performed later because it is a verified no-op and does not mutate state.
do $$
declare
  params record;
begin
  select * into params from consolidation_params limit 1;
  if params.idempotent then
    return;
  end if;

  if public.current_toronto_civil_date() <> params.effective_date then
    raise exception using errcode = '40001', message = 'Toronto civil date is not the approved effective date; re-preview and reschedule.';
  end if;

  if params.effective_date > public.halaqa_saturday_for_week(public.week_start_for_date(params.effective_date)) then
    raise exception using errcode = '22023', message = 'Effective date cannot be after the tracker week halaqa Saturday.';
  end if;

  if not exists (
    select 1 from public.masajid
    where id = params.masjid_id and active
  )
  or not exists (
    select 1 from public.cohorts
    where id = params.cohort_id and masjid_id = params.masjid_id and active and kind = 'sisters'
  )
  then
    raise exception using errcode = '40001', message = 'Masjid/cohort identity or active state changed.';
  end if;

  if (select count(*) from public.halaqa_groups where cohort_id = params.cohort_id and active) <> 2
     or not exists (select 1 from public.halaqa_groups where id = params.retained_group_id and cohort_id = params.cohort_id and active)
     or not exists (select 1 from public.halaqa_groups where id = params.retired_group_id and cohort_id = params.cohort_id and active)
  then
    raise exception using errcode = '40001', message = 'Active group topology changed; re-preview before execution.';
  end if;

  if (select count(*) from consolidation_source_memberships where starts_on >= params.effective_date) <> 0 then
    raise exception using errcode = '40001', message = 'A future-only retired-group membership exists; manual interval resolution is required.';
  end if;

  if (select count(*) from consolidation_source_memberships where starts_on <= params.effective_date and (ends_on is null or ends_on >= params.effective_date)) = 0 then
    raise exception using errcode = '40001', message = 'No retired-group membership intersects the cutover; refusing an empty consolidation.';
  end if;

  if exists (
    select 1
    from consolidation_source_memberships source
    join consolidation_source_memberships other
      on other.student_id = source.student_id
     and other.id <> source.id
     and other.starts_on <= params.effective_date
     and (other.ends_on is null or other.ends_on >= params.effective_date)
    where source.starts_on <= params.effective_date
      and (source.ends_on is null or source.ends_on >= params.effective_date)
  ) then
    raise exception using errcode = '40001', message = 'A student has multiple retired-group placements at cutover.';
  end if;

  if exists (
    select 1
    from public.student_group_memberships memberships
    join consolidation_affected_students affected on affected.student_id = memberships.student_id
    where memberships.group_id = params.retained_group_id
      and memberships.starts_on <= params.effective_date
      and (memberships.ends_on is null or memberships.ends_on >= params.effective_date)
      and exists (
        select 1
        from consolidation_source_memberships source
        where source.student_id = memberships.student_id
          and source.starts_on <= params.effective_date
          and (source.ends_on is null or source.ends_on >= params.effective_date)
      )
  ) then
    raise exception using errcode = '40001', message = 'A source student already has a retained-group cutover membership.';
  end if;

  if exists (
    select 1
    from (
      select memberships.student_id,
             count(*) as effective_membership_count,
             count(*) filter (where memberships.group_id = params.retired_group_id) as retired_count,
             count(*) filter (where memberships.group_id = params.retained_group_id) as retained_count
      from (
        select distinct source.student_id
        from consolidation_source_memberships source
        cross join consolidation_params source_params
        where source.starts_on <= source_params.effective_date
          and (source.ends_on is null or source.ends_on >= source_params.effective_date)
      ) source_students
      join public.student_group_memberships memberships
        on memberships.student_id = source_students.student_id
      cross join consolidation_params cutover_params
      where memberships.starts_on <= cutover_params.effective_date
        and (memberships.ends_on is null or memberships.ends_on >= cutover_params.effective_date)
      group by memberships.student_id
    ) placements
    where placements.effective_membership_count <> 1
       or placements.retired_count <> 1
       or placements.retained_count <> 0
  ) then
    raise exception using errcode = '40001', message = 'A source student has an ambiguous or cross-group effective placement at cutover.';
  end if;

  if exists (
    select 1
    from public.group_teacher_assignments assignments
    where assignments.group_id = params.retired_group_id
      and assignments.week_start >= public.week_start_for_date(params.effective_date)
  ) then
    raise exception using errcode = '40001', message = 'A current/future retired-group teacher assignment requires explicit teacher resolution.';
  end if;

  if exists (
    select 1
    from public.cohort_rotation_settings settings
    where settings.cohort_id = params.cohort_id and settings.active
  having count(*) <> 1 or min(settings.target_group_count) <> 2
  ) then
    raise exception using errcode = '40001', message = 'Rotation settings are not the expected one-active-row/two-group state.';
  end if;

  if exists (
    select 1
    from public.checkins checkins
    join consolidation_affected_students affected on affected.student_id = checkins.student_id
    where checkins.halaqa_group_id = params.retired_group_id
      and checkins.date >= params.effective_date
  )
  or exists (
    select 1
    from public.weekly_plans plans
    join consolidation_affected_students affected on affected.student_id = plans.student_id
    where plans.halaqa_group_id = params.retired_group_id
      and plans.week_start >= params.effective_date
  )
  or exists (
    select 1
    from public.partner_recitations recitations
    join consolidation_affected_students affected on affected.student_id = recitations.student_id
    where recitations.halaqa_group_id = params.retired_group_id
      and recitations.week_start >= params.effective_date
  )
  or exists (
    select 1
    from public.halaqa_grades grades
    join consolidation_affected_students affected on affected.student_id = grades.student_id
    where grades.halaqa_group_id = params.retired_group_id
      and grades.week_start >= params.effective_date
  )
  or exists (
    select 1
    from public.accountability_obligations obligations
    join consolidation_affected_students affected on affected.student_id = obligations.student_id
    where obligations.halaqa_group_id = params.retired_group_id
      and obligations.week_start >= params.effective_date
  )
  or exists (
    select 1
    from public.badge_awards awards
    join consolidation_affected_students affected on affected.student_id = awards.student_id
    where awards.halaqa_group_id = params.retired_group_id
      and awards.week_start >= params.effective_date
  )
  then
    raise exception using errcode = '40001', message = 'A post-cutover operational snapshot points at the retired group.';
  end if;
end;
$$;

-- The canonical state view is also the stale-state digest contract used by the
-- read-only preview. It deliberately includes historical memberships,
-- assignments, teacher staff rows, affected profiles, and activity scope IDs.
create temporary view consolidation_canonical_state as
with params as (
  select * from consolidation_params limit 1
), target_groups as (
  select groups.*
  from public.halaqa_groups groups
  join params on groups.cohort_id = params.cohort_id
  where groups.id in (params.retained_group_id, params.retired_group_id)
), activity as (
  select 'checkins'::text as table_name, checkins.id as row_id, checkins.student_id,
         public.week_start_for_date(checkins.date) as week_start, checkins.date as activity_date,
         checkins.masjid_id, checkins.cohort_id, checkins.halaqa_group_id
  from public.checkins join consolidation_affected_students using (student_id)
  union all
  select 'weekly_plans', plans.id, plans.student_id, plans.week_start, plans.week_start,
         plans.masjid_id, plans.cohort_id, plans.halaqa_group_id
  from public.weekly_plans plans join consolidation_affected_students using (student_id)
  union all
  select 'partner_recitations', recitations.id, recitations.student_id, recitations.week_start, recitations.week_start,
         recitations.masjid_id, recitations.cohort_id, recitations.halaqa_group_id
  from public.partner_recitations recitations join consolidation_affected_students using (student_id)
  union all
  select 'halaqa_grades', grades.id, grades.student_id, grades.week_start, grades.week_start,
         grades.masjid_id, grades.cohort_id, grades.halaqa_group_id
  from public.halaqa_grades grades join consolidation_affected_students using (student_id)
  union all
  select 'accountability_obligations', obligations.id, obligations.student_id, obligations.week_start, obligations.week_start,
         obligations.masjid_id, obligations.cohort_id, obligations.halaqa_group_id
  from public.accountability_obligations obligations join consolidation_affected_students using (student_id)
  union all
  select 'badge_awards', awards.id, awards.student_id, awards.week_start, awards.week_start,
         awards.masjid_id, awards.cohort_id, awards.halaqa_group_id
  from public.badge_awards awards join consolidation_affected_students using (student_id)
), state as (
  select jsonb_build_object(
    'masjid', (select to_jsonb(masajid) from public.masajid cross join params where masajid.id = params.masjid_id),
    'cohort', (select to_jsonb(cohorts) from public.cohorts cross join params where cohorts.id = params.cohort_id),
    'groups', coalesce((select jsonb_agg(to_jsonb(target_groups) order by target_groups.sort_order, target_groups.id) from target_groups), '[]'::jsonb),
    'rotation_settings', coalesce((select jsonb_agg(to_jsonb(settings) order by settings.active desc, settings.id) from public.cohort_rotation_settings settings cross join params where settings.cohort_id = params.cohort_id), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(to_jsonb(memberships) order by memberships.student_id, memberships.starts_on, memberships.id) from public.student_group_memberships memberships join target_groups on target_groups.id = memberships.group_id), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(to_jsonb(assignments) order by assignments.week_start, assignments.group_id, assignments.id) from public.group_teacher_assignments assignments join target_groups on target_groups.id = assignments.group_id), '[]'::jsonb),
    'profiles', coalesce((select jsonb_agg(to_jsonb(profiles) order by profiles.id) from public.profiles join consolidation_affected_students affected on affected.student_id = profiles.id), '[]'::jsonb),
    'teacher_staff', coalesce((select jsonb_agg(to_jsonb(staff) order by staff.profile_id, staff.staff_role, staff.starts_on, staff.id) from public.masjid_staff_memberships staff cross join params where staff.masjid_id = params.masjid_id), '[]'::jsonb),
    'activity_scope', coalesce((select jsonb_agg(to_jsonb(activity) order by activity.table_name, activity.row_id) from activity), '[]'::jsonb)
  ) as state
)
select state from state;

insert into consolidation_before_state (state, state_digest)
select state, encode(digest(state::text, 'sha256'), 'hex')
from consolidation_canonical_state
where not (select idempotent from consolidation_params);

do $$
declare
  params record;
  actual_digest text;
begin
  select * into params from consolidation_params limit 1;
  if params.idempotent then
    return;
  end if;

  select state_digest into actual_digest from consolidation_before_state;
  if actual_digest <> params.expected_before_state_digest then
    raise exception using errcode = '40001',
      message = 'Canonical state digest changed since preview; no mutation was applied.';
  end if;
end;
$$;

-- Close each retired-group interval at the day before the cutover.
update public.student_group_memberships memberships
set ends_on = params.effective_date - 1,
    updated_at = statement_timestamp()
from consolidation_params params,
     consolidation_source_memberships source
where not params.idempotent
  and source.id = memberships.id
  and source.starts_on <= params.effective_date
  and (source.ends_on is null or source.ends_on >= params.effective_date);

-- Insert one replacement membership per source placement. The old end date is
-- retained if it was finite; current production rows are open-ended.
with inserted as (
  insert into public.student_group_memberships (
    student_id, group_id, starts_on, ends_on, assigned_by, created_at, updated_at
  )
  select source.student_id,
         params.retained_group_id,
         params.effective_date,
         source.ends_on,
         params.actor_id,
         statement_timestamp(),
         statement_timestamp()
  from consolidation_source_memberships source
  cross join consolidation_params params
  where not params.idempotent
    and source.starts_on <= params.effective_date
    and (source.ends_on is null or source.ends_on >= params.effective_date)
  returning *
)
insert into consolidation_replacements
select * from inserted;

-- Keep rotation's stable group count aligned with the one active group.
update public.cohort_rotation_settings settings
set target_group_count = 1,
    updated_by = params.actor_id,
    updated_at = statement_timestamp()
from consolidation_params params
where not params.idempotent
  and settings.cohort_id = params.cohort_id
  and settings.active
  and settings.target_group_count = 2;

do $$
declare
  params record;
  retired_group record;
  group_result jsonb;
begin
  select * into params from consolidation_params limit 1;
  if params.idempotent then
    return;
  end if;

  select * into retired_group from consolidation_retired_group_before limit 1;

  insert into consolidation_group_result(result)
  select public.apply_super_admin_hierarchy_change(
    params.operation_request_id,
    params.actor_id,
    'update_group',
    params.masjid_id,
    params.cohort_id,
    params.retired_group_id,
    retired_group.name,
    'sisters',
    retired_group.sort_order,
    false,
    jsonb_build_object(
      'id', retired_group.id,
      'cohort_id', retired_group.cohort_id,
      'name', retired_group.name,
      'active', retired_group.active,
      'sort_order', retired_group.sort_order,
      'updated_at', retired_group.updated_at
    )
  );
end;
$$;

insert into consolidation_after_state (state, state_digest)
select state, encode(digest(state::text, 'sha256'), 'hex')
from consolidation_canonical_state;

-- Final invariants are checked before the operation audit event. Any failure
-- rolls back the membership closure, replacement inserts, setting update,
-- group deactivation, workflow ledger row, and all audit events together.
do $$
declare
  params record;
  source_count integer;
  replacement_count integer;
  effective_retired_count integer;
  effective_retained_count integer;
  effective_total_count integer;
begin
  select * into params from consolidation_params limit 1;
  if params.idempotent then
    return;
  end if;

  select count(*) into source_count
  from consolidation_source_memberships source
  where source.starts_on <= params.effective_date
    and (source.ends_on is null or source.ends_on >= params.effective_date);

  select count(*) into replacement_count from consolidation_replacements;

  if source_count <> replacement_count or replacement_count = 0 then
    raise exception using errcode = '40001', message = 'Replacement membership count does not equal source cutover count.';
  end if;

  if exists (
    select 1 from public.halaqa_groups
    where id = params.retired_group_id and active
  ) or not exists (
    select 1 from public.halaqa_groups
    where id = params.retained_group_id and active
  ) then
    raise exception using errcode = '40001', message = 'Final active-group state is unsafe.';
  end if;

  if not exists (
    select 1 from public.cohort_rotation_settings
    where cohort_id = params.cohort_id and active and target_group_count = 1
  ) then
    raise exception using errcode = '40001', message = 'Final rotation target group count is not one.';
  end if;

  select count(*) filter (where memberships.group_id = params.retired_group_id),
         count(*) filter (where memberships.group_id = params.retained_group_id),
         count(*)
  into effective_retired_count, effective_retained_count, effective_total_count
  from public.student_group_memberships memberships
  join consolidation_affected_students affected on affected.student_id = memberships.student_id
  where memberships.starts_on <= params.effective_date
    and (memberships.ends_on is null or memberships.ends_on >= params.effective_date);

  if effective_retired_count <> 0
     or effective_retained_count <> (select count(*) from consolidation_affected_students)
     or effective_total_count <> (select count(*) from consolidation_affected_students)
  then
    raise exception using errcode = '40001', message = 'Final effective roster is not exactly one retained-group placement per affected student.';
  end if;

  if exists (
    select 1 from public.group_teacher_assignments
    where group_id = params.retired_group_id
      and week_start >= public.week_start_for_date(params.effective_date)
  ) then
    raise exception using errcode = '40001', message = 'Final state contains a retired-group assignment at/after cutover.';
  end if;

  if exists (
    select 1
    from public.weekly_plans plans
    join consolidation_affected_students affected on affected.student_id = plans.student_id
    where plans.halaqa_group_id = params.retired_group_id and plans.week_start >= params.effective_date
  ) then
    raise exception using errcode = '40001', message = 'Final state contains a retired-group weekly plan at/after cutover.';
  end if;
end;
$$;

-- Audit rotation configuration separately, then record the single operation
-- event with the before/after membership sets and state digests.
insert into public.super_admin_audit_events (
  actor_id, action, target_table, target_id, target_masjid_id,
  before_data, after_data, metadata
)
select
  params.actor_id,
  'cohort_rotation_settings_updated',
  'cohort_rotation_settings',
  before_setting.id,
  params.masjid_id,
  to_jsonb(before_setting),
  to_jsonb(after_setting),
  jsonb_build_object(
    'request_id', params.operation_request_id,
    'source_workflow', 'womens_online_cohort_consolidation',
    'cohort_id', params.cohort_id,
    'effective_date', params.effective_date,
    'old_target_group_count', before_setting.target_group_count,
    'new_target_group_count', after_setting.target_group_count
  )
from consolidation_params params
join consolidation_setting_before before_setting on true
join public.cohort_rotation_settings after_setting
  on after_setting.id = before_setting.id
where not params.idempotent;

with inserted as (
  insert into public.super_admin_audit_events (
    actor_id, action, target_table, target_id, target_masjid_id,
    before_data, after_data, metadata
  )
  select
    params.actor_id,
    'womens_online_cohort_consolidated',
    'cohort_group_consolidation',
    params.cohort_id,
    params.masjid_id,
    jsonb_build_object(
      'state_digest', before_state.state_digest,
      'source_memberships', coalesce((select jsonb_agg(to_jsonb(source) order by source.student_id, source.starts_on, source.id) from consolidation_source_memberships source where source.starts_on <= params.effective_date and (source.ends_on is null or source.ends_on >= params.effective_date)), '[]'::jsonb),
      'retired_group', (select to_jsonb(groups) from consolidation_retired_group_before groups),
      'rotation_setting', (select to_jsonb(settings) from consolidation_setting_before settings)
    ),
    jsonb_build_object(
      'state_digest', after_state.state_digest,
      'replacement_memberships', coalesce((select jsonb_agg(to_jsonb(replacements) order by replacements.student_id, replacements.starts_on, replacements.id) from consolidation_replacements replacements), '[]'::jsonb),
      'retired_group', (select to_jsonb(groups) from public.halaqa_groups groups where groups.id = params.retired_group_id),
      'rotation_setting', (select to_jsonb(settings) from public.cohort_rotation_settings settings where settings.cohort_id = params.cohort_id and settings.active)
    ),
    jsonb_build_object(
      'request_id', params.operation_request_id,
      'source_workflow', 'womens_online_cohort_consolidation',
      'masjid_id', params.masjid_id,
      'cohort_id', params.cohort_id,
      'retained_group_id', params.retained_group_id,
      'retired_group_id', params.retired_group_id,
      'effective_date', params.effective_date,
      'source_membership_count', (select count(*) from consolidation_source_memberships source where source.starts_on <= params.effective_date and (source.ends_on is null or source.ends_on >= params.effective_date)),
      'replacement_membership_count', (select count(*) from consolidation_replacements),
      'operational_rows_mutated', false,
      'teacher_assignments_mutated', false,
      'historical_snapshots_preserved', true,
      'group_deleted', false,
      'fresh_backup_required', true
    )
  from consolidation_params params
  cross join consolidation_before_state before_state
  cross join consolidation_after_state after_state
  where not params.idempotent
  returning id
)
insert into consolidation_event_ids
select id from inserted;

update consolidation_params params
set result_status = case when params.idempotent then 'already_applied' else 'applied' end,
    result_event_id = coalesce(params.result_event_id, (select event_id from consolidation_event_ids limit 1));

select
  params.result_status,
  params.result_event_id,
  params.operation_request_id,
  (select state_digest from consolidation_before_state) as before_state_digest,
  (select state_digest from consolidation_after_state) as after_state_digest,
  (select count(*) from consolidation_replacements) as replacement_membership_rows,
  (select count(*) from consolidation_group_result) as group_rpc_rows
from consolidation_params params;

\if :dry_run
  ROLLBACK;
\else
  COMMIT;
\endif
