-- Read-only historical report population audit. Emits IDs, never phone/email.
begin transaction read only;

-- Corrected population versus legacy current-roster reuse by week and masjid.
with report_weeks as (
  select distinct generated.week_start::date
  from public.student_group_memberships memberships
  cross join lateral generate_series(
    week_start_for_date(memberships.starts_on + 6),
    least(
      coalesce(memberships.ends_on, current_toronto_civil_date()),
      week_start_for_date(current_toronto_civil_date())
    ),
    interval '7 days'
  ) generated(week_start)
), historical as (
  select weeks.week_start, cohorts.masjid_id, memberships.student_id
  from report_weeks weeks
  join public.student_group_memberships memberships
    on memberships.starts_on <= weeks.week_start
   and (memberships.ends_on is null or memberships.ends_on >= weeks.week_start)
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
), current_roster as (
  select memberships.student_id, cohorts.masjid_id
  from public.student_group_memberships memberships
  join public.profiles profiles on profiles.id = memberships.student_id
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
  join public.masajid masajid on masajid.id = cohorts.masjid_id
  where memberships.starts_on <= week_start_for_date(current_toronto_civil_date())
    and (memberships.ends_on is null or memberships.ends_on >= week_start_for_date(current_toronto_civil_date()))
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

-- Students added incorrectly or omitted by reusing today's roster.
with report_weeks as (
  select distinct generated.week_start::date
  from public.student_group_memberships memberships
  cross join lateral generate_series(
    week_start_for_date(memberships.starts_on + 6),
    least(
      coalesce(memberships.ends_on, current_toronto_civil_date()),
      week_start_for_date(current_toronto_civil_date())
    ),
    interval '7 days'
  ) generated(week_start)
), current_roster as (
  select memberships.student_id, cohorts.masjid_id
  from public.student_group_memberships memberships
  join public.profiles profiles on profiles.id = memberships.student_id
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
  join public.masajid masajid on masajid.id = cohorts.masjid_id
  where memberships.starts_on <= week_start_for_date(current_toronto_civil_date())
    and (memberships.ends_on is null or memberships.ends_on >= week_start_for_date(current_toronto_civil_date()))
    and profiles.role = 'student' and profiles.active
    and groups.active and cohorts.active and masajid.active
), historical as (
  select weeks.week_start, memberships.student_id, cohorts.masjid_id, groups.id as group_id
  from report_weeks weeks
  join public.student_group_memberships memberships
    on memberships.starts_on <= weeks.week_start
   and (memberships.ends_on is null or memberships.ends_on >= weeks.week_start)
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
)
select 'incorrectly_added_by_current_roster' as audit_section,
       weeks.week_start, roster.masjid_id, roster.student_id, null::uuid as historical_group_id
from report_weeks weeks cross join current_roster roster
where not exists (
  select 1 from historical
  where historical.week_start = weeks.week_start
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

-- Adjacent group and masjid transfers.
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
where previous_group_id is not null
  and previous_group_id is distinct from group_id
order by starts_on desc, student_id;

-- Later profile and hierarchy state that must not erase history.
select 'later_inactive_profiles' as audit_section, memberships.student_id,
       min(memberships.starts_on) as first_membership, profiles.role
from public.student_group_memberships memberships
join public.profiles profiles on profiles.id = memberships.student_id
where not profiles.active
group by memberships.student_id, profiles.role
union all
select 'later_role_changed_profiles', memberships.student_id,
       min(memberships.starts_on), profiles.role
from public.student_group_memberships memberships
join public.profiles profiles on profiles.id = memberships.student_id
where profiles.role <> 'student'
group by memberships.student_id, profiles.role
order by student_id;

select 'inactive_hierarchy_referenced' as audit_section,
       memberships.student_id, memberships.starts_on, memberships.ends_on,
       masajid.id as masjid_id, cohorts.id as cohort_id, groups.id as group_id,
       masajid.active as masjid_active, cohorts.active as cohort_active, groups.active as group_active
from public.student_group_memberships memberships
join public.halaqa_groups groups on groups.id = memberships.group_id
join public.cohorts cohorts on cohorts.id = groups.cohort_id
join public.masajid masajid on masajid.id = cohorts.masjid_id
where not masajid.active or not cohorts.active or not groups.active
order by memberships.starts_on desc, memberships.student_id;

-- Weeks where the current and corrected student ID sets differ.
with report_weeks as (
  select distinct generated.week_start::date
  from public.student_group_memberships memberships
  cross join lateral generate_series(
    week_start_for_date(memberships.starts_on + 6),
    least(
      coalesce(memberships.ends_on, current_toronto_civil_date()),
      week_start_for_date(current_toronto_civil_date())
    ),
    interval '7 days'
  ) generated(week_start)
), historical as (
  select weeks.week_start, cohorts.masjid_id,
         array_agg(distinct memberships.student_id order by memberships.student_id) as students
  from report_weeks weeks
  join public.student_group_memberships memberships
    on memberships.starts_on <= weeks.week_start
   and (memberships.ends_on is null or memberships.ends_on >= weeks.week_start)
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
  group by weeks.week_start, cohorts.masjid_id
), current_roster as (
  select cohorts.masjid_id,
         array_agg(distinct memberships.student_id order by memberships.student_id) as students
  from public.student_group_memberships memberships
  join public.profiles profiles on profiles.id = memberships.student_id
  join public.halaqa_groups groups on groups.id = memberships.group_id
  join public.cohorts cohorts on cohorts.id = groups.cohort_id
  join public.masajid masajid on masajid.id = cohorts.masjid_id
  where memberships.starts_on <= week_start_for_date(current_toronto_civil_date())
    and (memberships.ends_on is null or memberships.ends_on >= week_start_for_date(current_toronto_civil_date()))
    and profiles.role = 'student' and profiles.active
    and groups.active and cohorts.active and masajid.active
  group by cohorts.masjid_id
)
select 'differing_report_weeks' as audit_section, historical.week_start, historical.masjid_id
from historical left join current_roster using (masjid_id)
where historical.students is distinct from current_roster.students
order by historical.week_start desc, historical.masjid_id;

-- Obligations outside historical population/snapshot/scoring eligibility.
select 'obligations_outside_historical_eligibility' as audit_section,
       obligations.id as obligation_id, obligations.student_id, obligations.week_start,
       obligations.status, obligations.masjid_id, obligations.cohort_id, obligations.halaqa_group_id
from public.accountability_obligations obligations
left join public.profiles profiles on profiles.id = obligations.student_id
where not exists (
    select 1
    from public.student_group_memberships memberships
    join public.halaqa_groups groups on groups.id = memberships.group_id
    join public.cohorts cohorts on cohorts.id = groups.cohort_id
    where memberships.student_id = obligations.student_id
      and memberships.starts_on <= obligations.week_start
      and (memberships.ends_on is null or memberships.ends_on >= obligations.week_start)
      and groups.id = obligations.halaqa_group_id
      and cohorts.id = obligations.cohort_id
      and cohorts.masjid_id = obligations.masjid_id
  )
  or profiles.score_starts_on is null
  or profiles.score_starts_on > obligations.week_start
order by obligations.week_start desc, obligations.student_id;

-- Known issue only; Slice 4 does not repair Saturday-key weekly plans.
select 'known_issue_saturday_key_weekly_plans' as audit_section,
       id as weekly_plan_id, student_id, week_start
from public.weekly_plans
where extract(dow from week_start) = 6
order by week_start desc, student_id;

commit;
