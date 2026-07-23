create table public.super_admin_guided_change_reviews (
  request_id uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_profile_id uuid not null references public.profiles(id) on delete restrict,
  operation text not null check (
    operation in ('add_teacher', 'add_admin', 'add_admin_teacher', 'assign_student', 'deactivate_account')
  ),
  starts_on date not null,
  masjid_id uuid references public.masajid(id) on delete restrict,
  group_id uuid references public.halaqa_groups(id) on delete restrict,
  expected_state jsonb not null,
  review_payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  constraint super_admin_guided_change_reviews_scope_check check (
    (operation in ('add_teacher', 'add_admin', 'add_admin_teacher') and masjid_id is not null and group_id is null)
    or (operation = 'assign_student' and masjid_id is not null and group_id is not null)
    or (operation = 'deactivate_account' and masjid_id is null and group_id is null)
  )
);

create index super_admin_guided_change_reviews_actor_created_idx
  on public.super_admin_guided_change_reviews(actor_id, created_at desc);

create index super_admin_guided_change_reviews_expires_idx
  on public.super_admin_guided_change_reviews(expires_at);

alter table public.super_admin_guided_change_reviews enable row level security;

revoke all on table public.super_admin_guided_change_reviews from anon, authenticated;
grant select, insert, delete on table public.super_admin_guided_change_reviews to service_role;

comment on table public.super_admin_guided_change_reviews is
  'Short-lived, service-only intents that bind a Guided Change review to the exact mutation submitted.';
