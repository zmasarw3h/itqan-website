# Multi-Masjid Architecture Brief

> Status: core multi-masjid architecture implemented. The database hierarchy, scoped memberships,
> transactional account workflows, hardened RLS, super-admin console, and assigned-group teacher
> dashboard now exist. Explicit multi-masjid/cohort rotation selection and sisters rotation remain open.

## Purpose

This brief records the architecture used to move ITQAN Lite from one masjid to a scoped multi-masjid
system with brothers/sisters cohorts, teacher assignments, and role-specific experiences.

Use this document before splitting work across database/security, product/role experience, and UI/UX planning. Sub-plans must fit this brief unless a deliberate product decision changes it.

## Product Direction

ITQAN Lite is becoming a multi-masjid operations app while preserving the current student and admin workflows:

- Daily weighted Quran checklist
- Student history
- Partner recitation
- Weekly grades and halaqa grading
- Weekly plan upload/view
- Leaderboards and scoring
- Admin student detail pages
- Corrections
- CSV exports
- User import tooling
- Backup tooling
- Rewards and incentives

The current app is no longer only the original emergency one-masjid MVP. Existing routes, migrations, and README behavior remain the baseline unless explicitly changed by this project.

## Non-Negotiables

- Use TypeScript.
- Keep the migration additive and backfilled.
- Do not drop existing tables, columns, functions, policies, or storage metadata.
- Preserve all existing student and admin features.
- Server-side role checks and Supabase RLS must both enforce access.
- Students must never see private data for students outside their allowed scope.
- Teachers must never get broad admin visibility.
- Admin data must stay protected server-side.
- Service-role keys must remain server-only.
- Use one configured app timezone unless a later explicit requirement adds per-masjid timezones.
- The implementation must end with `npm run check` passing.

## Resolved Product Decisions

These decisions were locked on June 23, 2026:

- Phone numbers are globally unique across all masajid.
- Existing students should be backfilled into the `brothers` cohort under masjid `Toronto Islamic Centre (TIC)`.
- Existing active students still need a default halaqa group inside that cohort for membership integrity. Use a rollout group such as `TIC Brothers Default Group` unless a real initial group list is supplied before implementation.
- Student group changes take effect at the next tracker week boundary, not immediately during the current week.
- One halaqa group has exactly one assigned teacher per week for the first release.
- Teachers can view weekly plans for students in groups assigned to them for the relevant week.
- A student with no active/effective group membership can log in but sees a setup-incomplete state and cannot use student workflows until assigned.
- Add the `super_admin` role value while changing the role constraint, but defer super-admin UI to a later release. New masajid should be created by server-only operational scripts for the first release.

## Scope Hierarchy

The intended hierarchy is:

```text
Masjid
  -> Cohort: brothers | sisters
    -> Halaqa group
      -> Students
      -> Weekly teacher assignment
```

Students belong to one active halaqa group at a time. Their group determines their cohort and masjid.

Teachers are assigned to halaqa groups by week. A teacher can teach different groups in different weeks.

Admins have access across both brothers and sisters cohorts for the masjid or masajid they administer.

## Roles

### Student

Students can:

- Log in with phone/password.
- Use the daily checklist.
- See their own saved checklist state and score.
- Confirm partner recitation rounds.
- View their own weekly grades and grade breakdowns.
- Upload/view their own weekly plan.
- View their own check-in history.
- Change password.
- View the student-facing leaderboard for their own brothers/sisters cohort only.

Students cannot:

- Use student workflows if they have no active/effective group membership.
- See students in another cohort.
- See students in another masjid.
- See admin-only fields such as phone/email unless explicitly approved later.
- Grade other students.
- See teacher/admin screens.

### Teacher

Teachers can:

- Log in with phone/password.
- See the groups assigned to them for the selected week.
- View the roster for those assigned groups.
- View relevant weekly scoring context for students in those assigned groups.
- View weekly plans for students in assigned groups for the relevant week.
- Enter/update halaqa grades for assigned group students for the assigned week.
- Change password.

Teachers cannot:

- Add students.
- Correct daily check-ins unless explicitly added later.
- Export full admin CSVs unless explicitly added later.
- View unassigned groups.
- View another masjid unless assigned there.
- Manage teacher rotations.

### Admin

Admins can:

- Log in with phone/password.
- Access both brothers and sisters cohorts within masajid they administer.
- Add and manage students.
- View active students in scoped masajid.
- View dashboard, leaderboard, rewards, incentives, and scoring data.
- Filter by masjid, cohort, group, week, and status where supported.
- Open individual student admin pages.
- Correct check-ins.
- Enter halaqa grades.
- Assign teachers to groups by week.
- View/download student weekly plans.
- Export CSV data for their allowed scope.
- Use import/backup operations according to existing operational rules.

Admins cannot:

- See or manage masajid outside their admin membership unless a future super-admin role is explicitly introduced.

### Platform Owner / Super Admin

The first multi-masjid release needs a way to create and manage masajid, cohorts, and top-level admin memberships. Do not overload normal masjid admins with cross-masjid creation powers.

Recommended approach:

- Add a `super_admin` profile role value while changing the role constraint, but keep UI deferred unless the first release includes in-app masjid creation.
- `super_admin` can create masajid, create brothers/sisters cohorts, create initial groups, and grant masjid admin memberships.
- `super_admin` should not replace scoped masjid admin checks. Normal admin screens should still operate through explicit masjid membership.
- If in-app masjid creation is not needed for the first release, seed new masajid and initial admin memberships through a server-only operational script using the service role, then add `super_admin` UI later when the operational need is real.

First-release decision: include the `super_admin` role value for future-proofing, keep masjid creation operational/scripted, and defer broad super-admin UI until there is a real operational need.

## Role And Visibility Matrix

| Capability | Student | Teacher | Admin |
| --- | --- | --- | --- |
| Own daily checklist | yes | no | correction only |
| Own history | yes | no | scoped student detail |
| Own grades | yes | no | scoped student detail |
| Weekly plan upload/view | own only | assigned group/week view only | view/download scoped students |
| Partner recitation | own only | no | view in scoring context |
| Student-facing leaderboard | own cohort only | no | scoped admin leaderboard |
| View roster | own cohort leaderboard only | assigned groups/weeks | scoped masjid/cohort/group |
| Enter halaqa grades | no | assigned groups/weeks | scoped students |
| Correct check-ins | no | no | scoped students |
| Add students | no | no | scoped masjid |
| Assign teachers | no | no | scoped masjid |
| CSV export | no | no | scoped export |

## Data Model Direction

Prefer membership and assignment tables over placing all scope fields directly on `profiles`.

Expected new or changed concepts:

- `masajid`
  - One row per masjid.
  - Should support `name`, stable `slug`, `active`, timestamps.

- `cohorts`
  - Belongs to a masjid.
  - `kind` is `brothers` or `sisters`.
  - Usually exactly two active cohorts per masjid.

- `halaqa_groups`
  - Belongs to a cohort.
  - Contains display name, active flag, sort order.

- `student_group_memberships`
  - Connects students to groups.
  - Should be historical with `starts_on` and nullable `ends_on`.
  - Only one active group membership per student at a time.

- `masjid_staff_memberships`
  - Connects admins and teachers to masajid.
  - Supports scoped admin access and possible future multi-masjid staff.

- `group_teacher_assignments`
  - Connects one teacher to one group for one `week_start`.
  - Should track `assigned_by` and timestamps.
  - Unique per `(group_id, week_start)` unless the product later supports multiple teachers per group/week.

Update `profiles.role` to include:

```ts
type Role = "student" | "teacher" | "admin" | "super_admin";
```

`profiles.role` is a routing/default-experience hint, not the security source of truth. Actual access must come from `student_group_memberships`, `masjid_staff_memberships`, and `group_teacher_assignments`. RLS must not trust `profiles.role` alone except for basic active-user category checks.

Do not create teacher or admin records outside `profiles`. Keep Supabase Auth user IDs aligned with `profiles.id`.

Operational records should snapshot scope so historical reports remain correct and queries stay practical after students move groups:

- Add `masjid_id`, `cohort_id`, and `halaqa_group_id` to `checkins`.
- Add `masjid_id`, `cohort_id`, and `halaqa_group_id` to `weekly_plans`.
- Add `masjid_id`, `cohort_id`, and `halaqa_group_id` to `partner_recitations`.
- Add `masjid_id`, `cohort_id`, and `halaqa_group_id` to `halaqa_grades`.
- Add `masjid_id`, `cohort_id`, and `halaqa_group_id` to `accountability_obligations`.
- Add `masjid_id`, `cohort_id`, and `halaqa_group_id` to `badge_awards`.

