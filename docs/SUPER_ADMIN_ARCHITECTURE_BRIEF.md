# Super Admin Architecture Brief

## Purpose

This brief is the implementation source of truth for adding a super-admin operations console to ITQAN Lite.

The console exists to replace risky production SQL edits for operational tasks such as:

- Making a teacher also an admin-teacher for a masjid.
- Ending incorrect admin or teacher memberships without deleting history.
- Resetting passwords for users who cannot sign in.
- Inspecting whether a person is a student, teacher, admin, or admin-teacher in a specific masjid.
- Repairing setup gaps such as a student without a group or a masjid without an admin.

This is not a broad analytics dashboard. The first release must be a small, safe operations surface.

## Current Findings

- `profiles.role` already supports `student | teacher | admin | super_admin`.
- `super_admin` exists in the database role constraint and helper functions.
- There is no `/super-admin` route yet.
- Current role routing sends unknown or unsupported role experiences toward account/password pages.
- `profiles.role` is a routing/default-experience hint.
- Actual scoped access comes from:
  - `student_group_memberships`
  - `masjid_staff_memberships`
  - `group_teacher_assignments`
- `admin-teacher` is not a database role. It is a computed state:
  - `profiles.role = 'admin'`
  - active `masjid_staff_memberships` row with `staff_role = 'admin'`
  - active `masjid_staff_memberships` row with `staff_role = 'teacher'`
  - both rows scoped to the same masjid and effective date

Recent incidents this console must make easy:

- Ammar was `teacher` only for Thunder Bay, so he could not add teachers. The UI should show `Teacher only` and explain that this cannot manage staff or students.
- Abdelrahman needed to be Thunder Bay admin-teacher and removed from an incorrect TIC admin membership.
- A student password needed to be reset manually.
- Thunder Bay students needed a score/streak baseline reset based on membership start.

## Non-Negotiables

- Preserve all current student and admin features.
- Use TypeScript.
- Use server-side authorization and Supabase RLS.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.
- Service-role clients may only be created after a server-side super-admin guard passes.
- Do not trust client-submitted scope. Derive masjid/cohort/group scope on the server.
- Do not delete historical memberships for normal operations. End memberships with `ends_on`.
- Do not create an `admin_teacher` profile role.
- Do not build a new visual language. Reuse the existing admin UI style.
- Do not build Phase 1B until Phase 1A is complete and verified.
- `npm run check` must pass before merging implementation work.

## Authorization Model

`/super-admin` must require all of:

- Valid Supabase Auth user.
- Active row in `public.profiles`.
- `profiles.role = 'super_admin'`.
- Server-side guard on every page and action.

Recommended helper:

- `lib/super-admin.ts`
  - `requireSuperAdmin()`
  - `assertCanManageMasjid()`
  - `assertProfileRoleTransition()`
  - `assertMembershipScope()`
  - `assertNotSelfDemotion()`
  - `assertNotLastSuperAdminRemoval()`

Normal masjid admins must not gain `/super-admin` access through `masjid_staff_memberships`.

Update role routing:

- `defaultPathForRole("super_admin")` should return `/super-admin`.
- `AppNav` should expose a super-admin nav set for super admins.
- Normal `/admin` routes can remain scoped-admin routes.

## Operation Split

### Super Admin Only

- Access `/super-admin`.
- Create/update/deactivate masajid.
- Create/update/deactivate cohorts.
- Grant or revoke `staff_role = 'admin'`.
- Change `profiles.role`.
- Change `profiles.active`.
- Promote/demote admin-teacher patterns.
- Reset passwords.
- Move students or staff across masajid.
- Create another `super_admin` outside Phase 1 UI through a controlled runbook.

### Scoped Masjid Admin

These remain scoped to the masjid where the admin has active admin membership:

- Existing admin dashboard, grading, corrections, exports, rewards, incentives, and rotation.
- Create students in their own masjid.
- Create teachers in their own masjid.
- Create/update halaqa groups in their own masjid, if supported by that phase.
- Move students between groups inside their own masjid, if supported by that phase.
- Grant/revoke `staff_role = 'teacher'` inside their own masjid, if supported by that phase.
- Assign teachers to groups/weeks inside their own masjid.

Admin grants remain super-admin only.

## Phase 0: Security Foundation

Phase 0 must happen before exposing `/super-admin` writes.

### Migration

Add an audit table:

```sql
create table public.super_admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  target_table text,
  target_id uuid,
  target_masjid_id uuid references public.masajid(id),
  before_data jsonb,
  after_data jsonb,
  metadata jsonb
);
```

RLS:

- Enable RLS.
- Super admins can read audit events.
- Inserts should happen only through server-side actions or a guarded RPC.
- No client/browser path should write audit rows directly.

Review and tighten dangerous broad policies where needed:

- `masajid`
- `cohorts`
- `halaqa_groups`
- `student_group_memberships`
- `masjid_staff_memberships`
- any profile role/active mutation path

The goal is not to break existing scoped admin flows. The goal is to prevent normal admins from granting admin access, changing global roles, or changing other masajid.

### Server Guardrails

Every write action must:

- Call `requireSuperAdmin()` or the appropriate scoped admin guard.
- Derive target masjid from the submitted cohort/group/membership IDs server-side.
- Validate effective dates.
- Respect no-overlap constraints for student and staff memberships.
- Log successful mutations to `super_admin_audit_events`.
- Never log plaintext passwords.
- Block self-demotion or self-deactivation.
- Block removing the last active super admin.

## Phase 1A: People And Access Console

This is the first user-facing implementation target.

### Routes

- `/super-admin`
  - Redirect to `/super-admin/people`.
- `/super-admin/people`
  - Search and list people.
- `/super-admin/people/[id]`
  - Inspect and change a person's profile/access/password.

### People Search

Search by:

- Name
- Phone
- Synthetic auth email
- Real email if later stored separately

Filters:

- Active/inactive
- Profile role
- Masjid
- Staff role
- Student group

Results show:

- Name
- Phone/email
- Profile role
- Active state
- Current student group, if any
- Current staff access summary by masjid
- Action: `Open`

Example access summaries:

- `Thunder Bay: Teacher only`
- `Thunder Bay: Admin + Teacher`
- `TIC: Admin only`
- `No active access`

### Person Detail

Show:

- Identity block:
  - name
  - phone
  - auth email
  - profile role
  - active status
  - created date
- Student memberships:
  - current and historical `student_group_memberships`
- Staff memberships:
  - current and historical `masjid_staff_memberships`
- Teacher assignments:
  - current/upcoming `group_teacher_assignments`
- Setup warnings:
  - active profile with no access
  - inactive profile with open memberships
  - active teacher without teacher staff membership
  - active student without group
  - teacher-only user cannot add teachers or manage students
- Audit placeholder:
  - show recent audit events only after Phase 0 audit data exists

### Access Editor

Access presets:

- Student
- Teacher
- Admin
- Admin + Teacher
- Inactive

Rules:

- Student:
  - `profiles.role = 'student'`
  - active profile
  - require active masjid, cohort, and group
  - close current student membership ending the day before new `starts_on`
  - insert new `student_group_memberships`
- Teacher:
  - `profiles.role = 'teacher'`
  - active profile
  - ensure active `masjid_staff_memberships` row with `staff_role = 'teacher'`
- Admin:
  - `profiles.role = 'admin'`
  - active profile
  - ensure active `masjid_staff_memberships` row with `staff_role = 'admin'`
  - optionally close teacher membership only if user selected admin-only
- Admin + Teacher:
  - `profiles.role = 'admin'`
  - active profile
  - ensure active staff rows for both `admin` and `teacher` in the same masjid
- Inactive:
  - `profiles.active = false`
  - close open student memberships
  - close open staff memberships
  - optionally ban Auth user in a later phase after the UX and runbook are explicit

