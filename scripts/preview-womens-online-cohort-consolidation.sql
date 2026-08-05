-- ITQAN Lite women's online cohort consolidation preview.
--
-- READ ONLY. This file intentionally starts a READ ONLY transaction and has
-- no INSERT/UPDATE/DELETE/DDL statements. It must be run with a privileged
-- SQL connection because it reads the private historical-reporting helper and
-- storage metadata. It does not read or print file bytes.
--
-- Required psql variables:
--   masjid_id, cohort_id, retained_group_id, retired_group_id, effective_date
--
-- Example (use the exact values from the approved final preview):
--   psql "$DATABASE_URL" \
--     -v masjid_id=... \
--     -v cohort_id=... \
--     -v retained_group_id=... \
--     -v retired_group_id=... \
--     -v effective_date=2026-08-09 \
--     --single-transaction --set=ON_ERROR_STOP=1 \
--     --file scripts/preview-womens-online-cohort-consolidation.sql

\set ON_ERROR_STOP on
\pset pager off

\if :{?masjid_id}
\else
  \echo 'Missing required psql variable: masjid_id'
  \quit 3
\endif
\if :{?cohort_id}
\else
  \echo 'Missing required psql variable: cohort_id'
  \quit 3
\endif
\if :{?retained_group_id}
\else
  \echo 'Missing required psql variable: retained_group_id'
  \quit 3
\endif
\if :{?retired_group_id}
\else
  \echo 'Missing required psql variable: retired_group_id'
  \quit 3
\endif
\if :{?effective_date}
\else
  \echo 'Missing required psql variable: effective_date'
  \quit 3
\endif

BEGIN READ ONLY;

\echo '=== context ==='
with params as (
  select
    :'masjid_id'::uuid as masjid_id,
    :'cohort_id'::uuid as cohort_id,
    :'retained_group_id'::uuid as retained_group_id,
    :'retired_group_id'::uuid as retired_group_id,
    :'effective_date'::date as effective_date
)
select jsonb_pretty(jsonb_build_object(
  'database_session_date', current_date,
  'toronto_civil_date', public.current_toronto_civil_date(),
  'effective_date', params.effective_date,
  'effective_date_is_sunday', params.effective_date = public.week_start_for_date(params.effective_date),
  'effective_date_minus_one', params.effective_date - 1,
  'effective_tracker_week', public.week_start_for_date(params.effective_date),
  'effective_halaqa_saturday', public.halaqa_saturday_for_week(params.effective_date),
  'masjid_id', params.masjid_id,
  'cohort_id', params.cohort_id,
  'retained_group_id', params.retained_group_id,
  'retired_group_id', params.retired_group_id
)) as context
from params;

\echo '=== hierarchy ==='
with params as (
  select
    :'masjid_id'::uuid as masjid_id,
    :'cohort_id'::uuid as cohort_id,
    :'retained_group_id'::uuid as retained_group_id,
    :'retired_group_id'::uuid as retired_group_id
)
select
  masajid.id as masjid_id,
  masajid.name as masjid_name,
  masajid.slug as masjid_slug,
  masajid.active as masjid_active,
  cohorts.id as cohort_id,
  cohorts.name as cohort_name,
  cohorts.kind as cohort_kind,
  cohorts.active as cohort_active,
  groups.id as group_id,
  groups.name as group_name,
  groups.active as group_active,
  groups.sort_order,
  groups.created_at,
  groups.updated_at,
  case
    when groups.id = params.retained_group_id then 'retained_candidate'
    when groups.id = params.retired_group_id then 'retired_candidate'
    else 'other_group'
  end as requested_role
from params
left join public.masajid on masajid.id = params.masjid_id
left join public.cohorts on cohorts.id = params.cohort_id
left join public.halaqa_groups groups on groups.cohort_id = cohorts.id
order by groups.sort_order, groups.name, groups.id;

