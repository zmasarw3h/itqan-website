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
begin
  select groups.id, cohorts.id, cohorts.masjid_id
  into wrong_group_id, wrong_cohort_id, wrong_masjid_id
  from public.halaqa_groups groups
  join public.cohorts on cohorts.id = groups.cohort_id
  where groups.name = 'B Group'
  order by groups.id
  limit 1;

  update public.checkins
  set masjid_id = wrong_masjid_id,
      cohort_id = wrong_cohort_id,
      halaqa_group_id = wrong_group_id
  where id = (
    select id from public.checkins
    where masjid_id is distinct from wrong_masjid_id
    order by id limit 1
  );

  update public.partner_recitations
  set masjid_id = wrong_masjid_id,
      cohort_id = wrong_cohort_id,
      halaqa_group_id = wrong_group_id
  where id = (
    select id from public.partner_recitations
    where masjid_id is distinct from wrong_masjid_id
    order by id limit 1
  );

  update public.halaqa_grades
  set masjid_id = wrong_masjid_id,
      cohort_id = wrong_cohort_id,
      halaqa_group_id = wrong_group_id
  where id = (
    select id from public.halaqa_grades
    where masjid_id is distinct from wrong_masjid_id
    order by id limit 1
  );

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
