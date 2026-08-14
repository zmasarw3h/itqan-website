-- Additive backend contracts for the approved student-experience handoff.
--
-- Checklist writes and accountability attestations stay authenticated and
-- request-scoped. Both contracts lock the complete conflict set before they
-- mutate any row so retries and concurrent requests observe one authoritative
-- result.

create or replace function public.recalculate_student_checkin_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_total integer;
  expected_earned integer;
  locked_checkin_id uuid;
begin
  if not exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'student'
      and profiles.active = true
  ) then
    return new;
  end if;

  -- Direct signed-client item updates remain safe as well as the RPC path:
  -- every recalculation serializes on the same parent check-in row before it
  -- reads the complete item set.
  select checkins.id
  into locked_checkin_id
  from public.checkins
  where checkins.id = new.checkin_id
    and checkins.student_id = (select auth.uid())
  for update;

  if locked_checkin_id is null then
    return new;
  end if;

  select coalesce(sum(definitions.weight), 0)
    into expected_total
  from private.checkin_task_definition(new.date) as definitions;

  select coalesce(sum(case when items.completed then items.weight else 0 end), 0)
    into expected_earned
  from public.checkin_items as items
  where items.checkin_id = locked_checkin_id;

  update public.checkins
  set earned_weight = expected_earned,
      total_weight = expected_total,
      daily_score = case
        when expected_total = 0 then 0
        else round((expected_earned::numeric / expected_total::numeric) * 100, 2)
      end,
      updated_at = now()
  where checkins.id = locked_checkin_id
    and checkins.student_id = (select auth.uid());

  return new;
end;
$$;

