-- REVIEWED MANUAL REPAIR TEMPLATE — DO NOT RUN UNEDITED.
-- This file is intentionally not a migration. Run each phase separately only
-- after reviewing the preview and replacing the actor/date placeholders.

-- Phase 1: read-only inventory of malformed pending obligations.
select
  obligations.id,
  obligations.student_id,
  profiles.name as student_name,
  obligations.week_start,
  obligations.weekly_percentage,
  obligations.amount_cents,
  obligations.masjid_id,
  obligations.cohort_id,
  obligations.halaqa_group_id
from public.accountability_obligations as obligations
join public.profiles on profiles.id = obligations.student_id
where obligations.status = 'pending'
  and (
    obligations.masjid_id is null
    or obligations.cohort_id is null
    or obligations.halaqa_group_id is null
  )
order by obligations.week_start, profiles.name, obligations.id;

-- Phase 2: after review, waive malformed pending rows with an audit trail.
-- Replace the UUID with the active super admin approving the repair.
begin;
set local app.repair_actor_id = 'REPLACE_WITH_ACTIVE_SUPER_ADMIN_UUID';
do $$
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = current_setting('app.repair_actor_id')::uuid
      and profiles.role = 'super_admin'
      and profiles.active = true
  ) then
    raise exception 'repair actor must be an active super admin';
  end if;
end;
$$;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('app.repair_actor_id'),
    'role', 'authenticated'
  )::text,
  true
);

create temp table reviewed_malformed_obligations on commit drop as
select obligations.*
from public.accountability_obligations as obligations
where obligations.status = 'pending'
  and (
    obligations.masjid_id is null
    or obligations.cohort_id is null
    or obligations.halaqa_group_id is null
  )
for update;

update public.accountability_obligations as obligations
set status = 'waived',
    waived_at = now(),
    waived_by = current_setting('app.repair_actor_id')::uuid,
    admin_note = concat_ws(
      E'\n',
      nullif(obligations.admin_note, ''),
      'System repair: waived malformed pending obligation with no valid stored scope; not paid.'
    ),
    updated_at = now()
from reviewed_malformed_obligations as reviewed
where obligations.id = reviewed.id;

insert into public.super_admin_audit_events (
  actor_id, action, target_table, target_id, target_masjid_id,
  before_data, after_data, metadata
)
select
  current_setting('app.repair_actor_id')::uuid,
  'malformed_accountability_obligation_waived',
  'accountability_obligations',
  reviewed.id,
  reviewed.masjid_id,
  jsonb_build_object(
    'status', reviewed.status,
    'waived_at', reviewed.waived_at,
    'waived_by', reviewed.waived_by,
    'admin_note', reviewed.admin_note
  ),
  jsonb_build_object(
    'status', repaired.status,
    'waived_at', repaired.waived_at,
    'waived_by', repaired.waived_by,
    'admin_note', repaired.admin_note
  ),
  jsonb_build_object(
    'student_id', reviewed.student_id,
    'week_start', reviewed.week_start,
    'reason', 'missing_valid_scope',
    'payment_status_asserted', false
  )
from reviewed_malformed_obligations as reviewed
join public.accountability_obligations as repaired on repaired.id = reviewed.id;

alter table public.accountability_obligations
  validate constraint accountability_pending_scope_required;
commit;

-- Phase 3: stakeholder review list for official first-scored weeks.
select
  profiles.id as student_id,
  profiles.name as student_name,
  profiles.score_starts_on as current_score_starts_on,
  min(memberships.starts_on) as earliest_access_starts_on,
  min(
    memberships.starts_on
    + ((7 - extract(dow from memberships.starts_on)::integer) % 7)
  ) as earliest_canonical_score_start,
  count(*) filter (
    where obligations.status = 'pending'
      and (
        profiles.score_starts_on is null
        or obligations.week_start < profiles.score_starts_on
      )
  ) as pending_obligations_before_current_boundary
from public.profiles
left join public.student_group_memberships as memberships
  on memberships.student_id = profiles.id
left join public.accountability_obligations as obligations
  on obligations.student_id = profiles.id
where profiles.role = 'student'
group by profiles.id, profiles.name, profiles.score_starts_on
order by profiles.name, profiles.id;

