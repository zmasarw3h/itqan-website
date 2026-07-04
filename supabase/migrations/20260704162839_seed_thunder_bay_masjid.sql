-- Seed Thunder Bay Masjid with an initial brothers cohort and default group.
-- Staff/admin memberships are intentionally not assigned here.

insert into public.masajid (name, slug, active)
values ('Thunder Bay Masjid', 'thunder-bay', true)
on conflict (slug) do update
set name = excluded.name,
    active = excluded.active,
    updated_at = now();

insert into public.cohorts (masjid_id, kind, name, active, sort_order)
select masajid.id, 'brothers', 'Brothers', true, 10
from public.masajid
where masajid.slug = 'thunder-bay'
on conflict do nothing;

insert into public.halaqa_groups (cohort_id, name, active, sort_order)
select cohorts.id, 'Thunder Bay Brothers Default Group', true, 10
from public.cohorts
join public.masajid on masajid.id = cohorts.masjid_id
where masajid.slug = 'thunder-bay'
  and cohorts.kind = 'brothers'
  and cohorts.active = true
on conflict do nothing;
