-- Add weighted checklist scoring while preserving the existing checkins table.

alter table public.checkins
  add column if not exists earned_weight integer,
  add column if not exists total_weight integer,
  add column if not exists daily_score numeric;

create table if not exists public.checkin_items (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.checkins(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  task_key text not null,
  task_label text not null,
  weight integer not null,
  completed boolean not null,
  created_at timestamptz not null default now(),
  constraint checkin_items_checkin_task_unique unique (checkin_id, task_key)
);

alter table public.checkin_items enable row level security;

create policy "Students can read own checkin items"
  on public.checkin_items
  for select
  using (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Students can create own checkin items"
  on public.checkin_items
  for insert
  with check (
    student_id = auth.uid()
    and public.is_active_student()
    and exists (
      select 1
      from public.checkins
      where checkins.id = checkin_items.checkin_id
        and checkins.student_id = auth.uid()
    )
  );

create policy "Admins can read all checkin items"
  on public.checkin_items
  for select
  using (public.is_active_admin());

create policy "Admins can insert checkin items"
  on public.checkin_items
  for insert
  with check (public.is_active_admin());

create policy "Admins can update checkin items"
  on public.checkin_items
  for update
  using (public.is_active_admin())
  with check (public.is_active_admin());

create policy "Admins can delete checkin items"
  on public.checkin_items
  for delete
  using (public.is_active_admin());

create policy "Admins can delete checkins"
  on public.checkins
  for delete
  using (public.is_active_admin());

create index if not exists checkin_items_checkin_id_idx on public.checkin_items(checkin_id);
create index if not exists checkin_items_student_date_idx on public.checkin_items(student_id, date);
create index if not exists checkins_student_date_idx on public.checkins(student_id, date);
