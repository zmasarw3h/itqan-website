-- Add weekly incentive records for completed weekly scores.
-- Accountability obligations are self-attested only; no payment processing is added.

create table if not exists public.weekly_incentive_runs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  processed_at timestamptz not null default now(),
  processed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.accountability_obligations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  weekly_percentage numeric not null,
  amount_cents integer not null,
  status text not null default 'pending' check (status in ('pending', 'attested_paid', 'waived')),
  attested_paid_at timestamptz,
  waived_at timestamptz,
  waived_by uuid references public.profiles(id),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint accountability_obligations_student_week_unique unique (student_id, week_start),
  constraint accountability_obligations_amount_check check (amount_cents >= 0),
  constraint accountability_obligations_percentage_check check (
    weekly_percentage >= 0
    and weekly_percentage <= 100
  )
);

create table if not exists public.badge_awards (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  weekly_percentage numeric not null,
  badges_awarded integer not null,
  created_at timestamptz not null default now(),
  constraint badge_awards_student_week_unique unique (student_id, week_start),
  constraint badge_awards_count_check check (badges_awarded >= 0),
  constraint badge_awards_percentage_check check (
    weekly_percentage >= 0
    and weekly_percentage <= 100
  )
);

alter table public.weekly_incentive_runs enable row level security;
alter table public.accountability_obligations enable row level security;
alter table public.badge_awards enable row level security;

create or replace function public.enforce_student_accountability_attestation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_active_admin() then
    return new;
  end if;

  if public.is_active_student() then
    if old.student_id <> auth.uid()
      or old.status <> 'pending'
      or new.id is distinct from old.id
      or new.student_id is distinct from old.student_id
      or new.week_start is distinct from old.week_start
      or new.weekly_percentage is distinct from old.weekly_percentage
      or new.amount_cents is distinct from old.amount_cents
      or new.status <> 'attested_paid'
      or new.attested_paid_at is null
      or new.waived_at is distinct from old.waived_at
      or new.waived_by is distinct from old.waived_by
      or new.admin_note is distinct from old.admin_note
      or new.created_at is distinct from old.created_at
    then
      raise exception 'Students may only attest their own pending accountability obligation as paid.';
    end if;

    return new;
  end if;

  raise exception 'Only active students or admins may update accountability obligations.';
end;
$$;

create trigger enforce_student_accountability_attestation_trigger
  before update on public.accountability_obligations
  for each row
  execute function public.enforce_student_accountability_attestation();

create policy "Admins can read weekly incentive runs"
  on public.weekly_incentive_runs
  for select
  using (public.is_active_admin());

create policy "Admins can insert weekly incentive runs"
  on public.weekly_incentive_runs
  for insert
  with check (public.is_active_admin());

create policy "Admins can update weekly incentive runs"
  on public.weekly_incentive_runs
  for update
  using (public.is_active_admin())
  with check (public.is_active_admin());

create policy "Students can read own accountability obligations"
  on public.accountability_obligations
  for select
  using (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Students can attest own pending accountability obligations"
  on public.accountability_obligations
  for update
  using (
    student_id = auth.uid()
    and public.is_active_student()
    and status = 'pending'
  )
  with check (
    student_id = auth.uid()
    and public.is_active_student()
    and status = 'attested_paid'
    and attested_paid_at is not null
  );

create policy "Admins can read all accountability obligations"
  on public.accountability_obligations
  for select
  using (public.is_active_admin());

create policy "Admins can insert accountability obligations"
  on public.accountability_obligations
  for insert
  with check (public.is_active_admin());

create policy "Admins can update accountability obligations"
  on public.accountability_obligations
  for update
  using (public.is_active_admin())
  with check (public.is_active_admin());

create policy "Students can read own badge awards"
  on public.badge_awards
  for select
  using (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Admins can read all badge awards"
  on public.badge_awards
  for select
  using (public.is_active_admin());

create policy "Admins can insert badge awards"
  on public.badge_awards
  for insert
  with check (public.is_active_admin());

create policy "Admins can update badge awards"
  on public.badge_awards
  for update
  using (public.is_active_admin())
  with check (public.is_active_admin());

create index if not exists accountability_obligations_student_status_idx
  on public.accountability_obligations(student_id, status);

create index if not exists accountability_obligations_week_status_idx
  on public.accountability_obligations(week_start, status);

create index if not exists badge_awards_student_week_idx
  on public.badge_awards(student_id, week_start);

create index if not exists badge_awards_week_idx
  on public.badge_awards(week_start);