\echo '=== membership summary ==='
with params as (
  select
    :'cohort_id'::uuid as cohort_id,
    :'retained_group_id'::uuid as retained_group_id,
    :'retired_group_id'::uuid as retired_group_id,
    :'effective_date'::date as effective_date
), target_groups as (
  select groups.id, groups.name
  from public.halaqa_groups groups
  join params on params.cohort_id = groups.cohort_id
  where groups.id in (params.retained_group_id, params.retired_group_id)
), memberships as (
  select memberships.*, target_groups.name as group_name
  from public.student_group_memberships memberships
  join target_groups on target_groups.id = memberships.group_id
)
select
  memberships.group_id,
  memberships.group_name,
  count(*) as membership_rows,
  count(distinct memberships.student_id) as distinct_students,
  count(*) filter (where memberships.ends_on is null) as open_rows,
  count(*) filter (
    where memberships.starts_on <= params.effective_date
      and (memberships.ends_on is null or memberships.ends_on >= params.effective_date)
  ) as effective_at_cutover,
  count(*) filter (where memberships.starts_on >= params.effective_date) as future_only_rows,
  min(memberships.starts_on) as earliest_start,
  max(memberships.starts_on) as latest_start,
  max(memberships.ends_on) as latest_end
from memberships
cross join params
group by memberships.group_id, memberships.group_name
order by memberships.group_name, memberships.group_id;

\echo '=== membership rows ==='
with params as (
  select
    :'cohort_id'::uuid as cohort_id,
    :'retained_group_id'::uuid as retained_group_id,
    :'retired_group_id'::uuid as retired_group_id,
    :'effective_date'::date as effective_date
)
select
  memberships.id as membership_id,
  memberships.student_id,
  memberships.group_id,
  groups.name as group_name,
  memberships.starts_on,
  memberships.ends_on,
  memberships.assigned_by,
  memberships.created_at,
  memberships.updated_at,
  case
    when memberships.starts_on <= params.effective_date
      and (memberships.ends_on is null or memberships.ends_on >= params.effective_date)
      then 'effective_at_cutover'
    when memberships.starts_on >= params.effective_date then 'future_only'
    else 'historical_before_cutover'
  end as cutover_class,
  profiles.active as student_active,
  profiles.role as student_role,
  profiles.score_starts_on
from public.student_group_memberships memberships
join public.halaqa_groups groups on groups.id = memberships.group_id
join public.cohorts on cohorts.id = groups.cohort_id
join params on params.cohort_id = cohorts.id
join public.profiles on profiles.id = memberships.student_id
where groups.id in (params.retained_group_id, params.retired_group_id)
order by memberships.student_id, memberships.starts_on, memberships.id;

\echo '=== student placement checks at cutover ==='
with params as (
  select
    :'cohort_id'::uuid as cohort_id,
    :'retained_group_id'::uuid as retained_group_id,
    :'retired_group_id'::uuid as retired_group_id,
    :'effective_date'::date as effective_date
), source_students as (
  select distinct memberships.student_id
  from public.student_group_memberships memberships
  join params on memberships.group_id = params.retired_group_id
), placements as (
  select
    source_students.student_id,
    count(*) as effective_membership_count,
    count(*) filter (where memberships.group_id = params.retired_group_id) as retired_group_count,
    count(*) filter (where memberships.group_id = params.retained_group_id) as retained_group_count,
    coalesce(array_agg(memberships.group_id order by memberships.starts_on, memberships.id), '{}') as effective_group_ids
  from source_students
  cross join params
  left join public.student_group_memberships memberships
    on memberships.student_id = source_students.student_id
   and memberships.starts_on <= params.effective_date
   and (memberships.ends_on is null or memberships.ends_on >= params.effective_date)
  group by source_students.student_id
)
select
  placements.*,
  case
    when placements.effective_membership_count = 1
     and placements.retired_group_count = 1
     and placements.retained_group_count = 0 then 'PASS_SOURCE_PLACEMENT'
    else 'ABORT_AMBIGUOUS_OR_NON_SOURCE_PLACEMENT'
  end as status
from placements
order by placements.student_id;

