-- Weekly teacher rotation foundation.
-- Adds availability, cohort rotation settings, and run audit metadata.

create table if not exists public.teacher_rotation_availability (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  masjid_id uuid not null references public.masajid(id) on delete restrict,
  cohort_id uuid not null references public.cohorts(id) on delete restrict,
  week_start date not null,
  available boolean not null default false,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_rotation_availability_teacher_cohort_week_unique
    unique (teacher_id, cohort_id, week_start),
  constraint teacher_rotation_availability_week_start_check
    check (week_start = public.week_start_for_date(week_start))
);

create table if not exists public.cohort_rotation_settings (
  id uuid primary key default gen_random_uuid(),
  masjid_id uuid not null references public.masajid(id) on delete restrict,
  cohort_id uuid not null references public.cohorts(id) on delete restrict,
  target_group_count integer not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cohort_rotation_settings_target_group_count_check
    check (target_group_count > 0)
);

create table if not exists public.teacher_rotation_runs (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete restrict,
  week_start date not null,
  generated_by uuid references public.profiles(id),
  generated_at timestamptz not null default now(),
  available_teacher_count integer not null default 0,
  group_count integer not null default 0,
  assigned_count integer not null default 0,
  warning_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint teacher_rotation_runs_week_start_check
    check (week_start = public.week_start_for_date(week_start)),
  constraint teacher_rotation_runs_counts_check
    check (
      available_teacher_count >= 0
      and group_count >= 0
      and assigned_count >= 0
      and warning_count >= 0
      and assigned_count <= available_teacher_count
      and assigned_count <= group_count
    )
);

create or replace function public.cohort_masjid_id(input_cohort_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cohorts.masjid_id
  from public.cohorts
  where cohorts.id = input_cohort_id;
$$;

create or replace function public.teacher_rotation_row_scope_matches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.cohorts
    where cohorts.id = new.cohort_id
      and cohorts.masjid_id = new.masjid_id
  ) then
    raise exception 'cohort_id must belong to masjid_id';
  end if;

  if tg_table_name = 'teacher_rotation_availability' then
    if not exists (
      select 1
      from public.profiles
      join public.masjid_staff_memberships
        on masjid_staff_memberships.profile_id = profiles.id
      where profiles.id = new.teacher_id
        and profiles.role = 'teacher'
        and profiles.active = true
        and masjid_staff_memberships.masjid_id = new.masjid_id
        and masjid_staff_memberships.staff_role = 'teacher'
        and masjid_staff_memberships.active = true
        and masjid_staff_memberships.starts_on <= new.week_start
        and (
          masjid_staff_memberships.ends_on is null
          or masjid_staff_memberships.ends_on >= new.week_start
        )
    ) then
      raise exception 'teacher_id must be an active teacher for masjid_id and week_start';
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'teacher_rotation_availability_scope_trigger'
  ) then
    create trigger teacher_rotation_availability_scope_trigger
      before insert or update of teacher_id, masjid_id, cohort_id, week_start on public.teacher_rotation_availability
      for each row
      execute function public.teacher_rotation_row_scope_matches();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'cohort_rotation_settings_scope_trigger'
  ) then
    create trigger cohort_rotation_settings_scope_trigger
      before insert or update of masjid_id, cohort_id on public.cohort_rotation_settings
      for each row
      execute function public.teacher_rotation_row_scope_matches();
  end if;
end;
$$;

create unique index if not exists cohort_rotation_settings_active_cohort_unique_idx
  on public.cohort_rotation_settings(cohort_id)
  where active;

create index if not exists teacher_rotation_availability_cohort_week_idx
  on public.teacher_rotation_availability(cohort_id, week_start);

create index if not exists teacher_rotation_availability_teacher_week_idx
  on public.teacher_rotation_availability(teacher_id, week_start);

create index if not exists teacher_rotation_availability_masjid_week_idx
  on public.teacher_rotation_availability(masjid_id, week_start);

create index if not exists cohort_rotation_settings_masjid_idx
  on public.cohort_rotation_settings(masjid_id);

create index if not exists teacher_rotation_runs_cohort_week_idx
  on public.teacher_rotation_runs(cohort_id, week_start);

create index if not exists teacher_rotation_runs_generated_by_idx
  on public.teacher_rotation_runs(generated_by);

alter table public.teacher_rotation_availability enable row level security;
alter table public.cohort_rotation_settings enable row level security;
alter table public.teacher_rotation_runs enable row level security;

create policy "Teachers can read own rotation availability"
  on public.teacher_rotation_availability
  for select
  using (
    teacher_id = auth.uid()
    and public.is_active_teacher()
    and public.is_staff_for_masjid(masjid_id)
  );

create policy "Admins can manage teacher rotation availability"
  on public.teacher_rotation_availability
  for all
  using (public.is_admin_for_masjid(masjid_id))
  with check (public.is_admin_for_masjid(masjid_id));

create policy "Admins can manage cohort rotation settings"
  on public.cohort_rotation_settings
  for all
  using (public.is_admin_for_masjid(masjid_id))
  with check (public.is_admin_for_masjid(masjid_id));

create policy "Admins can manage teacher rotation runs"
  on public.teacher_rotation_runs
  for all
  using (public.is_admin_for_masjid(public.cohort_masjid_id(cohort_id)))
  with check (public.is_admin_for_masjid(public.cohort_masjid_id(cohort_id)));