Do not duplicate scope columns on `checkin_items` initially because each item belongs to a scoped `checkins` row. Add them later only if RLS or query performance proves the duplication is necessary.

For daily records, snapshot the student's group for the tracker week containing that date. For weekly records, snapshot the student's group for that `week_start`. New writes should fail safely if the student has no effective group for the relevant week.

## Existing Data Backfill

The first migration should preserve existing data by creating a default structure:

- Masjid: `Toronto Islamic Centre (TIC)`.
- Slug: `tic`, unless an existing operational convention requires a different stable slug.
- Cohort: `brothers`.
- Default group: `TIC Brothers Default Group`, unless a real initial group list is supplied before implementation.
- Existing admins become admins for `Toronto Islamic Centre (TIC)`.
- Existing students receive current active group memberships.

The product owner confirmed the current backfill cohort as brothers, so the production migration may backfill active students into the TIC brothers default group. The group should be treated as a rollout placeholder that admins can reorganize into real halaqa groups effective next week.

## RLS And Server Access Direction

RLS must be the hard boundary. App-level checks should mirror RLS but not replace it.

The current broad policies such as "Admins can read all profiles/checkins" must become scoped.

Expected helper functions:

- `is_active_student()`
- `is_active_teacher()`
- `is_active_admin()`
- `is_admin_for_masjid(masjid_id uuid)`
- `is_staff_for_masjid(masjid_id uuid)`
- `student_current_group_id(student_id uuid)`
- `student_group_for_week(student_id uuid, week_start date)`
- `student_cohort_for_week(student_id uuid, week_start date)`
- `student_masjid_for_week(student_id uuid, week_start date)`
- `is_teacher_for_group_week(group_id uuid, week_start date)`
- `can_read_student_for_week(student_id uuid, week_start date)`
- `can_grade_student_for_week(student_id uuid, week_start date)`

`student_group_for_week(student_id uuid, week_start date)` is the central database primitive. Derive cohort, masjid, teacher assignment, leaderboard scope, grading scope, and most weekly authorization from it.

RLS policy intent:

- Students read/write only their own owned rows where existing behavior allows it.
- Students may read cohort leaderboard data only through carefully scoped server-side queries or safe database views/functions.
- Teachers read only assigned group/week students and data needed for grading.
- Teachers write only halaqa grades for assigned group/week students.
- Teachers read weekly-plan metadata and receive signed weekly-plan file URLs only for assigned group/week students.
- Admins read/write only records for masajid where they have admin membership.
- Super admins, if added, can manage masajid and masjid admin memberships, but should not bypass scoped app flows unnecessarily.
- Service role remains limited to server-only operations already requiring it, such as Auth user creation and private Storage signed URLs.

Exact teacher grading rule:

```text
A teacher may insert or update halaqa_grades only when:
- student_group_for_week(halaqa_grades.student_id, halaqa_grades.week_start) = group_teacher_assignments.group_id
- group_teacher_assignments.teacher_id = auth.uid()
- group_teacher_assignments.week_start = halaqa_grades.week_start
- the teacher profile and assignment are active/effective
```

This prevents teachers from grading students who moved groups, students in another cohort, or students in another masjid.

## Leaderboards

There are two different leaderboard products:

### Student-Facing Leaderboard

- Scope: signed-in student's current cohort.
- Brothers see brothers in the same masjid.
- Sisters see sisters in the same masjid.
- The leaderboard is cohort-wide, not halaqa-group-wide. Brothers in different halaqa groups inside the same masjid can see each other on the brothers leaderboard; sisters likewise.
- Should not expose phone numbers, emails, weekly plan metadata, admin notes, or private operational fields.
- Should show rank, display name, and weekly scoring summary.

## Unassigned Student Behavior

Students with no active/effective group membership should not be silently placed into leaderboards or allowed to create unscoped records.

Required behavior:

- They can authenticate.
- They land on a setup-incomplete page instead of the normal student workflow.
- They cannot use check-in, weekly plan upload, partner recitation, grades, rewards, history, or leaderboard until assigned.
- Message: `Your ITQAN group is not assigned yet. Please contact your masjid admin.`
- Admins should have a visible way to find and assign unassigned students within their operational scope once admin group management exists.

## Student Weekly Teacher Visibility

Students should be able to see who is assigned to their halaqa group for the current week.

Recommended behavior:

- Show a compact `This week's teacher` panel on `/student/check-in`.
- Also show the same teacher name on `/student/grades` and `/student/weekly-plan`, because those pages relate to weekly grading and plan review.
- Resolve the teacher server-side from the signed-in student's group membership active at the selected `week_start`, then `group_teacher_assignments`.
- Display teacher name only. Do not show teacher phone/email unless a later explicit requirement adds staff contact visibility.
- If no teacher is assigned, show `Teacher not assigned yet.`
- If the student has no active group membership, show the setup-incomplete state and do not attempt to show teacher assignment.

Data shape for student-facing teacher display:

```ts
type StudentTeacherAssignmentView = {
  weekStart: string;
  masjidName: string;
  cohortKind: "brothers" | "sisters";
  groupName: string;
  teacherName: string | null;
};
```

This view must not expose teacher IDs, phone numbers, emails, staff membership metadata, or assignment audit fields to the browser unless needed by the UI.

### Admin Leaderboard

- Scope: selected masjid/cohort/group where the admin has access.
- Supports existing weekly scoring, below-70 filtering, rewards/incentives context, and CSV export.
- Should include filters for masjid, cohort, group, week, and status where practical.

## Teacher Rotation

Teacher assignment is weekly.

Recommended behavior:

- Admin assigns a teacher to each halaqa group for a selected week.
- Teacher dashboard defaults to the current week.
- Teacher can change week and see historical/future assignments.
- Teacher can grade only assigned students for that group/week.
- Teacher can view weekly plans for assigned students for that group/week.
- If a student changes groups mid-year, changes take effect at the next tracker week boundary. Historical weekly membership determines who the teacher could grade for older weeks.
- Exactly one teacher is assigned per group/week for the first release.
- The write rule must use `student_group_for_week(student_id, week_start)` and the current `group_teacher_assignments` row for that exact `week_start`.

Open design point:

- Later releases may support assistant teachers or multiple teachers per group/week. Do not model that in first-release UI behavior.

## Login UX Direction

Keep the login form simple:

- Phone number
- Password

Do not add a masjid selector to login. Phone numbers are globally unique across all masajid, and the current Auth design maps normalized phone numbers to synthetic unique emails.

Role and scope should be resolved after authentication:

- Student lands on student check-in.
- Teacher lands on teacher dashboard.
- Admin lands on admin dashboard.
- Super admins, if UI is added, land on platform setup/admin.
- A user with access to multiple masajid should choose or switch masjid after login, not before login.

Login page copy should be updated:

- Remove one-masjid/emergency wording.
- Use broader ITQAN language.
- Suggested helper text: "Use the phone number registered with your masjid."
- Do not expose role choices on the login screen.

## Navigation And Route Direction

Existing student routes should remain:

- `/student/check-in`
- `/student/partner-recitation`
- `/student/grades`
- `/student/weekly-plan`
- `/student/rewards`
- `/student/history`
- `/account/change-password`

Add:

- `/student/leaderboard`

Existing admin routes should remain, with scoped filters:

- `/admin`
- `/admin/leaderboard`
- `/admin/students/new`
- `/admin/students/[id]`
- `/admin/incentives`
- `/admin/rewards`
- `/admin/export`
- `/admin/leaderboard/export`

Add admin management routes as needed:

- `/admin/groups`
- `/admin/teacher-assignments`
- `/admin/masajid` is deferred to a later release with super-admin UI.

For the first release, masjid creation should happen through a server-only operational script and normal admins should only manage groups/teachers inside masajid where they already have admin membership.

Add teacher routes:

- `/teacher`
- `/teacher/groups/[assignmentId]` or `/teacher/groups/[groupId]?week=YYYY-MM-DD`

Do not remove existing routes unless explicitly requested.

## UI/UX Principles