\echo '=== teacher assignments ==='
with params as (
  select
    :'cohort_id'::uuid as cohort_id,
    :'retained_group_id'::uuid as retained_group_id,
    :'retired_group_id'::uuid as retired_group_id,
    :'effective_date'::date as effective_date,
    :'masjid_id'::uuid as masjid_id
)
select
  assignments.id as assignment_id,
  assignments.group_id,
  groups.name as group_name,
  assignments.teacher_id,
  profiles.name as teacher_name,
  profiles.role as teacher_role,
  profiles.active as teacher_active,
  assignments.week_start,
  public.halaqa_saturday_for_week(assignments.week_start) as halaqa_saturday,
  assignments.active,
  assignments.assigned_by,
  assignments.created_at,
  assignments.updated_at,
  exists (
    select 1
    from public.masjid_staff_memberships staff
    where staff.profile_id = assignments.teacher_id
      and staff.masjid_id = params.masjid_id
      and staff.staff_role = 'teacher'
      and staff.active
      and staff.starts_on <= public.halaqa_saturday_for_week(assignments.week_start)
      and (staff.ends_on is null or staff.ends_on >= public.halaqa_saturday_for_week(assignments.week_start))
  ) as teacher_staff_covers_halaqa_saturday,
  case
    when assignments.week_start >= params.effective_date then 'on_or_after_cutover'
    else 'historical_before_cutover'
  end as cutover_class
from public.group_teacher_assignments assignments
join public.halaqa_groups groups on groups.id = assignments.group_id
join public.cohorts on cohorts.id = groups.cohort_id
join params on params.cohort_id = cohorts.id
join public.profiles on profiles.id = assignments.teacher_id
where assignments.group_id in (params.retained_group_id, params.retired_group_id)
order by assignments.week_start, groups.name, assignments.created_at, assignments.id;

\echo '=== rotation settings and availability ==='
with params as (
  select :'cohort_id'::uuid as cohort_id
)
select
  'rotation_setting' as row_kind,
  settings.id,
  settings.masjid_id,
  settings.cohort_id,
  settings.target_group_count,
  settings.active,
  settings.created_by,
  settings.updated_by,
  settings.created_at,
  settings.updated_at,
  null::date as week_start,
  null::uuid as teacher_id,
  null::boolean as available
from public.cohort_rotation_settings settings
join params on params.cohort_id = settings.cohort_id
union all
select
  'teacher_availability',
  availability.id,
  availability.masjid_id,
  availability.cohort_id,
  null::integer,
  null::boolean,
  availability.created_by,
  availability.updated_by,
  availability.created_at,
  availability.updated_at,
  availability.week_start,
  availability.teacher_id,
  availability.available
from public.teacher_rotation_availability availability
join params on params.cohort_id = availability.cohort_id
order by row_kind, week_start nulls first, id;

