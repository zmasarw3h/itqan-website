# ITQAN Teacher And Rotation Redesign Handoff

Status: approved by the product owner on 2026-08-08.

This package is the canonical visual and interaction handoff for the teacher
experience and the Saturday rotation wizard. It supersedes the presentation and
step ordering in the currently deployed admin rotation UI and the unmerged
`codex/teacher-ui-polish` presentation. Existing authorization, privacy, audit,
publication, grading, weekly-plan, and historical-integrity behavior remains in
force unless this document explicitly changes the operational workflow.

## Canonical canvases

1. [Teacher dashboard](canvases/01-teacher-dashboard.png)
2. [Teacher grading workspace](canvases/02-teacher-grading-workspace.png)
3. [Teacher checklist details](canvases/03-teacher-checklist-details.png)
4. [Admin student availability](canvases/04-admin-student-availability.png)
5. [Admin teacher availability](canvases/05-admin-teacher-availability.png)
6. [Admin session groups](canvases/06-admin-session-groups.png)
7. [Admin review and publish](canvases/07-admin-review-publish.png)

The images are visual targets, not schema or authorization specifications. When
sample copy conflicts with live data, render live data without changing the
approved hierarchy. Canvas 1 repeats the sample name `Hassan Youssef` as primary
teacher; production must show each group's real primary teacher. The logged-in
teacher's assigned group alone receives the `Your assigned group` treatment.

The product-facing wordmark is always **ITQAN**. Do not display `ITQAN Lite` in
the application shell.

## Shared visual system

- Reuse the real application navigation and existing role-aware links.
- Navigation and primary ink: `#17211d`.
- Primary action and responsibility green: `#315747`.
- Restrained emphasis gold: `#b58a3c`.
- Page background: `#f8f7f2`.
- Work surfaces: white with subtle stone separators.
- Prefer spacing, alignment, typography, and row separators over nested cards.
- Shadows are reserved for overlays and rare elevation changes.
- Body copy should generally render at 14–16 px with visible keyboard focus.
- Use the project's established icon library or existing components. Do not
  recreate icons or the wordmark from the raster canvases.

## Admin rotation workflow

The rotation experience is a four-screen sequential wizard:

1. Student availability
2. Teacher availability
3. Session groups and primary-teacher assignments
4. Review and publish

The route must encode the selected step so reload, deep links, and browser
back/forward preserve context. The intended URL shape is:

- `/admin/rotation?step=students`
- `/admin/rotation?step=teachers`
- `/admin/rotation?step=groups`
- `/admin/rotation?step=review`

Masjid, cohort, and canonical Sunday `week` parameters remain in the URL. A
route-segment implementation is acceptable only if it preserves the same
behavior and existing `/admin/rotation` links.

Only one step's content is rendered at a time. The progress indicator is not a
set of unrestricted anchor links. Admins may return to completed steps, but a
future step stays locked until its prerequisites are valid.

### Step 1 — Student availability

- Active students attend by default; a missing availability row means attending.
- Absence applies only to the selected Saturday session.
- Permanent membership and history never change.
- Search, absence-only filtering, per-student attendance, and optional reason
  remain available.
- Continuing requires a valid saved availability state.

### Step 2 — Teacher availability

- Availability applies only to the selected cohort and Saturday.
- The number of available teachers becomes the default session-group count.
- Zero available teachers blocks continuation.
- The screen does not assign groups yet.

### Step 3 — Session groups

- Default rule: number of session groups equals number of available teachers.
- Default rule: every available teacher receives one primary group.
- Attending students are balanced across the session groups.
- Placements are Saturday-only and never rewrite permanent membership.
- Unplaced students block continuation and publication.
- Imbalance is a warning unless it leaves a student unplaced.
- A teacher/group-count mismatch is an explicit exception that requires a clear
  warning and confirmation. It must never occur silently.
- Manual redistribution and a detailed placement view remain available.

### Step 4 — Review and publish

- Review student availability, available teachers, session placements, primary
  teachers, and unplaced count together.
