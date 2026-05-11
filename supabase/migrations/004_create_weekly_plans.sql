-- Weekly plan metadata. Files live in the private Supabase Storage bucket
-- named weekly-plans; this table stores ownership and lookup metadata only.

create table if not exists public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  file_path text not null,
  file_name text not null,
  file_type text not null,
  file_size integer not null,
  uploaded_at timestamptz not null default now(),
  constraint weekly_plans_student_week_unique unique (student_id, week_start)
);

alter table public.weekly_plans enable row level security;

create policy "Students can read own weekly plans"
  on public.weekly_plans
  for select
  using (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Students can insert own weekly plans"
  on public.weekly_plans
  for insert
  with check (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Students can update own weekly plans"
  on public.weekly_plans
  for update
  using (
    student_id = auth.uid()
    and public.is_active_student()
  )
  with check (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Admins can read all weekly plans"
  on public.weekly_plans
  for select
  using (public.is_active_admin());

create index if not exists weekly_plans_student_id_idx on public.weekly_plans(student_id);
create index if not exists weekly_plans_week_start_idx on public.weekly_plans(week_start);