\echo '=== operational snapshot summary for affected students ==='
with params as (
  select
    :'retained_group_id'::uuid as retained_group_id,
    :'retired_group_id'::uuid as retired_group_id,
    :'effective_date'::date as effective_date,
    :'masjid_id'::uuid as masjid_id,
    :'cohort_id'::uuid as cohort_id
), affected_students as (
  select distinct memberships.student_id
  from public.student_group_memberships memberships
  join params on memberships.group_id in (params.retained_group_id, params.retired_group_id)
), activity as (
  select 'checkins'::text as table_name, checkins.id as row_id, checkins.student_id,
         public.week_start_for_date(checkins.date) as week_start, checkins.date as activity_date,
         checkins.masjid_id, checkins.cohort_id, checkins.halaqa_group_id
  from public.checkins join affected_students using (student_id)
  union all
  select 'weekly_plans', weekly_plans.id, weekly_plans.student_id, weekly_plans.week_start,
         weekly_plans.week_start, weekly_plans.masjid_id, weekly_plans.cohort_id, weekly_plans.halaqa_group_id
  from public.weekly_plans join affected_students using (student_id)
  union all
  select 'partner_recitations', partner_recitations.id, partner_recitations.student_id, partner_recitations.week_start,
         partner_recitations.week_start, partner_recitations.masjid_id, partner_recitations.cohort_id, partner_recitations.halaqa_group_id
  from public.partner_recitations join affected_students using (student_id)
  union all
  select 'halaqa_grades', halaqa_grades.id, halaqa_grades.student_id, halaqa_grades.week_start,
         halaqa_grades.week_start, halaqa_grades.masjid_id, halaqa_grades.cohort_id, halaqa_grades.halaqa_group_id
  from public.halaqa_grades join affected_students using (student_id)
  union all
  select 'accountability_obligations', accountability_obligations.id, accountability_obligations.student_id, accountability_obligations.week_start,
         accountability_obligations.week_start, accountability_obligations.masjid_id, accountability_obligations.cohort_id, accountability_obligations.halaqa_group_id
  from public.accountability_obligations join affected_students using (student_id)
  union all
  select 'badge_awards', badge_awards.id, badge_awards.student_id, badge_awards.week_start,
         badge_awards.week_start, badge_awards.masjid_id, badge_awards.cohort_id, badge_awards.halaqa_group_id
  from public.badge_awards join affected_students using (student_id)
), classified as (
  select
    activity.*,
    case
      when activity.masjid_id is null and activity.cohort_id is null and activity.halaqa_group_id is null then 'all_scope_null'
      when activity.masjid_id is distinct from params.masjid_id
        or activity.cohort_id is distinct from params.cohort_id
        or activity.halaqa_group_id is null then 'missing_or_cross_scope'
      when activity.halaqa_group_id = params.retained_group_id then 'retained_group_snapshot'
      when activity.halaqa_group_id = params.retired_group_id then 'retired_group_snapshot'
      else 'other_group_snapshot'
    end as snapshot_class,
    case when activity.week_start >= params.effective_date then 'on_or_after_cutover' else 'before_cutover' end as time_class
  from activity
  cross join params
)
select table_name, snapshot_class, time_class, count(*) as row_count,
       count(distinct student_id) as student_count,
       min(week_start) as min_week_start,
       max(week_start) as max_week_start
from classified
group by table_name, snapshot_class, time_class
order by table_name, snapshot_class, time_class;

\echo '=== weekly plan metadata/storage object summary ==='
with params as (
  select
    :'retained_group_id'::uuid as retained_group_id,
    :'retired_group_id'::uuid as retired_group_id,
    :'masjid_id'::uuid as masjid_id,
    :'cohort_id'::uuid as cohort_id
), plans as (
  select weekly_plans.*
  from public.weekly_plans
  join params on weekly_plans.masjid_id = params.masjid_id
             and weekly_plans.cohort_id = params.cohort_id
             and weekly_plans.halaqa_group_id in (params.retained_group_id, params.retired_group_id)
), objects as (
  select plans.id, storage_objects.id as storage_object_id
  from plans
  left join storage.objects storage_objects
    on storage_objects.bucket_id = 'weekly-plans'
   and storage_objects.name = plans.file_path
)
select
  count(*) as weekly_plan_rows,
  count(*) filter (where storage_object_id is not null) as matching_storage_objects,
  count(*) filter (where storage_object_id is null) as missing_storage_objects,
  min(plans.week_start) as min_week_start,
  max(plans.week_start) as max_week_start,
  sum(plans.file_size) as metadata_bytes
from plans
join objects using (id);

\echo '=== historical reporting scope dependencies ==='
select scopes.week_start, scopes.masjid_id, scopes.cohort_id,
       count(distinct memberships.student_id) as placement_count
from private.raw_historical_report_week_scopes() scopes
left join public.student_group_memberships memberships
  on memberships.starts_on <= scopes.week_start
 and (memberships.ends_on is null or memberships.ends_on >= scopes.week_start)
left join public.halaqa_groups groups on groups.id = memberships.group_id
where scopes.masjid_id = :'masjid_id'::uuid
  and scopes.cohort_id = :'cohort_id'::uuid
  and groups.cohort_id = scopes.cohort_id
group by scopes.week_start, scopes.masjid_id, scopes.cohort_id
order by scopes.week_start;