No autosave.

Use explicit `Save access changes`.

For risky changes, show a preview before saving:

- rows to close
- rows to create
- profile fields to update
- masjid/cross-masjid effects

Require typed confirmation for:

- granting admin access
- removing admin access
- deactivating a profile
- cross-masjid student or staff movement

Recommended confirmation:

- Type the person's name for person-level risk.
- Type the masjid name for admin access changes.

### Password Reset

Password reset must be separate from access changes.

Flow:

- On person detail only.
- Super admin only.
- Require typed confirmation with person's name or phone.
- Generate or accept a temporary password with existing password validation.
- Call Supabase Auth admin update server-side.
- Show the temporary password once after success.
- Ask the user to change it from `Password` after signing in.
- Audit the reset action without storing the plaintext password.

Success copy:

```text
Temporary password set for [Name]. Share it directly and ask them to change it after signing in.
```

Clarifying copy:

```text
This does not change their masjid access.
```

## Phase 1B: Masjid Setup

Do not start Phase 1B until Phase 1A is complete and verified.

Routes can stay under `/super-admin`:

- `/super-admin/masajid`
- `/super-admin/masajid/new`
- `/super-admin/masajid/[id]`

Minimum flows:

- List masajid.
- Create masjid:
  - name
  - slug
  - active
- Create cohort:
  - masjid
  - kind: brothers or sisters
  - name
  - sort order
  - active
- Create group:
  - cohort
  - name
  - sort order
  - active
- Assign first admin or admin-teacher.

Thunder Bay-style setup should be supported:

- Masjid with brothers cohort only.
- One default active group.
- First admin/admin-teacher assigned after creation.

No delete UI in Phase 1B. Deactivation only.

## Phase 2: Scoped Admin Delegation

After Phase 1A and 1B are stable:

- Refactor existing admin user/group actions to share guard helpers.
- Let masjid admins manage teachers/students inside their own masjid.
- Keep admin grants, role changes, password resets, and cross-masjid movement super-admin only.
- Add repair flows for common scoped setup errors.

## Phase 3: Operational Polish

Later work:

- Audit log search/export.
- Denied-attempt logging.
- Session/IP/user-agent metadata for sensitive actions.
- Bulk import and repair.
- Cross-masjid reports.
- Roster/group balancing UI.
- Optional two-person approval for super-admin promotion or destructive deactivation.

## UI And Interaction Direction

Use current app conventions:

- `AppNav`
- `mx-auto max-w-6xl px-4 py-8`
- white bordered panels
- dense tables/forms
- moss primary buttons
- red/amber/green banners
- `overflow-x-auto` tables where appropriate

Do not use:

- decorative dashboards
- charts
- analytics widgets
- new brand styling
- card-heavy landing pages

### Layout

First screen:

- Title: `Super Admin`
- Support text: `Manage people, masjid access, and account recovery.`
- Primary panel: person search
- Secondary panel: setup issues or masjid summary later

### Staff Membership Editor

Per masjid, show computed state:

- `No staff access`
- `Teacher only`
- `Admin only`
- `Admin + Teacher`

Use two independent controls:

- `Admin access`
- `Teacher access`

Show:

- masjid name
- active role state
- starts on
- ends on
- active today or not active today

Warnings:

```text
This person can teach/rotate where assigned, but cannot add teachers or manage students for this masjid.
```

```text
This gives access to manage students, staff access, grades, corrections, plans, exports, and rotation for [Masjid].
```

```text
They will remain a teacher but will no longer manage staff or students for this masjid.
```

### Mobile Requirements

- Inputs and buttons must use current touch-friendly sizing.
- Staff rows stack by masjid.
- Checkboxes/toggles remain visible without horizontal scrolling.
- Destructive and privileged actions must not sit directly adjacent on mobile.
- Confirmation input appears directly above the submit button.

### States

Loading:

- `Loading people...`
- `Loading access...`

