-- Read-only post-change validation for the women's online cohort consolidation.
-- Required psql variables:
--   masjid_id, cohort_id, retained_group_id, retired_group_id,
--   effective_date, operation_request_id

\set ON_ERROR_STOP on
\pset pager off

\if :{?masjid_id}
\else
  \echo 'Missing masjid_id'
  \quit 3
\endif
\if :{?cohort_id}
\else
  \echo 'Missing cohort_id'
  \quit 3
\endif
\if :{?retained_group_id}
\else
  \echo 'Missing retained_group_id'
  \quit 3
\endif
\if :{?retired_group_id}
\else
  \echo 'Missing retired_group_id'
  \quit 3
\endif
\if :{?effective_date}
\else
  \echo 'Missing effective_date'
  \quit 3
\endif
\if :{?operation_request_id}
\else
  \echo 'Missing operation_request_id'
  \quit 3
\endif

BEGIN READ ONLY;

\echo '=== final invariant checks ==='
with params as (
  select
    :'masjid_id'::uuid as masjid_id,
    :'cohort_id'::uuid as cohort_id,
    :'retained_group_id'::uuid as retained_group_id,
    :'retired_group_id'::uuid as retired_group_id,
    :'effective_date'::date as effective_date,
    :'operation_request_id'::uuid as operation_request_id
), affected_students as (
  select distinct memberships.student_id
  from public.student_group_memberships memberships
  join params on memberships.group_id in (params.retained_group_id, params.retired_group_id)
), effective_placements as (
  select memberships.student_id,
         count(*) as placement_count,
         count(*) filter (where memberships.group_id = params.retained_group_id) as retained_count,
         count(*) filter (where memberships.group_id = params.retired_group_id) as retired_count
  from public.student_group_memberships memberships
  join affected_students affected on affected.student_id = memberships.student_id
  cross join params
  where memberships.starts_on <= params.effective_date
    and (memberships.ends_on is null or memberships.ends_on >= params.effective_date)
  group by memberships.student_id
), checks as (
  select 'masjid_and_cohort_active' as check_name,
         case when exists (select 1 from public.masajid m cross join params where m.id=params.masjid_id and m.active)
                 and exists (select 1 from public.cohorts c cross join params where c.id=params.cohort_id and c.masjid_id=params.masjid_id and c.active)
              then 'PASS' else 'FAIL' end as status,
         null::jsonb as detail
  union all
  select 'exactly_one_active_group',
         case when (select count(*) from public.halaqa_groups g cross join params where g.cohort_id=params.cohort_id and g.active)=1
                 and exists (select 1 from public.halaqa_groups g cross join params where g.id=params.retained_group_id and g.active)
                 and exists (select 1 from public.halaqa_groups g cross join params where g.id=params.retired_group_id and not g.active)
              then 'PASS' else 'FAIL' end,
         (select jsonb_agg(to_jsonb(g) order by g.sort_order,g.id) from public.halaqa_groups g cross join params where g.cohort_id=params.cohort_id)
  union all
  select 'one_retained_placement_per_affected_student',
         case when count(*) filter (where placement_count <> 1 or retained_count <> 1 or retired_count <> 0)=0
                   and count(*) = (select count(*) from affected_students)
              then 'PASS' else 'FAIL' end,
         jsonb_build_object('affected_students', (select count(*) from affected_students), 'placements', count(*))
  from effective_placements
  union all
  select 'no_retired_current_or_future_membership',
         case when not exists (
           select 1 from public.student_group_memberships memberships cross join params
           where memberships.group_id=params.retired_group_id
             and (memberships.ends_on is null or memberships.ends_on >= params.effective_date)
         ) then 'PASS' else 'FAIL' end,
         null::jsonb
  union all
  select 'rotation_target_group_count_one',
         case when (select count(*) from public.cohort_rotation_settings settings cross join params where settings.cohort_id=params.cohort_id and settings.active)=1
                   and exists (select 1 from public.cohort_rotation_settings settings cross join params where settings.cohort_id=params.cohort_id and settings.active and settings.target_group_count=1)
              then 'PASS' else 'FAIL' end,
         null::jsonb
  union all
  select 'no_retired_current_or_future_assignment',
         case when not exists (select 1 from public.group_teacher_assignments assignments cross join params where assignments.group_id=params.retired_group_id and assignments.week_start >= public.week_start_for_date(params.effective_date))
              then 'PASS' else 'FAIL' end,
         null::jsonb
  union all
  select 'operation_audit_event_present',
         case when exists (select 1 from public.super_admin_audit_events events cross join params where events.action='womens_online_cohort_consolidated' and events.metadata->>'request_id'=params.operation_request_id::text and events.target_id=params.cohort_id and events.target_masjid_id=params.masjid_id)
              then 'PASS' else 'FAIL' end,
         null::jsonb
  union all
  select 'operation_declared_no_activity_or_assignment_mutation',
         case when exists (
           select 1 from public.super_admin_audit_events events cross join params
           where events.action='womens_online_cohort_consolidated'
             and events.metadata->>'request_id'=params.operation_request_id::text
             and events.metadata->>'operational_rows_mutated'='false'
             and events.metadata->>'teacher_assignments_mutated'='false'
         ) then 'PASS' else 'FAIL' end,
         null::jsonb
)
select check_name, status, jsonb_pretty(detail) as detail
from checks
order by case status when 'FAIL' then 1 else 2 end, check_name;

