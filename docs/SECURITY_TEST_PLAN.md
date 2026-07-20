# Security Test Plan

This plan verifies the scoped multi-masjid access model and Supabase row-level security (RLS) policies for ITQAN Lite. It is intended for a local Supabase project or disposable staging environment, not production.

## Scope

Verify these enforcement layers:

- App routes and server actions enforce the signed-in profile role plus effective masjid, cohort, group, or super-admin scope before accessing protected data.
- Browser/server Supabase clients use the signed-in user's session and the anon key, so public table access is constrained by RLS.
- Guarded service-role usage stays server-side. Every mutation validates the actor and target scope before creating an admin client; the read-only login resolver is the pre-auth exception.
- `security definer` functions expose only the minimum required `execute` grants and enforce their own actor/scope checks.
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
- `public.weekly_incentive_runs`
- `public.accountability_obligations`
- `public.badge_awards`
- `public.teacher_rotation_availability`
- `public.cohort_rotation_settings`
- `public.teacher_rotation_runs`
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
- Caller-relative scope helpers documented in `docs/AUTHORIZATION_MATRIX.md`.
- Raw cross-user scope resolution lives in the unexposed `private` schema.

Uniqueness and check constraints that are security-relevant:

- `checkins_student_date_unique` prevents duplicate check-ins for the same student/date.
- `checkin_items_checkin_task_unique` prevents duplicate task snapshots for one check-in.
- `weekly_plans_student_week_unique` allows one weekly plan metadata row per student/week.
- `partner_recitations_student_week_round_unique` prevents duplicate partner-recitation submissions for one student/week/round.
- `partner_recitations_points_check` requires student/admin partner recitation points to be `75`.
- `halaqa_grades_student_week_unique` allows one halaqa grade per student/week.
- `halaqa_grades_points_check` enforces the valid attendance/recitation point combinations.

## Test Data

Create two active masjids with cohorts and groups, then create these users with matching `public.profiles` rows:

- `super_admin_a`: active super admin
- `admin_a`: active admin staff member for masjid A only
- `admin_b`: active admin staff member for masjid B only
- `teacher_a`: active teacher staff member for masjid A only
- `student_a` and `student_a_2`: active students in masjid A
- `student_b`: active student in masjid B
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

- Load students through the scoped admin RPC/app query.
- Expected: only students effectively assigned to masjid A are returned.
- Select all profiles directly.
- Expected: the query must not expose people whose only access is in masjid B. Broad global profile visibility is forbidden.
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

As `teacher_a`:

- Read the assigned group and students for an effective week in masjid A.
- Expected: only the assigned group/week is visible.
- Read an unassigned group or any masjid B group.
- Expected: zero rows or permission denial.

### Privileged Functions

For every application-facing `security definer` function:

- Execute as unauthenticated/`anon`.
- Expected: permission denied unless the function is the explicitly documented read-only pre-auth login resolver.
- Execute as each authenticated role outside its intended scope.
- Expected: permission denied or zero scoped rows.
- Execute scoped read RPCs such as `admin_students_for_week` as `admin_a`.
- Expected: masjid A rows only; no masjid B identifiers or records appear.

Trigger helpers and internal-only maintenance functions must not be executable by `anon` or ordinary `authenticated` users.

### Check-Ins

As `student_a`:

- Select `checkins` where `student_id = student_a.id`.
- Expected: only `student_a` check-ins are returned.
- Select `checkins` where `student_id = student_b.id`.
- Expected: zero rows.
- Insert today's check-in with `student_id = student_a.id`, canonical total weight, zero earned weight/score, and no admin attribution.
- Expected: succeeds when today's row does not already exist; a different date or forged score/attribution fails.
- Insert a second check-in for the same `student_id` and `date`.
- Expected: fails on `checkins_student_date_unique`.
- Insert a check-in with `student_id = student_b.id`.
- Expected: fails with RLS/permission error.
- Update the student's own note or canonical task completion through autosave.
- Expected: succeeds while ownership, date, attribution, and the effective scope snapshot remain unchanged. Task completion recalculates score-bearing columns in the database.
- Directly update `earned_weight`, `total_weight`, `daily_score`, `updated_by_admin`, or the check-in date.
- Expected: fails; these are derived or protected fields.
- Update another student's check-in or delete any check-in.
- Expected: fails or affects zero rows.

As `admin_a`:

- Select check-ins for students in masjid A and masjid B.
- Insert, update, and delete intended correction rows for both masjids.
- Expected: masjid A operations succeed; masjid B rows are hidden and writes fail.

### Check-In Items

As `student_a`:

- Select `checkin_items` where `student_id = student_a.id`.
- Expected: only `student_a` items are returned.
- Select `checkin_items` where `student_id = student_b.id`.
- Expected: zero rows.
- Insert a canonical item with `student_id = student_a.id` and a current-day `checkin_id` that belongs to `student_a`.
- Expected: succeeds when its key, label, and weight match the checklist definition and the task is not already present.
- Insert an invented task or change a task key, label, weight, identity, date, or creation timestamp.
- Expected: fails at the database integrity trigger.
- Insert an item with `student_id = student_a.id` and a `checkin_id` that belongs to `student_b`.
- Expected: fails with RLS/permission error because the referenced check-in is not owned by the signed-in student.
- Insert an item with `student_id = student_b.id`.
- Expected: fails with RLS/permission error.
- Update only the student's own existing item's `completed` flag while its canonical identity remains consistent.
- Expected: succeeds for autosave and atomically recalculates the parent score.
- Update another student's item or delete any item.
- Expected: fails or affects zero rows.

