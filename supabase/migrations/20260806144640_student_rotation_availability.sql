-- Session-only student availability for the weekly rotation workflow.
-- A missing row means the student is attending; only explicit absences persist.

create table public.student_rotation_availability (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  cohort_id uuid not null references public.cohorts(id) on delete restrict,
  week_start date not null,
  available boolean not null default false,
  reason text,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_rotation_availability_student_cohort_week_unique
    unique (student_id, cohort_id, week_start),
  constraint student_rotation_availability_week_start_check
    check (week_start = public.week_start_for_date(week_start)),
  constraint student_rotation_availability_absence_only_check
    check (available = false),
  constraint student_rotation_availability_reason_check
    check (
      reason is null
      or (char_length(btrim(reason)) between 1 and 240)
    )
);

create index student_rotation_availability_cohort_week_idx
  on public.student_rotation_availability (cohort_id, week_start);

create index student_rotation_availability_student_week_idx
  on public.student_rotation_availability (student_id, week_start);

create or replace function public.student_rotation_availability_scope_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.student_group_memberships as memberships
    join public.halaqa_groups as groups on groups.id = memberships.group_id
    join public.profiles as students on students.id = memberships.student_id
    where memberships.student_id = new.student_id
      and groups.cohort_id = new.cohort_id
      and groups.active = true
      and students.role = 'student'
      and students.active = true
      and memberships.starts_on <= new.week_start
      and (memberships.ends_on is null or memberships.ends_on >= new.week_start)
  ) then
    raise exception using
      errcode = '23514',
      message = 'student_id must have an effective active membership in cohort_id for week_start';
  end if;

  return new;
end;
$$;

create trigger student_rotation_availability_scope_trigger
  before insert or update of student_id, cohort_id, week_start
  on public.student_rotation_availability
  for each row
  execute function public.student_rotation_availability_scope_matches();

alter table public.student_rotation_availability enable row level security;

revoke all on table public.student_rotation_availability from public, anon, authenticated;
grant select on table public.student_rotation_availability to authenticated;
grant all on table public.student_rotation_availability to service_role;

create policy "Scoped admins can read student rotation availability"
  on public.student_rotation_availability
  for select
  to authenticated
  using (
    (select public.is_active_admin())
    and exists (
      select 1
      from public.cohorts
      where cohorts.id = student_rotation_availability.cohort_id
        and public.is_admin_for_masjid(cohorts.masjid_id)
    )
  );

-- The server calls this service-only function with the validated signed-in
-- admin as actor. SECURITY DEFINER is needed to keep the replacement atomic
-- while invoking the existing protected canonical-date helpers; the passed
-- actor is revalidated from authoritative membership state below.
-- It replaces the selected session's absence ledger atomically and never
-- changes student memberships, groups, or teacher assignments.
create or replace function public.apply_student_rotation_availability(
  input_actor_id uuid,
  input_cohort_id uuid,
  input_week_start date,
  input_absences jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cohort_masjid_id uuid;
  absence_count integer;
begin
  if input_week_start is null
    or input_week_start <> public.week_start_for_date(input_week_start) then
    raise exception using errcode = '22023', message = 'student_rotation_availability_invalid_week_start';
  end if;

  if input_absences is null or jsonb_typeof(input_absences) <> 'array' then
    raise exception using errcode = '22023', message = 'student_rotation_availability_invalid_absences';
  end if;

  select cohorts.masjid_id
  into cohort_masjid_id
  from public.cohorts
  join public.masajid on masajid.id = cohorts.masjid_id
  where cohorts.id = input_cohort_id
    and cohorts.active = true
    and masajid.active = true
  for update of cohorts;

  if cohort_masjid_id is null
    or not exists (
      select 1
      from public.profiles as actor
      join public.masjid_staff_memberships as memberships
        on memberships.profile_id = actor.id
      where actor.id = input_actor_id
        and actor.role = 'admin'
        and actor.active = true
        and memberships.masjid_id = cohort_masjid_id
        and memberships.staff_role = 'admin'
        and memberships.active = true
        and memberships.starts_on <= public.current_toronto_civil_date()
        and (memberships.ends_on is null or memberships.ends_on >= public.current_toronto_civil_date())
    ) then
    raise exception using errcode = '42501', message = 'student_rotation_availability_unauthorized_actor';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(input_absences) as submitted(student_id uuid, reason text)
    group by submitted.student_id
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'student_rotation_availability_duplicate_student';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(input_absences) as submitted(student_id uuid, reason text)
    left join public.student_group_memberships as memberships
      on memberships.student_id = submitted.student_id
      and memberships.starts_on <= input_week_start
      and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
    left join public.halaqa_groups as groups
      on groups.id = memberships.group_id
      and groups.cohort_id = input_cohort_id
      and groups.active = true
    left join public.profiles as students
      on students.id = submitted.student_id
      and students.role = 'student'
      and students.active = true
    where submitted.student_id is null
      or groups.id is null
      or students.id is null
      or (submitted.reason is not null and char_length(btrim(submitted.reason)) > 240)
  ) then
    raise exception using errcode = '22023', message = 'student_rotation_availability_invalid_student_or_reason';
  end if;

  delete from public.student_rotation_availability
  where cohort_id = input_cohort_id
    and week_start = input_week_start;

  insert into public.student_rotation_availability (
    student_id,
    cohort_id,
    week_start,
    available,
    reason,
    recorded_by,
    updated_at
  )
  select
    submitted.student_id,
    input_cohort_id,
    input_week_start,
    false,
    nullif(btrim(submitted.reason), ''),
    input_actor_id,
    now()
  from jsonb_to_recordset(input_absences) as submitted(student_id uuid, reason text);

  get diagnostics absence_count = row_count;

  return jsonb_build_object(
    'cohort_id', input_cohort_id,
    'week_start', input_week_start,
    'absence_count', absence_count
  );
end;
$$;

revoke execute on function public.apply_student_rotation_availability(uuid, uuid, date, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_student_rotation_availability(uuid, uuid, date, jsonb)
  to service_role;

revoke execute on function public.student_rotation_availability_scope_matches()
  from public, anon, authenticated, service_role;

-- Keep the security-definer trigger function in the project's reviewed
-- allowlist. The persistence RPC is service-only and revalidates its actor.
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
    'public.prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)',
    'public.prepare_teacher_rotation_publication(uuid,uuid,uuid,date)',
    'public.preview_official_scoring_start_change(uuid,uuid,date)',
    'public.protect_foundation_row_identity()',
    'public.refresh_current_profile_role()',
    'public.recalculate_student_checkin_score()',
    'public.reconcile_historical_accountability_obligation(uuid,date)',
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
    'private.recompute_profile_access(uuid,date)'
  ]::text[]) as listed(signature);
$$;