\echo '=== affected operational snapshots after cutover ==='
with params as (
  select :'retired_group_id'::uuid as retired_group_id, :'effective_date'::date as effective_date
), affected_students as (
  select distinct memberships.student_id
  from public.student_group_memberships memberships
  join params on memberships.group_id = params.retired_group_id
  union
  select distinct memberships.student_id
  from public.student_group_memberships memberships
  where memberships.group_id = :'retained_group_id'::uuid
), activity as (
  select 'checkins'::text as table_name, checkins.student_id, public.week_start_for_date(checkins.date) as week_start, checkins.halaqa_group_id
  from public.checkins join affected_students using (student_id)
  union all
  select 'weekly_plans', plans.student_id, plans.week_start, plans.halaqa_group_id
  from public.weekly_plans plans join affected_students using (student_id)
  union all
  select 'partner_recitations', recitations.student_id, recitations.week_start, recitations.halaqa_group_id
  from public.partner_recitations recitations join affected_students using (student_id)
  union all
  select 'halaqa_grades', grades.student_id, grades.week_start, grades.halaqa_group_id
  from public.halaqa_grades grades join affected_students using (student_id)
  union all
  select 'accountability_obligations', obligations.student_id, obligations.week_start, obligations.halaqa_group_id
  from public.accountability_obligations obligations join affected_students using (student_id)
  union all
  select 'badge_awards', awards.student_id, awards.week_start, awards.halaqa_group_id
  from public.badge_awards awards join affected_students using (student_id)
)
select table_name, count(*) as retired_group_rows_after_cutover
from activity cross join params
where activity.halaqa_group_id = params.retired_group_id
  and activity.week_start >= params.effective_date
group by table_name
order by table_name;

\echo '=== weekly plan object presence ==='
select count(*) as plan_rows,
       count(storage_objects.id) as matching_storage_objects,
       count(*) - count(storage_objects.id) as missing_storage_objects
from public.weekly_plans plans
left join storage.objects storage_objects
  on storage_objects.bucket_id = 'weekly-plans'
 and storage_objects.name = plans.file_path
where plans.masjid_id = :'masjid_id'::uuid
  and plans.cohort_id = :'cohort_id'::uuid
  and plans.halaqa_group_id in (:'retained_group_id'::uuid, :'retired_group_id'::uuid);

COMMIT;