As `admin_a`:

- Select, insert, update, and delete intended correction items in both masjids.
- Expected: masjid A operations succeed; masjid B rows are hidden and writes fail.

### Weekly Plans

This section covers `public.weekly_plans` metadata. Weekly-plan Storage objects are private and are uploaded/replaced/deleted by guarded server actions after checking the signed-in user and target path. Signed sessions have scoped read access for signed-link authorization but no direct object mutation access.

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

- Select weekly-plan metadata for students in both masjids.
- Expected: only masjid A metadata is returned.
- Insert, update, or delete weekly-plan metadata directly.
- Expected: fails unless a future migration intentionally adds admin management policies. Current intended admin access is read-only metadata plus server-side signed file links.

For private Storage as `student_a`:

- Create a signed URL for `student_a`'s current object, then try student B's object.
- Expected: own signing succeeds and peer/cross-masjid signing fails.
- Directly upload, replace, or delete an object, including under `student_a`'s path.
- Expected: fails or affects zero objects; the existing plan remains signable.

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

- Select, insert, update, and delete intended partner-recitation rows in both masjids.
- Expected: masjid A operations succeed subject to constraints; masjid B rows are hidden and writes fail.

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

- Select halaqa grades in both masjids.
- Insert and update intended halaqa grade rows in both masjids.
- Expected: masjid A operations succeed when values satisfy `halaqa_grades_points_check`; masjid B rows are hidden and writes fail.
- Delete a halaqa grade.
- Expected: fails unless a future migration intentionally adds an admin delete policy.

## App-Level Verification

Run these checks through the app using staging users:

- Student login lands on `/student/check-in`.
- Student pages show only the signed-in student's current check-in status, history, weekly plan, partner recitation, and grades.
- Direct navigation to `/admin`, `/admin/export`, `/admin/students/new`, and `/admin/students/[id]` as a student redirects away or returns not found.
- Admin login lands on `/admin`.
- Admin dashboard, filters, correction form, student/teacher creation, halaqa grade form, and CSV export expose only the admin's effective masjid scope.
- A super admin can open `/super-admin`, `/super-admin/people`, and `/super-admin/masajid`; all other roles are rejected server-side.
- A teacher's database reads are limited to their effective assignment. The teacher-facing dashboard remains a separate implementation phase.
- Switching between test users from masjid A and masjid B never leaks names, counts, IDs, files, grades, or leaderboard data across masjids.
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

## Required Phase 1 Automated RLS Integration Tests

Phase 1 is not mergeable until a local disposable Supabase harness:

- Applies all migrations and seeds the two-masjid role matrix above.
- Runs table and RPC assertions with signed-in anon clients, never the service role.
- Proves normal admins cannot read or mutate another masjid's operational data.
- Proves students cannot read another student's owned operational records, including a student in the same cohort. The intentional cohort leaderboard RPC may expose only its documented leaderboard fields.
- Proves teachers are limited to their effective assigned group/week.
- Proves inactive profiles and expired/future memberships do not grant current access.
- Tests `security definer` execute grants for `anon`, ordinary authenticated users, admins, and super admins.
- Tests private weekly-plan Storage access and signed-link authorization.
- Proves canonical checklist integrity, derived-score enforcement, foundation-history immutability, and audit-row update/delete immutability.
- Proves signed students can create a canonical current check-in and checklist items, weekly-plan metadata,
  and the currently open partner-recitation confirmation without a service-role client.
- Proves rotation-run reads remain scoped while signed-session insert/update/delete are denied and the
  guarded service-role generation transaction still succeeds.
- Rejects non-Sunday week inputs to weekly projection RPCs.
- Catalog-checks Storage policy command, role, permissiveness, and expressions, plus exact function and
  audit-table privileges rather than relying only on behavioral happy paths.
- Proves transactional account setup denies direct signed calls and cross-masjid actor spoofing, exact
  completed-request lookup rejects cross-actor/changed payload reuse, and exact sequential or concurrent
  request retries create one profile, membership, and audit event.
- Proves an Auth-only identity can resume only when trusted metadata exactly matches the request, actor,
  normalized email, and canonical setup payload; changed payloads, cross-actor attempts, and unrelated
  duplicate identities are not recoverable.
- Proves signed super admins cannot directly mutate profiles or insert/update/delete student/staff
  memberships while service-role-only guarded workflow RPCs remain executable.
- Proves admin/admin-teacher staff grants are atomic, stale-safe, replay-safe, browser-denied, and roll back
  profile, student membership, partial staff membership, and audit writes together on failure.
- Proves super-admin access changes reject stale snapshots and request-ID reuse with changed input.
- Proves standalone staff-membership closure serializes concurrent retries, rejects stale state and sole
  active-masjid-admin removal, and rolls membership plus audit writes back together when a guard fails.
- Proves active-masjid admin coverage remains continuous at future start/end boundaries, requires an
  open-ended terminal handoff, serializes concurrent end/grant operations, and does not apply to inactive masajid.
- Runs through a documented opt-in command with disposable credentials only. It must never target production.

Keep `npm run check` deterministic. The Docker-backed RLS integration command runs as a separate GitHub
Actions job and is a required Phase 1 merge gate.

Run it only against the disposable local stack:

```bash
npm run test:rls
```

The command refuses non-local URLs, uses the service role only for fixture setup/teardown, and performs
every data-authorization assertion through signed-in anon-key clients. A separate catalog assertion,
executed inside the disposable Postgres container, verifies the exhaustive `SECURITY DEFINER` grant set
and empty `search_path` configuration; it never connects to a remote database.