-- One authenticated item autosave transaction. The parent lock is acquired
-- before the item mutation; the existing item trigger remains the canonical
-- owner/date/task-label/weight validator, and the existing scope contract
-- prevents stale or out-of-scope parent rows from being used.
create or replace function public.save_student_checklist_item(
  input_task_key text,
  input_completed boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  effective_date date := public.current_effective_date();
  current_checkin public.checkins%rowtype;
  current_item public.checkin_items%rowtype;
  completed_task_keys jsonb;
begin
  if actor_id is null or not public.is_active_student() then
    raise exception using errcode = '42501', message = 'An active student session is required.';
  end if;

  if input_task_key is null or input_task_key = '' or input_completed is null then
    raise exception using errcode = '22023', message = 'A checklist task and completion state are required.';
  end if;

  -- The single student/date constraint remains the source of truth for the
  -- parent. Locking it first makes different-item toggles wait for the prior
  -- item update and score recalculation to commit.
  select checkins.*
  into current_checkin
  from public.checkins
  where checkins.student_id = actor_id
    and checkins.date = effective_date
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Today''s checklist is unavailable.';
  end if;

  if not public.student_scope_snapshot_matches(
    current_checkin.student_id,
    public.week_start_for_date(current_checkin.date),
    current_checkin.masjid_id,
    current_checkin.cohort_id,
    current_checkin.halaqa_group_id
  ) then
    raise exception using errcode = '42501', message = 'Today''s checklist is outside the active student scope.';
  end if;

  -- This row lookup intentionally does not accept a student or date supplied
  -- by the caller. The item integrity trigger below validates the canonical
  -- effective-date task definition, versioned label, and weight during the
  -- update itself.
  select items.*
  into current_item
  from public.checkin_items as items
  where items.checkin_id = current_checkin.id
    and items.task_key = input_task_key
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'The checklist task is not valid for today.';
  end if;

  update public.checkin_items
  set completed = input_completed
  where checkin_items.id = current_item.id
  returning checkin_items.* into current_item;

  if not found then
    raise exception using errcode = '40001', message = 'The checklist update could not be committed.';
  end if;

  -- The after-item trigger has already recalculated the locked parent. Read
  -- that row and the final item set from the same transaction for the
  -- authoritative response returned to the server action.
  select checkins.*
  into current_checkin
  from public.checkins
  where checkins.id = current_checkin.id
  for update;

  select coalesce(
    jsonb_agg(items.task_key order by items.task_key) filter (where items.completed),
    '[]'::jsonb
  )
  into completed_task_keys
  from public.checkin_items as items
  where items.checkin_id = current_checkin.id;

  return jsonb_build_object(
    'completed_task_keys', completed_task_keys,
    'earned_weight', current_checkin.earned_weight,
    'total_weight', current_checkin.total_weight,
    'daily_score', current_checkin.daily_score,
    'saved_at', current_checkin.updated_at
  );
end;
$$;

-- Only the authenticated student RPC surface is callable by the browser.
revoke all on function public.save_student_checklist_item(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.save_student_checklist_item(text, boolean)
  to authenticated;

-- Students may attest only the oldest pending historical obligation that can
-- block the current operational week. The complete pending set is locked in
-- week/id order before the requested row is re-read, avoiding deadlocks and
-- making concurrent/replayed attestations deterministic.
create or replace function public.attest_oldest_accountability_obligation(
  input_obligation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_week_start date := public.week_start_for_date(public.current_effective_date());
  requested public.accountability_obligations%rowtype;
  candidate public.accountability_obligations%rowtype;
  oldest_pending_id uuid;
begin
  if actor_id is null or not public.is_active_student() then
    raise exception using errcode = '42501', message = 'An active student session is required.';
  end if;

  if input_obligation_id is null then
    raise exception using errcode = '42501', message = 'The accountability obligation is not available.';
  end if;

  -- This first read is deliberately unlocked: it only establishes that the
  -- requested id belongs to the caller. The ordered lock below is the first
  -- lock acquired by every attestation transaction, so two different ids
  -- cannot deadlock while converging on the same oldest obligation.
  select obligations.*
  into requested
  from public.accountability_obligations as obligations
  where obligations.id = input_obligation_id
    and obligations.student_id = actor_id;

  if not found then
    raise exception using errcode = '42501', message = 'The accountability obligation is not available.';
  end if;

  for candidate in
    select obligations.*
    from public.accountability_obligations as obligations
    where obligations.student_id = actor_id
      and obligations.status = 'pending'
      and obligations.week_start >= date '2026-05-31'
      and obligations.week_start < current_week_start
    order by obligations.week_start asc, obligations.id asc
    for update
  loop
    if oldest_pending_id is null then
      oldest_pending_id := candidate.id;
    end if;
  end loop;

  -- Re-read the requested row after the complete lock set is held. A paid
  -- replay is idempotent; a waived/non-pending row, current-week row, future
  -- row, or younger pending row is rejected without mutation.
  select obligations.*
  into requested
  from public.accountability_obligations as obligations
  where obligations.id = input_obligation_id
    and obligations.student_id = actor_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'The accountability obligation is not available.';
  end if;

  if requested.week_start < date '2026-05-31'
    or requested.week_start >= current_week_start then
    raise exception using errcode = '42501', message = 'Only a currently blocking historical obligation may be attested.';
  end if;

  if requested.status = 'attested_paid' then
    return jsonb_build_object(
      'id', requested.id,
      'week_start', requested.week_start,
      'status', requested.status,
      'attested_paid_at', requested.attested_paid_at,
      'updated_at', requested.updated_at
    );
  end if;

  if requested.status <> 'pending' then
    raise exception using errcode = '42501', message = 'Only a currently blocking historical obligation may be attested.';
  end if;

  if oldest_pending_id is distinct from requested.id then
    raise exception using errcode = '42501', message = 'The oldest pending accountability obligation must be attested first.';
  end if;

  update public.accountability_obligations
  set status = 'attested_paid',
      attested_paid_at = now(),
      updated_at = now()
  where accountability_obligations.id = requested.id
    and accountability_obligations.student_id = actor_id
    and accountability_obligations.status = 'pending'
  returning accountability_obligations.* into requested;

  if not found then
    -- A guarded zero-row result is safe for the action to treat as a failed
    -- attempt; no partial update is possible in this transaction.
    return null;
  end if;

  return jsonb_build_object(
    'id', requested.id,
    'week_start', requested.week_start,
    'status', requested.status,
    'attested_paid_at', requested.attested_paid_at,
    'updated_at', requested.updated_at
  );
end;
$$;

revoke all on function public.attest_oldest_accountability_obligation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.attest_oldest_accountability_obligation(uuid)
  to authenticated;

-- Force student attestations through the ordered RPC. The function repeats
-- the actor/ownership checks under its definer privileges, while admins keep
-- their existing scoped correction policy.
alter policy "Students can attest own pending accountability obligations"
  on public.accountability_obligations
  to authenticated
  using (false)
  with check (false);

-- Extend the reviewed SECURITY DEFINER inventory without replacing the
-- complete allowlist established by the prior migrations.
alter function private.application_security_definer_oids()
  rename to application_security_definer_oids_before_student_backend;

create or replace function private.application_security_definer_oids()
returns table (function_oid oid)
language sql
stable
set search_path = ''
as $$
  select function_oid
  from private.application_security_definer_oids_before_student_backend()
  union
  select 'public.attest_oldest_accountability_obligation(uuid)'::regprocedure::oid;
$$;

revoke all on function private.application_security_definer_oids()
  from public, anon, authenticated, service_role;
