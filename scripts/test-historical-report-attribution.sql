-- Disposable-only parity checks for exact integrity versus report attribution.
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;

insert into public.masajid (id, name, slug, active) values
  ('10000000-0000-0000-0000-000000000001', 'Attribution A', 'attribution-a', true),
  ('10000000-0000-0000-0000-000000000002', 'Attribution B', 'attribution-b', true);
insert into public.cohorts (id, masjid_id, kind, name, active, sort_order) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'brothers', 'A1', true, 1),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'sisters', 'A2', true, 2),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'brothers', 'B1', true, 1);
insert into public.halaqa_groups (id, cohort_id, name, active, sort_order) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'A exact', true, 1),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'A group mismatch', true, 2),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'A cohort mismatch', true, 1),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', 'B cross masjid', true, 1);
insert into public.profiles (id, name, email, role, active, score_starts_on) values
  ('40000000-0000-0000-0000-000000000001', 'Attribution Student', 'attribution@local.invalid', 'student', true, '2026-06-07'),
  ('40000000-0000-0000-0000-000000000002', 'No Membership', 'no-membership@local.invalid', 'student', true, '2026-06-07'),
  ('40000000-0000-0000-0000-000000000003', 'Not Scoring Yet', 'not-scoring@local.invalid', 'student', true, '2026-06-14'),
  ('40000000-0000-0000-0000-000000000004', 'Scope Evidence Student', 'scope-evidence@local.invalid', 'student', true, '2026-06-07'),
  ('40000000-0000-0000-0000-000000000008', 'Attribution Admin', 'attribution-admin@local.invalid', 'admin', true, null),
  ('40000000-0000-0000-0000-000000000009', 'Attribution Teacher', 'attribution-teacher@local.invalid', 'teacher', true, null),
  ('40000000-0000-0000-0000-000000000010', 'Attribution Super Admin', 'attribution-super@local.invalid', 'super_admin', true, null);
insert into public.masjid_staff_memberships
  (profile_id, masjid_id, staff_role, active, starts_on)
values
  ('40000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'admin', true, '1900-01-01'),
  ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'teacher', true, '1900-01-01');
insert into public.student_group_memberships (id, student_id, group_id, starts_on, ends_on) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '1900-01-01', '2026-06-13'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', '1900-01-01', '2026-06-13'),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', '1900-01-01', '2026-06-13');

insert into public.checkins
  (id, student_id, date, completed, earned_weight, total_weight, daily_score, masjid_id, cohort_id, halaqa_group_id)
values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '2026-06-07', true, 100, 100, 100, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '2026-06-08', true, 100, 100, 100, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '2026-06-09', true, 100, 100, 100, null, null, null),
  ('60000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', '2026-06-10', true, 100, 100, 100, '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000004'),
  ('60000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000004', '2026-06-07', true, 100, 100, 100, null, '20000000-0000-0000-0000-000000000003', null),
  ('60000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000004', '2026-06-08', true, 100, 100, 100, null, null, '30000000-0000-0000-0000-000000000004'),
  ('60000000-0000-0000-0000-000000000013', '40000000-0000-0000-0000-000000000004', '2026-06-09', true, 100, 100, 100, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000014', '40000000-0000-0000-0000-000000000004', '2026-06-10', true, 100, 100, 100, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004'),
  ('60000000-0000-0000-0000-000000000015', '40000000-0000-0000-0000-000000000004', '2026-06-11', true, 100, 100, 100, null, '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000016', '40000000-0000-0000-0000-000000000004', '2026-06-12', true, 100, 100, 100, null, '20000000-0000-0000-0000-000000000001', null),
  ('60000000-0000-0000-0000-000000000017', '40000000-0000-0000-0000-000000000004', '2026-06-13', true, 100, 100, 100, null, null, '30000000-0000-0000-0000-000000000001');
insert into public.partner_recitations
  (id, student_id, week_start, round, points, masjid_id, cohort_id, halaqa_group_id)
