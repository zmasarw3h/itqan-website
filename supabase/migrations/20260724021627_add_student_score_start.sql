-- Separate orientation access from the first week that contributes to scores,
-- streaks, incentives, and accountability. A null boundary means that the
-- profile is not scorable yet.

alter table public.profiles
  add column if not exists score_starts_on date;

alter table public.profiles
  add constraint profiles_score_starts_on_sunday
  check (
    score_starts_on is null
    or extract(dow from score_starts_on) = 0
  );

comment on column public.profiles.score_starts_on is
  'First canonical Sunday included in student scoring; null means not scorable yet.';

with earliest_membership as (
  select
    memberships.student_id,
    min(
      memberships.starts_on
      + ((7 - extract(dow from memberships.starts_on)::integer) % 7)
    ) as score_starts_on
  from public.student_group_memberships as memberships
  group by memberships.student_id
)
update public.profiles
set score_starts_on = earliest_membership.score_starts_on
from earliest_membership
where profiles.id = earliest_membership.student_id
  and profiles.score_starts_on is null;

-- Keep the existing setup implementation as the access/membership primitive.
-- This overload wraps it in the same transaction, validates the independent
-- scoring boundary, persists it, and extends the idempotent result/audit data.
create or replace function public.apply_scoped_user_setup(
  input_request_id uuid,
  input_actor_id uuid,
  input_profile_id uuid,
  input_name text,
  input_email text,
  input_phone text,
  input_role text,
  input_starts_on date,
  input_score_starts_on date,
  input_masjid_id uuid,
  input_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_payload jsonb;
  stored_score_starts_on date;
begin
  if input_role = 'student' then
    if input_score_starts_on is null
      or input_score_starts_on <> public.week_start_for_date(input_score_starts_on) then
      raise exception using
        errcode = '22023',
        message = 'score_starts_on must be a Sunday tracker week start for a student.';
    end if;

    if input_starts_on is null or input_score_starts_on < input_starts_on then
      raise exception using
        errcode = '22023',
        message = 'score_starts_on cannot be earlier than access eligibility.';
    end if;
  elsif input_score_starts_on is not null then
    raise exception using
      errcode = '22023',
      message = 'score_starts_on must be null for a teacher.';
  end if;

  result_payload := public.apply_scoped_user_setup(
    input_request_id,
    input_actor_id,
    input_profile_id,
    input_name,
    input_email,
    input_phone,
    input_role,
    input_starts_on,
    input_masjid_id,
    input_group_id
  );

  select profiles.score_starts_on
  into stored_score_starts_on
  from public.profiles
  where profiles.id = input_profile_id
  for update;

  if input_role = 'student' then
    if stored_score_starts_on is null then
      update public.profiles
      set score_starts_on = input_score_starts_on
      where profiles.id = input_profile_id;
    elsif stored_score_starts_on <> input_score_starts_on then
      raise exception using
        errcode = '22023',
        message = 'request_id was already used with a different score_starts_on.';
    end if;
  elsif stored_score_starts_on is not null then
    raise exception using
      errcode = '22023',
      message = 'teacher profile unexpectedly has a scoring boundary.';
  end if;

  result_payload := result_payload || jsonb_build_object(
    'score_starts_on',
    case when input_role = 'student' then input_score_starts_on else null end
  );

  update private.workflow_mutation_requests
  set result = result_payload
  where request_id = input_request_id
    and workflow = 'scoped_user_setup'
    and actor_id = input_actor_id
    and target_id = input_profile_id;

  update public.super_admin_audit_events
  set after_data = coalesce(after_data, '{}'::jsonb) || jsonb_build_object(
        'score_starts_on',
        case when input_role = 'student' then input_score_starts_on else null end
      ),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'score_starts_on',
        case when input_role = 'student' then input_score_starts_on else null end
      )
  where id = (
    select events.id
    from public.super_admin_audit_events as events
    where events.actor_id = input_actor_id
      and events.action = 'scoped_user_created'
      and events.target_table = 'profiles'
      and events.target_id = input_profile_id
    order by events.occurred_at desc, events.id desc
    limit 1
  );

  return result_payload;
end;
$$;

