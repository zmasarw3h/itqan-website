-- Read-only query-scale evidence for the production-shaped RLS fixture,
-- including its 1900-01-01 sentinel membership.
begin transaction read only;

explain (analyze, buffers, settings)
select * from private.raw_historical_report_week_scopes();

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (select id from public.profiles where role = 'super_admin' order by id limit 1),
    'role', 'authenticated'
  )::text,
  true
);

explain (analyze, buffers, settings)
select * from public.historical_reporting_available_weeks();

explain (analyze, buffers, settings)
select *
from public.historical_reporting_students_for_weeks(
  array(select week_start from public.historical_reporting_available_weeks())
);

-- Admin leaderboard activity ranges use the bounded batch population and
-- immutable historical scope snapshots.
explain (analyze, buffers, settings)
with population as materialized (
  select * from public.historical_reporting_students_for_weeks(
    array(select week_start from public.historical_reporting_available_weeks())
  )
)
select population.week_start, population.student_id,
       coalesce(sum(checkins.daily_score), 0), coalesce(sum(recitations.points), 0),
       coalesce(max(grades.attendance_points + grades.recitation_points), 0)
from population
left join public.checkins checkins
  on checkins.student_id = population.student_id
 and checkins.date between population.week_start and population.week_start + 6
 and checkins.masjid_id = population.masjid_id
 and checkins.cohort_id = population.cohort_id
 and checkins.halaqa_group_id = population.group_id
left join public.partner_recitations recitations
  on recitations.student_id = population.student_id
 and recitations.week_start = population.week_start
 and recitations.masjid_id = population.masjid_id
 and recitations.cohort_id = population.cohort_id
 and recitations.halaqa_group_id = population.group_id
left join public.halaqa_grades grades
  on grades.student_id = population.student_id
 and grades.week_start = population.week_start
 and grades.masjid_id = population.masjid_id
 and grades.cohort_id = population.cohort_id
 and grades.halaqa_group_id = population.group_id
group by population.week_start, population.student_id;

-- Weekly incentive/streak computation asks for at most three independently
-- eligible weeks and evaluates each authoritative percentage separately.
explain (analyze, buffers, settings)
with selected_weeks as (
  select week_start from public.historical_reporting_available_weeks()
  where week_start + 6 < public.current_effective_date()
  order by week_start desc limit 3
), population as materialized (
  select * from public.historical_reporting_students_for_weeks(
    array(select week_start from selected_weeks)
  ) where scoring_eligible
)
select population.week_start, population.student_id,
       private.raw_historical_weekly_percentage(population.student_id, population.week_start)
from population;

-- Monthly rewards join badge rows to the union of bounded eligible weekly
-- populations; membership starts never define an expanded calendar range.
explain (analyze, buffers, settings)
with reward_weeks as (
  select week_start from public.historical_reporting_available_weeks()
  where week_start + 6 < public.current_effective_date()
), population as materialized (
  select * from public.historical_reporting_students_for_weeks(
    array(select week_start from reward_weeks)
  ) where scoring_eligible
)
select population.student_id, count(awards.id)
from population
left join public.badge_awards awards
  on awards.student_id = population.student_id
 and awards.week_start = population.week_start
 and awards.masjid_id = population.masjid_id
 and awards.cohort_id = population.cohort_id
 and awards.halaqa_group_id = population.group_id
group by population.student_id;

-- Student leaderboard resolves its caller and peer cohort historically.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (
      select profiles.id
      from public.profiles profiles
      join public.student_group_memberships memberships on memberships.student_id = profiles.id
      join public.halaqa_groups groups on groups.id = memberships.group_id
      join public.cohorts cohorts on cohorts.id = groups.cohort_id
      where profiles.role = 'student' and profiles.active
        and exists (
          select 1 from private.raw_historical_report_week_scopes() scopes
          where scopes.masjid_id = cohorts.masjid_id
            and scopes.cohort_id = cohorts.id
            and scopes.week_start between memberships.starts_on and coalesce(memberships.ends_on, 'infinity'::date)
            and profiles.score_starts_on is not null
            and profiles.score_starts_on <= scopes.week_start
        )
      order by profiles.id
      limit 1
    ),
    'role', 'authenticated'
  )::text,
  true
);
explain (analyze, buffers, settings)
select * from public.student_leaderboard_available_weeks();
explain (analyze, buffers, settings)
select * from public.student_cohort_leaderboard_for_week(
  (select max(week_start) from public.student_leaderboard_available_weeks())
);

-- Audit mismatch enumeration is a finite scan of activity rows with a
-- point-in-time membership lookup, never a generated membership date range.
explain (analyze, buffers, settings)
with activity_rows as (
  select checkins.student_id, public.week_start_for_date(checkins.date) as week_start,
         checkins.masjid_id, checkins.cohort_id, checkins.halaqa_group_id
  from public.checkins
  union all
  select student_id, week_start, masjid_id, cohort_id, halaqa_group_id
  from public.partner_recitations
  union all
  select student_id, week_start, masjid_id, cohort_id, halaqa_group_id
  from public.halaqa_grades
  union all
  select student_id, week_start, masjid_id, cohort_id, halaqa_group_id
  from public.accountability_obligations
)
select count(*) from activity_rows
where not private.raw_historical_activity_scope_matches(
  student_id, week_start, masjid_id, cohort_id, halaqa_group_id
);

rollback;
