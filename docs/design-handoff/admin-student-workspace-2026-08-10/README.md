# ITQAN Admin Student Workspace Redesign Handoff

Status: approved by the product owner on 2026-08-10.

This package is the canonical visual and interaction handoff for the admin
student-specific experience. It replaces the current long, single-scroll
presentation at `/admin/students/[id]` with a sectioned workspace while
preserving the existing student, scoring, checklist, partner-recitation,
halaqa-grade, weekly-plan, correction, streak-reset, and deletion behavior.

The canvases are visual targets, not new authorization or schema contracts.
Render live data when sample names, dates, filenames, scores, or statuses differ
from production. The product-facing wordmark is always **ITQAN**, never
`ITQAN Lite`.

## Canonical canvases

Only the canvases in this directory are authoritative. Intermediate images from
the design conversation are superseded and must not be used for implementation.

1. [Overview — desktop](canvases/01-overview-desktop.png)
2. [Overview — mobile](canvases/02-overview-mobile.png)
3. [Weekly activity — desktop](canvases/03-weekly-activity-desktop.png)
4. [Weekly activity — mobile](canvases/04-weekly-activity-mobile.png)
5. [Halaqa and plan, attendance No — desktop](canvases/05-halaqa-plan-no-desktop.png)
6. [Halaqa and plan, attendance No — mobile](canvases/06-halaqa-plan-no-mobile.png)
7. [Halaqa and plan, attendance Yes — desktop](canvases/07-halaqa-plan-yes-desktop.png)
8. [Halaqa and plan, attendance Yes — mobile](canvases/08-halaqa-plan-yes-mobile.png)
9. [Corrections — desktop](canvases/09-corrections-desktop.png)
10. [Corrections — mobile](canvases/10-corrections-mobile.png)
11. [Student settings — desktop](canvases/11-student-settings-desktop.png)
12. [Student settings — mobile](canvases/12-student-settings-mobile.png)
13. [Scoring settings initial screen — desktop](canvases/13-scoring-settings-desktop.png)
14. [Scoring settings initial screen — mobile](canvases/14-scoring-settings-mobile.png)
15. [Uploaded weekly-plan preview — desktop](canvases/15-weekly-plan-preview-desktop.png)
16. [Uploaded weekly-plan preview — mobile](canvases/16-weekly-plan-preview-mobile.png)

The raster dimensions are visual-reference dimensions, not CSS pixel
requirements. Implement and verify the responsive product at 390 px, 768 px,
and the existing desktop breakpoints.

## Product and technical scope

### In scope

- Reorganize the existing admin student-specific route into five sections.
- Keep student identity and tracker-week selection persistent across sections.
- Encode the active section and week in the URL.
- Improve the daily-history, halaqa-grade, partner-correction, daily-correction,
  student-settings, and scoring-settings presentation.
- Add secure in-browser preview for PDF, PNG, and JPEG weekly plans while
  retaining a distinct download action.
- Preserve independent form saves and existing audited server mutations.

### Intentionally unchanged

- Student, teacher, and super-admin product surfaces.
- Checklist definitions, weights, effective-date versioning, and weekly-score
  calculations.
- Partner-recitation scoring and its fixed 75 points per round.
- Halaqa grading rules and the 150-point maximum.
- Weekly-plan upload behavior, allowed types, size limit, and storage layout.
- Below-70 streak computation and reset authorization.
- Admin scope, RLS, historical records, audit requirements, and atomicity.
- The existing scoring-boundary preview-and-confirm workflow.
- Database schema unless a backend-fit audit proves an additive change is
  required. No destructive migration is authorized by this handoff.

## Workspace information architecture

The canonical section order is:

1. Overview
2. Weekly activity
3. Halaqa & plan
4. Corrections
5. Student settings

Recommended URL shape:

- `/admin/students/[id]?week=YYYY-MM-DD&view=overview`
- `/admin/students/[id]?week=YYYY-MM-DD&view=activity`
- `/admin/students/[id]?week=YYYY-MM-DD&view=halaqa-plan`
- `/admin/students/[id]?week=YYYY-MM-DD&view=corrections`
- `/admin/students/[id]?week=YYYY-MM-DD&view=settings`

`overview` is the default when `view` is absent or invalid. Every navigation
change preserves the canonical Sunday `week`. Reload, deep links, browser
back/forward, action redirects, and success/error messages must retain both
values.

Desktop uses the five-item tab row in the canvases. Mobile uses only the
full-width `Section` selector; do not render a second horizontal tab strip.

The redesign must not hide the original long page behind client-side tabs while
still loading all of its data. Render the shared student/week shell plus the
active section's data. Section-aware loading should reduce the initial payload
and keep each server-rendered request focused.