select
  'weekly_incentive_runs' as dependency,
  count(*) as row_count,
  min(week_start) as min_week_start,
  max(week_start) as max_week_start
from public.weekly_incentive_runs
where masjid_id = :'masjid_id'::uuid;

\echo '=== pre-existing audit history ==='
select occurred_at, actor_id, action, target_table, target_id, target_masjid_id,
       metadata->>'source_workflow' as source_workflow,
       metadata->>'request_id' as request_id
from public.super_admin_audit_events
where target_id in (:'retained_group_id'::uuid, :'retired_group_id'::uuid)
   or (target_masjid_id = :'masjid_id'::uuid
       and target_table in ('halaqa_groups', 'student_group_memberships', 'group_teacher_assignments', 'cohort_rotation_settings'))
order by occurred_at, id;

\echo '=== ambiguity and stale-state checks ==='
with params as (
  select
    :'masjid_id'::uuid as masjid_id,
    :'cohort_id'::uuid as cohort_id,
    :'retained_group_id'::uuid as retained_group_id,
    :'retired_group_id'::uuid as retired_group_id,
    :'effective_date'::date as effective_date
), source_students as (
  select distinct memberships.student_id
  from public.student_group_memberships memberships
  join params on memberships.group_id = params.retired_group_id
), source_windows as (
  select memberships.*
  from public.student_group_memberships memberships
  join params on memberships.group_id = params.retired_group_id
), cutover_placements as (
  select source_students.student_id,
         count(memberships.id) as placement_count,
         count(*) filter (where memberships.group_id = params.retired_group_id) as retired_count,
         count(*) filter (where memberships.group_id = params.retained_group_id) as retained_count
  from source_students
  cross join params
  left join public.student_group_memberships memberships
    on memberships.student_id = source_students.student_id
   and memberships.starts_on <= params.effective_date
   and (memberships.ends_on is null or memberships.ends_on >= params.effective_date)
  group by source_students.student_id
), activity as (
  select checkins.student_id, public.week_start_for_date(checkins.date) as week_start, checkins.halaqa_group_id
  from public.checkins join source_students using (student_id)
  union all
  select weekly_plans.student_id, weekly_plans.week_start, weekly_plans.halaqa_group_id
  from public.weekly_plans join source_students using (student_id)
  union all
  select partner_recitations.student_id, partner_recitations.week_start, partner_recitations.halaqa_group_id
  from public.partner_recitations join source_students using (student_id)
  union all
  select halaqa_grades.student_id, halaqa_grades.week_start, halaqa_grades.halaqa_group_id
  from public.halaqa_grades join source_students using (student_id)
  union all
  select accountability_obligations.student_id, accountability_obligations.week_start, accountability_obligations.halaqa_group_id
  from public.accountability_obligations join source_students using (student_id)
  union all
  select badge_awards.student_id, badge_awards.week_start, badge_awards.halaqa_group_id
  from public.badge_awards join source_students using (student_id)
), checks as (
  select 'effective_date_is_sunday' as check_name,
         case when params.effective_date = public.week_start_for_date(params.effective_date) then 'PASS' else 'ABORT' end as status,
         jsonb_build_object('effective_date', params.effective_date) as detail
  from params
  union all
  select 'exactly_two_active_groups_in_cohort',
         case when count(*) filter (where groups.active) = 2
                   and count(*) filter (where groups.id = params.retained_group_id and groups.active) = 1
                   and count(*) filter (where groups.id = params.retired_group_id and groups.active) = 1
              then 'PASS' else 'ABORT' end,
         jsonb_build_object('active_group_count', count(*) filter (where groups.active), 'group_rows', count(*))
  from public.halaqa_groups groups cross join params
  where groups.cohort_id = params.cohort_id
  group by params.retained_group_id, params.retired_group_id
  union all
  select 'source_has_no_future_only_memberships',
         case when count(*) = 0 then 'PASS' else 'ABORT' end,
         jsonb_build_object('future_only_rows', count(*))
  from source_windows cross join params
  where source_windows.starts_on >= params.effective_date
  union all
  select 'source_students_have_one_source_placement_at_cutover',
         case when count(*) filter (where placement_count <> 1 or retired_count <> 1 or retained_count <> 0) = 0
              then 'PASS' else 'ABORT' end,
         jsonb_build_object(
           'source_student_count', count(*),
           'bad_student_count', count(*) filter (where placement_count <> 1 or retired_count <> 1 or retained_count <> 0)
         )
  from cutover_placements
  union all
  select 'retained_group_has_no_cutover_overlap_for_source_students',
         case when count(*) = 0 then 'PASS' else 'ABORT' end,
         jsonb_build_object('overlap_rows', count(*))
  from public.student_group_memberships memberships
  join source_students on source_students.student_id = memberships.student_id
  cross join params
  where memberships.group_id = params.retained_group_id
    and memberships.starts_on <= params.effective_date
    and (memberships.ends_on is null or memberships.ends_on >= params.effective_date)
  union all
  select 'retired_group_has_no_assignment_at_or_after_cutover',
         case when count(*) = 0 then 'PASS' else 'ABORT' end,
         jsonb_build_object('assignment_rows', count(*))
  from public.group_teacher_assignments assignments
  join public.halaqa_groups groups on groups.id = assignments.group_id
  cross join params
  where groups.cohort_id = params.cohort_id
    and assignments.group_id = params.retired_group_id
    and assignments.week_start >= params.effective_date
  union all
  select 'retired_group_has_no_operational_snapshot_at_or_after_cutover',
         case when count(*) = 0 then 'PASS' else 'ABORT' end,
         jsonb_build_object('activity_rows', count(*))
  from activity cross join params
  where activity.halaqa_group_id = params.retired_group_id
    and activity.week_start >= params.effective_date
  union all
  select 'one_active_rotation_setting_with_expected_two_groups',
         case when count(*) = 1 and min(settings.target_group_count) = 2 then 'PASS' else 'ABORT' end,
         jsonb_build_object('active_setting_rows', count(*), 'target_group_counts', coalesce(jsonb_agg(settings.target_group_count order by settings.id), '[]'::jsonb))
  from public.cohort_rotation_settings settings cross join params
  where settings.cohort_id = params.cohort_id and settings.active
  union all
  select 'historical_invalid_teacher_assignment_warning',
         case when count(*) = 0 then 'PASS' else 'WARNING' end,
         jsonb_build_object('historical_assignment_rows_without_saturday_staff_coverage', count(*))
  from public.group_teacher_assignments assignments
  join public.halaqa_groups groups on groups.id = assignments.group_id
  cross join params
  where groups.cohort_id = params.cohort_id
    and assignments.group_id in (params.retained_group_id, params.retired_group_id)
    and assignments.week_start < params.effective_date
    and assignments.active
    and not exists (
      select 1
      from public.masjid_staff_memberships staff
      where staff.profile_id = assignments.teacher_id
        and staff.masjid_id = params.masjid_id
        and staff.staff_role = 'teacher'
        and staff.active
        and staff.starts_on <= public.halaqa_saturday_for_week(assignments.week_start)
        and (staff.ends_on is null or staff.ends_on >= public.halaqa_saturday_for_week(assignments.week_start))
    )
)
select check_name, status, jsonb_pretty(detail) as detail
from checks
order by case status when 'ABORT' then 1 when 'WARNING' then 2 else 3 end, check_name;

