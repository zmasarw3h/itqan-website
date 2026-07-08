# Phase 3B Repair Console Brief

This brief is the implementation source of truth for the first super-admin repair console release.
It follows Phase 0, Phase 1A, Phase 1B, and scoped admin delegation. It intentionally does not add an
audit log UI.

## Goal

Give super admins a safe way to find and fix common setup inconsistencies without writing SQL.

The repair console should make operational problems visible, explain the impact, preview the proposed
change, require explicit confirmation for risky fixes, apply exactly one repair at a time, and write
audit events for successful mutations.

## Non-Goals

- No audit log browser or audit export.
- No bulk repair.
- No automatic background repair.
- No destructive delete UI.
- No normal-admin access to repair tools.
- No teacher dashboard work.
- No new visual design system.
- No broad cross-masjid reporting beyond the issues required for repair.

## Routes

Add routes under the existing super-admin area:

- `/super-admin/repairs`
  - List repairable issues and read-only warnings.
  - Filter by issue type, masjid, and severity if cheap to implement.
- Optional later route only if the list page becomes too dense:
  - `/super-admin/repairs/[issueKey]`

`AppNav` should add `Repairs` for `super_admin` users after `Masajid`.

## First-Release Issue Types

### Repairable

1. `active_student_without_group`
   - Condition: `profiles.role = 'student'`, `profiles.active = true`, and no active/effective
     `student_group_memberships` row for today.
   - Repair: assign the student to a selected active group.
   - Required selection: masjid, cohort, group, effective date.
   - Server must derive masjid/cohort from the selected group and validate it is active.

2. `active_teacher_without_teacher_staff`
   - Condition: `profiles.role in ('teacher', 'admin', 'super_admin')`, `profiles.active = true`,
     and the person is expected to teach but lacks an active `masjid_staff_memberships` row with
     `staff_role = 'teacher'`.
   - First-release detection should use clear signals only:
     - profile role is `teacher`, or
     - person has active/upcoming teacher assignments but no matching active teacher staff row.
   - Repair: add an active teacher staff membership for a selected active masjid.
   - Required selection: masjid, effective date.
   - Do not change `profiles.role` for admin-teachers; keep role as `admin` and add staff access.

3. `inactive_profile_open_memberships`
   - Condition: `profiles.active = false` and any open `student_group_memberships` or
     `masjid_staff_memberships` row exists.
   - Repair: close all open memberships for the person on the selected end date.
   - Required confirmation: type the person's name.
   - End date must be today or earlier unless there is a clear future-dated membership being closed.

4. `active_profile_without_access`
   - Condition: active non-super-admin profile has no active student membership and no active staff
     membership.
   - Repair: send the super admin to the existing person access editor with a status hint.
   - First release should not invent a generic repair because the correct access type requires
     human judgment.

5. `active_masjid_without_admin`
   - Condition: active masjid has no active admin staff membership.
   - Repair: assign an existing active profile as admin or admin-teacher for that masjid.
   - Required confirmation: type the masjid name.
   - Server must reject removing or replacing existing admins in this flow; this repair only adds
     missing admin access.

### Read-Only Warnings In First Release

1. `profile_missing_auth_user`
   - Condition: profile exists but Supabase Auth user lookup fails.
   - Display only. Do not repair automatically in 3B.

2. `auth_user_missing_profile`
   - Condition: Auth user exists but profile is missing.
   - Display only if feasible without expensive Auth pagination. Do not repair automatically in 3B.

3. `teacher_assignment_without_staff_for_week`
   - Condition: assigned teacher lacks teacher staff membership for the assignment masjid/week.
   - Display with link to person detail. Repair through teacher staff membership only.

## Safety Rules

Every repair mutation must:

- Require `requireSuperAdminAdminClient()`.
- Use the service-role client only after the server-side super-admin guard passes.
- Derive target masjid/cohort/group server-side from selected IDs.
- Validate active target masjid/cohort/group records.
- Validate effective dates with existing date helpers.
- Respect existing no-overlap membership expectations.
- Be idempotent when safely repeated.
- Write a `super_admin_audit_events` row on success.
- Never log plaintext passwords.
- Never create, delete, promote, demote, deactivate, or password-reset a super admin in repair flows.
- Never remove the last active admin from an active masjid.
- Never mutate Auth users in 3B except optional read-only lookup for diagnostics.

## UX Requirements

Use existing app conventions:

- `AppNav`
- `mx-auto max-w-6xl px-4 py-8`
- white bordered panels
- dense tables/forms
- moss primary buttons
- red/amber/green status banners
- `overflow-x-auto` tables where needed

