-- Require the admin Storage policy to point at the exact, scoped metadata row.
-- The application preview/download route performs the same checks before it
-- streams bytes with the service-role client. This closes the older policy
-- gap where a scoped admin could sign any object-shaped path under a student
-- and week, including an orphan or substituted object.

create or replace function public.can_admin_read_weekly_plan_path(input_file_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parsed_student_id uuid;
  parsed_week_start date;
  resolved_masjid_id uuid;
  resolved_cohort_id uuid;
  resolved_group_id uuid;
begin
  if input_file_path is null
    or input_file_path !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[^/]+$'
    or position('..' in input_file_path) > 0
    or position(chr(92) in input_file_path) > 0 then
    return false;
  end if;

  begin
    parsed_student_id := split_part(input_file_path, '/', 1)::uuid;
    parsed_week_start := split_part(input_file_path, '/', 2)::date;
  exception
    when invalid_text_representation or datetime_field_overflow then
      return false;
  end;

  if parsed_week_start <> public.week_start_for_date(parsed_week_start) then
    return false;
  end if;

  if not exists (
    select 1
    from public.profiles as students
    where students.id = parsed_student_id
      and students.role = 'student'
      and students.active = true
  ) then
    return false;
  end if;

  if not public.can_admin_manage_student_for_week(parsed_student_id, parsed_week_start) then
    return false;
  end if;

  resolved_group_id := public.student_group_for_week(parsed_student_id, parsed_week_start);
  resolved_cohort_id := public.student_cohort_for_week(parsed_student_id, parsed_week_start);
  resolved_masjid_id := public.student_masjid_for_week(parsed_student_id, parsed_week_start);

  if resolved_group_id is null or resolved_cohort_id is null or resolved_masjid_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.weekly_plans as plans
    where plans.student_id = parsed_student_id
      and plans.week_start = parsed_week_start
      and plans.file_path = input_file_path
      and plans.masjid_id = resolved_masjid_id
      and plans.cohort_id = resolved_cohort_id
      and plans.halaqa_group_id = resolved_group_id
      and plans.file_type in ('application/pdf', 'image/png', 'image/jpeg')
      and plans.file_size between 1 and 3 * 1024 * 1024
  );
end;
$$;

revoke all on function public.can_admin_read_weekly_plan_path(text)
  from public, anon, authenticated, service_role;
grant execute on function public.can_admin_read_weekly_plan_path(text) to authenticated;

comment on function public.can_admin_read_weekly_plan_path(text) is
  'Allows an active scoped admin to read only the exact canonical weekly-plan object represented by its metadata row.';