values
  ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '2026-06-07', 'round_1', 75, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003'),
  ('70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '2026-06-07', 'round_2', 75, null, null, null);
insert into public.halaqa_grades
  (id, student_id, week_start, attended, attendance_points, recitation_points, masjid_id, cohort_id, halaqa_group_id)
values
  ('80000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '2026-06-07', true, 100, 50, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002');

do $$
begin
  if not private.raw_historical_scope_matches('40000000-0000-0000-0000-000000000001', '2026-06-07',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001') then
    raise exception 'exact historical scope was rejected';
  end if;
  if private.raw_historical_scope_matches('40000000-0000-0000-0000-000000000001', '2026-06-07',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002') then
    raise exception 'group mismatch passed exact integrity';
  end if;
  if not private.raw_historical_report_activity_is_attributable('40000000-0000-0000-0000-000000000001', '2026-06-07',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002') then
    raise exception 'same-masjid group mismatch was not attributed';
  end if;
  if not private.raw_historical_report_activity_is_attributable('40000000-0000-0000-0000-000000000001', '2026-06-07',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003') then
    raise exception 'same-masjid cohort mismatch was not attributed';
  end if;
  if private.raw_historical_report_activity_is_attributable('40000000-0000-0000-0000-000000000001', '2026-06-07',
      '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000004') then
    raise exception 'cross-masjid activity was attributed';
  end if;
  if not private.raw_historical_report_activity_is_attributable('40000000-0000-0000-0000-000000000001', '2026-06-07', null, null, null) then
    raise exception 'unambiguous legacy null-masjid activity was not attributed';
  end if;
  if private.raw_historical_report_activity_disposition('40000000-0000-0000-0000-000000000001', '2026-06-07', null, null, null)
      <> 'counted_legacy_missing_masjid_by_unambiguous_membership' then
    raise exception 'all-null legacy scope received the wrong disposition';
  end if;
  if private.raw_historical_report_activity_disposition('40000000-0000-0000-0000-000000000001', '2026-06-07', null,
      '20000000-0000-0000-0000-000000000002', null)
      <> 'counted_legacy_missing_masjid_by_unambiguous_membership' then
    raise exception 'null masjid with same-masjid cohort was not attributed';
  end if;
  if private.raw_historical_report_activity_disposition('40000000-0000-0000-0000-000000000001', '2026-06-07', null, null,
      '30000000-0000-0000-0000-000000000003')
      <> 'counted_legacy_missing_masjid_by_unambiguous_membership' then
    raise exception 'null masjid with same-masjid group was not attributed';
  end if;
  if private.raw_historical_report_activity_disposition('40000000-0000-0000-0000-000000000001', '2026-06-07', null,
      '20000000-0000-0000-0000-000000000003', null) <> 'excluded_cross_masjid_cohort' then
    raise exception 'null masjid with cross-masjid cohort was attributed';
  end if;
  if private.raw_historical_report_activity_disposition('40000000-0000-0000-0000-000000000001', '2026-06-07', null, null,
      '30000000-0000-0000-0000-000000000004') <> 'excluded_cross_masjid_group' then
    raise exception 'null masjid with cross-masjid group was attributed';
  end if;
  if private.raw_historical_report_activity_disposition('40000000-0000-0000-0000-000000000001', '2026-06-07',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', null)
      <> 'excluded_cross_masjid_cohort' then
    raise exception 'matching masjid with cross-masjid cohort was attributed';
  end if;
  if private.raw_historical_report_activity_disposition('40000000-0000-0000-0000-000000000001', '2026-06-07',
      '10000000-0000-0000-0000-000000000001', null, '30000000-0000-0000-0000-000000000004')
      <> 'excluded_cross_masjid_group' then
    raise exception 'matching masjid with cross-masjid group was attributed';
  end if;
  if private.raw_historical_report_activity_disposition('40000000-0000-0000-0000-000000000001', '2026-06-07', null,
      '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001')
      <> 'excluded_conflicting_stored_scope' then
    raise exception 'cohort/group masjid conflict was not excluded';
  end if;
  if private.raw_historical_report_activity_disposition('40000000-0000-0000-0000-000000000001', '2026-06-07',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001') <> 'counted_exact_scope' then
    raise exception 'exact scope received the wrong disposition';
  end if;
  if private.raw_historical_report_activity_disposition('40000000-0000-0000-0000-000000000001', '2026-06-07',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000003') <> 'counted_same_masjid_placement_mismatch' then
    raise exception 'ordinary same-masjid placement mismatch was not attributed';
  end if;
  if private.raw_historical_report_activity_is_attributable('40000000-0000-0000-0000-000000000002', '2026-06-07', null, null, null) then
    raise exception 'no-membership activity was attributed';
  end if;
  if private.raw_historical_report_activity_is_attributable('40000000-0000-0000-0000-000000000001', '2026-06-14', null, null, null) then
    raise exception 'different tracker week activity was attributed';
  end if;
  if private.raw_historical_report_activity_is_attributable('40000000-0000-0000-0000-000000000002', '2026-06-07',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001') then
    raise exception 'different student activity was attributed';
  end if;
  if private.raw_historical_weekly_percentage('40000000-0000-0000-0000-000000000001', '2026-06-07') <> 60 then
    raise exception 'revised attribution score did not count exact, same-masjid, and legacy activity';
  end if;
  if private.raw_historical_weekly_percentage('40000000-0000-0000-0000-000000000003', '2026-06-07') is not null then
    raise exception 'pre-score-start week produced a score';
  end if;
end;
$$;

-- A pre-existing malformed same-masjid grade remains report-attributable, but
-- current writes may not normalize or otherwise edit it through UPDATE/UPSERT.
set local session_replication_role = origin;
do $$
begin
  update public.halaqa_grades
  set attendance_points = 90
  where id = '80000000-0000-0000-0000-000000000001';
  raise exception 'existing malformed grade update unexpectedly succeeded';
exception
  when check_violation then null;
end;
$$;
do $$
begin
  insert into public.halaqa_grades
    (id, student_id, week_start, attended, attendance_points, recitation_points)
  values
    ('80000000-0000-0000-0000-000000000099',
     '40000000-0000-0000-0000-000000000001', '2026-06-07', true, 90, 50)
  on conflict (student_id, week_start) do update
  set attendance_points = excluded.attendance_points;
  raise exception 'existing malformed grade upsert unexpectedly succeeded';
exception
  when check_violation then null;
end;
$$;
set local session_replication_role = replica;

-- Direct-role checks cover the SECURITY DEFINER projection, not only its
-- private attribution predicate. It must recover legacy null-scope rows for a
-- currently scoped admin without disclosing explicit cross-masjid activity.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-0000-0000-000000000008","role":"authenticated"}',
  true
);
do $$
declare
  projected_count integer;
  legacy_count integer;
  cross_masjid_count integer;
begin
  select count(*),
         count(*) filter (where masjid_id is null),
         count(*) filter (where row_id in (
           '60000000-0000-0000-0000-000000000004',
           '60000000-0000-0000-0000-000000000011',
           '60000000-0000-0000-0000-000000000012',
           '60000000-0000-0000-0000-000000000013',
           '60000000-0000-0000-0000-000000000014',
           '60000000-0000-0000-0000-000000000015'
         ))
  into projected_count, legacy_count, cross_masjid_count
  from public.historical_reporting_activity_for_weeks(array['2026-06-07'::date]);

  if projected_count <> 8 then
    raise exception 'scoped admin received % attributable rows instead of 8', projected_count;
  end if;
  if legacy_count <> 4 then
    raise exception 'scoped admin did not receive all attributable legacy null-masjid rows';
  end if;
  if cross_masjid_count <> 0 then
    raise exception 'scoped admin received explicit cross-masjid report activity';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-0000-0000-000000000010","role":"authenticated"}',
  true
);
do $$
declare
  projected_count integer;
  cross_masjid_count integer;
begin
  select count(*),
         count(*) filter (where row_id in (
           '60000000-0000-0000-0000-000000000004',
           '60000000-0000-0000-0000-000000000011',
           '60000000-0000-0000-0000-000000000012',
           '60000000-0000-0000-0000-000000000013',
           '60000000-0000-0000-0000-000000000014',
           '60000000-0000-0000-0000-000000000015'
         ))
  into projected_count, cross_masjid_count
  from public.historical_reporting_activity_for_weeks(array['2026-06-07'::date]);

  if projected_count <> 8 or cross_masjid_count <> 0 then
    raise exception 'super-admin report projection bypassed attribution rules';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
do $$
declare
  projected_count integer;
  cross_masjid_count integer;
begin
  select count(*), count(*) filter (where row_id in (
    '60000000-0000-0000-0000-000000000004',
    '60000000-0000-0000-0000-000000000011',
    '60000000-0000-0000-0000-000000000012',
    '60000000-0000-0000-0000-000000000013',
    '60000000-0000-0000-0000-000000000014',
    '60000000-0000-0000-0000-000000000015'
  ))
  into projected_count, cross_masjid_count
  from public.historical_reporting_activity_for_weeks(array['2026-06-07'::date]);

  if projected_count <> 6 or cross_masjid_count <> 0 then
    raise exception 'student report projection exposed cross-masjid activity';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-0000-0000-000000000009","role":"authenticated"}',
  true
);
do $$
begin
  perform *
  from public.historical_reporting_activity_for_weeks(array['2026-06-07'::date]);
  raise exception 'unrelated teacher executed historical report activity RPC';
exception
  when insufficient_privilege then null;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-0000-0000-000000000008","role":"authenticated"}',
  true
);
do $$
declare
  dashboard jsonb;
  dashboard_row jsonb;
  workspace_weeks date[];
begin
  select public.admin_dashboard_leaderboard_for_week('2026-06-07'::date, false)
  into dashboard;
  if jsonb_array_length(dashboard -> 'rows') <> 2 then
    raise exception 'bounded admin dashboard returned an unexpected scoped population: %', dashboard;
  end if;

  select row
  into dashboard_row
  from jsonb_array_elements(dashboard -> 'rows') as row
  where row ->> 'student_id' = '40000000-0000-0000-0000-000000000001';
  if dashboard_row is null
    or dashboard_row ->> 'student_id' <> '40000000-0000-0000-0000-000000000001'
    or dashboard_row ->> 'masjid_name' <> 'Attribution A'
    or (dashboard_row ->> 'daily_points')::numeric <> 300
    or (dashboard_row ->> 'partner_points')::numeric <> 150
    or (dashboard_row ->> 'halaqa_points')::numeric <> 150
    or (dashboard_row ->> 'total_points')::numeric <> 600
    or (dashboard_row ->> 'percentage')::numeric <> 60
    or dashboard_row ->> 'below70_streak' <> '1' then
    raise exception 'bounded dashboard aggregation changed attribution, score, streak, or contact semantics: %', dashboard_row;
  end if;

  select public.admin_student_available_week_starts(
    '40000000-0000-0000-0000-000000000001'::uuid,
    '2026-06-07'::date
  )
  into workspace_weeks;
  if not ('2026-06-07'::date = any(workspace_weeks)) then
    raise exception 'bounded student workspace week contract omitted the evidence week: %', workspace_weeks;
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"40000000-0000-0000-0000-000000000009","role":"authenticated"}',
  true
);
do $$
begin
  perform public.admin_dashboard_available_weeks();
  raise exception 'unrelated teacher executed admin dashboard week RPC';
exception
  when insufficient_privilege then null;
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform *
  from public.historical_reporting_activity_for_weeks(array['2026-06-07'::date]);
  raise exception 'anonymous caller executed historical report activity RPC';
exception
  when insufficient_privilege then null;
end;
$$;
reset role;

alter table public.student_group_memberships drop constraint student_group_memberships_no_overlap;
insert into public.student_group_memberships (id, student_id, group_id, starts_on) values
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '2026-06-07');
do $$
begin
  if private.raw_historical_report_activity_is_attributable('40000000-0000-0000-0000-000000000001', '2026-06-07', null, null, null) then
    raise exception 'ambiguous membership attributed activity';
  end if;
  if private.raw_historical_scope_matches('40000000-0000-0000-0000-000000000001', '2026-06-07',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001') then
    raise exception 'ambiguous membership passed exact integrity';
  end if;
end;
$$;

rollback;
select 'Historical report attribution SQL parity checks passed.' as result;