The repairs page should show:

- issue count summary
- issue type
- severity: `warning` or `repairable`
- affected person or masjid
- current broken state
- recommended action
- link to related person or masjid detail
- repair form or action where first-release repair is supported

Confirmation rules:

- Type person name for person-level membership closure.
- Type masjid name for adding missing masjid admin access.
- Assigning a student to a group requires explicit group selection and submit, but no typed
  confirmation unless the student currently has another active group.
- Adding teacher staff membership requires explicit masjid selection and submit, but no typed
  confirmation.

Success copy must include the affected person or masjid and the change made.

Empty state:

```text
No repair issues found.
```

Permission error:

```text
You do not have permission to manage super admin operations.
```

## Backend Ownership

The backend implementation agent owns:

- `app/super-admin/repairs/data.ts`
- `app/super-admin/repairs/actions.ts`
- pure repair planning helpers, likely `lib/super-admin-repairs.ts`
- tests for issue detection and repair planning
- audit event payloads
- server-side validation and guardrails

Expected backend functions:

- `loadRepairIssues(adminSupabase, filters)`
- `buildRepairIssues(input)`
- `planStudentGroupRepair(input)`
- `planTeacherStaffRepair(input)`
- `planInactiveProfileMembershipClosure(input)`
- `planMissingMasjidAdminRepair(input)`

Use existing helpers and patterns from:

- `app/super-admin/data.ts`
- `app/super-admin/actions.ts`
- `app/super-admin/masajid/data.ts`
- `app/super-admin/masajid/actions.ts`
- `lib/super-admin-access.ts`
- `lib/super-admin-setup.ts`
- `lib/super-admin.ts`

## Frontend Ownership

The frontend implementation agent owns:

- `app/super-admin/repairs/page.tsx`
- small local components if useful under `app/super-admin/repairs/`
- nav update in `app/nav.tsx`
- UI status messages and empty states

The frontend agent must not implement authorization or repair business logic in components.
Components call server actions and render server-provided issues.

## Review Workflow

After backend and frontend patches are integrated:

1. Run `npm run check`.
2. Use one security/data-integrity review pass focused on:
   - cross-masjid mutation risk
   - super-admin guard placement
   - audit logging
   - membership overlap and effective date handling
   - accidental super-admin self/peer mutation
3. Use one UX/workflow review pass focused on:
   - whether the issue is understandable
   - whether the repair preview is clear
   - whether confirmation is placed near the submit action
   - mobile and dense-table ergonomics
4. Coordinator triages findings.
5. Send clear backend defects back to the backend agent, clear frontend defects back to the
   frontend agent, and patch small obvious fixes directly.
6. Rerun `npm run check`.

Do not automatically apply every reviewer patch. Review agents produce findings; the coordinator owns
final integration decisions.

## Acceptance Criteria

Phase 3B is ready when a super admin can:

- Open `/super-admin/repairs`.
- See active students without groups.
- Assign one such student to an active group with an audited repair.
- See teacher or admin-teacher staff inconsistencies.
- Add missing teacher staff access without changing an admin's profile role.
- See inactive profiles with open memberships.
- Close open memberships for one inactive profile after typed confirmation.
- See active masajid with no active admin.
- Add missing admin access for one masjid after typed masjid-name confirmation.
- See read-only Auth/Profile mismatch warnings where feasible.
- Navigate from a repair issue to the related person or masjid detail page.
- Avoid all repair pages and actions when signed in as a normal admin, teacher, student, or anonymous user.

Existing flows must still work:

- Student login.
- Student daily checklist.
- Partner recitation.
- Student grades.
- Weekly plan upload/view.
- Student history.
- Admin dashboard and leaderboard.
- Admin student detail pages.
- Admin corrections.
- Halaqa grading.
- CSV exports.
- Teacher rotation.
- Super-admin people and masjid setup pages.

## Testing Requirements

Add focused tests for:

- issue detection for each first-release issue type
- no false positive for valid active student/staff/masjid setup
- date window handling
- repair plans are idempotent where applicable
- confirmation mismatch mapping
- normal users cannot reach repair data/actions

Run before handoff:

```bash
npm run check
```

## Deployment Notes

No schema migration is expected for 3B unless implementation discovers a missing constraint or helper
that cannot be safely handled in app code. If a migration becomes necessary, stop and review it before
implementation continues.

Deploy through the normal protected-main PR flow. After deployment, smoke test:

- unauthenticated `/super-admin/repairs` redirects to login
- authenticated super admin can load the repairs page
- one read-only issue list load
- one non-destructive repair in a controlled test account if available
