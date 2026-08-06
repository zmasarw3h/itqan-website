-- Stale-draft recovery for attendance-aware Saturday session rosters.
--
-- A refresh is a new draft, never an in-place rewrite.  The superseded draft
-- remains readable for history/diagnostics but cannot be edited, reviewed, or
-- published.  The current published version is only read while the refresh is
-- serialized under the existing cohort/week advisory lock.

-- The foundation migration allowed only draft/published rows.  Broaden the
-- status and audit-operation checks without removing any table, column, or
-- historical row.  These replacements are additive state-machine cases for
-- the recovery workflow.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.session_roster_drafts'::regclass
      and conname = 'session_roster_drafts_status_check'
  ) then
    alter table public.session_roster_drafts
      drop constraint session_roster_drafts_status_check;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.session_roster_drafts'::regclass
      and conname = 'session_roster_drafts_status_check'
  ) then
    alter table public.session_roster_drafts
      add constraint session_roster_drafts_status_check
      check (status in ('draft', 'published', 'superseded'));
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.session_roster_drafts'::regclass
      and conname = 'session_roster_drafts_published_link_check'
  ) then
    alter table public.session_roster_drafts
      drop constraint session_roster_drafts_published_link_check;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.session_roster_drafts'::regclass
      and conname = 'session_roster_drafts_published_link_check'
  ) then
    alter table public.session_roster_drafts
      add constraint session_roster_drafts_published_link_check
      check (
        (status = 'draft' and published_version_id is null)
        or (status = 'published' and published_version_id is not null)
        or (status = 'superseded' and published_version_id is null)
      );
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.session_roster_audit_events'::regclass
      and conname = 'session_roster_audit_events_action_check'
  ) then
    alter table public.session_roster_audit_events
      drop constraint session_roster_audit_events_action_check;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.session_roster_audit_events'::regclass
      and conname = 'session_roster_audit_events_action_check'
  ) then
    alter table public.session_roster_audit_events
      add constraint session_roster_audit_events_action_check
      check (action in (
        'draft_created',
        'student_moved',
        'primary_teacher_assigned',
        'draft_reviewed',
        'version_published',
        'revision_created',
        'draft_refreshed'
      ));
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'private.session_roster_mutation_requests'::regclass
      and conname = 'session_roster_mutation_requests_operation_check'
  ) then
    alter table private.session_roster_mutation_requests
      drop constraint session_roster_mutation_requests_operation_check;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'private.session_roster_mutation_requests'::regclass
      and conname = 'session_roster_mutation_requests_operation_check'
  ) then
    alter table private.session_roster_mutation_requests
      add constraint session_roster_mutation_requests_operation_check
      check (operation in (
        'load_or_create_draft',
        'move_student',
        'assign_primary_teacher',
        'review_draft',
        'publish_draft',
        'create_revision',
        'refresh_draft'
      ));
  end if;
end;
$$;

create or replace function private.session_roster_teacher_is_eligible(
  input_teacher_id uuid,
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
    from public.cohorts
    join public.masajid
      on masajid.id = cohorts.masjid_id
    join public.profiles
      on profiles.id = input_teacher_id
    join public.masjid_staff_memberships as staff
      on staff.profile_id = profiles.id
      and staff.masjid_id = cohorts.masjid_id
    join public.teacher_rotation_availability as availability
      on availability.teacher_id = profiles.id
      and availability.masjid_id = cohorts.masjid_id
      and availability.cohort_id = input_cohort_id
      and availability.week_start = input_week_start
      and availability.available = true
    where cohorts.id = input_cohort_id
      and cohorts.active = true
      and masajid.active = true
      and profiles.role in ('teacher', 'admin')
      and profiles.active = true
      and staff.staff_role = 'teacher'
      and staff.active = true
      and staff.starts_on <= public.halaqa_saturday_for_week(input_week_start)
      and (staff.ends_on is null or staff.ends_on >= public.halaqa_saturday_for_week(input_week_start))
  );
$$;

