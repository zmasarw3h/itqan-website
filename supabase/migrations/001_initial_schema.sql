-- ITQAN Daily Check-In initial schema
-- This migration defines the minimum tables and row-level security rules
-- for the emergency one-masjid check-in app.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null check (role in ('student', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  completed boolean not null default true,
  note text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by_admin uuid references public.profiles(id),
  constraint checkins_student_date_unique unique (student_id, date)
);

alter table public.profiles enable row level security;
alter table public.checkins enable row level security;

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and active = true
  );
$$;

create or replace function public.is_active_student()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'student'
      and active = true
  );
$$;

-- Profiles policies

create policy "Users can read own active profile"
  on public.profiles
  for select
  using (id = auth.uid() and active = true);

create policy "Admins can read all profiles"
  on public.profiles
  for select
  using (public.is_active_admin());

create policy "Admins can update profiles"
  on public.profiles
  for update
  using (public.is_active_admin())
  with check (public.is_active_admin());

create policy "Admins can insert profiles"
  on public.profiles
  for insert
  with check (public.is_active_admin());

-- Check-in policies

create policy "Students can read own checkins"
  on public.checkins
  for select
  using (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Students can create own checkins"
  on public.checkins
  for insert
  with check (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Admins can read all checkins"
  on public.checkins
  for select
  using (public.is_active_admin());

create policy "Admins can insert checkins"
  on public.checkins
  for insert
  with check (public.is_active_admin());

create policy "Admins can update checkins"
  on public.checkins
  for update
  using (public.is_active_admin())
  with check (public.is_active_admin());

create index if not exists checkins_student_id_idx on public.checkins(student_id);
create index if not exists checkins_date_idx on public.checkins(date);
create index if not exists profiles_role_idx on public.profiles(role);
