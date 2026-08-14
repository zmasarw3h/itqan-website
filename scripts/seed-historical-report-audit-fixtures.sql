-- Disposable local-only corruption fixture for proving the read-only audit.
-- The upgrade harness runs this after RLS tests and never against production.
begin;

alter table public.checkins disable trigger user;
alter table public.partner_recitations disable trigger user;
alter table public.halaqa_grades disable trigger user;
alter table public.accountability_obligations disable trigger user;

do $$
declare
  wrong_group_id uuid;
  wrong_cohort_id uuid;
  wrong_masjid_id uuid;
  target_student_id uuid;
  target_checkin_id uuid;
  target_partner_id uuid;
  target_grade_id uuid;
begin
  select groups.id, cohorts.id, cohorts.masjid_id
  into wrong_group_id, wrong_cohort_id, wrong_masjid_id
  from public.halaqa_groups groups
  join public.cohorts on cohorts.id = groups.cohort_id
  where groups.name = 'B Group'
  order by groups.id
  limit 1;

  -- Corrupt one stable, eligible student/week across all three score-bearing
  -- tables. The contribution and cap checks make the audit's score-delta
  -- assertion independent of random UUID ordering in the broader RLS fixture.
  select candidate.student_id,
         candidate.checkin_id,
         candidate.partner_id,
         candidate.grade_id
  into target_student_id, target_checkin_id, target_partner_id, target_grade_id
  from (
    select checkins.student_id,
           public.week_start_for_date(checkins.date) as week_start,
           checkins.date as activity_date,
           checkins.id as checkin_id,
           partner_recitations.id as partner_id,
           partner_recitations.round as partner_round,
           partner_recitations.points as partner_points,
           halaqa_grades.id as grade_id
    from public.checkins
    join public.profiles
      on profiles.id = checkins.student_id
    join public.partner_recitations
      on partner_recitations.student_id = checkins.student_id
     and partner_recitations.week_start = public.week_start_for_date(checkins.date)
    join public.halaqa_grades
      on halaqa_grades.student_id = checkins.student_id
     and halaqa_grades.week_start = public.week_start_for_date(checkins.date)
    where profiles.email = 'studenta@rls.local'
      and profiles.role = 'student'
      and profiles.score_starts_on is not null
      and profiles.score_starts_on <= public.week_start_for_date(checkins.date)
      and checkins.daily_score > 0
      and partner_recitations.points > 0
      and coalesce(halaqa_grades.attendance_points, 0)
        + coalesce(halaqa_grades.recitation_points, 0) > 0
      and checkins.masjid_id is distinct from wrong_masjid_id
      and partner_recitations.masjid_id is distinct from wrong_masjid_id
      and halaqa_grades.masjid_id is distinct from wrong_masjid_id
      and private.raw_historical_scope_matches(
        checkins.student_id,
        public.week_start_for_date(checkins.date),
        checkins.masjid_id,
        checkins.cohort_id,
        checkins.halaqa_group_id
      )
      and private.raw_historical_scope_matches(
        partner_recitations.student_id,
        partner_recitations.week_start,
        partner_recitations.masjid_id,
        partner_recitations.cohort_id,
        partner_recitations.halaqa_group_id
      )
      and private.raw_historical_scope_matches(
        halaqa_grades.student_id,
        halaqa_grades.week_start,
        halaqa_grades.masjid_id,
        halaqa_grades.cohort_id,
        halaqa_grades.halaqa_group_id
      )
      and (
        select coalesce(sum(existing.daily_score), 0) - checkins.daily_score
        from public.checkins as existing
        where existing.student_id = checkins.student_id
          and existing.date between public.week_start_for_date(checkins.date)
            and public.week_start_for_date(checkins.date) + 6
      ) < 700
      and (
        select coalesce(sum(existing.points), 0) - partner_recitations.points
        from public.partner_recitations as existing
        where existing.student_id = partner_recitations.student_id
          and existing.week_start = partner_recitations.week_start
      ) < 150
      and not exists (
        select 1
        from public.checkins as existing
        where existing.student_id = checkins.student_id
          and existing.date between public.week_start_for_date(checkins.date)
            and public.week_start_for_date(checkins.date) + 6
          and not private.raw_historical_report_activity_is_attributable(
            existing.student_id,
            public.week_start_for_date(existing.date),
            existing.masjid_id,
            existing.cohort_id,
            existing.halaqa_group_id
          )
      )
      and not exists (
        select 1
        from public.partner_recitations as existing
        where existing.student_id = partner_recitations.student_id
          and existing.week_start = partner_recitations.week_start
          and not private.raw_historical_report_activity_is_attributable(
            existing.student_id,
            existing.week_start,
            existing.masjid_id,
            existing.cohort_id,
            existing.halaqa_group_id
          )
      )
      and not exists (
        select 1
        from public.halaqa_grades as existing
        where existing.student_id = halaqa_grades.student_id
          and existing.week_start = halaqa_grades.week_start
          and not private.raw_historical_report_activity_is_attributable(
            existing.student_id,
            existing.week_start,
            existing.masjid_id,
            existing.cohort_id,
            existing.halaqa_group_id
          )
      )
  ) as candidate
  order by candidate.week_start desc,
           candidate.activity_date desc,
           candidate.partner_round,
           candidate.partner_points desc,
           candidate.checkin_id,
           candidate.partner_id,
           candidate.grade_id
  limit 1;

  if target_student_id is null then
    raise exception 'historical attribution fixture could not find a positive, uncapped, exact-scope student-week candidate';
  end if;

  update public.checkins
  set masjid_id = wrong_masjid_id,
      cohort_id = wrong_cohort_id,
      halaqa_group_id = wrong_group_id
  where id = target_checkin_id;

  update public.partner_recitations
  set masjid_id = wrong_masjid_id,
      cohort_id = wrong_cohort_id,
      halaqa_group_id = wrong_group_id
  where id = target_partner_id;

  update public.halaqa_grades
  set masjid_id = wrong_masjid_id,
      cohort_id = wrong_cohort_id,
      halaqa_group_id = wrong_group_id
  where id = target_grade_id;

  update public.accountability_obligations
  set masjid_id = wrong_masjid_id,
      cohort_id = wrong_cohort_id,
      halaqa_group_id = wrong_group_id
  where id = (
    select id
    from public.accountability_obligations
    where status in ('attested_paid', 'waived')
      and masjid_id is distinct from wrong_masjid_id
    order by id
    limit 1
  );
end;
$$;

alter table public.checkins enable trigger user;
alter table public.partner_recitations enable trigger user;
alter table public.halaqa_grades enable trigger user;
alter table public.accountability_obligations enable trigger user;

commit;