## Shared student workspace shell

- Reuse the real role-aware application navigation and complete admin links.
- Keep `Back to students`, student name, phone/email, cohort/group context, and
  week selection above the section navigation.
- Use live scoped cohort/group data. Canvas values are illustrative.
- Maintain one main page heading per view and visible keyboard focus.
- Week changes preserve the active section unless that section cannot represent
  the selected historical context, in which case explain the fallback.
- Normal admins must never read or mutate a student outside an actively
  administered masjid.

## Section behavior

### Overview

- Show the selected week's score status and Daily, Partner, and Halaqa totals.
- Show due-day progress and missing-day status.
- Keep the below-70 streak prominent.
- The reset action is available whenever there is an active below-70 streak of
  one or more completed weeks. A zero streak has no reset action.
- Preserve the existing passed-test confirmation and audit behavior.
- Show a concise recent-week activity list linking to Weekly activity.
- Do not show persistent scoring settings on Overview.
- When the selected week is excluded from official scoring, show a compact
  orientation notice directly under the score summary. Omit it for normal
  included weeks.

### Weekly activity

- This section is read-only.
- Desktop uses a week list plus selected-day detail panel.
- Mobile uses an accordion list with one expanded day at a time.
- Show stored date, state, daily score, checklist points, completed items,
  missed items, saved time, and student note where admins are already allowed to
  read it.
- Do not add `Correct this day`, edit icons, inline editing, or another route to
  the same correction form. All mutation lives under Corrections.
- Preserve historical stored labels and weights; do not recompute old checklist
  definitions from the current template.

### Halaqa & plan

- Partner recitation does not belong here; students normally record it and
  admins only correct it when needed.
- Halaqa grade remains here because it is a normal admin/teacher weekly workflow.
- Weekly plan remains read-only for admins.
- Halaqa attendance `No` hides the recitation input and shows zero Attendance,
  Recitation, and Total values. Never show a disabled input containing `50`.
- Halaqa attendance `Yes` reveals the required 10–50 recitation-points input and
  updates Attendance, Recitation, Total, and the section summary live.
- The canvas's `40` and `140 / 150` values demonstrate interaction state only.
- Feedback and halaqa grade save together through the existing individual save
  action. Show unsaved, pending, success, validation, and retryable-error states.

Weekly-plan states:

- Empty: show the selected week and `No plan uploaded for this week.`
- Uploaded: show filename, upload time, file type/size when available, `View
  plan`, and a separate `Download` action.
- Admins cannot upload, replace, approve, comment on, or parse a student's plan.

### Corrections

This is the only student-workspace section for correcting student-entered
records.

Daily check-in correction:

- Reuse the existing date, status, note, and completed-task mutation.
- The date must be within the selected tracker week and no later than the
  operational effective date.
- Changing the date refreshes the stored correction state and the versioned task
  list for that date.
- Save and report status independently from partner recitation.

Partner recitation correction:

- Explain that students normally record rounds themselves.
- Show the two fixed 75-point rounds and their existing stored states.
- The admin corrects completion, not an arbitrary point value.
- Save and report status independently from daily check-in.

Every correction remains server-authorized and audited. There is no page-wide
Save button.

### Student settings

- Rename the former catch-all Admin actions concept to `Student settings`.
- Show the current scoring-eligibility summary and link to the existing
  scoring-settings workflow.
- Isolate the danger zone with significant visual and spatial separation.
- Do not add password, role, membership, activation, or other account controls.
- Do not show daily/partner corrections or streak reset here.

The Jan 4, 2026 scoring date in the canvases is illustrative and was chosen
because scoring boundaries are canonical Sundays. Render the live boundary.
Production has previously exposed `1900-01-07` as a legacy value. The backend-fit
audit must define its intended product meaning before implementation. Do not
silently replace, reinterpret, or mutate production values from the frontend.

## Scoring settings workflow

`Open scoring settings` continues to use the existing dedicated route:

`/admin/students/[id]/official-scoring`

- Restyle the initial screen to match canvases 13 and 14.
- Keep `Back to Abdulaziz` returning to the student's Settings section and
  selected tracker week.
- The proposed boundary must be a canonical Sunday and cannot precede access
  eligibility.
- `Review impact` is not a save. Nothing changes until the impact preview is
  current and the admin supplies a reason and exact-name confirmation.
- Preserve affected-week, obligation-waiver, backward-move, stale-preview,
  scope-denial, and confirmation behavior from the existing workflow.
- Restyle the existing preview/confirmation state with the same hierarchy even
  though the canvases show only the initial state.

## Secure weekly-plan preview

The current implementation requests a signed URL with a forced-download
disposition. The redesign requires a narrow backend addition before the viewer
is enabled:

- Provide separate server-authorized preview and download paths.
- Recheck the active admin's student scope on every request.
- Verify that the storage path belongs to the student and selected canonical
  week.
- Allow only the existing PDF, PNG, and JPEG types.
- Preview responses must use the correct content type and an inline content
  disposition; download responses retain an attachment disposition.
- Use short-lived access and never expose a service-role key to browser code.
- Deny missing, cross-student, cross-masjid, malformed-path, unsupported-type,
  and stale contexts.
- Existing student and teacher download behavior remains unchanged unless a
  separate reviewed change deliberately reuses the preview contract.

Desktop preview:

- Open an accessible modal in the same tab over Halaqa & plan.
- Trap focus, support Escape/overlay/Close dismissal, and restore focus and page
  position to the `View plan` trigger.
- Provide zoom out, current zoom, zoom in, fit, open in new tab, download, and
  close controls.
- Support panning when an image or PDF is zoomed.

Mobile preview:

- Use a full-screen dialog, not a small centered modal.
- Provide Close, Download, Open in new tab, zoom, fit, and page state.
- Support pinch-to-zoom and drag-to-pan without trapping the underlying page's
  scroll.

PDF rendering may use a well-supported viewer implementation. PNG/JPEG previews
may use the native image element plus constrained zoom/pan behavior. If inline
rendering is unavailable, explain the fallback and offer Open in new tab and
Download; never leave the viewer as a blank frame.

## Responsive and accessibility requirements

- Verify at 390 px, 768 px, and desktop widths.
- Mobile must never render desktop section tabs or squeeze desktop columns.
- Touch targets are at least 44 px where practical.
- Inputs retain visible labels; do not rely on placeholder-only identification.
- Modals/dialogs expose an accessible name, trap focus, prevent background
  interaction, support Escape, and restore focus.
- Status must not depend on color alone.
- Preserve readable 14–16 px body text and existing reduced-motion behavior.
- Forms expose pending, success, validation, authorization, stale, and retryable
  failure states without losing entered data unnecessarily.

## Data loading and performance

- Fetch shared student identity, section/week validity, and only the summary
  needed by the active section.
- Overview loads the selected-week score, streak, and a small recent-activity
  subset.
- Weekly activity loads the selected week's daily records and stored items.
- Halaqa & plan loads that week's halaqa grade and weekly-plan metadata.
- Corrections loads editable daily state plus that week's partner rounds.
- Student settings loads scoring-boundary and delete eligibility context.
- Do not fetch all historical check-ins and every section's data for the initial
  Overview render.
- Preserve server rendering, role checks, and RLS; section-aware loading is not
  permission delegation to the browser.

## Visual system

- Reuse the established ITQAN navigation, tokens, form controls, and icon
  library.
- Navigation and primary ink: `#17211d`.
- Primary action green: `#315747`.
- Restrained emphasis gold: `#b58a3c`.
- Page background: `#f8f7f2`.
- Prefer spacing, typography, dividers, and grouped rows over cards-inside-cards.
- Reserve elevation for the weekly-plan modal and other true overlays.
- Canvas document contents are realistic sample data, not a request to generate
  or parse weekly-plan documents.

## Implementation ownership and merge order

1. Merge this design-only handoff.
2. Luna Max: backend-fit audit, legacy scoring-date finding, and secure
   weekly-plan preview/download contract. The backend branch must not redesign
   the student page.
3. Sol Medium: implement the complete student workspace and scoring-settings
   presentation against the fixed backend contract.
4. Merge backend first, rebase frontend, complete visual QA, then merge frontend.
5. Luna Max or equivalent security review: authorization, file response headers,
   cross-scope denial, and regression hardening.

Frontend work may begin after the preview endpoint contract is explicit, but
merges remain serialized.

## Implementation acceptance

The implementation PR must include:

- Desktop and mobile screenshots for all five sections.
- Both Halaqa attendance states.
- Empty and uploaded-plan states plus open desktop/mobile viewers.
- Initial scoring-settings screen and impact-preview/confirmation state.
- Side-by-side visual comparison against the matching canonical canvases.
- URL reload, deep-link, back/forward, week-change, and action-redirect tests.
- Daily and partner correction success/error tests.
- Halaqa conditional-field and live-total tests.
- Weekly-plan preview/download authorization and response-header tests.
- Cross-student and cross-masjid denial tests.
- Keyboard and focus verification for navigation, forms, and viewers.
- No fixture-only production route or authorization bypass.
- No unrelated product-surface or schema changes.
- `npm run check` passing.

Visual approval requires matching the canvases' hierarchy, spacing, density,
color roles, responsive structure, and primary actions. Passing tests alone is
not visual acceptance.
