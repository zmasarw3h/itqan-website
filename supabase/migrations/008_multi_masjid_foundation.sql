-- Multi-masjid foundation.
-- Adds masjid/cohort/group scope, historical student memberships,
-- weekly teacher assignments, and scope snapshots for existing records.

create extension if not exists "btree_gist";

-- Expand profile roles for the multi-masjid model. The role remains a
-- routing/default-experience hint; scoped access comes from memberships.
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('student', 'teacher', 'admin', 'super_admin'));

create table if not exists public.masajid (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.cohorts (
  id uuid primary key default gen_random_uuid(),
  masjid_id uuid not null references public.masajid(id) on delete restrict,
  kind text not null check (kind in ('brothers', 'sisters')),
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.halaqa_groups (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete restrict,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.student_group_memberships (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.halaqa_groups(id) on delete restrict,
  starts_on date not null,
  ends_on date,
  assigned_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint student_group_memberships_dates_check check (
    ends_on is null
    or ends_on >= starts_on
  )
);

create table if not exists public.masjid_staff_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  masjid_id uuid not null references public.masajid(id) on delete restrict,
  staff_role text not null check (staff_role in ('admin', 'teacher')),
  active boolean not null default true,
  starts_on date not null default current_date,
  ends_on date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint masjid_staff_memberships_dates_check check (
    ends_on is null
    or ends_on >= starts_on
  )
);

create table if not exists public.group_teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.halaqa_groups(id) on delete restrict,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  week_start date not null,
  active boolean not null default true,
  assigned_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint group_teacher_assignments_week_unique unique (group_id, week_start),
  constraint group_teacher_assignments_week_start_check check (
    week_start = public.week_start_for_date(week_start)
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_group_memberships_no_overlap'
      and conrelid = 'public.student_group_memberships'::regclass
  ) then
    alter table public.student_group_memberships
      add constraint student_group_memberships_no_overlap
      exclude using gist (
        student_id with =,
        (daterange(starts_on, coalesce(ends_on + 1, 'infinity'::date), '[)')) with &&
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'masjid_staff_memberships_no_overlap'
      and conrelid = 'public.masjid_staff_memberships'::regclass
  ) then
    alter table public.masjid_staff_memberships
      add constraint masjid_staff_memberships_no_overlap
      exclude using gist (
        profile_id with =,
        masjid_id with =,
        staff_role with =,
        (daterange(starts_on, coalesce(ends_on + 1, 'infinity'::date), '[)')) with &&
      )
      where (active);
  end if;
end;
$$;

create unique index if not exists cohorts_active_kind_unique_idx
  on public.cohorts(masjid_id, kind)
  where active;

create unique index if not exists halaqa_groups_active_name_unique_idx
  on public.halaqa_groups(cohort_id, lower(name))
  where active;

create index if not exists cohorts_masjid_id_idx
  on public.cohorts(masjid_id);

create index if not exists halaqa_groups_cohort_id_idx
  on public.halaqa_groups(cohort_id);

create index if not exists student_group_memberships_student_id_idx
  on public.student_group_memberships(student_id);

create index if not exists student_group_memberships_group_id_idx
  on public.student_group_memberships(group_id);

create index if not exists masjid_staff_memberships_profile_id_idx
  on public.masjid_staff_memberships(profile_id);

create index if not exists masjid_staff_memberships_masjid_id_idx
  on public.masjid_staff_memberships(masjid_id);

create index if not exists group_teacher_assignments_teacher_week_idx
  on public.group_teacher_assignments(teacher_id, week_start);

create index if not exists group_teacher_assignments_group_week_idx
  on public.group_teacher_assignments(group_id, week_start);

alter table public.checkins
  add column if not exists masjid_id uuid references public.masajid(id),
  add column if not exists cohort_id uuid references public.cohorts(id),
  add column if not exists halaqa_group_id uuid references public.halaqa_groups(id);

alter table public.weekly_plans
  add column if not exists masjid_id uuid references public.masajid(id),
  add column if not exists cohort_id uuid references public.cohorts(id),
  add column if not exists halaqa_group_id uuid references public.halaqa_groups(id);

alter table public.partner_recitations
  add column if not exists masjid_id uuid references public.masajid(id),
  add column if not exists cohort_id uuid references public.cohorts(id),
  add column if not exists halaqa_group_id uuid references public.halaqa_groups(id);

alter table public.halaqa_grades
  add column if not exists masjid_id uuid references public.masajid(id),
  add column if not exists cohort_id uuid references public.cohorts(id),
  add column if not exists halaqa_group_id uuid references public.halaqa_groups(id);

alter table public.accountability_obligations
  add column if not exists masjid_id uuid references public.masajid(id),
  add column if not exists cohort_id uuid references public.cohorts(id),
  add column if not exists halaqa_group_id uuid references public.halaqa_groups(id);

alter table public.badge_awards
  add column if not exists masjid_id uuid references public.masajid(id),
  add column if not exists cohort_id uuid references public.cohorts(id),
  add column if not exists halaqa_group_id uuid references public.halaqa_groups(id);

alter table public.weekly_incentive_runs
  add column if not exists masjid_id uuid references public.masajid(id);

create index if not exists checkins_scope_week_idx
  on public.checkins(masjid_id, cohort_id, halaqa_group_id, date);

create index if not exists weekly_plans_scope_week_idx
  on public.weekly_plans(masjid_id, cohort_id, halaqa_group_id, week_start);

create index if not exists partner_recitations_scope_week_idx
  on public.partner_recitations(masjid_id, cohort_id, halaqa_group_id, week_start);

create index if not exists halaqa_grades_scope_week_idx
  on public.halaqa_grades(masjid_id, cohort_id, halaqa_group_id, week_start);

create index if not exists accountability_obligations_scope_week_idx
  on public.accountability_obligations(masjid_id, cohort_id, halaqa_group_id, week_start);

create index if not exists badge_awards_scope_week_idx
  on public.badge_awards(masjid_id, cohort_id, halaqa_group_id, week_start);

create index if not exists weekly_incentive_runs_masjid_week_idx
  on public.weekly_incentive_runs(masjid_id, week_start);

-- Backfill the current one-masjid deployment into TIC brothers.
insert into public.masajid (name, slug, active)
values ('Toronto Islamic Centre (TIC)', 'tic', true)
on conflict (slug) do update
set name = excluded.name,
    active = excluded.active,
    updated_at = now();

insert into public.cohorts (masjid_id, kind, name, active, sort_order)
select masajid.id, 'brothers', 'Brothers', true, 10
from public.masajid
where masajid.slug = 'tic'
on conflict do nothing;

insert into public.cohorts (masjid_id, kind, name, active, sort_order)
select masajid.id, 'sisters', 'Sisters', true, 20
from public.masajid
where masajid.slug = 'tic'
on conflict do nothing;

insert into public.halaqa_groups (cohort_id, name, active, sort_order)
select cohorts.id, 'TIC Brothers Default Group', true, 10
from public.cohorts
join public.masajid on masajid.id = cohorts.masjid_id
where masajid.slug = 'tic'
  and cohorts.kind = 'brothers'
on conflict do nothing;

insert into public.masjid_staff_memberships (profile_id, masjid_id, staff_role, active, starts_on)
select profiles.id, masajid.id, 'admin', true, date '1900-01-01'
from public.profiles
cross join public.masajid
where profiles.role in ('admin', 'super_admin')
  and profiles.active = true
  and masajid.slug = 'tic'
  and not exists (
    select 1
    from public.masjid_staff_memberships existing
    where existing.profile_id = profiles.id
      and existing.masjid_id = masajid.id
      and existing.staff_role = 'admin'
      and existing.active = true
      and daterange(existing.starts_on, coalesce(existing.ends_on + 1, 'infinity'::date), '[)')
        && daterange(date '1900-01-01', 'infinity'::date, '[)')
  );

insert into public.student_group_memberships (student_id, group_id, starts_on)
select profiles.id, halaqa_groups.id, date '1900-01-01'
from public.profiles
join public.halaqa_groups on halaqa_groups.name = 'TIC Brothers Default Group'
join public.cohorts on cohorts.id = halaqa_groups.cohort_id
join public.masajid on masajid.id = cohorts.masjid_id
where profiles.role = 'student'
  and profiles.active = true
  and masajid.slug = 'tic'
  and cohorts.kind = 'brothers'
  and not exists (
    select 1
    from public.student_group_memberships existing
    where existing.student_id = profiles.id
      and daterange(existing.starts_on, coalesce(existing.ends_on + 1, 'infinity'::date), '[)')
        && daterange(date '1900-01-01', 'infinity'::date, '[)')
  );

create or replace function public.is_active_teacher()
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
      and role = 'teacher'
      and active = true
  );
$$;

create or replace function public.is_active_super_admin()
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
      and role = 'super_admin'
      and active = true
  );