-- Refresh is deliberately service-only.  The actor is still revalidated as an
-- active normal admin for the exact cohort; a service key is not a substitute
-- for the normal-admin scope check.
create or replace function public.refresh_session_roster_draft(
  input_request_id uuid,
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date,
  input_draft_id uuid,
  input_expected_state_version bigint,
  input_expected_source_state_digest text,
  input_expected_published_version_id uuid,
  input_confirm_discard_changes boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_masjid_id uuid;
  draft public.session_roster_drafts%rowtype;
  current_version public.session_roster_versions%rowtype;
  source_state jsonb;
  source_digest text;
  request_payload jsonb;
  replay_result jsonb;
  next_revision bigint;
  refreshed_draft_id uuid;
  result_payload jsonb;
  cleared_teacher_count integer := 0;
begin
  perform private.session_roster_assert_week(input_week_start);

  if input_confirm_discard_changes is distinct from true then
    raise exception using
      errcode = '22023',
      message = 'session_roster_refresh_confirmation_required';
  end if;

  target_masjid_id := private.session_roster_admin_masjid(input_actor_id, input_cohort_id);

  -- The cohort row and the shared advisory lock are acquired in the same
  -- order as every other session-roster mutation.  This makes refresh versus
  -- refresh/edit/publish/source-write races serialize on one boundary.
  perform cohorts.id
  from public.cohorts as cohorts
  where cohorts.id = input_cohort_id
    and cohorts.masjid_id = target_masjid_id
  for update;
  perform private.session_roster_lock(input_cohort_id, input_week_start);

  request_payload := jsonb_build_object(
    'request_id', input_request_id,
    'actor_id', input_actor_id,
    'cohort_id', input_cohort_id,
    'week_start', input_week_start,
    'draft_id', input_draft_id,
    'expected_state_version', input_expected_state_version,
    'expected_source_state_digest', input_expected_source_state_digest,
    'expected_published_version_id', input_expected_published_version_id,
    'confirm_discard_changes', input_confirm_discard_changes
  );

  replay_result := private.session_roster_replay_result(
    input_request_id,
    'refresh_draft',
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

  if not found then
    raise exception using errcode = 'P0002', message = 'session_roster_draft_not_found';
  end if;

  if draft.cohort_id is distinct from input_cohort_id
    or draft.masjid_id is distinct from target_masjid_id
    or draft.week_start is distinct from input_week_start then
    raise exception using errcode = '42501', message = 'session_roster_draft_scope_mismatch';
  end if;

  if draft.status <> 'draft' then
    raise exception using errcode = 'PT412', message = 'session_roster_draft_not_editable';
  end if;

  if draft.state_version is distinct from input_expected_state_version then
    raise exception using errcode = 'PT412', message = 'session_roster_stale_draft';
  end if;

  if draft.source_state_digest is distinct from input_expected_source_state_digest then
    raise exception using errcode = 'PT412', message = 'session_roster_refresh_stale_draft';
  end if;

  select versions.*
  into current_version
  from public.session_roster_versions as versions
  where versions.cohort_id = input_cohort_id
    and versions.week_start = input_week_start
  order by versions.version_number desc
  limit 1;

  if current_version.id is distinct from input_expected_published_version_id then
    raise exception using errcode = 'PT412', message = 'session_roster_published_version_stale';
  end if;

  source_state := private.session_roster_source_snapshot(input_cohort_id, input_week_start);
  source_digest := private.session_roster_source_digest(input_cohort_id, input_week_start);

  if source_state is null or source_digest is null then
    raise exception using errcode = '22023', message = 'session_roster_source_unavailable';
  end if;

  if draft.source_state_digest is not distinct from source_digest then
    raise exception using errcode = 'PT412', message = 'session_roster_refresh_not_stale';
  end if;

  select coalesce(max(drafts.revision_number), 0) + 1
  into next_revision
  from public.session_roster_drafts as drafts
  where drafts.cohort_id = input_cohort_id
    and drafts.week_start = input_week_start;

  -- Keep the old manual draft and its rows for history, but invalidate its
  -- mutation token by moving it out of the editable state.  No source
  -- membership or teacher-assignment row is touched.
  update public.session_roster_drafts
  set status = 'superseded',
      updated_by = input_actor_id,
      updated_at = statement_timestamp()
  where id = input_draft_id;

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
    input_actor_id,
    input_actor_id
  )
  returning id into refreshed_draft_id;

  -- Seed attendance/usual placement from the current authoritative source.
  -- When a published version exists, its historical placement and teacher
  -- responsibility are only a starting point; the source snapshot decides
  -- whether a student still exists/attends and active groups decide scope.
  perform private.session_roster_materialize_draft(
    refreshed_draft_id,
    source_state,
    current_version.id
  );

  -- A published responsibility is historical input, not a guarantee that the
  -- teacher remains eligible for this Saturday.  Clear any copied teacher
  -- that no longer has active staff coverage plus exact positive availability;
  -- the resulting readiness response exposes the responsibility blocker.
  update public.session_roster_draft_groups as groups
  set primary_teacher_id = null,
      primary_teacher_name = null,
      updated_at = statement_timestamp()
  where groups.draft_id = refreshed_draft_id
    and groups.primary_teacher_id is not null
    and not private.session_roster_teacher_is_eligible(
      groups.primary_teacher_id,
      input_cohort_id,
      input_week_start
    );
  get diagnostics cleared_teacher_count = row_count;

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
    'draft_refreshed',
    target_masjid_id,
    input_cohort_id,
    input_week_start,
    public.halaqa_saturday_for_week(input_week_start),
    refreshed_draft_id,
    current_version.id,
    input_request_id,
    jsonb_build_object(
      'draft_id', input_draft_id,
      'state_version', draft.state_version,
      'source_state_digest', draft.source_state_digest,
      'published_version_id', input_expected_published_version_id
    ),
    jsonb_build_object(
      'draft_id', refreshed_draft_id,
      'state_version', 0,
      'revision_number', next_revision,
      'source_state_digest', source_digest,
      'base_published_version_id', current_version.id,
      'requires_review', true
    ),
    jsonb_build_object(
      'discarded_manual_edits', true,
      'discarded_manual_edit_kinds', jsonb_build_array('student_placement', 'primary_teacher_responsibility'),
      'superseded_draft_id', input_draft_id,
      'superseded_state_version', draft.state_version,
      'refreshed_draft_id', refreshed_draft_id,
      'refreshed_state_version', 0,
      'old_published_version_id', input_expected_published_version_id,
      'published_version_unchanged', true,
      'cleared_ineligible_primary_teacher_count', cleared_teacher_count,
      'source_state_digest', source_digest
    )
  );

  result_payload := private.session_roster_draft_payload(refreshed_draft_id)
    || jsonb_build_object(
      'refresh', jsonb_build_object(
        'superseded_draft_id', input_draft_id,
        'superseded_state_version', draft.state_version,
        'refreshed_draft_id', refreshed_draft_id,
        'refreshed_state_version', 0,
        'discarded_manual_edits', true,
        'discarded_manual_edit_kinds', jsonb_build_array('student_placement', 'primary_teacher_responsibility'),
        'requires_review', true,
        'published_version_unchanged', true,
        'published_version_id', current_version.id,
        'source_state_digest', source_digest
      )
    );

  perform private.session_roster_write_request(
    input_request_id,
    'refresh_draft',
    input_actor_id,
    input_draft_id,
    request_payload,
    result_payload
  );

  return result_payload;
end;
$$;

comment on function public.refresh_session_roster_draft(uuid, uuid, uuid, date, uuid, bigint, text, uuid, boolean)
  is 'Service-only normal-admin stale-draft recovery. Creates a reviewed-required replacement and supersedes the old draft without changing source memberships, assignments, or published history.';

-- Explicitly preserve the private-schema boundary and the service-only public
-- mutation surface.
revoke all on function private.session_roster_teacher_is_eligible(uuid, uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.refresh_session_roster_draft(uuid, uuid, uuid, date, uuid, bigint, text, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.refresh_session_roster_draft(uuid, uuid, uuid, date, uuid, bigint, text, uuid, boolean)
  to service_role;

-- Keep the explicit SECURITY DEFINER inventory current.  This is a function
-- replacement only; the underlying tables and existing entries are retained.
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
    'public.refresh_session_roster_draft(uuid,uuid,uuid,date,uuid,bigint,text,uuid,boolean)',
    'public.review_session_roster_draft(uuid,uuid,uuid,bigint)',
    'public.rotation_publication_state_version_bump()',
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
    'private.recompute_profile_access(uuid,date)',
    'private.session_roster_source_lock()'
  ]::text[]) as listed(signature);
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