\echo '=== canonical before-state digest ==='
with params as (
  select
    :'masjid_id'::uuid as masjid_id,
    :'cohort_id'::uuid as cohort_id,
    :'retained_group_id'::uuid as retained_group_id,
    :'retired_group_id'::uuid as retired_group_id
), target_groups as (
  select groups.*
  from public.halaqa_groups groups
  join params on groups.cohort_id = params.cohort_id
  where groups.id in (params.retained_group_id, params.retired_group_id)
), affected_students as (
  select distinct memberships.student_id
  from public.student_group_memberships memberships
  join params on memberships.group_id in (params.retained_group_id, params.retired_group_id)
), activity as (
  select 'checkins'::text as table_name, checkins.id as row_id, checkins.student_id,
         public.week_start_for_date(checkins.date) as week_start, checkins.date as activity_date,
         checkins.masjid_id, checkins.cohort_id, checkins.halaqa_group_id
  from public.checkins join affected_students using (student_id)
  union all
  select 'weekly_plans', weekly_plans.id, weekly_plans.student_id, weekly_plans.week_start,
         weekly_plans.week_start, weekly_plans.masjid_id, weekly_plans.cohort_id, weekly_plans.halaqa_group_id
  from public.weekly_plans join affected_students using (student_id)
  union all
  select 'partner_recitations', partner_recitations.id, partner_recitations.student_id, partner_recitations.week_start,
         partner_recitations.week_start, partner_recitations.masjid_id, partner_recitations.cohort_id, partner_recitations.halaqa_group_id
  from public.partner_recitations join affected_students using (student_id)
  union all
  select 'halaqa_grades', halaqa_grades.id, halaqa_grades.student_id, halaqa_grades.week_start,
         halaqa_grades.week_start, halaqa_grades.masjid_id, halaqa_grades.cohort_id, halaqa_grades.halaqa_group_id
  from public.halaqa_grades join affected_students using (student_id)
  union all
  select 'accountability_obligations', accountability_obligations.id, accountability_obligations.student_id, accountability_obligations.week_start,
         accountability_obligations.week_start, accountability_obligations.masjid_id, accountability_obligations.cohort_id, accountability_obligations.halaqa_group_id
  from public.accountability_obligations join affected_students using (student_id)
  union all
  select 'badge_awards', badge_awards.id, badge_awards.student_id, badge_awards.week_start,
         badge_awards.week_start, badge_awards.masjid_id, badge_awards.cohort_id, badge_awards.halaqa_group_id
  from public.badge_awards join affected_students using (student_id)
), state as (
  select jsonb_build_object(
    'masjid', (select to_jsonb(masajid) from public.masajid cross join params where masajid.id = params.masjid_id),
    'cohort', (select to_jsonb(cohorts) from public.cohorts cross join params where cohorts.id = params.cohort_id),
    'groups', coalesce((select jsonb_agg(to_jsonb(target_groups) order by target_groups.sort_order, target_groups.id) from target_groups), '[]'::jsonb),
    'rotation_settings', coalesce((select jsonb_agg(to_jsonb(settings) order by settings.active desc, settings.id) from public.cohort_rotation_settings settings cross join params where settings.cohort_id = params.cohort_id), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(to_jsonb(memberships) order by memberships.student_id, memberships.starts_on, memberships.id) from public.student_group_memberships memberships join target_groups on target_groups.id = memberships.group_id), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(to_jsonb(assignments) order by assignments.week_start, assignments.group_id, assignments.id) from public.group_teacher_assignments assignments join target_groups on target_groups.id = assignments.group_id), '[]'::jsonb),
    'profiles', coalesce((select jsonb_agg(to_jsonb(profiles) order by profiles.id) from public.profiles join affected_students on affected_students.student_id = profiles.id), '[]'::jsonb),
    'teacher_staff', coalesce((select jsonb_agg(to_jsonb(staff) order by staff.profile_id, staff.staff_role, staff.starts_on, staff.id) from public.masjid_staff_memberships staff cross join params where staff.masjid_id = params.masjid_id), '[]'::jsonb),
    'activity_scope', coalesce((select jsonb_agg(to_jsonb(activity) order by activity.table_name, activity.row_id) from activity), '[]'::jsonb)
  ) as state
)
select encode(digest(state::text, 'sha256'), 'hex') as before_state_digest,
       jsonb_build_object(
         'target_group_rows', jsonb_array_length(state->'groups'),
         'membership_rows', jsonb_array_length(state->'memberships'),
         'assignment_rows', jsonb_array_length(state->'assignments'),
         'affected_profile_rows', jsonb_array_length(state->'profiles'),
         'activity_scope_rows', jsonb_array_length(state->'activity_scope')
       ) as digest_scope
from state;

COMMIT;
