-- Provide one guarded, idempotent workflow for changing the student-wide
-- official scoring boundary. Scoped admins may activate or move it forward
-- only inside their current masjid authority. Super admins may also backdate.

create table private.official_scoring_start_requests (
  request_id uuid primary key,
  actor_id uuid not null,
  student_id uuid not null,
  input_payload jsonb not null,
  result jsonb not null,
  completed_at timestamptz not null default now()
);

alter table private.official_scoring_start_requests enable row level security;
revoke all on table private.official_scoring_start_requests
  from public, anon, authenticated, service_role;

create index official_scoring_start_requests_actor_completed_idx
  on private.official_scoring_start_requests(actor_id, completed_at desc);

create or replace function private.official_scoring_start_change_preview(
  input_actor_id uuid,
  input_student_id uuid,
  input_score_starts_on date
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  actor_role text;
  student_name text;
  current_score_starts_on date;
  earliest_access_starts_on date;
  earliest_valid_score_start date;
  affected_from date;
  affected_to date;
  change_direction text;
  affected_week_starts jsonb;
  pending_obligations jsonb;
  pending_count integer;
  pending_amount_cents integer;
  current_effective_date date := public.current_effective_date();
begin
  select profiles.role
  into actor_role
  from public.profiles
  where profiles.id = input_actor_id
    and profiles.active = true
    and profiles.role in ('admin', 'super_admin');

  if actor_role is null then
    raise exception using errcode = '42501', message = 'Active admin access is required.';
  end if;

  if input_score_starts_on is null
    or input_score_starts_on <> public.week_start_for_date(input_score_starts_on) then
    raise exception using errcode = '22023', message = 'Official scoring must start on a Sunday.';
  end if;

  select profiles.name, profiles.score_starts_on
  into student_name, current_score_starts_on
  from public.profiles
  where profiles.id = input_student_id
    and profiles.role = 'student'
    and profiles.active = true;

  if student_name is null then
    raise exception using errcode = '22023', message = 'Target profile must be an active student.';
  end if;

  select min(memberships.starts_on)
  into earliest_access_starts_on
  from public.student_group_memberships as memberships
  where memberships.student_id = input_student_id;

  if earliest_access_starts_on is null then
    raise exception using errcode = '22023', message = 'Student has no legitimate access membership.';
  end if;

  earliest_valid_score_start :=
    earliest_access_starts_on
    + ((7 - extract(dow from earliest_access_starts_on)::integer) % 7);

  if input_score_starts_on < earliest_valid_score_start then
    raise exception using
      errcode = '22023',
      message = 'Official scoring cannot begin before access eligibility.';
  end if;

  change_direction := case
    when current_score_starts_on is null then 'activate'
    when input_score_starts_on > current_score_starts_on then 'forward'
    when input_score_starts_on < current_score_starts_on then 'backward'
    else 'unchanged'
  end;

  if actor_role = 'admin' then
    if change_direction = 'backward' then
      raise exception using
        errcode = '42501',
        message = 'Scoped admins cannot move official scoring backward.';
    end if;

    if not exists (
      select 1
      from public.student_group_memberships as memberships
      where memberships.student_id = input_student_id
        and memberships.starts_on <= current_effective_date
        and (memberships.ends_on is null or memberships.ends_on >= current_effective_date)
        and private.raw_is_admin_for_masjid(
          input_actor_id,
          private.raw_group_masjid_id(memberships.group_id),
          current_effective_date
        )
    ) then
      raise exception using
        errcode = '42501',
        message = 'Student is outside the admin current masjid scope.';
    end if;

    if change_direction in ('activate', 'forward') and exists (
      select 1
      from public.student_group_memberships as memberships
      where memberships.student_id = input_student_id
        and memberships.starts_on < input_score_starts_on
        and (
          memberships.ends_on is null
          or memberships.ends_on >= coalesce(current_score_starts_on, earliest_valid_score_start)
        )
        and not private.raw_is_admin_for_masjid(
          input_actor_id,
          private.raw_group_masjid_id(memberships.group_id),
          current_effective_date
        )
    ) then
      raise exception using
        errcode = '42501',
        message = 'Affected scoring history crosses outside the admin masjid scope.';
    end if;

    if change_direction in ('activate', 'forward') and exists (
      select 1
      from public.accountability_obligations as obligations
      where obligations.student_id = input_student_id
        and obligations.status = 'pending'
        and obligations.week_start < input_score_starts_on
        and not private.raw_is_admin_for_masjid(
          input_actor_id,
          obligations.masjid_id,
          current_effective_date
        )
    ) then
      raise exception using
        errcode = '42501',
        message = 'Affected obligations cross outside the admin masjid scope.';
    end if;
  end if;

  affected_from := case
    when change_direction = 'activate' then earliest_valid_score_start
    when change_direction = 'forward' then current_score_starts_on
    when change_direction = 'backward' then input_score_starts_on
    else input_score_starts_on
  end;
  affected_to := case
    when change_direction in ('activate', 'forward') then input_score_starts_on
    when change_direction = 'backward' then current_score_starts_on
    else input_score_starts_on
  end;

  with activity_weeks as (
    select public.week_start_for_date(checkins.date) as week_start
    from public.checkins
    where checkins.student_id = input_student_id
    union
    select recitations.week_start
    from public.partner_recitations as recitations
    where recitations.student_id = input_student_id
    union
    select grades.week_start
    from public.halaqa_grades as grades
    where grades.student_id = input_student_id
    union
    select awards.week_start
    from public.badge_awards as awards
    where awards.student_id = input_student_id
  )
  select coalesce(jsonb_agg(weeks.week_start order by weeks.week_start), '[]'::jsonb)
  into affected_week_starts
  from (
    select distinct activity_weeks.week_start
    from activity_weeks
    where change_direction <> 'unchanged'
      and activity_weeks.week_start >= affected_from
      and activity_weeks.week_start < affected_to
  ) as weeks;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', obligations.id,
          'week_start', obligations.week_start,
          'amount_cents', obligations.amount_cents
        )
        order by obligations.week_start, obligations.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer,
    coalesce(sum(obligations.amount_cents), 0)::integer
  into pending_obligations, pending_count, pending_amount_cents
  from public.accountability_obligations as obligations
  where obligations.student_id = input_student_id
    and obligations.status = 'pending'
    and obligations.week_start < input_score_starts_on
    and change_direction in ('activate', 'forward');

  return jsonb_build_object(
    'student_id', input_student_id,
    'student_name', student_name,
    'actor_role', actor_role,
    'old_score_starts_on', current_score_starts_on,
    'new_score_starts_on', input_score_starts_on,
    'earliest_access_starts_on', earliest_access_starts_on,
    'earliest_valid_score_start', earliest_valid_score_start,
    'direction', change_direction,
    'affected_week_starts', affected_week_starts,
    'pending_obligations', pending_obligations,
    'pending_obligation_count', pending_count,
    'pending_amount_cents', pending_amount_cents
  );