-- Phase 4: populate only stakeholder-confirmed rows, review, then execute.
begin;
set local app.repair_actor_id = 'REPLACE_WITH_ACTIVE_SUPER_ADMIN_UUID';
do $$
begin
  if not exists (
    select 1 from public.profiles
    where profiles.id = current_setting('app.repair_actor_id')::uuid
      and profiles.role = 'super_admin'
      and profiles.active = true
  ) then
    raise exception 'repair actor must be an active super admin';
  end if;
end;
$$;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('app.repair_actor_id'),
    'role', 'authenticated'
  )::text,
  true
);

create temp table confirmed_score_starts (
  student_id uuid primary key,
  confirmed_score_starts_on date not null,
  stakeholder_note text not null
) on commit drop;

-- Add one explicit row per confirmed student. Never bulk-guess dates.
-- insert into confirmed_score_starts values
--   ('STUDENT_UUID', date '2026-07-26', 'Confirmed by stakeholder on YYYY-MM-DD');

do $$
begin
  if exists (
    select 1
    from confirmed_score_starts as confirmed
    left join public.profiles on profiles.id = confirmed.student_id
    left join lateral (
      select min(memberships.starts_on) as earliest_access
      from public.student_group_memberships as memberships
      where memberships.student_id = confirmed.student_id
    ) access on true
    where profiles.role is distinct from 'student'
      or access.earliest_access is null
      or confirmed.confirmed_score_starts_on
        <> public.week_start_for_date(confirmed.confirmed_score_starts_on)
      or confirmed.confirmed_score_starts_on < access.earliest_access
  ) then
    raise exception 'Confirmed score-start rows failed student, Sunday, or access-boundary validation.';
  end if;
end;
$$;

create temp table pre_boundary_pending_obligations on commit drop as
select obligations.*, confirmed.stakeholder_note, confirmed.confirmed_score_starts_on
from public.accountability_obligations as obligations
join confirmed_score_starts as confirmed on confirmed.student_id = obligations.student_id
where obligations.status = 'pending'
  and obligations.week_start < confirmed.confirmed_score_starts_on
for update;

insert into public.super_admin_audit_events (
  actor_id, action, target_table, target_id, before_data, after_data, metadata
)
select
  current_setting('app.repair_actor_id')::uuid,
  'student_score_start_repaired',
  'profiles',
  profiles.id,
  jsonb_build_object('score_starts_on', profiles.score_starts_on),
  jsonb_build_object('score_starts_on', confirmed.confirmed_score_starts_on),
  jsonb_build_object('stakeholder_note', confirmed.stakeholder_note)
from confirmed_score_starts as confirmed
join public.profiles on profiles.id = confirmed.student_id;

update public.profiles as profiles
set score_starts_on = confirmed.confirmed_score_starts_on
from confirmed_score_starts as confirmed
where profiles.id = confirmed.student_id;

update public.accountability_obligations as obligations
set status = 'waived',
    waived_at = now(),
    waived_by = current_setting('app.repair_actor_id')::uuid,
    admin_note = concat_ws(
      E'\n',
      nullif(obligations.admin_note, ''),
      'System repair: waived because the obligation predates the stakeholder-confirmed scoring boundary; not paid.'
    ),
    updated_at = now()
from pre_boundary_pending_obligations as reviewed
where obligations.id = reviewed.id;

insert into public.super_admin_audit_events (
  actor_id, action, target_table, target_id, target_masjid_id,
  before_data, after_data, metadata
)
select
  current_setting('app.repair_actor_id')::uuid,
  'pre_score_start_obligation_waived',
  'accountability_obligations',
  reviewed.id,
  reviewed.masjid_id,
  jsonb_build_object('status', reviewed.status),
  jsonb_build_object('status', repaired.status, 'waived_at', repaired.waived_at),
  jsonb_build_object(
    'student_id', reviewed.student_id,
    'week_start', reviewed.week_start,
    'confirmed_score_starts_on', reviewed.confirmed_score_starts_on,
    'stakeholder_note', reviewed.stakeholder_note,
    'payment_status_asserted', false
  )
from pre_boundary_pending_obligations as reviewed
join public.accountability_obligations as repaired on repaired.id = reviewed.id;
commit;
