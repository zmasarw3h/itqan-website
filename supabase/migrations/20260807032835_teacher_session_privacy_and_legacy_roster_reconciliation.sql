-- Close the legacy raw-checklist Data API path without changing the shared
-- operational-row helper. That helper still serves preserved admin/teacher
-- surfaces elsewhere, but teacher checklist reads must use only the
-- published-session sanitized RPC.
alter policy "Admins can read all checkins"
  on public.checkins
  to authenticated
  using ((select public.is_admin_for_masjid(masjid_id)));

alter policy "Admins can read all checkin items"
  on public.checkin_items
  to authenticated
  using (
    exists (
      select 1
      from public.checkins
      where checkins.id = checkin_items.checkin_id
        and checkins.student_id = checkin_items.student_id
        and checkins.date = checkin_items.date
        and (select public.is_admin_for_masjid(checkins.masjid_id))
    )
  );

-- The application has migrated its teacher group page to the published
-- session contracts. Revoke the old permanent-membership roster endpoint for
-- every role so no authenticated caller can bypass publication/version
-- authorization. The function remains in the SECURITY DEFINER inventory for
-- catalog drift detection, but it is no longer an API surface.
revoke all on function public.teacher_group_roster_context(uuid, date)
  from public, anon, authenticated, service_role;
