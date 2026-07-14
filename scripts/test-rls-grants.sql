-- Schema-catalog assertions complement the signed-session behavioral tests.
-- This runs only inside the disposable local Postgres container.

create temp table expected_authenticated_definers (signature text primary key);

insert into expected_authenticated_definers (signature) values
  ('public.admin_students_for_week(date)'),
  ('public.can_admin_delete_student(uuid)'),
  ('public.can_admin_manage_student_for_week(uuid, date)'),
  ('public.can_admin_read_weekly_plan_path(text)'),
  ('public.can_grade_student_for_week(uuid, date)'),
  ('public.can_read_cohort(uuid)'),
  ('public.can_read_group(uuid)'),
  ('public.can_read_masjid(uuid)'),
  ('public.can_read_operational_student_row(uuid, uuid, date)'),
  ('public.can_read_profile(uuid)'),
  ('public.can_read_student_for_week(uuid, date)'),
  ('public.cohort_masjid_id(uuid)'),
  ('public.current_effective_date()'),
  ('public.current_partner_recitation_round()'),
  ('public.group_masjid_id(uuid)'),
  ('public.is_active_admin()'),
  ('public.is_active_student()'),
  ('public.is_active_super_admin()'),
  ('public.is_active_teacher()'),
  ('public.is_admin_for_masjid(uuid)'),
  ('public.is_rotation_teacher_for_masjid_week(uuid, uuid, date)'),
  ('public.is_staff_for_masjid(uuid)'),
  ('public.is_teacher_for_group_week(uuid, date)'),
  ('public.student_cohort_for_week(uuid, date)'),
  ('public.student_cohort_leaderboard_for_week(date)'),
  ('public.student_current_group_id(uuid)'),
  ('public.student_group_for_week(uuid, date)'),
  ('public.student_leaderboard_available_weeks()'),
  ('public.student_masjid_for_week(uuid, date)'),
  ('public.student_scope_snapshot_matches(uuid, date, uuid, uuid, uuid)'),
  ('public.student_weekly_teacher_name(date)'),
  ('public.teacher_can_read_membership(uuid, date, date)');

do $$
declare
  unexpected text;
  missing text;
  anon_executable text;
  unsafe_search_path text;
begin
  with actual as (
    select format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  )
  select string_agg(signature, ', ' order by signature)
  into unexpected
  from (
    select signature from actual
    except
    select signature from expected_authenticated_definers
  ) difference;

  with actual as (
    select format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  )
  select string_agg(signature, ', ' order by signature)
  into missing
  from (
    select signature from expected_authenticated_definers
    except
    select signature from actual
  ) difference;

  select string_agg(
    format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)),
    ', ' order by p.proname
  )
  into anon_executable
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  select string_agg(
    format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)),
    ', ' order by p.proname
  )
  into unsafe_search_path
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not coalesce(p.proconfig @> array['search_path=""'], false);

  if unexpected is not null then
    raise exception 'Unexpected authenticated SECURITY DEFINER grants: %', unexpected;
  end if;

  if missing is not null then
    raise exception 'Missing authenticated SECURITY DEFINER grants: %', missing;
  end if;

  if anon_executable is not null then
    raise exception 'anon/PUBLIC can execute SECURITY DEFINER functions: %', anon_executable;
  end if;

  if unsafe_search_path is not null then
    raise exception 'SECURITY DEFINER functions without empty search_path: %', unsafe_search_path;
  end if;
end;
$$;