- Keep operational screens dense, clear, and scan-friendly.
- Avoid landing-page style marketing surfaces for logged-in users.
- Make scope visible in admin and teacher pages: masjid, cohort, group, week.
- Avoid role leakage in the UI: students should not see admin/teacher affordances.
- Use clear empty states for unassigned students, no assigned teacher, no grades entered, and no visible students.
- Keep mobile layouts usable for admins and teachers entering grades on-site.
- CSV/export filters should visibly match the data exported.

## Import, Export, And Operations

Import tooling must evolve from:

```csv
name,phone,role
```

to include enough scope to create memberships:

```csv
name,phone,role,masjid_slug,cohort_kind,group_name
```

For teachers/admins, group may be blank but masjid should be present.

CSV exports should include relevant scope columns:

- masjid
- cohort
- group
- week

Backup tooling should continue to work. Documentation must be updated to include new tables and operational restore considerations.

## Testing Requirements

Extend unit tests for:

- Access helpers
- Student cohort visibility
- Unassigned student setup-incomplete gating
- Teacher assignment visibility
- Exact teacher grading authorization
- Admin scoped visibility
- Leaderboard filtering
- CSV escaping with new scope columns
- Import validation for masjid/cohort/group

Extend RLS manual/integration plans for:

- Student cannot read other cohort data.
- Student cannot read other masjid data.
- Student with no effective group cannot create unscoped student records.
- Teacher cannot read unassigned groups.
- Teacher cannot grade unassigned groups/weeks.
- Teacher cannot grade students whose effective group differs from the assigned group for that week.
- Admin cannot read another masjid without membership.
- Inactive staff/student access is denied.

Run before finishing implementation:

```bash
npm run check
```

## Phased Implementation Plan

### Phase 1: Schema And Backfill

- Add masjid/cohort/group/staff/student membership/teacher assignment tables.
- Add `teacher` and `super_admin` role values.
- Add snapshot scope columns to operational parent tables.
- Backfill existing data.
- Add indexes and constraints.
- Add RLS helper functions.

### Phase 2: Scoped Access Layer

- Update `lib/types.ts`.
- Update `lib/access.ts`.
- Update profile loading to include memberships or create dedicated scope loaders.
- Replace broad admin assumptions in server actions and data loaders.

### Phase 3: Admin Scope UI

- Add masjid/cohort/group filters.
- Update add-student flow.
- Add group and teacher assignment management.
- Update admin CSV exports.

### Phase 4: Teacher Experience (implemented)

- Add teacher nav.
- Add teacher dashboard.
- Add assigned group roster.
- Add scoped halaqa grading.
- Add assigned weekly plan viewing.

### Phase 5: Student Cohort Leaderboard

- Add student leaderboard route.
- Use cohort-scoped data only.
- Hide private operational fields.

### Phase 6: Login And General UX Cleanup

- Update login copy and role redirects.
- Update navigation per role.
- Add empty states and scope labels.

### Phase 7: Docs, Import, Backup, Tests

- Update README and stale docs.
- Update import tooling and sample CSV.
- Update backup docs.
- Add tests.
- Run `npm run check`.

## Subagent Planning Assignments

After this brief is accepted, use focused subagents:

### Database / Security Planner

Deliver:

- Exact schema proposal.
- Migration ordering.
- Backfill strategy.
- RLS functions and policies.
- Indexes and uniqueness constraints.
- Security risks and mitigations.

### Role Experience / Product Planner

Deliver:

- Route map.
- Permission matrix.
- Student journey.
- Teacher journey.
- Admin journey.
- Edge cases for membership changes, assignment changes, inactive users, and unassigned students.

### UI/UX Planner

Deliver:

- Login page UX recommendations.
- Navigation model per role.
- Admin filter and scope selector model.
- Teacher grading workflow.
- Student leaderboard layout.
- Empty/error state guidance.

### Testing / Rollout Planner

Optional but recommended after the first three:

- Unit test plan.
- RLS verification matrix.
- Migration verification checklist.
- Rollout steps.
- Rollback/mitigation plan.

## Open Questions

- Do admins ever manage more than one masjid?
- Should students with no cohort assignment be blocked from login, shown a limited state, or routed to support text?
- Should teacher assignments be copied forward automatically week to week?
- Are masajid all expected to use the same timezone for the first multi-masjid release?
- What exact server-only operational command/script should create future masajid, cohorts, initial groups, and initial admin memberships?