- Publishing requires an explicit confirmation.
- Publication is atomic, versioned, audited, and immediately becomes the live
  teacher roster.
- A revision draft never hides or mutates the currently published version until
  the new revision publishes successfully.

### Draft dependency rules

- Editing students after group placement marks the group and review steps stale.
- Editing teachers after group placement marks the group and review steps stale.
- Regeneration must be explicit; do not silently discard manual redistribution.
- Back navigation preserves the draft.
- Stale, replayed, or concurrent writes must fail safely and explain the next
  recovery action.

## Teacher experience

### Dashboard

- Show published cohort sections and every published group the teacher may access.
- `Your assigned group` is visual responsibility emphasis only, not a permission
  boundary.
- Other published cohort groups remain enabled.
- Show real primary teacher, student count, plan count, and grading progress.
- State clearly that the roster is the published Saturday roster and may differ
  from permanent membership.

### Grading workspace

- Use the exact published version, group, student, and week context returned by
  the deployed backend.
- Optimize for scanning with a grouped table/list rather than card-per-student
  presentation.
- Preserve attendance, recitation score, teacher grade notes, weekly-plan link,
  status feedback, and one-student-at-a-time saving.
- Every grade write and weekly-plan link retains the version token.
- Do not add batch grading.

### Checklist details

- Desktop uses a right-side drawer; mobile uses a full-width bottom sheet.
- The drawer/sheet is modal, traps focus, supports Escape and overlay dismissal,
  and restores focus to its trigger.
- Requests include the exact version, group, student, tracker week, and date.
- Show date, stored label, completed state, weight, earned points, record state,
  and daily total.
- Completed items say `Completed`.
- Historical unchecked items say `Missed`.
- Current or future unchecked items say `Not completed yet`.
- Never request or display private student notes, raw check-ins, submission
  timestamps, correction actors, or audit metadata.

## Responsive requirements

- Preserve the hierarchy and action order at 390 px, 768 px, and desktop widths.
- Admin screens remain one step per page on mobile.
- Tables may become labelled stacked rows, but no data or action may disappear.
- Primary Back/Continue or Publish actions remain easy to reach without covering
  focused inputs.
- The teacher grading workspace may stack each student's fields on mobile while
  preserving individual saving and exact context.
- Touch targets are at least 44 px where practical.

## Authorization and data boundaries

- No canvas authorizes widening access beyond the deployed session authorization
  contracts.
- Teachers access only current published session contexts for authorized cohorts.
- Draft, missing, superseded, cross-masjid, and cross-cohort contexts remain denied.
- Admin scope remains enforced server-side and by RLS.
- Student notes and raw check-in records remain excluded from teacher reads.
- No design change mutates production data, permanent membership, or historical
  roster versions.

## Implementation acceptance

Each UI pull request must include:

- Desktop screenshots at a consistent 1440 × 1024 viewport.
- Mobile screenshots at 390 × 844 for every materially different responsive
  surface.
- Side-by-side comparison against the matching canvas.
- Populated, empty, loading, denied, stale, validation, and retryable-error states
  relevant to the surface.
- Keyboard verification for the wizard, grading controls, and checklist modal.
- No fixture-only production route or bypassed authorization.
- No unrelated route, role, or product-surface changes.
- `npm run check` passing.

Visual approval requires matching the canvases' hierarchy, spacing, density,
color roles, navigation, and primary actions. Passing tests alone is not visual
acceptance.

## Planned ownership and merge order

1. Luna Max: backend-fit audit and any approved additive backend amendment.
2. Sol XHigh: admin four-screen wizard.
3. Sol XHigh: teacher dashboard, grading workspace, and checklist surface.
4. Luna Max: integration, authorization, RLS, concurrency, and historical audit.

Teacher UI implementation may proceed in parallel with an admin backend amendment
because its deployed read/write contracts are already stable. Merges remain
serialized: backend amendment (if any), admin wizard, teacher UI, integration
hardening.
