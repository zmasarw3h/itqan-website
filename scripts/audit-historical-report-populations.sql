-- Read-only, bounded historical-report audit. Output contains identifiers and
-- report dates only: never names, contact details, notes, or activity content.
begin transaction read only;

-- Available report weeks come only from report-bearing evidence plus the
-- current tracker week. Membership date ranges are never expanded.
select 'available_report_week_bounds' as audit_section,
       count(distinct week_start) as report_week_count,
       min(week_start) as earliest_report_week,
       max(week_start) as latest_report_week
from private.raw_historical_report_week_scopes();

-- Corrected historical population versus legacy current-roster reuse.
with report_scopes as (
  select distinct week_start, masjid_id from private.raw_historical_report_week_scopes()
), historical as (
  select distinct scopes.week_start, scopes.masjid_id, memberships.student_id,
         groups.id as group_id
  from report_scopes scopes
  join public.student_group_memberships memberships
    on memberships.starts_on <= scopes.week_start
   and (memberships.ends_on is null or memberships.ends_on >= scopes.week_start)
  join public.profiles profiles on profiles.id = memberships.student_id
   and profiles.score_starts_on is not null
   and profiles.score_starts_on <= scopes.week_start
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
   and cohorts.masjid_id = scopes.masjid_id
), current_roster as (
  select distinct memberships.student_id, cohorts.masjid_id
  from public.student_group_memberships memberships
  join public.profiles profiles on profiles.id = memberships.student_id
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
  join public.masajid masajid on masajid.id = cohorts.masjid_id
  where memberships.starts_on <= public.week_start_for_date(public.current_toronto_civil_date())
    and (memberships.ends_on is null or memberships.ends_on >= public.week_start_for_date(public.current_toronto_civil_date()))
    and profiles.role = 'student' and profiles.active
    and groups.active and cohorts.active and masajid.active
)
select 'population_counts' as audit_section, historical.week_start, historical.masjid_id,
       count(distinct historical.student_id) as historical_population_count,
       count(distinct current_roster.student_id) as reused_current_roster_count
from historical
left join current_roster using (masjid_id)
group by historical.week_start, historical.masjid_id
order by historical.week_start desc, historical.masjid_id;

with report_scopes as (
  select distinct week_start, masjid_id from private.raw_historical_report_week_scopes()
), historical as (
  select distinct scopes.week_start, scopes.masjid_id, memberships.student_id,
         groups.id as group_id
  from report_scopes scopes
  join public.student_group_memberships memberships
    on memberships.starts_on <= scopes.week_start
   and (memberships.ends_on is null or memberships.ends_on >= scopes.week_start)
  join public.profiles profiles on profiles.id = memberships.student_id
   and profiles.score_starts_on is not null
   and profiles.score_starts_on <= scopes.week_start
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
   and cohorts.masjid_id = scopes.masjid_id
), current_roster as (
  select distinct memberships.student_id, cohorts.masjid_id
  from public.student_group_memberships memberships
  join public.profiles profiles on profiles.id = memberships.student_id
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
  join public.masajid masajid on masajid.id = cohorts.masjid_id
  where memberships.starts_on <= public.week_start_for_date(public.current_toronto_civil_date())
    and (memberships.ends_on is null or memberships.ends_on >= public.week_start_for_date(public.current_toronto_civil_date()))
    and profiles.role = 'student' and profiles.active
    and groups.active and cohorts.active and masajid.active
)
select 'incorrectly_added_by_current_roster' as audit_section,
       scopes.week_start, roster.masjid_id, roster.student_id, null::uuid as historical_group_id
from report_scopes scopes
join current_roster roster using (masjid_id)
where not exists (
  select 1 from historical
  where historical.week_start = scopes.week_start
    and historical.masjid_id = roster.masjid_id
    and historical.student_id = roster.student_id
)
union all
select 'omitted_historical_students', historical.week_start, historical.masjid_id,
       historical.student_id, historical.group_id
from historical
where not exists (
  select 1 from current_roster
  where current_roster.masjid_id = historical.masjid_id
    and current_roster.student_id = historical.student_id
)
order by week_start desc, masjid_id, student_id;