create or replace function public.get_scoped_user_setup_request_result(
  input_request_id uuid,
  input_actor_id uuid,
  input_name text,
  input_email text,
  input_phone text,
  input_role text,
  input_starts_on date,
  input_score_starts_on date,
  input_masjid_id uuid,
  input_group_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result_payload jsonb;
  stored_score_starts_on date;
begin
  if input_role = 'student' then
    if input_score_starts_on is null
      or input_score_starts_on <> public.week_start_for_date(input_score_starts_on)
      or input_starts_on is null
      or input_score_starts_on < input_starts_on then
      raise exception using errcode = '22023', message = 'invalid student score_starts_on.';
    end if;
  elsif input_score_starts_on is not null then
    raise exception using errcode = '22023', message = 'score_starts_on must be null for a teacher.';
  end if;

  result_payload := public.get_scoped_user_setup_request_result(
    input_request_id,
    input_actor_id,
    input_name,
    input_email,
    input_phone,
    input_role,
    input_starts_on,
    input_masjid_id,
    input_group_id
  );

  if result_payload is null then
    return null;
  end if;

  select profiles.score_starts_on
  into stored_score_starts_on
  from public.profiles
  where profiles.id = (result_payload ->> 'profile_id')::uuid;

  if input_role = 'student' and stored_score_starts_on is distinct from input_score_starts_on then
    raise exception using
      errcode = '22023',
      message = 'request_id was already used with a different score_starts_on.';
  end if;

  if input_role = 'teacher' and stored_score_starts_on is not null then
    raise exception using errcode = '22023', message = 'teacher profile unexpectedly has a scoring boundary.';
  end if;

  return result_payload || jsonb_build_object(
    'score_starts_on',
    case when input_role = 'student' then input_score_starts_on else null end
  );
end;
$$;

create or replace function public.get_scoped_user_setup_auth_recovery(
  input_request_id uuid,
  input_actor_id uuid,
  input_name text,
  input_email text,
  input_phone text,
  input_role text,
  input_starts_on date,
  input_score_starts_on date,
  input_masjid_id uuid,
  input_group_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if input_role = 'student' then
    if input_score_starts_on is null
      or input_score_starts_on <> public.week_start_for_date(input_score_starts_on)
      or input_starts_on is null
      or input_score_starts_on < input_starts_on then
      raise exception using errcode = '22023', message = 'invalid student score_starts_on.';
    end if;
  elsif input_score_starts_on is not null then
    raise exception using errcode = '22023', message = 'score_starts_on must be null for a teacher.';
  end if;

  return public.get_scoped_user_setup_auth_recovery(
    input_request_id,
    input_actor_id,
    input_name,
    input_email,
    input_phone,
    input_role,
    input_starts_on,
    input_masjid_id,
    input_group_id
  );
end;
$$;

revoke all on function public.apply_scoped_user_setup(
  uuid, uuid, uuid, text, text, text, text, date, date, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.get_scoped_user_setup_request_result(
  uuid, uuid, text, text, text, text, date, date, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.get_scoped_user_setup_auth_recovery(
  uuid, uuid, text, text, text, text, date, date, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.apply_scoped_user_setup(
  uuid, uuid, uuid, text, text, text, text, date, date, uuid, uuid
) to service_role;
grant execute on function public.get_scoped_user_setup_request_result(
  uuid, uuid, text, text, text, text, date, date, uuid, uuid
) to service_role;
grant execute on function public.get_scoped_user_setup_auth_recovery(
  uuid, uuid, text, text, text, text, date, date, uuid, uuid
) to service_role;

revoke execute on function public.apply_scoped_user_setup(
  uuid, uuid, uuid, text, text, text, text, date, uuid, uuid
) from service_role;
revoke execute on function public.get_scoped_user_setup_request_result(
  uuid, uuid, text, text, text, text, date, uuid, uuid
) from service_role;
revoke execute on function public.get_scoped_user_setup_auth_recovery(
  uuid, uuid, text, text, text, text, date, uuid, uuid
) from service_role;

create or replace function public.apply_super_admin_score_start_correction(
  input_actor_id uuid,
  input_student_id uuid,
  input_score_starts_on date,
  input_expected_score_starts_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_score_starts_on date;
  earliest_access_starts_on date;
  earliest_valid_score_start date;
  target_name text;
begin
  if not exists (
    select 1
    from public.profiles
    where profiles.id = input_actor_id
      and profiles.role = 'super_admin'
      and profiles.active = true
  ) then
    raise exception using errcode = '42501', message = 'Active super-admin access is required.';
  end if;

  if input_score_starts_on is null
    or input_score_starts_on <> public.week_start_for_date(input_score_starts_on) then
    raise exception using errcode = '22023', message = 'score_starts_on must be a Sunday tracker week start.';
  end if;

  select profiles.name, profiles.score_starts_on
  into target_name, current_score_starts_on
  from public.profiles
  where profiles.id = input_student_id
    and profiles.role = 'student'
  for update;

  if target_name is null then
    raise exception using errcode = '22023', message = 'Target profile must be a student.';
  end if;

  if current_score_starts_on is distinct from input_expected_score_starts_on then
    raise exception using errcode = 'P0001', message = 'score start changed; reload before saving.';
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
      message = 'score_starts_on cannot be earlier than access eligibility.';
  end if;

  update public.profiles
  set score_starts_on = input_score_starts_on
  where profiles.id = input_student_id;

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
    'student_score_start_corrected',
    'profiles',
    input_student_id,
    jsonb_build_object('score_starts_on', current_score_starts_on),
    jsonb_build_object('score_starts_on', input_score_starts_on),
    jsonb_build_object(
      'student_name', target_name,
      'earliest_access_starts_on', earliest_access_starts_on,
      'earliest_valid_score_start', earliest_valid_score_start
    )
  );

  return jsonb_build_object(
    'student_id', input_student_id,
    'score_starts_on', input_score_starts_on
  );
end;
$$;

revoke all on function public.apply_super_admin_score_start_correction(
  uuid, uuid, date, date
) from public, anon, authenticated;
grant execute on function public.apply_super_admin_score_start_correction(
  uuid, uuid, date, date
) to service_role;

create or replace function public.student_leaderboard_available_weeks()
returns table (week_start date)
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (
    select profiles.id, profiles.score_starts_on
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'student'
      and profiles.active = true
      and profiles.score_starts_on is not null
  ),
  candidate_weeks as (
    select public.week_start_for_date(public.current_effective_date()) as week_start
    from caller
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
  from candidate_weeks, caller
  where candidate_weeks.week_start is not null
    and candidate_weeks.week_start >= caller.score_starts_on
  order by candidate_weeks.week_start desc;
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
      and profiles.score_starts_on is not null
      and profiles.score_starts_on <= input_week_start
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
      and profiles.score_starts_on is not null
      and profiles.score_starts_on <= input_week_start
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
      and profiles.score_starts_on is not null
      and profiles.score_starts_on <= input_week_start - 7
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
