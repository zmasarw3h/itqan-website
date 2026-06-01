-- Allow students to update their own daily checklist rows for autosave.
-- Server actions still validate the active role, effective date, and task keys.

create policy "Students can update own checkins"
  on public.checkins
  for update
  using (
    student_id = auth.uid()
    and public.is_active_student()
  )
  with check (
    student_id = auth.uid()
    and public.is_active_student()
  );

create policy "Students can update own checkin items"
  on public.checkin_items
  for update
  using (
    student_id = auth.uid()
    and public.is_active_student()
    and exists (
      select 1
      from public.checkins
      where checkins.id = checkin_items.checkin_id
        and checkins.student_id = auth.uid()
    )
  )
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
