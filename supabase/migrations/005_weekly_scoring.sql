-- Add 1000-point weekly scoring support:
-- daily checklist 700, partner recitation 150, Saturday halaqa grade 150.

create or replace function public.current_effective_date()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select case
    when extract(hour from now() at time zone 'America/Toronto') < 1
      then ((now() at time zone 'America/Toronto')::date - 1)
    else (now() at time zone 'America/Toronto')::date
  end;
$$;

create or replace function public.week_start_for_date(input_date date)
returns date
language sql
immutable
set search_path = public
as $$
  select input_date - extract(dow from input_date)::integer;
$$;

create or replace function public.current_partner_recitation_round()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when extract(dow from public.current_effective_date())::integer <= 3 then 'round_1'
    else 'round_2'
  end;
$$;

create table if not exists public.partner_recitations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  round text not null check (round in ('round_1', 'round_2')),
  points integer not null default 75,
  submitted_at timestamptz not null default now(),
  constraint partner_recitations_student_week_round_unique unique (student_id, week_start, round),
  constraint partner_recitations_points_check check (points = 75)
);

create table if not exists public.halaqa_grades (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  attended boolean not null default false,
  attendance_points integer not null default 0,
  recitation_points integer not null default 0,
  notes text,
  graded_by uuid references public.profiles(id),
  graded_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint halaqa_grades_student_week_unique unique (student_id, week_start),
  constraint halaqa_grades_points_check check (
    (
      attended = false
      and attendance_points = 0
      and recitation_points = 0
    )
    or (
      attended = true
      and attendance_points = 100
      and recitation_points between 10 and 50
    )
  )
);

alter table public.partner_recitations enable row level security;
alter table public.halaqa_grades enable row level security;

create policy "Students can read own partner recitations"
  on public.partner_recitations
  for select
  using (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Students can create current partner recitations"
  on public.partner_recitations
  for insert
  with check (
    student_id = auth.uid()
    and public.is_active_student()
    and week_start = public.week_start_for_date(public.current_effective_date())
    and round = public.current_partner_recitation_round()
    and points = 75
  );

create policy "Admins can read all partner recitations"
  on public.partner_recitations
  for select
  using (public.is_active_admin());

create policy "Admins can insert partner recitations"
  on public.partner_recitations
  for insert
  with check (public.is_active_admin());

create policy "Admins can update partner recitations"
  on public.partner_recitations
  for update
  using (public.is_active_admin())
  with check (public.is_active_admin());

create policy "Admins can delete partner recitations"
  on public.partner_recitations
  for delete
  using (public.is_active_admin());

create policy "Students can read own halaqa grades"
  on public.halaqa_grades
  for select
  using (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Admins can read all halaqa grades"
  on public.halaqa_grades
  for select
  using (public.is_active_admin());

create policy "Admins can insert halaqa grades"
  on public.halaqa_grades
  for insert
  with check (public.is_active_admin());

create policy "Admins can update halaqa grades"
  on public.halaqa_grades
  for update
  using (public.is_active_admin())
  with check (public.is_active_admin());

create index if not exists partner_recitations_student_week_idx
  on public.partner_recitations(student_id, week_start);

create index if not exists halaqa_grades_student_week_idx
  on public.halaqa_grades(student_id, week_start);