with report_scopes as (
  select distinct week_start, masjid_id from private.raw_historical_report_week_scopes()
), historical as (
  select scopes.week_start, scopes.masjid_id,
         array_agg(distinct memberships.student_id order by memberships.student_id) as students
  from report_scopes scopes
  join public.student_group_memberships memberships
    on memberships.starts_on <= scopes.week_start
   and (memberships.ends_on is null or memberships.ends_on >= scopes.week_start)
  join public.profiles profiles on profiles.id = memberships.student_id
   and profiles.score_starts_on is not null
   and profiles.score_starts_on <= scopes.week_start
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
   and cohorts.masjid_id = scopes.masjid_id
  group by scopes.week_start, scopes.masjid_id
), current_roster as (
  select cohorts.masjid_id,
         array_agg(distinct memberships.student_id order by memberships.student_id) as students
  from public.student_group_memberships memberships
  join public.profiles profiles on profiles.id = memberships.student_id
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
  join public.masajid masajid on masajid.id = cohorts.masjid_id
  where memberships.starts_on <= public.week_start_for_date(public.current_toronto_civil_date())
    and (memberships.ends_on is null or memberships.ends_on >= public.week_start_for_date(public.current_toronto_civil_date()))
    and profiles.role = 'student' and profiles.active
    and groups.active and cohorts.active and masajid.active
  group by cohorts.masjid_id
)
select 'differing_report_weeks' as audit_section, historical.week_start, historical.masjid_id
from historical
left join current_roster using (masjid_id)
where historical.students is distinct from current_roster.students
order by historical.week_start desc, historical.masjid_id;

-- Adjacent transfers and later state changes that must not rewrite history.
with ordered as (
  select memberships.student_id, memberships.starts_on, memberships.group_id, cohorts.masjid_id,
         lag(memberships.group_id) over history as previous_group_id,
         lag(cohorts.masjid_id) over history as previous_masjid_id
  from public.student_group_memberships memberships
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
  window history as (partition by memberships.student_id order by memberships.starts_on, memberships.id)
)
select 'group_transfers' as audit_section, student_id, starts_on,
       previous_masjid_id, masjid_id, previous_group_id, group_id
from ordered
where previous_group_id is not null and previous_group_id is distinct from group_id
order by starts_on desc, student_id;

with bounded_population as (
  select distinct scopes.week_start, memberships.student_id, memberships.starts_on
  from private.raw_historical_report_week_scopes() scopes
  join public.student_group_memberships memberships
    on memberships.starts_on <= scopes.week_start
   and (memberships.ends_on is null or memberships.ends_on >= scopes.week_start)
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
   and cohorts.masjid_id = scopes.masjid_id
  join public.profiles profiles on profiles.id = memberships.student_id
   and profiles.score_starts_on is not null
   and profiles.score_starts_on <= scopes.week_start
)
select 'later_inactive_profiles' as audit_section, population.student_id,
       min(population.starts_on) as first_membership, profiles.role
from bounded_population population
join public.profiles profiles on profiles.id = population.student_id
where not profiles.active
group by population.student_id, profiles.role
union all
select 'later_role_changed_profiles', population.student_id,
       min(population.starts_on), profiles.role
from bounded_population population
join public.profiles profiles on profiles.id = population.student_id
where profiles.role <> 'student'
group by population.student_id, profiles.role
order by student_id;

with bounded_population as (
  select distinct scopes.week_start, memberships.id as membership_id
  from private.raw_historical_report_week_scopes() scopes
  join public.student_group_memberships memberships
    on memberships.starts_on <= scopes.week_start
   and (memberships.ends_on is null or memberships.ends_on >= scopes.week_start)
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
   and cohorts.masjid_id = scopes.masjid_id
  join public.profiles profiles on profiles.id = memberships.student_id
   and profiles.score_starts_on is not null
   and profiles.score_starts_on <= scopes.week_start
)
select 'inactive_hierarchy_referenced' as audit_section,
       memberships.student_id, memberships.starts_on, memberships.ends_on,
       masajid.id as masjid_id, cohorts.id as cohort_id, groups.id as group_id,
       masajid.active as masjid_active, cohorts.active as cohort_active, groups.active as group_active
from public.student_group_memberships memberships
join bounded_population population on population.membership_id = memberships.id
join public.halaqa_groups groups on groups.id = memberships.group_id
join public.cohorts cohorts on cohorts.id = groups.cohort_id
join public.masajid masajid on masajid.id = cohorts.masjid_id
where not masajid.active or not cohorts.active or not groups.active
order by memberships.starts_on desc, memberships.student_id;

