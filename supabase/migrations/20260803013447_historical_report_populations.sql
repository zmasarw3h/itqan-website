-- Canonical historical reporting population.
--
-- Viewer authorization is evaluated at request time. Population and hierarchy
-- placement are evaluated independently for every canonical Sunday supplied by
-- the caller. Current names are projected, while contact fields are returned
-- only when the actor can also open the student's current operational profile.

create or replace function private.raw_historical_activity_scope_matches(
  input_student_id uuid,
  input_week_start date,
  input_masjid_id uuid,
  input_cohort_id uuid,
  input_group_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_group_memberships as memberships
    join public.halaqa_groups as groups on groups.id = memberships.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
    where memberships.student_id = input_student_id
      and memberships.starts_on <= input_week_start
      and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
      and groups.id = input_group_id
      and cohorts.id = input_cohort_id
      and cohorts.masjid_id = input_masjid_id
  );
$$;

create or replace function private.raw_can_open_current_student_profile(
  input_actor_id uuid,
  input_student_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.raw_is_active_super_admin(input_actor_id)
    or exists (
      select 1
      from public.profiles as students
      join public.student_group_memberships as memberships
        on memberships.student_id = students.id
      join public.halaqa_groups as groups on groups.id = memberships.group_id
      join public.cohorts on cohorts.id = groups.cohort_id
      join public.masajid on masajid.id = cohorts.masjid_id
      where students.id = input_student_id
        and students.role = 'student'
        and students.active = true
        and memberships.starts_on <= public.current_toronto_civil_date()
        and (
          memberships.ends_on is null
          or memberships.ends_on >= public.current_toronto_civil_date()
        )
        and groups.active = true
        and cohorts.active = true
        and masajid.active = true
        and private.raw_is_admin_for_masjid(
          input_actor_id,
          cohorts.masjid_id,
          public.current_toronto_civil_date()
        )
    );
$$;

-- Bounded report-bearing week scopes. Legacy membership rows may begin at the
-- 1900 sentinel, so available weeks must come from actual report evidence (or
-- the current tracker week), never by expanding an entire membership window.
create or replace function private.raw_historical_report_week_scopes()
returns table (
  week_start date,
  masjid_id uuid,
  cohort_id uuid
)
language sql
stable
set search_path = ''
as $$
  with student_week_evidence as (
    select checkins.student_id,
           public.week_start_for_date(checkins.date) as week_start
    from public.checkins
    union
    select recitations.student_id, recitations.week_start
    from public.partner_recitations as recitations
    union
    select grades.student_id, grades.week_start
    from public.halaqa_grades as grades
    union
    select obligations.student_id, obligations.week_start
    from public.accountability_obligations as obligations
    union
    select awards.student_id, awards.week_start
    from public.badge_awards as awards
  ),
  historically_scoped_evidence as (
    select evidence.week_start,
           cohorts.masjid_id,
           cohorts.id as cohort_id
    from student_week_evidence as evidence
    join lateral (
      select memberships.group_id
      from public.student_group_memberships as memberships
      where memberships.student_id = evidence.student_id
        and memberships.starts_on <= evidence.week_start
        and (memberships.ends_on is null or memberships.ends_on >= evidence.week_start)
      order by memberships.starts_on desc, memberships.id desc
      limit 1
    ) as effective_membership on true
    join public.halaqa_groups as groups on groups.id = effective_membership.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
    join public.profiles on profiles.id = evidence.student_id
    where evidence.week_start = public.week_start_for_date(evidence.week_start)
      and profiles.score_starts_on is not null
      and profiles.score_starts_on <= evidence.week_start
  ),
  completed_report_runs as (
    select runs.week_start,
           runs.masjid_id,
           cohorts.id as cohort_id
    from public.weekly_incentive_runs as runs
    join public.cohorts on cohorts.masjid_id = runs.masjid_id
    where runs.week_start = public.week_start_for_date(runs.week_start)
      and exists (
        select 1
        from public.halaqa_groups as groups
        join public.student_group_memberships as memberships
          on memberships.group_id = groups.id
        join public.profiles on profiles.id = memberships.student_id
        where groups.cohort_id = cohorts.id
          and memberships.starts_on <= runs.week_start
          and (memberships.ends_on is null or memberships.ends_on >= runs.week_start)
          and profiles.score_starts_on is not null
          and profiles.score_starts_on <= runs.week_start
      )
  ),
  current_week_scopes as (
    select public.week_start_for_date(public.current_effective_date()) as week_start,
           cohorts.masjid_id,
           cohorts.id as cohort_id
    from public.student_group_memberships as memberships
    join public.halaqa_groups as groups on groups.id = memberships.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
    join public.profiles on profiles.id = memberships.student_id
    where memberships.starts_on <= public.week_start_for_date(public.current_effective_date())
      and (
        memberships.ends_on is null
        or memberships.ends_on >= public.week_start_for_date(public.current_effective_date())
      )
      and profiles.score_starts_on is not null
      and profiles.score_starts_on <= public.week_start_for_date(public.current_effective_date())
  )
  select distinct evidence.week_start, evidence.masjid_id, evidence.cohort_id
  from (
    select * from historically_scoped_evidence
    union all
    select * from completed_report_runs
    union all
    select * from current_week_scopes
  ) as evidence
  where evidence.masjid_id is not null
    and evidence.cohort_id is not null;
$$;

-- Student-facing report RPCs must not turn a long-lived (including sentinel)
-- membership into an implicit reporting calendar. Keep this predicate private
-- so both public RPCs share the same non-recursive, evidence-bounded rule.
create or replace function private.raw_student_reporting_week_is_allowed(
  input_student_id uuid,
  input_week_start date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select input_week_start is not null
    and input_week_start = public.week_start_for_date(input_week_start)
    and input_week_start <= public.week_start_for_date(public.current_effective_date())
    and exists (
      select 1
      from public.profiles
      join lateral (
        select memberships.group_id
        from public.student_group_memberships as memberships
        where memberships.student_id = profiles.id
          and memberships.starts_on <= input_week_start
          and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
        order by memberships.starts_on desc, memberships.id desc
        limit 1
      ) as effective_membership on true
      join public.halaqa_groups as groups on groups.id = effective_membership.group_id
      join public.cohorts on cohorts.id = groups.cohort_id
      where profiles.id = input_student_id
        and profiles.role = 'student'
        and profiles.active = true
        and profiles.score_starts_on is not null
        and profiles.score_starts_on <= input_week_start
        and exists (
          select 1
          from private.raw_historical_report_week_scopes() as scopes
          where scopes.week_start = input_week_start
            and scopes.masjid_id = cohorts.masjid_id
            and scopes.cohort_id = cohorts.id
        )
    );
$$;

create or replace function public.historical_reporting_students_for_weeks(
  input_week_starts date[]
)
returns table (
  week_start date,
  student_id uuid,
  student_name text,
  student_email text,
  student_phone text,
  membership_starts_on date,
  membership_ends_on date,
  score_starts_on date,
  scoring_eligible boolean,
  masjid_id uuid,
  masjid_name text,
  cohort_id uuid,
  cohort_kind text,
  cohort_name text,
  group_id uuid,
  group_name text,
  can_view_current_contact boolean,
  can_open_current_profile boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_is_student boolean;
  actor_is_admin boolean;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;

  if input_week_starts is null
    or cardinality(input_week_starts) = 0
    or array_position(input_week_starts, null) is not null then
    raise exception using errcode = '22023', message = 'At least one tracker week is required.';
  end if;

  if exists (
    select 1
    from unnest(input_week_starts) as supplied(week_start)
    where supplied.week_start <> public.week_start_for_date(supplied.week_start)
  ) then
    raise exception using errcode = '22023', message = 'Every tracker week must be a Sunday week start.';
  end if;

  select profiles.role = 'student' and profiles.active,
         profiles.role = 'admin' and profiles.active
  into actor_is_student, actor_is_admin
  from public.profiles
  where profiles.id = actor_id;

  if not coalesce(actor_is_student, false)
    and not coalesce(actor_is_admin, false)
    and not private.raw_is_active_super_admin(actor_id) then
    raise exception using errcode = '42501', message = 'Historical reporting access is required.';
  end if;

  return query
  with requested_weeks as (
    select distinct supplied.week_start
    from unnest(input_week_starts) as supplied(week_start)
    join public.historical_reporting_available_weeks() as available
      on available.week_start = supplied.week_start
  ),
  population as (
    select requested_weeks.week_start,
           memberships.student_id,
           memberships.starts_on,
           memberships.ends_on,
           groups.id as group_id,
           groups.name as group_name,
           cohorts.id as cohort_id,
           cohorts.kind as cohort_kind,
           cohorts.name as cohort_name,
           masajid.id as masjid_id,
           masajid.name as masjid_name
    from requested_weeks
    join public.student_group_memberships as memberships
      on memberships.starts_on <= requested_weeks.week_start
      and (memberships.ends_on is null or memberships.ends_on >= requested_weeks.week_start)
    join public.halaqa_groups as groups on groups.id = memberships.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
    join public.masajid on masajid.id = cohorts.masjid_id
  )
  select population.week_start,
         profiles.id,
         profiles.name,
         case when visibility.allowed then profiles.email end,
         case when visibility.allowed then profiles.phone end,
         population.starts_on,
         population.ends_on,
         profiles.score_starts_on,
         profiles.score_starts_on is not null
           and profiles.score_starts_on <= population.week_start,
         population.masjid_id,
         population.masjid_name,
         population.cohort_id,
         population.cohort_kind,
         population.cohort_name,
         population.group_id,
         population.group_name,
         visibility.allowed,
         visibility.allowed
  from population
  join public.profiles on profiles.id = population.student_id
  cross join lateral (
    select actor_id = population.student_id
      or private.raw_can_open_current_student_profile(actor_id, population.student_id) as allowed
  ) as visibility
  where (
      coalesce(actor_is_student, false)
      and population.student_id = actor_id
    )
    or private.raw_is_active_super_admin(actor_id)
    or (
      coalesce(actor_is_admin, false)
      and private.raw_is_admin_for_masjid(
        actor_id,
        population.masjid_id,
        public.current_toronto_civil_date()
      )
    )
  order by population.week_start desc,
           population.masjid_name,
           population.cohort_kind,
           population.cohort_name,
           population.group_name,
           profiles.name,
           profiles.id;
end;
$$;

create or replace function public.historical_reporting_available_weeks()
returns table (week_start date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  actor_active boolean;
begin
  select profiles.role, profiles.active
  into actor_role, actor_active
  from public.profiles
  where profiles.id = actor_id;

  if actor_id is null or not coalesce(actor_active, false)
    or actor_role not in ('student', 'admin', 'super_admin') then
    raise exception using errcode = '42501', message = 'Historical reporting access is required.';
  end if;

  return query
  select distinct scopes.week_start
  from private.raw_historical_report_week_scopes() as scopes
  where scopes.week_start <= public.week_start_for_date(public.current_effective_date())
    and (
      actor_role = 'super_admin'
      or (
      actor_role = 'admin'
      and private.raw_is_admin_for_masjid(
        actor_id,
        scopes.masjid_id,
        public.current_toronto_civil_date()
      )
      )
      or (
      actor_role = 'student'
      and exists (
        select 1
        from public.student_group_memberships as memberships
        join public.halaqa_groups as groups on groups.id = memberships.group_id
        join public.profiles on profiles.id = memberships.student_id
        where memberships.student_id = actor_id
          and groups.cohort_id = scopes.cohort_id
          and memberships.starts_on <= scopes.week_start
          and (memberships.ends_on is null or memberships.ends_on >= scopes.week_start)
          and profiles.score_starts_on is not null
          and profiles.score_starts_on <= scopes.week_start
      )
      )
    )
  order by scopes.week_start desc;
end;
$$;

create or replace function public.student_historical_reporting_scope_for_week(
  input_week_start date
)
returns table (
  student_id uuid,
  week_start date,
  masjid_id uuid,
  masjid_name text,
  masjid_slug text,
  cohort_id uuid,
  cohort_name text,
  cohort_kind text,
  group_id uuid,
  group_name text,
  membership_starts_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_tracker_week_start(input_week_start);

  if not exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'student'
      and profiles.active = true
  ) then
    raise exception using errcode = '42501', message = 'Active student access is required.';
  end if;

  if not private.raw_student_reporting_week_is_allowed((select auth.uid()), input_week_start) then
    raise exception using errcode = '22023',
      message = 'Requested student leaderboard week is not available.';
  end if;

  return query
  select memberships.student_id,
         input_week_start,
         masajid.id,
         masajid.name,
         masajid.slug,
         cohorts.id,
         cohorts.name,
         cohorts.kind,
         groups.id,
         groups.name,
         memberships.starts_on
  from public.student_group_memberships as memberships
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  where memberships.student_id = (select auth.uid())
    and memberships.starts_on <= input_week_start
    and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
  order by memberships.starts_on desc, memberships.id desc
  limit 1;
end;
$$;

create or replace function public.student_leaderboard_available_weeks()
returns table (week_start date)
language sql
stable
security definer
set search_path = ''
as $$
  select available.week_start
  from public.historical_reporting_available_weeks() as available;
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

  if not exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'student'
      and profiles.active = true
  ) then
    raise exception using errcode = '42501', message = 'Active student access is required.';
  end if;

  if not private.raw_student_reporting_week_is_allowed((select auth.uid()), input_week_start) then
    raise exception using errcode = '22023',
      message = 'Requested student leaderboard week is not available.';
  end if;

  return query
  with caller as (
    select profiles.id,
           current_groups.cohort_id,
           previous_groups.cohort_id as previous_cohort_id
    from public.profiles
    left join lateral (
      select groups.cohort_id
      from public.student_group_memberships as memberships
      join public.halaqa_groups as groups on groups.id = memberships.group_id
      where memberships.student_id = profiles.id
        and memberships.starts_on <= input_week_start
        and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
      order by memberships.starts_on desc, memberships.id desc
      limit 1
    ) as current_groups on true
    left join lateral (
      select groups.cohort_id
      from public.student_group_memberships as memberships
      join public.halaqa_groups as groups on groups.id = memberships.group_id
      where memberships.student_id = profiles.id
        and memberships.starts_on <= input_week_start - 7
        and (memberships.ends_on is null or memberships.ends_on >= input_week_start - 7)
      order by memberships.starts_on desc, memberships.id desc
      limit 1
    ) as previous_groups on true
    where profiles.id = (select auth.uid())
      and profiles.role = 'student'
      and profiles.active = true
  ),
  current_students as (
    select profiles.id,
           profiles.name,
           groups.id as group_id,
           cohorts.id as cohort_id,
           cohorts.masjid_id
    from caller
    join public.student_group_memberships as memberships
      on memberships.starts_on <= input_week_start
      and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
    join public.halaqa_groups as groups on groups.id = memberships.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
      and cohorts.id = caller.cohort_id
    join public.profiles on profiles.id = memberships.student_id
    where caller.cohort_id is not null
      and profiles.score_starts_on is not null
      and profiles.score_starts_on <= input_week_start
  ),
  current_scores as (
    select students.id,
           students.name,
           least(700::numeric, greatest(0::numeric, coalesce((
             select sum(coalesce(checkins.daily_score, 0))
             from public.checkins
             where checkins.student_id = students.id
               and checkins.date between input_week_start and input_week_start + 6
               and private.raw_historical_activity_scope_matches(
                 students.id, input_week_start, checkins.masjid_id,
                 checkins.cohort_id, checkins.halaqa_group_id
               )
           ), 0)::numeric)) as daily_points,
           least(150, greatest(0, coalesce((
             select sum(recitations.points)
             from public.partner_recitations as recitations
             where recitations.student_id = students.id
               and recitations.week_start = input_week_start
               and private.raw_historical_activity_scope_matches(
                 students.id, input_week_start, recitations.masjid_id,
                 recitations.cohort_id, recitations.halaqa_group_id
               )
           ), 0)::integer)) as partner_points,
           least(150, greatest(0, coalesce((
             select grades.attendance_points + grades.recitation_points
             from public.halaqa_grades as grades
             where grades.student_id = students.id
               and grades.week_start = input_week_start
               and private.raw_historical_activity_scope_matches(
                 students.id, input_week_start, grades.masjid_id,
                 grades.cohort_id, grades.halaqa_group_id
               )
           ), 0)::integer)) as halaqa_points
    from current_students as students
  ),
  current_ranked as (
    select scores.*,
           row_number() over (
             order by (scores.daily_points + scores.partner_points + scores.halaqa_points) desc,
                      scores.name,
                      scores.id
           )::integer as rank
    from current_scores as scores
  ),
  previous_students as (
    select profiles.id,
           profiles.name
    from caller
    join public.student_group_memberships as memberships
      on memberships.starts_on <= input_week_start - 7
      and (memberships.ends_on is null or memberships.ends_on >= input_week_start - 7)
    join public.halaqa_groups as groups on groups.id = memberships.group_id
    join public.cohorts on cohorts.id = groups.cohort_id
      and cohorts.id = caller.previous_cohort_id
    join public.profiles on profiles.id = memberships.student_id
    where caller.previous_cohort_id is not null
      and profiles.score_starts_on is not null
      and profiles.score_starts_on <= input_week_start - 7
  ),
  previous_activity as (
    select exists (
      select 1
      from previous_students as students
      where exists (
        select 1
        from public.checkins
        where checkins.student_id = students.id
          and checkins.date between input_week_start - 7 and input_week_start - 1
          and private.raw_historical_activity_scope_matches(
            students.id, input_week_start - 7, checkins.masjid_id,
            checkins.cohort_id, checkins.halaqa_group_id
          )
      ) or exists (
        select 1
        from public.partner_recitations as recitations
        where recitations.student_id = students.id
          and recitations.week_start = input_week_start - 7
          and private.raw_historical_activity_scope_matches(
            students.id, input_week_start - 7, recitations.masjid_id,
            recitations.cohort_id, recitations.halaqa_group_id
          )
      ) or exists (
        select 1
        from public.halaqa_grades as grades
        where grades.student_id = students.id
          and grades.week_start = input_week_start - 7
          and private.raw_historical_activity_scope_matches(
            students.id, input_week_start - 7, grades.masjid_id,
            grades.cohort_id, grades.halaqa_group_id
          )
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
               and private.raw_historical_activity_scope_matches(
                 students.id, input_week_start - 7, checkins.masjid_id,
                 checkins.cohort_id, checkins.halaqa_group_id
               )
           ), 0)::numeric))
           + least(150::numeric, greatest(0::numeric, coalesce((
             select sum(recitations.points)
             from public.partner_recitations as recitations
             where recitations.student_id = students.id
               and recitations.week_start = input_week_start - 7
               and private.raw_historical_activity_scope_matches(
                 students.id, input_week_start - 7, recitations.masjid_id,
                 recitations.cohort_id, recitations.halaqa_group_id
               )
           ), 0)::numeric))
           + least(150::numeric, greatest(0::numeric, coalesce((
             select grades.attendance_points + grades.recitation_points
             from public.halaqa_grades as grades
             where grades.student_id = students.id
               and grades.week_start = input_week_start - 7
               and private.raw_historical_activity_scope_matches(
                 students.id, input_week_start - 7, grades.masjid_id,
                 grades.cohort_id, grades.halaqa_group_id
               )
           ), 0)::numeric)) as total_points
    from previous_students as students
    cross join previous_activity
    where previous_activity.has_activity
  ),
  previous_ranked as (
    select scores.id,
           row_number() over (
             order by scores.total_points desc, scores.name, scores.id
           )::integer as rank
    from previous_scores as scores
  )
  select current_ranked.name,
         current_ranked.rank,
         previous_ranked.rank,
         case when previous_ranked.rank is null then null
              else previous_ranked.rank - current_ranked.rank end,
         (current_ranked.daily_points + current_ranked.partner_points + current_ranked.halaqa_points)::numeric,
         round((current_ranked.daily_points + current_ranked.partner_points + current_ranked.halaqa_points) / 10, 2),
         current_ranked.id = (select caller.id from caller),
         case
           when input_week_start + 6 < public.current_effective_date() then
             case when (current_ranked.daily_points + current_ranked.partner_points + current_ranked.halaqa_points) < 700
                  then 'Below 70%' else 'Passing' end
           when (current_ranked.daily_points + current_ranked.partner_points + current_ranked.halaqa_points) < 700
             then 'Below 70% so far'
           else 'In progress'
         end
  from current_ranked
  left join previous_ranked on previous_ranked.id = current_ranked.id
  order by current_ranked.rank;
end;
$$;

-- Pending obligations are historical report rows. Their scope validation must
-- survive later hierarchy deactivation, while their insert/update RLS remains
-- governed by the caller's current authorization.
create or replace function private.raw_historical_weekly_percentage(
  input_student_id uuid,
  input_week_start date
)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when input_week_start <> public.week_start_for_date(input_week_start)
      or input_week_start < date '2026-05-31'
      or input_week_start + 6 >= public.current_effective_date()
      or not exists (
        select 1
        from public.profiles
        where profiles.id = input_student_id
          and profiles.score_starts_on is not null
          and profiles.score_starts_on <= input_week_start
      )
      or not exists (
        select 1
        from public.student_group_memberships as memberships
        where memberships.student_id = input_student_id
          and memberships.starts_on <= input_week_start
          and (memberships.ends_on is null or memberships.ends_on >= input_week_start)
      )
    then null
    else round((
      least(700::numeric, greatest(0::numeric, coalesce((
        select sum(coalesce(checkins.daily_score, 0))
        from public.checkins
        where checkins.student_id = input_student_id
          and checkins.date between input_week_start and input_week_start + 6
          and private.raw_historical_activity_scope_matches(
            input_student_id, input_week_start, checkins.masjid_id,
            checkins.cohort_id, checkins.halaqa_group_id
          )
      ), 0)::numeric))
      + least(150::numeric, greatest(0::numeric, coalesce((
        select sum(recitations.points)
        from public.partner_recitations as recitations
        where recitations.student_id = input_student_id
          and recitations.week_start = input_week_start
          and private.raw_historical_activity_scope_matches(
            input_student_id, input_week_start, recitations.masjid_id,
            recitations.cohort_id, recitations.halaqa_group_id
          )
      ), 0)::numeric))
      + least(150::numeric, greatest(0::numeric, coalesce((
        select grades.attendance_points + grades.recitation_points
        from public.halaqa_grades as grades
        where grades.student_id = input_student_id
          and grades.week_start = input_week_start
          and private.raw_historical_activity_scope_matches(
            input_student_id, input_week_start, grades.masjid_id,
            grades.cohort_id, grades.halaqa_group_id
          )
      ), 0)::numeric))
    ) / 10, 2)
  end;
$$;

create or replace function public.set_student_scope_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  scope_week_start date;
begin
  if tg_table_name = 'checkins' then
    scope_week_start := public.week_start_for_date(new.date);
  elsif tg_table_name = 'weekly_plans' then
    scope_week_start := public.week_start_for_date(new.week_start + 1);
  else
    scope_week_start := new.week_start;
  end if;

  select groups.id, cohorts.id, cohorts.masjid_id
  into new.halaqa_group_id, new.cohort_id, new.masjid_id
  from public.student_group_memberships as memberships
  join public.halaqa_groups as groups on groups.id = memberships.group_id
  join public.cohorts on cohorts.id = groups.cohort_id
  where memberships.student_id = new.student_id
    and memberships.starts_on <= scope_week_start
    and (memberships.ends_on is null or memberships.ends_on >= scope_week_start)
  order by memberships.starts_on desc, memberships.id desc
  limit 1;

  return new;
end;
$$;

create or replace function public.validate_accountability_obligation_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'pending' then
    return new;
  end if;

  if not private.raw_historical_activity_scope_matches(
    new.student_id,
    new.week_start,
    new.masjid_id,
    new.cohort_id,
    new.halaqa_group_id
  ) or not exists (
    select 1
    from public.profiles
    where profiles.id = new.student_id
      and profiles.score_starts_on is not null
      and profiles.score_starts_on <= new.week_start
  ) then
    raise exception using
      errcode = '23514',
      message = 'Pending accountability obligations require historical population and scoring eligibility.';
  end if;

  return new;
end;
$$;

-- Reconciliation is server-only and atomic. The database recomputes the score
-- from scope-matching activity, so neither a browser nor the server can submit
-- a forged percentage or amount.
create or replace function public.reconcile_historical_accountability_obligation(
  input_student_id uuid,
  input_week_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_percentage numeric;
  expected_amount_cents integer;
  obligation public.accountability_obligations%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Server accountability access is required.';
  end if;

  expected_percentage := private.raw_historical_weekly_percentage(
    input_student_id,
    input_week_start
  );

  if expected_percentage is null then
    raise exception using
      errcode = '23514',
      message = 'Accountability reconciliation requires a completed Sunday in the historical scoring population.';
  end if;

  expected_amount_cents := case
    when expected_percentage >= 70 then 0
    else ceil((70 - expected_percentage) / 10)::integer * 500
  end;

  select obligations.*
  into obligation
  from public.accountability_obligations as obligations
  where obligations.student_id = input_student_id
    and obligations.week_start = input_week_start
  for update;

  if found and obligation.status in ('attested_paid', 'waived') then
    return null;
  end if;

  perform set_config(
    'app.historical_accountability_reconcile',
    input_student_id::text || ':' || input_week_start::text,
    true
  );

  if expected_percentage >= 70 then
    if obligation.id is not null then
      update public.accountability_obligations
      set weekly_percentage = expected_percentage,
          amount_cents = 0,
          status = 'waived',
          waived_at = now(),
          admin_note = 'Auto-waived after automatic score recalculation >= 70',
          updated_at = now()
      where accountability_obligations.id = obligation.id
      returning * into obligation;
    end if;

    return null;
  end if;

  if obligation.id is null then
    insert into public.accountability_obligations (
      student_id,
      week_start,
      weekly_percentage,
      amount_cents,
      status,
      updated_at
    )
    values (
      input_student_id,
      input_week_start,
      expected_percentage,
      expected_amount_cents,
      'pending',
      now()
    )
    on conflict (student_id, week_start) do nothing
    returning * into obligation;

    if obligation.id is null then
      select obligations.*
      into obligation
      from public.accountability_obligations as obligations
      where obligations.student_id = input_student_id
        and obligations.week_start = input_week_start
      for update;
    end if;
  end if;

  if obligation.status = 'pending' then
    update public.accountability_obligations
    set weekly_percentage = expected_percentage,
        amount_cents = expected_amount_cents,
        updated_at = now()
    where accountability_obligations.id = obligation.id
    returning * into obligation;
  end if;

  if obligation.status <> 'pending' then
    return null;
  end if;

  return to_jsonb(obligation);
end;
$$;

-- Phase A keeps the deployed application's service-role insert/recalculation
-- contract while the new reconciliation RPC rolls out. Both paths recompute
-- authoritative historical eligibility and score values in this trigger.
create or replace function public.enforce_student_accountability_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_percentage numeric;
  expected_amount_cents integer;
  expected_masjid_id uuid;
  expected_cohort_id uuid;
  expected_group_id uuid;
  reconciliation_marker text;
begin
  if tg_op = 'INSERT' then
    if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
      or public.is_active_admin()
      or public.is_active_super_admin() then
      expected_percentage := private.raw_historical_weekly_percentage(new.student_id, new.week_start);
      expected_amount_cents := case
        when expected_percentage is null or expected_percentage >= 70 then 0
        else ceil((70 - expected_percentage) / 10)::integer * 500
      end;

      select cohorts.masjid_id, cohorts.id, groups.id
      into expected_masjid_id, expected_cohort_id, expected_group_id
      from public.student_group_memberships memberships
      join public.halaqa_groups groups on groups.id = memberships.group_id
      join public.cohorts cohorts on cohorts.id = groups.cohort_id
      where memberships.student_id = new.student_id
        and memberships.starts_on <= new.week_start
        and (memberships.ends_on is null or memberships.ends_on >= new.week_start)
      order by memberships.starts_on desc, memberships.id desc
      limit 1;

      if expected_percentage is not null
        and expected_percentage < 70
        and new.weekly_percentage is not distinct from expected_percentage
        and new.amount_cents is not distinct from expected_amount_cents
        and new.status = 'pending'
        and new.attested_paid_at is null
        and new.waived_at is null
        and new.waived_by is null
        and new.admin_note is null
        and (new.masjid_id is null or new.masjid_id = expected_masjid_id)
        and (new.cohort_id is null or new.cohort_id = expected_cohort_id)
        and (new.halaqa_group_id is null or new.halaqa_group_id = expected_group_id)
      then
        return new;
      end if;

      raise exception 'Legacy accountability insertion may only use the authoritative historical score.';
    end if;

    raise exception 'Only active admins or server workflows may insert accountability obligations.';
  end if;

  reconciliation_marker := nullif(
    current_setting('app.historical_accountability_reconcile', true),
    ''
  );

  if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
    and reconciliation_marker is not null then
    expected_percentage := private.raw_historical_weekly_percentage(new.student_id, new.week_start);
    expected_amount_cents := case
      when expected_percentage is null or expected_percentage >= 70 then 0
      else ceil((70 - expected_percentage) / 10)::integer * 500
    end;

    if reconciliation_marker = new.student_id::text || ':' || new.week_start::text
      and old.status = 'pending'
      and new.id is not distinct from old.id
      and new.student_id is not distinct from old.student_id
      and new.week_start is not distinct from old.week_start
      and new.masjid_id is not distinct from old.masjid_id
      and new.cohort_id is not distinct from old.cohort_id
      and new.halaqa_group_id is not distinct from old.halaqa_group_id
      and new.weekly_percentage is not distinct from expected_percentage
      and new.amount_cents is not distinct from expected_amount_cents
      and new.attested_paid_at is not distinct from old.attested_paid_at
      and new.waived_by is not distinct from old.waived_by
      and new.created_at is not distinct from old.created_at
      and (
        (expected_percentage < 70
          and new.status = 'pending'
          and new.waived_at is not distinct from old.waived_at
          and new.admin_note is not distinct from old.admin_note)
        or
        (expected_percentage >= 70
          and new.status = 'waived'
          and new.waived_at is not null
          and new.admin_note = 'Auto-waived after automatic score recalculation >= 70')
      )
    then
      return new;
    end if;

    raise exception 'Accountability reconciliation may only apply the authoritative historical score.';
  end if;

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

  if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' then
    expected_percentage := private.raw_historical_weekly_percentage(new.student_id, new.week_start);
    expected_amount_cents := case
      when expected_percentage is null or expected_percentage >= 70 then 0
      else ceil((70 - expected_percentage) / 10)::integer * 500
    end;

    if expected_percentage is not null
      and old.status = 'pending'
      and new.id is not distinct from old.id
      and new.student_id is not distinct from old.student_id
      and new.week_start is not distinct from old.week_start
      and new.masjid_id is not distinct from old.masjid_id
      and new.cohort_id is not distinct from old.cohort_id
      and new.halaqa_group_id is not distinct from old.halaqa_group_id
      and new.weekly_percentage is not distinct from expected_percentage
      and new.amount_cents is not distinct from expected_amount_cents
      and new.attested_paid_at is not distinct from old.attested_paid_at
      and new.waived_by is not distinct from old.waived_by
      and new.created_at is not distinct from old.created_at
      and (
        (expected_percentage < 70
          and new.status = 'pending'
          and new.waived_at is not distinct from old.waived_at
          and new.admin_note is not distinct from old.admin_note)
        or
        (expected_percentage >= 70
          and new.status = 'waived'
          and new.waived_at is not null
          and new.admin_note = 'Auto-waived after automatic score recalculation >= 70')
      )
    then
      return new;
    end if;

    raise exception 'Legacy accountability recalculation may only use the authoritative historical score.';
  end if;

  if public.is_active_admin() or public.is_active_super_admin() then
    if new.id is distinct from old.id
      or new.student_id is distinct from old.student_id
      or new.week_start is distinct from old.week_start
      or new.masjid_id is distinct from old.masjid_id
      or new.cohort_id is distinct from old.cohort_id
      or new.halaqa_group_id is distinct from old.halaqa_group_id
      or new.weekly_percentage is distinct from old.weekly_percentage
      or new.amount_cents is distinct from old.amount_cents
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Administrators may not alter accountability identity, historical scope, score, or amount.';
    end if;

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

drop trigger if exists enforce_student_accountability_attestation_trigger
  on public.accountability_obligations;

create trigger enforce_student_accountability_attestation_trigger
  before insert or update on public.accountability_obligations
  for each row
  execute function public.enforce_student_accountability_attestation();

revoke all on function private.raw_historical_activity_scope_matches(uuid, date, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_can_open_current_student_profile(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_historical_report_week_scopes()
  from public, anon, authenticated, service_role;
revoke all on function private.raw_student_reporting_week_is_allowed(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.raw_historical_weekly_percentage(uuid, date)
  from public, anon, authenticated, service_role;

revoke all on function public.historical_reporting_students_for_weeks(date[])
  from public, anon, authenticated, service_role;
revoke all on function public.historical_reporting_available_weeks()
  from public, anon, authenticated, service_role;
revoke all on function public.student_historical_reporting_scope_for_week(date)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_historical_accountability_obligation(uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.historical_reporting_students_for_weeks(date[]) to authenticated;
grant execute on function public.historical_reporting_available_weeks() to authenticated;
grant execute on function public.student_historical_reporting_scope_for_week(date) to authenticated;
grant execute on function public.reconcile_historical_accountability_obligation(uuid, date)
  to service_role;

revoke execute on function public.student_cohort_leaderboard_for_week(date) from public, anon;
revoke execute on function public.student_leaderboard_available_weeks() from public, anon;
grant execute on function public.student_cohort_leaderboard_for_week(date) to authenticated;
grant execute on function public.student_leaderboard_available_weeks() to authenticated;

revoke execute on function public.set_student_scope_snapshot()
  from public, anon, authenticated, service_role;
revoke execute on function public.validate_accountability_obligation_scope()
  from public, anon, authenticated, service_role;

comment on function public.historical_reporting_students_for_weeks(date[]) is
  'Batch historical student population by canonical Sunday; current authorization and contact visibility are evaluated at request time.';
comment on function public.historical_reporting_available_weeks() is
  'Bounded canonical report weeks from report-bearing evidence plus the current tracker week, intersected with historical membership, scoring eligibility, and current viewer scope.';
comment on function public.student_leaderboard_available_weeks() is
  'Student-selectable canonical Sundays, bounded to evidence-backed historical cohort scopes plus the current tracker week; never returns future weeks.';

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
    'public.historical_reporting_available_weeks()',
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
    'public.preview_official_scoring_start_change(uuid,uuid,date)',
    'public.protect_foundation_row_identity()',
    'public.refresh_current_profile_role()',
    'public.reconcile_historical_accountability_obligation(uuid,date)',
    'public.recalculate_student_checkin_score()',
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
