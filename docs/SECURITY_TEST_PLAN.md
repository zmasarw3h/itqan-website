# Security Test Plan

This plan verifies the app access model and Supabase row-level security (RLS) policies for the ITQAN emergency app. It is intended for staging or a local Supabase project, not production.

## Scope

Verify these enforcement layers:

- App routes and server actions call `requireProfile(["student"])` or `requireProfile(["admin"])` before accessing protected data.
- Browser/server Supabase clients use the signed-in user's session and the anon key, so public table access is constrained by RLS.
- Admin-only service role usage stays server-side and is limited to Auth user creation plus private weekly-plan Storage upload, cleanup, and signed URL creation.
- Database constraints block duplicate records where RLS alone is not enough.

Do not use the Supabase SQL editor, service role key, or `createSupabaseAdminClient()` for RLS assertions. Those can bypass RLS and will produce false positives. Use a signed-in anon client, the deployed staging app, or a one-off local script that signs in as each test user.

## Current RLS Inventory

Tables with RLS enabled:

- `public.profiles`
- `public.checkins`
- `public.checkin_items`
- `public.weekly_plans`
- `public.partner_recitations`
- `public.halaqa_grades`
- `public.masajid`
- `public.cohorts`
- `public.halaqa_groups`
- `public.student_group_memberships`
- `public.masjid_staff_memberships`
- `public.group_teacher_assignments`
- `public.super_admin_audit_events`

Helper functions used by policies:

- `public.is_active_admin()`
- `public.is_active_student()`
- `public.is_active_teacher()`
- `public.is_active_super_admin()`
- `public.is_admin_for_masjid(masjid_id)`
- `public.current_effective_date()`
- `public.week_start_for_date(date)`
- `public.current_partner_recitation_round()`

Uniqueness and check constraints that are security-relevant:

- `checkins_student_date_unique` prevents duplicate check-ins for the same student/date.
- `checkin_items_checkin_task_unique` prevents duplicate task snapshots for one check-in.
- `weekly_plans_student_week_unique` allows one weekly plan metadata row per student/week.
- `partner_recitations_student_week_round_unique` prevents duplicate partner-recitation submissions for one student/week/round.
- `partner_recitations_points_check` requires student/admin partner recitation points to be `75`.
- `halaqa_grades_student_week_unique` allows one halaqa grade per student/week.
- `halaqa_grades_points_check` enforces the valid attendance/recitation point combinations.

## Test Data

Create these users in a disposable Supabase project with matching `public.profiles` rows:

- `admin_a`: active admin
- `student_a`: active student
- `student_b`: active student
- `inactive_student`: inactive student, optional but useful for negative checks

Seed at least one row owned by `student_a` and one row owned by `student_b` in each owned table:

- `checkins`
- `checkin_items`
- `weekly_plans`
- `partner_recitations`
- `halaqa_grades`

Use the service role only for setup/teardown. Run the actual assertions through signed-in user sessions.

## Manual RLS Verification Matrix

### Profiles

As `student_a`:

- Select `profiles` where `id = student_a.id`.
- Expected: exactly `student_a`'s active profile is returned.
- Select `profiles` where `id = student_b.id`.
- Expected: zero rows.
- Select all profiles.
- Expected: only `student_a`'s own active profile is visible.

As `admin_a`:

- Select all profiles.
- Expected: all profiles intended for admin management are visible.
- Insert or update `profiles.role` / `profiles.active` directly through the signed-in client.
- Expected: fails unless the actor is an active super admin. Normal app student/teacher creation uses guarded server-side service-role code.

As `student_a` or unauthenticated:

- Insert a profile for a new student.
- Expected: fails with RLS/permission error.

### Super Admin Audit Events

As `super_admin_a`:

- Select from `super_admin_audit_events`.
- Expected: audit events are returned.

As `admin_a`, `student_a`, or unauthenticated:

- Select from `super_admin_audit_events`.
- Expected: zero rows or permission/RLS denial.
- Insert, update, or delete audit events.
- Expected: fails. Audit rows should be written only by guarded server-side code or a future tightly scoped RPC.

### Foundation Tables

As `admin_a`:

- Insert/update/delete `masajid`, `cohorts`, or `halaqa_groups` directly through the signed-in client.
- Expected: fails. Setup-level writes are super-admin only or must go through existing guarded server-side flows.
- Insert/update a `masjid_staff_memberships` row with `staff_role = 'admin'`.
- Expected: fails. Admin grants are super-admin only.
- Insert/update a `masjid_staff_memberships` row with `staff_role = 'teacher'` for a masjid where `admin_a` has active admin membership.
- Expected: succeeds if all table constraints are satisfied.
- Insert/update a `student_group_memberships` or `group_teacher_assignments` row outside `admin_a`'s active admin masjid.
- Expected: fails.

### Check-Ins

As `student_a`:

- Select `checkins` where `student_id = student_a.id`.
- Expected: only `student_a` check-ins are returned.
- Select `checkins` where `student_id = student_b.id`.
- Expected: zero rows.
- Insert a check-in with `student_id = student_a.id` for a date without an existing row.
- Expected: succeeds.
- Insert a second check-in for the same `student_id` and `date`.
- Expected: fails on `checkins_student_date_unique`.
- Insert a check-in with `student_id = student_b.id`.
- Expected: fails with RLS/permission error.
- Update or delete any check-in.
- Expected: fails because students have no update/delete policies.

As `admin_a`:

- Select check-ins for all students.
- Insert, update, and delete intended correction rows.
- Expected: succeeds for active admin.

### Check-In Items

As `student_a`:

- Select `checkin_items` where `student_id = student_a.id`.
- Expected: only `student_a` items are returned.
- Select `checkin_items` where `student_id = student_b.id`.
- Expected: zero rows.
- Insert an item with `student_id = student_a.id` and a `checkin_id` that belongs to `student_a`.
- Expected: succeeds when the task is not already present for that check-in.
- Insert an item with `student_id = student_a.id` and a `checkin_id` that belongs to `student_b`.
- Expected: fails with RLS/permission error because the referenced check-in is not owned by the signed-in student.
- Insert an item with `student_id = student_b.id`.
- Expected: fails with RLS/permission error.
- Update or delete any item.
- Expected: fails because students have no update/delete policies.

As `admin_a`:

- Select, insert, update, and delete intended correction items.
- Expected: succeeds for active admin.

### Weekly Plans

This section covers `public.weekly_plans` metadata. Weekly-plan Storage objects are private and are currently uploaded/read by server-side service role code after the app checks the signed-in user's role.

As `student_a`:

- Select `weekly_plans` where `student_id = student_a.id`.
- Expected: only `student_a` metadata rows are returned.
- Select `weekly_plans` where `student_id = student_b.id`.
- Expected: zero rows.
- Insert weekly-plan metadata with `student_id = student_a.id`.
- Expected: succeeds if there is no existing row for that student/week.
- Update weekly-plan metadata for `student_a`.
- Expected: succeeds.
- Insert or update weekly-plan metadata with `student_id = student_b.id`.
- Expected: fails with RLS/permission error.
- Delete weekly-plan metadata.
- Expected: fails because students have no delete policy.

As `admin_a`:

- Select weekly-plan metadata for all students.
- Expected: succeeds for active admin.
- Insert, update, or delete weekly-plan metadata directly.
- Expected: fails unless a future migration intentionally adds admin management policies. Current intended admin access is read-only metadata plus server-side signed file links.

### Partner Recitations

As `student_a`:

- Select `partner_recitations` where `student_id = student_a.id`.
- Expected: only `student_a` rows are returned.
- Select `partner_recitations` where `student_id = student_b.id`.
- Expected: zero rows.
- Insert a partner recitation with:
  - `student_id = student_a.id`
  - `week_start = public.week_start_for_date(public.current_effective_date())`
  - `round = public.current_partner_recitation_round()`
  - `points = 75`
- Expected: succeeds if the row does not already exist.
- Repeat the same insert.
- Expected: fails on `partner_recitations_student_week_round_unique`.
- Insert with `student_id = student_b.id`.
- Expected: fails with RLS/permission error.
- Insert for a non-current `week_start`.
- Expected: fails with RLS/permission error.
- Insert for the other round when that round is not current.
- Expected: fails with RLS/permission error.
- Insert with `points` other than `75`.
- Expected: fails with RLS/constraint error.
- Update or delete any partner recitation.
- Expected: fails because students have no update/delete policies.

As `admin_a`:

- Select, insert, update, and delete intended partner-recitation rows.
- Expected: succeeds for active admin, subject to table constraints.

### Halaqa Grades

As `student_a`:

- Select `halaqa_grades` where `student_id = student_a.id`.
- Expected: only `student_a` rows are returned.
- Select `halaqa_grades` where `student_id = student_b.id`.
- Expected: zero rows.
- Insert, update, or delete any halaqa grade.
- Expected: fails because students have no write policies.

As `student_a` or unauthenticated:

- Attempt to create a halaqa grade for any student.
- Expected: fails with RLS/permission error.

As `admin_a`:

- Select all halaqa grades.
- Insert and update intended halaqa grade rows.
- Expected: succeeds for active admin when values satisfy `halaqa_grades_points_check`.
- Delete a halaqa grade.
- Expected: fails unless a future migration intentionally adds an admin delete policy.

## App-Level Verification

Run these checks through the app using staging users:

- Student login lands on `/student/check-in`.
- Student pages show only the signed-in student's current check-in status, history, weekly plan, partner recitation, and grades.
- Direct navigation to `/admin`, `/admin/export`, `/admin/students/new`, and `/admin/students/[id]` as a student redirects away or returns not found.
- Admin login lands on `/admin`.
- Admin dashboard, filters, correction form, student creation, halaqa grade form, and CSV export work for intended records.
- Browser DevTools Network responses for student pages do not include another student's profile, check-ins, check-in items, weekly plans, partner recitations, or halaqa grades.
- Browser bundles do not contain `SUPABASE_SERVICE_ROLE_KEY`.

## Unit Coverage

The current unit tests cover pure helper behavior that supports the access model:

- `test/access.test.ts`: active-user, student-owned-data, admin-data, and check-in submission helper rules.
- `test/weekly-plans.test.ts`: weekly-plan file validation, storage path safety, and ownership helpers.
- `test/checkins.test.ts`: duplicate check-in detection, duplicate partner-recitation detection, and admin correction payloads.
- `test/grades.test.ts`: student grade scoping and grade display helpers.
- `test/partner-recitations.test.ts`: current-round view state.
- `test/security.test.ts`: consolidated security-critical helper expectations.
- `test/super-admin-rules.test.ts`: pure super-admin guardrails and audit payload shaping.

These are not substitutes for RLS tests. They only guard app-side pure functions.

## Future Automated RLS Integration Tests

TODO:

- Add a local Supabase test harness that can start a disposable Supabase stack, apply `supabase/migrations`, seed Auth users and profiles, and run assertions with signed-in anon clients.
- Add RLS integration tests for each table in the manual matrix above.
- Add negative tests for inactive profiles to confirm `is_active_admin()` and `is_active_student()` deny access.
- Add Storage policy tests if direct authenticated Storage access is enabled in addition to the current server-side service-role Storage flow.
- Add CI support for the RLS suite with disposable credentials only. Do not run it against production.
- Keep `npm run check` focused on deterministic local checks, and run RLS integration tests through a separate opt-in command until the harness is stable.