-- Immutable scope mismatches. Each row contains only the requested identifiers,
-- date/week, stored and expected scope IDs, and a stable reason code.
with activity_rows as (
  select 'checkins'::text as source_table, checkins.id as row_id, checkins.student_id,
         checkins.date as report_date, public.week_start_for_date(checkins.date) as scope_week,
         checkins.masjid_id, checkins.cohort_id, checkins.halaqa_group_id
  from public.checkins
  union all
  select 'partner_recitations', recitations.id, recitations.student_id,
         recitations.week_start, recitations.week_start,
         recitations.masjid_id, recitations.cohort_id, recitations.halaqa_group_id
  from public.partner_recitations recitations
  union all
  select 'halaqa_grades', grades.id, grades.student_id,
         grades.week_start, grades.week_start,
         grades.masjid_id, grades.cohort_id, grades.halaqa_group_id
  from public.halaqa_grades grades
  union all
  select 'accountability_obligations', obligations.id, obligations.student_id,
         obligations.week_start, obligations.week_start,
         obligations.masjid_id, obligations.cohort_id, obligations.halaqa_group_id
  from public.accountability_obligations obligations
), evaluated as (
  select activity_rows.*, expected.masjid_id as expected_masjid_id,
         expected.cohort_id as expected_cohort_id, expected.group_id as expected_group_id
  from activity_rows
  left join lateral (
    select cohorts.masjid_id, cohorts.id as cohort_id, groups.id as group_id
    from public.student_group_memberships memberships
    join public.halaqa_groups groups on groups.id = memberships.group_id
    join public.cohorts cohorts on cohorts.id = groups.cohort_id
    where memberships.student_id = activity_rows.student_id
      and memberships.starts_on <= activity_rows.scope_week
      and (memberships.ends_on is null or memberships.ends_on >= activity_rows.scope_week)
    order by memberships.starts_on desc, memberships.id desc
    limit 1
  ) expected on true
)
select source_table as audit_section, row_id, student_id, report_date,
       masjid_id as stored_masjid_id, cohort_id as stored_cohort_id,
       halaqa_group_id as stored_group_id, expected_masjid_id,
       expected_cohort_id, expected_group_id,
       case
         when expected_group_id is null then 'no_historical_membership'
         else 'stored_scope_mismatch'
       end as reason_code
from evaluated
where expected_group_id is null
   or masjid_id is distinct from expected_masjid_id
   or cohort_id is distinct from expected_cohort_id
   or halaqa_group_id is distinct from expected_group_id
order by source_table, report_date desc, student_id, row_id;

-- Count only bounded, scoring-eligible student/weeks whose numeric score
-- actually changes when malformed activity snapshots are excluded.
with eligible as (
  select distinct scopes.week_start, memberships.student_id
  from private.raw_historical_report_week_scopes() scopes
  join public.student_group_memberships memberships
    on memberships.starts_on <= scopes.week_start
   and (memberships.ends_on is null or memberships.ends_on >= scopes.week_start)
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
   and cohorts.masjid_id = scopes.masjid_id
  join public.profiles profiles on profiles.id = memberships.student_id
   and profiles.score_starts_on is not null
   and profiles.score_starts_on <= scopes.week_start
), score_comparison as (
  select eligible.student_id, eligible.week_start,
    least(700::numeric, greatest(0::numeric, coalesce((
      select sum(coalesce(checkins.daily_score, 0)) from public.checkins
      where checkins.student_id = eligible.student_id
        and checkins.date between eligible.week_start and eligible.week_start + 6
    ), 0)::numeric))
    + least(150::numeric, greatest(0::numeric, coalesce((
      select sum(recitations.points) from public.partner_recitations recitations
      where recitations.student_id = eligible.student_id
        and recitations.week_start = eligible.week_start
    ), 0)::numeric))
    + least(150::numeric, greatest(0::numeric, coalesce((
      select grades.attendance_points + grades.recitation_points from public.halaqa_grades grades
      where grades.student_id = eligible.student_id
        and grades.week_start = eligible.week_start
    ), 0)::numeric)) as unvalidated_points,
    least(700::numeric, greatest(0::numeric, coalesce((
      select sum(coalesce(checkins.daily_score, 0)) from public.checkins
      where checkins.student_id = eligible.student_id
        and checkins.date between eligible.week_start and eligible.week_start + 6
        and private.raw_historical_activity_scope_matches(
          eligible.student_id, eligible.week_start, checkins.masjid_id,
          checkins.cohort_id, checkins.halaqa_group_id)
    ), 0)::numeric))
    + least(150::numeric, greatest(0::numeric, coalesce((
      select sum(recitations.points) from public.partner_recitations recitations
      where recitations.student_id = eligible.student_id
        and recitations.week_start = eligible.week_start
        and private.raw_historical_activity_scope_matches(
          eligible.student_id, eligible.week_start, recitations.masjid_id,
          recitations.cohort_id, recitations.halaqa_group_id)
    ), 0)::numeric))
    + least(150::numeric, greatest(0::numeric, coalesce((
      select grades.attendance_points + grades.recitation_points from public.halaqa_grades grades
      where grades.student_id = eligible.student_id
        and grades.week_start = eligible.week_start
        and private.raw_historical_activity_scope_matches(
          eligible.student_id, eligible.week_start, grades.masjid_id,
          grades.cohort_id, grades.halaqa_group_id)
    ), 0)::numeric)) as validated_points
  from eligible
)
select 'scores_changed_by_scope_exclusion' as audit_section,
       count(*) as changed_student_week_scores