$$;

create or replace function public.student_group_for_week(input_student_id uuid, input_week_start date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select student_group_memberships.group_id
  from public.student_group_memberships
  join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
  join public.cohorts on cohorts.id = halaqa_groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  where student_group_memberships.student_id = input_student_id
    and student_group_memberships.starts_on <= input_week_start
    and (
      student_group_memberships.ends_on is null
      or student_group_memberships.ends_on >= input_week_start
    )
    and halaqa_groups.active = true
    and cohorts.active = true
    and masajid.active = true
  order by student_group_memberships.starts_on desc
  limit 1;
$$;

create or replace function public.student_current_group_id(input_student_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.student_group_for_week(
    input_student_id,
    public.week_start_for_date(public.current_effective_date())
  );
$$;

create or replace function public.student_cohort_for_week(input_student_id uuid, input_week_start date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select halaqa_groups.cohort_id
  from public.halaqa_groups
  where halaqa_groups.id = public.student_group_for_week(input_student_id, input_week_start);
$$;

create or replace function public.student_masjid_for_week(input_student_id uuid, input_week_start date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cohorts.masjid_id
  from public.cohorts
  where cohorts.id = public.student_cohort_for_week(input_student_id, input_week_start);
$$;

create or replace function public.group_masjid_id(input_group_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cohorts.masjid_id
  from public.halaqa_groups
  join public.cohorts on cohorts.id = halaqa_groups.cohort_id
  where halaqa_groups.id = input_group_id;
$$;

create or replace function public.is_admin_for_masjid(input_masjid_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_super_admin()
    or exists (
      select 1
      from public.masjid_staff_memberships
      join public.profiles on profiles.id = masjid_staff_memberships.profile_id
      where masjid_staff_memberships.profile_id = auth.uid()
        and masjid_staff_memberships.masjid_id = input_masjid_id
        and masjid_staff_memberships.staff_role = 'admin'
        and masjid_staff_memberships.active = true
        and masjid_staff_memberships.starts_on <= public.current_effective_date()
        and (
          masjid_staff_memberships.ends_on is null
          or masjid_staff_memberships.ends_on >= public.current_effective_date()
        )
        and profiles.active = true
    );
$$;

create or replace function public.is_staff_for_masjid(input_masjid_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_super_admin()
    or exists (
      select 1
      from public.masjid_staff_memberships
      join public.profiles on profiles.id = masjid_staff_memberships.profile_id
      where masjid_staff_memberships.profile_id = auth.uid()
        and masjid_staff_memberships.masjid_id = input_masjid_id
        and masjid_staff_memberships.active = true
        and masjid_staff_memberships.starts_on <= public.current_effective_date()
        and (
          masjid_staff_memberships.ends_on is null
          or masjid_staff_memberships.ends_on >= public.current_effective_date()
        )
        and profiles.active = true
    );
$$;

create or replace function public.is_teacher_for_group_week(input_group_id uuid, input_week_start date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_teacher_assignments
    join public.profiles on profiles.id = group_teacher_assignments.teacher_id
    join public.masjid_staff_memberships on masjid_staff_memberships.profile_id = group_teacher_assignments.teacher_id
    where group_teacher_assignments.group_id = input_group_id
      and group_teacher_assignments.week_start = input_week_start
      and group_teacher_assignments.teacher_id = auth.uid()
      and group_teacher_assignments.active = true
      and profiles.active = true
      and masjid_staff_memberships.masjid_id = public.group_masjid_id(input_group_id)
      and masjid_staff_memberships.staff_role = 'teacher'
      and masjid_staff_memberships.active = true
      and masjid_staff_memberships.starts_on <= input_week_start
      and (
        masjid_staff_memberships.ends_on is null
        or masjid_staff_memberships.ends_on >= input_week_start
      )
  );
$$;

create or replace function public.can_read_student_for_week(input_student_id uuid, input_week_start date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select input_student_id = auth.uid()
    or public.is_admin_for_masjid(public.student_masjid_for_week(input_student_id, input_week_start))
    or public.is_teacher_for_group_week(public.student_group_for_week(input_student_id, input_week_start), input_week_start);
$$;

create or replace function public.can_grade_student_for_week(input_student_id uuid, input_week_start date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_for_masjid(public.student_masjid_for_week(input_student_id, input_week_start))
    or public.is_teacher_for_group_week(public.student_group_for_week(input_student_id, input_week_start), input_week_start);
$$;

create or replace function public.can_admin_manage_student_for_week(input_student_id uuid, input_week_start date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_for_masjid(public.student_masjid_for_week(input_student_id, input_week_start));
$$;

update public.checkins
set halaqa_group_id = scope.group_id,
    cohort_id = scope.cohort_id,
    masjid_id = scope.masjid_id
from (
  select checkins.id as row_id,
         halaqa_groups.id as group_id,
         cohorts.id as cohort_id,
         cohorts.masjid_id
  from public.checkins
  join public.student_group_memberships on student_group_memberships.student_id = checkins.student_id
  join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
  join public.cohorts on cohorts.id = halaqa_groups.cohort_id
  where student_group_memberships.starts_on <= public.week_start_for_date(checkins.date)
    and (
      student_group_memberships.ends_on is null
      or student_group_memberships.ends_on >= public.week_start_for_date(checkins.date)
    )
) as scope
where checkins.id = scope.row_id
  and (
    checkins.halaqa_group_id is distinct from scope.group_id
    or checkins.cohort_id is distinct from scope.cohort_id
    or checkins.masjid_id is distinct from scope.masjid_id
  );

update public.weekly_plans
set halaqa_group_id = scope.group_id,
    cohort_id = scope.cohort_id,
    masjid_id = scope.masjid_id
from (
  select weekly_plans.id as row_id,
         halaqa_groups.id as group_id,
         cohorts.id as cohort_id,
         cohorts.masjid_id
  from public.weekly_plans
  join public.student_group_memberships on student_group_memberships.student_id = weekly_plans.student_id
  join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
  join public.cohorts on cohorts.id = halaqa_groups.cohort_id
  where student_group_memberships.starts_on <= public.week_start_for_date(weekly_plans.week_start + 1)
    and (
      student_group_memberships.ends_on is null
      or student_group_memberships.ends_on >= public.week_start_for_date(weekly_plans.week_start + 1)
    )
) as scope
where weekly_plans.id = scope.row_id
  and (
    weekly_plans.halaqa_group_id is distinct from scope.group_id
    or weekly_plans.cohort_id is distinct from scope.cohort_id
    or weekly_plans.masjid_id is distinct from scope.masjid_id
  );

update public.partner_recitations
set halaqa_group_id = scope.group_id,
    cohort_id = scope.cohort_id,
    masjid_id = scope.masjid_id
from (
  select partner_recitations.id as row_id,
         halaqa_groups.id as group_id,
         cohorts.id as cohort_id,
         cohorts.masjid_id
  from public.partner_recitations
  join public.student_group_memberships on student_group_memberships.student_id = partner_recitations.student_id
  join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
  join public.cohorts on cohorts.id = halaqa_groups.cohort_id
  where student_group_memberships.starts_on <= partner_recitations.week_start
    and (
      student_group_memberships.ends_on is null
      or student_group_memberships.ends_on >= partner_recitations.week_start
    )
) as scope
where partner_recitations.id = scope.row_id
  and (
    partner_recitations.halaqa_group_id is distinct from scope.group_id
    or partner_recitations.cohort_id is distinct from scope.cohort_id
    or partner_recitations.masjid_id is distinct from scope.masjid_id
  );

update public.halaqa_grades
set halaqa_group_id = scope.group_id,
    cohort_id = scope.cohort_id,
    masjid_id = scope.masjid_id
from (
  select halaqa_grades.id as row_id,
         halaqa_groups.id as group_id,
         cohorts.id as cohort_id,
         cohorts.masjid_id
  from public.halaqa_grades
  join public.student_group_memberships on student_group_memberships.student_id = halaqa_grades.student_id
  join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
  join public.cohorts on cohorts.id = halaqa_groups.cohort_id
  where student_group_memberships.starts_on <= halaqa_grades.week_start
    and (
      student_group_memberships.ends_on is null
      or student_group_memberships.ends_on >= halaqa_grades.week_start
    )
) as scope
where halaqa_grades.id = scope.row_id
  and (
    halaqa_grades.halaqa_group_id is distinct from scope.group_id
    or halaqa_grades.cohort_id is distinct from scope.cohort_id
    or halaqa_grades.masjid_id is distinct from scope.masjid_id
  );

do $$
begin
  alter table public.accountability_obligations
    disable trigger enforce_student_accountability_attestation_trigger;

  update public.accountability_obligations
  set halaqa_group_id = scope.group_id,
      cohort_id = scope.cohort_id,
      masjid_id = scope.masjid_id
  from (
    select accountability_obligations.id as row_id,
           halaqa_groups.id as group_id,
           cohorts.id as cohort_id,
           cohorts.masjid_id
    from public.accountability_obligations
    join public.student_group_memberships on student_group_memberships.student_id = accountability_obligations.student_id
    join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
    join public.cohorts on cohorts.id = halaqa_groups.cohort_id
    where student_group_memberships.starts_on <= accountability_obligations.week_start
      and (
        student_group_memberships.ends_on is null
        or student_group_memberships.ends_on >= accountability_obligations.week_start
      )
  ) as scope
  where accountability_obligations.id = scope.row_id
    and (
      accountability_obligations.halaqa_group_id is distinct from scope.group_id
      or accountability_obligations.cohort_id is distinct from scope.cohort_id
      or accountability_obligations.masjid_id is distinct from scope.masjid_id
    );

  alter table public.accountability_obligations
    enable trigger enforce_student_accountability_attestation_trigger;
exception
  when others then
    alter table public.accountability_obligations
      enable trigger enforce_student_accountability_attestation_trigger;
    raise;
end;
$$;

update public.badge_awards
set halaqa_group_id = scope.group_id,
    cohort_id = scope.cohort_id,
    masjid_id = scope.masjid_id
from (
  select badge_awards.id as row_id,
         halaqa_groups.id as group_id,
         cohorts.id as cohort_id,
         cohorts.masjid_id
  from public.badge_awards
  join public.student_group_memberships on student_group_memberships.student_id = badge_awards.student_id
  join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
  join public.cohorts on cohorts.id = halaqa_groups.cohort_id
  where student_group_memberships.starts_on <= badge_awards.week_start
    and (
      student_group_memberships.ends_on is null
      or student_group_memberships.ends_on >= badge_awards.week_start
    )
) as scope
where badge_awards.id = scope.row_id
  and (
    badge_awards.halaqa_group_id is distinct from scope.group_id
    or badge_awards.cohort_id is distinct from scope.cohort_id
    or badge_awards.masjid_id is distinct from scope.masjid_id
  );

update public.weekly_incentive_runs
set masjid_id = masajid.id
from public.masajid
where masajid.slug = 'tic'
  and weekly_incentive_runs.masjid_id is null;

create or replace function public.set_student_scope_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_week_start date;
  scope_group_id uuid;
  scope_cohort_id uuid;
  scope_masjid_id uuid;
begin
  if tg_table_name = 'checkins' then
    scope_week_start := public.week_start_for_date(new.date);
  elsif tg_table_name = 'weekly_plans' then
    scope_week_start := public.week_start_for_date(new.week_start + 1);
  else
    scope_week_start := new.week_start;
  end if;

  select halaqa_groups.id, cohorts.id, cohorts.masjid_id
  into scope_group_id, scope_cohort_id, scope_masjid_id
  from public.student_group_memberships
  join public.halaqa_groups on halaqa_groups.id = student_group_memberships.group_id
  join public.cohorts on cohorts.id = halaqa_groups.cohort_id
  join public.masajid on masajid.id = cohorts.masjid_id
  where student_group_memberships.student_id = new.student_id
    and student_group_memberships.starts_on <= scope_week_start
    and (
      student_group_memberships.ends_on is null
      or student_group_memberships.ends_on >= scope_week_start
    )
    and halaqa_groups.active = true
    and cohorts.active = true
    and masajid.active = true
  order by student_group_memberships.starts_on desc
  limit 1;

  new.halaqa_group_id := scope_group_id;
  new.cohort_id := scope_cohort_id;
  new.masjid_id := scope_masjid_id;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_checkins_scope_snapshot_trigger'
  ) then
    create trigger set_checkins_scope_snapshot_trigger
      before insert or update of student_id, date on public.checkins
      for each row
      execute function public.set_student_scope_snapshot();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_weekly_plans_scope_snapshot_trigger'
  ) then
    create trigger set_weekly_plans_scope_snapshot_trigger
      before insert or update of student_id, week_start on public.weekly_plans
      for each row
      execute function public.set_student_scope_snapshot();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_partner_recitations_scope_snapshot_trigger'
  ) then
    create trigger set_partner_recitations_scope_snapshot_trigger
      before insert or update of student_id, week_start on public.partner_recitations
      for each row
      execute function public.set_student_scope_snapshot();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_halaqa_grades_scope_snapshot_trigger'
  ) then
    create trigger set_halaqa_grades_scope_snapshot_trigger
      before insert or update of student_id, week_start on public.halaqa_grades
      for each row
      execute function public.set_student_scope_snapshot();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_accountability_obligations_scope_snapshot_trigger'
  ) then
    create trigger set_accountability_obligations_scope_snapshot_trigger
      before insert or update of student_id, week_start on public.accountability_obligations
      for each row
      execute function public.set_student_scope_snapshot();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'set_badge_awards_scope_snapshot_trigger'
  ) then
    create trigger set_badge_awards_scope_snapshot_trigger
      before insert or update of student_id, week_start on public.badge_awards
      for each row
      execute function public.set_student_scope_snapshot();
  end if;
end;
$$;

alter table public.masajid enable row level security;
alter table public.cohorts enable row level security;
alter table public.halaqa_groups enable row level security;
alter table public.student_group_memberships enable row level security;
alter table public.masjid_staff_memberships enable row level security;
alter table public.group_teacher_assignments enable row level security;

create policy "Active users can read active masajid"
  on public.masajid
  for select
  using (
    active = true
    and (
      public.is_active_student()
      or public.is_active_teacher()
      or public.is_active_admin()
      or public.is_active_super_admin()
    )
  );

create policy "Admins can manage masajid foundation data"
  on public.masajid
  for all
  using (public.is_active_super_admin() or public.is_active_admin())
  with check (public.is_active_super_admin() or public.is_active_admin());

create policy "Active users can read active cohorts"
  on public.cohorts
  for select
  using (
    active = true
    and (
      public.is_active_student()
      or public.is_active_teacher()
      or public.is_active_admin()
      or public.is_active_super_admin()
    )
  );

create policy "Admins can manage cohort foundation data"
  on public.cohorts
  for all
  using (public.is_active_super_admin() or public.is_active_admin())
  with check (public.is_active_super_admin() or public.is_active_admin());

create policy "Active users can read active halaqa groups"
  on public.halaqa_groups
  for select
  using (
    active = true
    and (
      public.is_active_student()
      or public.is_active_teacher()
      or public.is_active_admin()
      or public.is_active_super_admin()
    )
  );

create policy "Admins can manage halaqa group foundation data"
  on public.halaqa_groups
  for all
  using (public.is_active_super_admin() or public.is_active_admin())
  with check (public.is_active_super_admin() or public.is_active_admin());

create policy "Students can read own group memberships"
  on public.student_group_memberships
  for select
  using (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Teachers can read assigned group memberships"
  on public.student_group_memberships
  for select
  using (
    public.is_teacher_for_group_week(
      group_id,
      public.week_start_for_date(public.current_effective_date())
    )
  );

create policy "Admins can manage student group memberships"
  on public.student_group_memberships
  for all
  using (public.is_active_super_admin() or public.is_active_admin())
  with check (public.is_active_super_admin() or public.is_active_admin());

create policy "Users can read own staff memberships"
  on public.masjid_staff_memberships
  for select
  using (
    profile_id = auth.uid()
    and (
      public.is_active_teacher()
      or public.is_active_admin()
      or public.is_active_super_admin()
    )
  );

create policy "Admins can manage staff memberships"
  on public.masjid_staff_memberships
  for all
  using (public.is_active_super_admin() or public.is_active_admin())
  with check (public.is_active_super_admin() or public.is_active_admin());

create policy "Teachers can read own group assignments"
  on public.group_teacher_assignments
  for select
  using (
    teacher_id = auth.uid()
    and public.is_active_teacher()
  );

create policy "Admins can manage group teacher assignments"
  on public.group_teacher_assignments
  for all
  using (public.is_active_super_admin() or public.is_active_admin())
  with check (public.is_active_super_admin() or public.is_active_admin());