end;
$$;

revoke all on function private.official_scoring_start_change_preview(uuid, uuid, date)
  from public, anon, authenticated, service_role;

create or replace function public.preview_official_scoring_start_change(
  input_actor_id uuid,
  input_student_id uuid,
  input_score_starts_on date
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.official_scoring_start_change_preview(
    input_actor_id,
    input_student_id,
    input_score_starts_on
  );
$$;

create or replace function public.apply_official_scoring_start_change(
  input_request_id uuid,
  input_actor_id uuid,
  input_student_id uuid,
  input_score_starts_on date,
  input_expected_score_starts_on date,
  input_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_reason text := trim(coalesce(input_reason, ''));
  normalized_input jsonb;
  prior_request private.official_scoring_start_requests%rowtype;
  current_score_starts_on date;
  preview jsonb;
  direction text;
  obligation record;
  obligation_count integer := 0;
  waived_amount_cents integer := 0;
  result_payload jsonb;
begin
  if input_request_id is null then
    raise exception using errcode = '22023', message = 'request_id is required.';
  end if;

  if length(normalized_reason) < 5 or length(normalized_reason) > 500 then
    raise exception using errcode = '22023', message = 'A reason between 5 and 500 characters is required.';
  end if;

  normalized_input := jsonb_build_object(
    'actor_id', input_actor_id,
    'student_id', input_student_id,
    'score_starts_on', input_score_starts_on,
    'expected_score_starts_on', input_expected_score_starts_on,
    'reason', normalized_reason
  );

  perform pg_advisory_xact_lock(hashtextextended(input_request_id::text, 0));

  select requests.*
  into prior_request
  from private.official_scoring_start_requests as requests
  where requests.request_id = input_request_id;

  if found then
    if prior_request.actor_id is distinct from input_actor_id
      or prior_request.student_id is distinct from input_student_id
      or prior_request.input_payload is distinct from normalized_input then
      raise exception using
        errcode = '22023',
        message = 'request_id was already used with different official scoring inputs.';
    end if;

    return prior_request.result;
  end if;

  select profiles.score_starts_on
  into current_score_starts_on
  from public.profiles
  where profiles.id = input_student_id
    and profiles.role = 'student'
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'Target profile must be a student.';
  end if;

  if current_score_starts_on is distinct from input_expected_score_starts_on then
    raise exception using errcode = 'P0001', message = 'official scoring start changed; reload before saving.';
  end if;

  preview := private.official_scoring_start_change_preview(
    input_actor_id,
    input_student_id,
    input_score_starts_on
  );
  direction := preview ->> 'direction';

  if direction = 'unchanged' then
    raise exception using errcode = '22023', message = 'Choose a different official scoring start.';
  end if;

  update public.profiles
  set score_starts_on = input_score_starts_on
  where profiles.id = input_student_id;

  if direction in ('activate', 'forward') then
    perform set_config('app.official_scoring_request_id', input_request_id::text, true);

    for obligation in
      select obligations.*
      from public.accountability_obligations as obligations
      where obligations.student_id = input_student_id
        and obligations.status = 'pending'
        and obligations.week_start < input_score_starts_on
      order by obligations.week_start, obligations.id
      for update
    loop
      update public.accountability_obligations
      set status = 'waived',
          waived_at = now(),
          waived_by = input_actor_id,
          admin_note = concat_ws(
            E'\n',
            nullif(obligation.admin_note, ''),
            'Official scoring start changed: pending pre-boundary obligation waived; not paid. Reason: '
              || normalized_reason
          ),
          updated_at = now()
      where accountability_obligations.id = obligation.id;

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
        input_actor_id,
        'pre_score_start_obligation_waived',
        'accountability_obligations',
        obligation.id,
        obligation.masjid_id,
        jsonb_build_object(
          'status', obligation.status,
          'waived_at', obligation.waived_at,
          'waived_by', obligation.waived_by,
          'admin_note', obligation.admin_note
        ),
        jsonb_build_object(
          'status', 'waived',
          'waived_by', input_actor_id
        ),
        jsonb_build_object(
          'request_id', input_request_id,
          'student_id', input_student_id,
          'week_start', obligation.week_start,
          'new_score_starts_on', input_score_starts_on,
          'reason', normalized_reason,
          'payment_status_asserted', false
        )
      );

      obligation_count := obligation_count + 1;
      waived_amount_cents := waived_amount_cents + obligation.amount_cents;
    end loop;
  end if;

  insert into public.super_admin_audit_events (
    actor_id,
    action,
    target_table,
    target_id,
    before_data,
    after_data,
    metadata
  )
  values (
    input_actor_id,
    'official_scoring_start_changed',
    'profiles',
    input_student_id,
    jsonb_build_object('score_starts_on', current_score_starts_on),
    jsonb_build_object('score_starts_on', input_score_starts_on),
    jsonb_build_object(
      'request_id', input_request_id,
      'direction', direction,
      'reason', normalized_reason,
      'affected_week_starts', preview -> 'affected_week_starts',
      'waived_obligation_count', obligation_count,
      'waived_amount_cents', waived_amount_cents
    )
  );

  result_payload := preview || jsonb_build_object(
    'request_id', input_request_id,
    'waived_obligation_count', obligation_count,
    'waived_amount_cents', waived_amount_cents
  );

  insert into private.official_scoring_start_requests (
    request_id,
    actor_id,
    student_id,
    input_payload,
    result
  )
  values (
    input_request_id,
    input_actor_id,
    input_student_id,
    normalized_input,
    result_payload
  );

  return result_payload;
end;
$$;

create or replace function public.enforce_student_accountability_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
    and nullif(current_setting('app.official_scoring_request_id', true), '') is not null then
    if old.status = 'pending'
      and new.id is not distinct from old.id
      and new.student_id is not distinct from old.student_id
      and new.week_start is not distinct from old.week_start
      and new.weekly_percentage is not distinct from old.weekly_percentage
      and new.amount_cents is not distinct from old.amount_cents
      and new.status = 'waived'
      and new.attested_paid_at is not distinct from old.attested_paid_at
      and new.waived_at is not null
      and new.waived_by is not null
      and exists (
        select 1
        from public.profiles
        where profiles.id = new.waived_by
          and profiles.role in ('admin', 'super_admin')
          and profiles.active = true
      )
      and new.admin_note like '%pending pre-boundary obligation waived; not paid%'
      and new.created_at is not distinct from old.created_at
    then
      return new;
    end if;

    raise exception 'Official scoring workflow may only waive an unchanged pending obligation.';
  end if;

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

revoke all on function public.preview_official_scoring_start_change(uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.apply_official_scoring_start_change(uuid, uuid, uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.preview_official_scoring_start_change(uuid, uuid, date)
  to service_role;
grant execute on function public.apply_official_scoring_start_change(uuid, uuid, uuid, date, date, text)
  to service_role;

revoke execute on function public.apply_super_admin_score_start_correction(uuid, uuid, date, date)
  from service_role;

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
