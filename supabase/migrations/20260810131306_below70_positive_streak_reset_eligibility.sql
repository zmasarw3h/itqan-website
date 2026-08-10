-- Forward-fix the reset eligibility rule without editing the applied reset
-- migrations. Three consecutive below-70 weeks still trigger the intervention
-- and required test process; after a passed test, every positive active streak
-- is resettable. Zero and negative values remain invalid.

do $$
begin
  if exists (
    select 1
    from public.below70_streak_resets
    where previous_streak_length <= 0
  ) then
    raise exception using
      errcode = '23514',
      message = 'Cannot replace the below-70 reset constraint while invalid historical rows exist.';
  end if;
end;
$$;

alter table public.below70_streak_resets
  drop constraint below70_streak_resets_previous_streak_check;

alter table public.below70_streak_resets
  add constraint below70_streak_resets_previous_streak_check
  check (previous_streak_length > 0);

create or replace function public.reset_student_below70_streak(
  input_request_id uuid,
  input_student_id uuid,
  input_passed_test boolean,
  input_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_completed_week_start date;
  normalized_note text;
  target_role text;
  target_active boolean;
  scope_count integer;
  scope_masjid_id uuid;
  scope_cohort_id uuid;
  scope_group_id uuid;
  previous_streak_length integer;
  existing_reset public.below70_streak_resets%rowtype;
  inserted_reset public.below70_streak_resets%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if input_request_id is null or input_student_id is null then
    raise exception using errcode = '22023', message = 'Request id and student id are required.';
  end if;

  if input_passed_test is distinct from true then
    raise exception using errcode = '22023', message = 'Explicit passed-test confirmation is required.';
  end if;

  normalized_note := nullif(btrim(input_note), '');
  if normalized_note is not null
    and (
      char_length(normalized_note) > 280
      or normalized_note ~ '[[:cntrl:]]'
    ) then
    raise exception using errcode = '22023', message = 'Admin note must be at most 280 characters and contain no control characters.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('below70-streak-reset:' || input_student_id::text, 0)
  );

  current_completed_week_start := public.week_start_for_date(public.current_effective_date()) - 7;

  select profiles.role, profiles.active
  into target_role, target_active
  from public.profiles
  where profiles.id = input_student_id;

  if target_role is distinct from 'student' or not coalesce(target_active, false) then
    raise exception using errcode = '42501', message = 'An active student target is required.';
  end if;

  select count(*)
  into scope_count
  from public.student_group_memberships as memberships
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  where memberships.student_id = input_student_id
    and memberships.starts_on <= current_completed_week_start
    and (memberships.ends_on is null or memberships.ends_on >= current_completed_week_start);

  if scope_count <> 1 then
    raise exception using errcode = '42501', message = 'Exactly one historical student scope is required for the completed week.';
  end if;

  select groups.id, cohorts.id, cohorts.masjid_id
  into scope_group_id, scope_cohort_id, scope_masjid_id
  from public.student_group_memberships as memberships
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  where memberships.student_id = input_student_id
    and memberships.starts_on <= current_completed_week_start
    and (memberships.ends_on is null or memberships.ends_on >= current_completed_week_start)
  order by memberships.starts_on desc, memberships.id desc
  limit 1;

  if not private.raw_is_admin_for_masjid(
    actor_id,
    scope_masjid_id,
    public.current_toronto_civil_date()
  ) then
    raise exception using errcode = '42501', message = 'Active scoped administration is required for the student''s masjid.';
  end if;

  select resets.*
  into existing_reset
  from public.below70_streak_resets as resets
  where resets.request_id = input_request_id
  for update;

  if existing_reset.id is not null then
    if not private.raw_is_admin_for_masjid(
      actor_id,
      existing_reset.masjid_id,
      public.current_toronto_civil_date()
    ) then
      raise exception using errcode = '42501', message = 'Active administration for the original reset masjid is required.';
    end if;

    if existing_reset.student_id <> input_student_id
      or existing_reset.admin_note is distinct from normalized_note
      or existing_reset.passed_test_confirmation is distinct from input_passed_test then
      raise exception using errcode = '22023', message = 'Request id was already used for a different reset.';
    end if;

    return jsonb_build_object(
      'status', 'replayed',
      'reset_id', existing_reset.id,
      'student_id', existing_reset.student_id,
      'masjid_id', existing_reset.masjid_id,
      'cohort_id', existing_reset.cohort_id,
      'halaqa_group_id', existing_reset.halaqa_group_id,
      'effective_through_week_start', existing_reset.effective_through_week_start,
      'previous_streak_length', existing_reset.previous_streak_length,
      'passed_test_confirmation', existing_reset.passed_test_confirmation,
      'admin_note', existing_reset.admin_note,
      'actor_id', existing_reset.actor_id,
      'created_at', existing_reset.created_at,
      'active_streak_length', 0
    );
  end if;

  select resets.*
  into existing_reset
  from public.below70_streak_resets as resets
  where resets.student_id = input_student_id
    and resets.effective_through_week_start = current_completed_week_start
  for update;

  if existing_reset.id is not null then
    if not private.raw_is_admin_for_masjid(
      actor_id,
      existing_reset.masjid_id,
      public.current_toronto_civil_date()
    ) then
      raise exception using errcode = '42501', message = 'Active administration for the original reset masjid is required.';
    end if;

    return jsonb_build_object(
      'status', 'replayed',
      'reset_id', existing_reset.id,
      'student_id', existing_reset.student_id,
      'masjid_id', existing_reset.masjid_id,
      'cohort_id', existing_reset.cohort_id,
      'halaqa_group_id', existing_reset.halaqa_group_id,
      'effective_through_week_start', existing_reset.effective_through_week_start,
      'previous_streak_length', existing_reset.previous_streak_length,
      'passed_test_confirmation', existing_reset.passed_test_confirmation,
      'admin_note', existing_reset.admin_note,
      'actor_id', existing_reset.actor_id,
      'created_at', existing_reset.created_at,
      'active_streak_length', 0
    );
  end if;

  previous_streak_length := private.raw_below70_streak(
    input_student_id,
    current_completed_week_start
  );

  if previous_streak_length <= 0 then
    raise exception using
      errcode = '22023',
      message = 'The active below-70 streak must be greater than zero completed weeks.';
  end if;

  insert into public.below70_streak_resets (
    student_id,
    masjid_id,
    cohort_id,
    halaqa_group_id,
    effective_through_week_start,
    previous_streak_length,
    passed_test_confirmation,
    admin_note,
    request_id,
    actor_id
  )
  values (
    input_student_id,
    scope_masjid_id,
    scope_cohort_id,
    scope_group_id,
    current_completed_week_start,
    previous_streak_length,
    input_passed_test,
    normalized_note,
    input_request_id,
    actor_id
  )
  returning * into inserted_reset;

  insert into public.super_admin_audit_events (
    actor_id,
    action,
    target_table,
    target_id,
    target_masjid_id,
    before_data,
    after_data,
    metadata
  )
  values (
    actor_id,
    'below70_streak_reset',
    'below70_streak_resets',
    inserted_reset.id,
    inserted_reset.masjid_id,
    jsonb_build_object(
      'active_streak_length', previous_streak_length,
      'effective_through_week_start', current_completed_week_start
    ),
    jsonb_build_object(
      'active_streak_length', 0,
      'effective_through_week_start', current_completed_week_start
    ),
    jsonb_build_object(
      'student_id', inserted_reset.student_id,
      'masjid_id', inserted_reset.masjid_id,
      'cohort_id', inserted_reset.cohort_id,
      'halaqa_group_id', inserted_reset.halaqa_group_id,
      'effective_through_week_start', inserted_reset.effective_through_week_start,
      'previous_streak_length', inserted_reset.previous_streak_length,
      'passed_test_confirmation', inserted_reset.passed_test_confirmation
    )
  );

  return jsonb_build_object(
    'status', 'reset',
    'reset_id', inserted_reset.id,
    'student_id', inserted_reset.student_id,
    'masjid_id', inserted_reset.masjid_id,
    'cohort_id', inserted_reset.cohort_id,
    'halaqa_group_id', inserted_reset.halaqa_group_id,
    'effective_through_week_start', inserted_reset.effective_through_week_start,
    'previous_streak_length', inserted_reset.previous_streak_length,
    'passed_test_confirmation', inserted_reset.passed_test_confirmation,
    'admin_note', inserted_reset.admin_note,
    'actor_id', inserted_reset.actor_id,
    'created_at', inserted_reset.created_at,
    'active_streak_length', 0
  );
end;
$$;

-- CREATE OR REPLACE preserves the existing function OID and allowlist entry.
-- Keep the already-reviewed authenticated-only privilege posture explicit.
revoke all on function public.reset_student_below70_streak(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reset_student_below70_streak(uuid, uuid, boolean, text) to authenticated;
alter function public.reset_student_below70_streak(uuid, uuid, boolean, text) set search_path = '';