Empty:

- `Search for a person by name, phone, or email.`
- `No people match this search.`

Permission error:

- `You do not have permission to manage super admin operations.`

Success:

- Include the person and masjid name.
- Put the banner above the changed panel.

## Error Cases To Handle

- No matching people.
- Duplicate phone/profile.
- Auth user exists but profile is missing.
- Profile exists but Auth user is missing.
- Missing masjid/cohort/group setup.
- Student has no active group.
- Masjid has no active admin.
- Teacher has no teacher staff membership.
- Membership overlap constraint failure.
- Invalid tracker week start.
- Inactive target masjid/cohort/group.
- Missing `SUPABASE_SERVICE_ROLE_KEY`.
- Attempt to deactivate or demote self.
- Attempt to remove the last active super admin.

## Out Of Scope For Phase 1A

- Masjid/cohort/group creation UI.
- Bulk import.
- Audit log browser.
- Super-admin self-management.
- Deleting masajid, cohorts, groups, profiles, or memberships.
- Teacher dashboard.
- Parent accounts.
- Payments.
- Announcements.
- Plan approval, comments, OCR, or parsing.
- Analytics dashboards.
- New visual design system.

## Acceptance Criteria

Phase 0 + Phase 1A is ready when a super admin can:

- Land on `/super-admin` after login.
- Search for Ammar by phone or name.
- See Ammar labeled as `Teacher only` for Thunder Bay if he lacks admin membership.
- Make Ammar `Admin + Teacher` for Thunder Bay without SQL.
- Search for Abdelrahman by phone or name.
- End an incorrect TIC admin membership without deleting history.
- Reset a student's password safely.
- See that password reset does not change masjid access.
- Deactivate a person and close open memberships with confirmation.
- See clear warnings for setup problems.
- Avoid cross-masjid changes unless explicitly confirmed.

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

## Deployment Order

1. Commit and merge any unrelated pending fixes first.
2. Create a new branch for Phase 0.
3. Add and apply the audit/RLS migration.
4. Smoke test existing student/admin routes.
5. Create a new branch or continue with Phase 1A app work.
6. Implement `/super-admin` pages and actions.
7. Run `npm run check`.
8. Deploy app changes after the migration is live.
9. Smoke test:
   - super-admin login and route guard
   - people search
   - staff membership edit
   - password reset
   - existing student/admin flows

## Implementation Notes

Likely files and areas:

- `lib/access.ts`
- `app/nav.tsx`
- `lib/super-admin.ts`
- `app/super-admin/page.tsx`
- `app/super-admin/people/page.tsx`
- `app/super-admin/people/[id]/page.tsx`
- `app/super-admin/actions.ts`
- `app/super-admin/data.ts`
- `lib/supabase-admin.ts`
- `lib/admin-users.ts`
- `lib/dates.ts`
- `docs/OPERATIONS.md`
- `docs/DATA_MODEL.md`
- `supabase/migrations/*super_admin*`

Use existing patterns from:

- `app/admin/students/new/page.tsx`
- `app/admin/actions.ts`
- `app/admin/rotation/page.tsx`
- `app/admin/rotation/data.ts`
- `app/admin/students/[id]/student-delete-form.tsx`
- `lib/admin-users.ts`
- `lib/supabase-admin.ts`

## Open Questions

- Should Phase 1A allow creating a brand-new person, or only editing existing people and resetting passwords?
- Should inactive users be banned in Supabase Auth immediately, or should Phase 1A only set `profiles.active = false` and close memberships?
- Should generated temporary passwords be system-generated only, or should super admins be allowed to enter one?
- Should audit events be visible in Phase 1A, or only written for later review?

Default recommendation:

- Allow person creation only if it is already supported safely by existing helpers.
- Do not ban Auth users in Phase 1A unless the runbook is explicit.
- Use generated temporary passwords.
- Write audit events in Phase 0, but defer the audit browser UI to Phase 3.
