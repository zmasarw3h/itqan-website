-- Phase 0 security foundation for future super-admin operations.
-- This migration is intentionally additive except for tightening unsafe broad
-- write policies created by the earlier multi-masjid foundation.

create table if not exists public.super_admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  target_table text,
  target_id uuid,
  target_masjid_id uuid references public.masajid(id),
  before_data jsonb,
  after_data jsonb,
  metadata jsonb
);

alter table public.super_admin_audit_events enable row level security;

revoke all on table public.super_admin_audit_events from anon, authenticated;
grant select on table public.super_admin_audit_events to authenticated;
grant select, insert on table public.super_admin_audit_events to service_role;

create policy "Active super admins can read audit events"
  on public.super_admin_audit_events
  for select
  to authenticated
  using ((select public.is_active_super_admin()));

create index if not exists super_admin_audit_events_occurred_at_idx
  on public.super_admin_audit_events(occurred_at desc);

create index if not exists super_admin_audit_events_actor_id_idx
  on public.super_admin_audit_events(actor_id);

create index if not exists super_admin_audit_events_target_masjid_id_idx
  on public.super_admin_audit_events(target_masjid_id);

-- Normal admins keep existing scoped app capabilities, but direct Data API
-- profile role/active mutations are super-admin only.
alter policy "Admins can update profiles"
  on public.profiles
  to authenticated
  using ((select public.is_active_super_admin()))
  with check ((select public.is_active_super_admin()));

alter policy "Admins can insert profiles"
  on public.profiles
  to authenticated
  with check ((select public.is_active_super_admin()));

-- Foundation records are setup-level objects. Existing admin flows that need
-- these writes use server-side scoped checks and service-role paths.
alter policy "Admins can manage masajid foundation data"
  on public.masajid
  to authenticated
  using ((select public.is_active_super_admin()))
  with check ((select public.is_active_super_admin()));

alter policy "Admins can manage cohort foundation data"
  on public.cohorts
  to authenticated
  using ((select public.is_active_super_admin()))
  with check ((select public.is_active_super_admin()));

alter policy "Admins can manage halaqa group foundation data"
  on public.halaqa_groups
  to authenticated
  using ((select public.is_active_super_admin()))
  with check ((select public.is_active_super_admin()));

-- Student membership writes are limited to the signed-in admin's masjid.
alter policy "Admins can manage student group memberships"
  on public.student_group_memberships
  to authenticated
  using (
    (select public.is_active_super_admin())
    or public.is_admin_for_masjid(public.group_masjid_id(group_id))
  )
  with check (
    (select public.is_active_super_admin())
    or public.is_admin_for_masjid(public.group_masjid_id(group_id))
  );

-- Normal admins may manage teacher staff rows only for masajid they administer.
-- Admin grants and super-admin staff changes are reserved for super admins.
alter policy "Admins can manage staff memberships"
  on public.masjid_staff_memberships
  to authenticated
  using (
    (select public.is_active_super_admin())
    or (
      staff_role = 'teacher'
      and public.is_admin_for_masjid(masjid_id)
    )
  )
  with check (
    (select public.is_active_super_admin())
    or (
      staff_role = 'teacher'
      and public.is_admin_for_masjid(masjid_id)
    )
  );

alter policy "Admins can manage group teacher assignments"
  on public.group_teacher_assignments
  to authenticated
  using (
    (select public.is_active_super_admin())
    or public.is_admin_for_masjid(public.group_masjid_id(group_id))
  )
  with check (
    (select public.is_active_super_admin())
    or public.is_admin_for_masjid(public.group_masjid_id(group_id))
  );