from score_comparison
where unvalidated_points is distinct from validated_points;

-- Paid or waived obligation mismatches are flagged separately and never repaired.
select 'paid_or_waived_obligation_scope_mismatches' as audit_section,
       obligations.id as row_id, obligations.student_id, obligations.week_start as report_date,
       obligations.masjid_id as stored_masjid_id, obligations.cohort_id as stored_cohort_id,
       obligations.halaqa_group_id as stored_group_id, expected.masjid_id as expected_masjid_id,
       expected.cohort_id as expected_cohort_id, expected.group_id as expected_group_id,
       case
         when expected.group_id is null then 'paid_or_waived_no_historical_membership'
         else 'paid_or_waived_stored_scope_mismatch'
       end as reason_code
from public.accountability_obligations obligations
left join lateral (
  select cohorts.masjid_id, cohorts.id as cohort_id, groups.id as group_id
  from public.student_group_memberships memberships
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
  where memberships.student_id = obligations.student_id
    and memberships.starts_on <= obligations.week_start
    and (memberships.ends_on is null or memberships.ends_on >= obligations.week_start)
  order by memberships.starts_on desc, memberships.id desc
  limit 1
) expected on true
where obligations.status in ('attested_paid', 'waived')
  and (
    expected.group_id is null
    or obligations.masjid_id is distinct from expected.masjid_id
    or obligations.cohort_id is distinct from expected.cohort_id
    or obligations.halaqa_group_id is distinct from expected.group_id
  )
order by obligations.week_start desc, obligations.student_id;

-- Eligibility mismatches include score-start failures even when snapshots match.
select 'obligations_outside_historical_eligibility' as audit_section,
       obligations.id as row_id, obligations.student_id, obligations.week_start as report_date,
       obligations.masjid_id as stored_masjid_id, obligations.cohort_id as stored_cohort_id,
       obligations.halaqa_group_id as stored_group_id, expected.masjid_id as expected_masjid_id,
       expected.cohort_id as expected_cohort_id, expected.group_id as expected_group_id,
       case
         when expected.group_id is null then 'no_historical_membership'
         when profiles.score_starts_on is null or profiles.score_starts_on > obligations.week_start
           then 'not_scoring_eligible'
         else 'stored_scope_mismatch'
       end as reason_code
from public.accountability_obligations obligations
left join public.profiles profiles on profiles.id = obligations.student_id
left join lateral (
  select cohorts.masjid_id, cohorts.id as cohort_id, groups.id as group_id
  from public.student_group_memberships memberships
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
  where memberships.student_id = obligations.student_id
    and memberships.starts_on <= obligations.week_start
    and (memberships.ends_on is null or memberships.ends_on >= obligations.week_start)
  order by memberships.starts_on desc, memberships.id desc
  limit 1
) expected on true
where expected.group_id is null
   or profiles.score_starts_on is null
   or profiles.score_starts_on > obligations.week_start
   or obligations.masjid_id is distinct from expected.masjid_id
   or obligations.cohort_id is distinct from expected.cohort_id
   or obligations.halaqa_group_id is distinct from expected.group_id
order by obligations.week_start desc, obligations.student_id;

-- Known issue only; Slice 4 does not repair Saturday-key weekly plans.
select 'known_issue_saturday_key_weekly_plans' as audit_section,
       id as row_id, student_id, week_start as report_date
from public.weekly_plans
where extract(dow from week_start) = 6
order by week_start desc, student_id;

commit;
