# ITQAN Student Experience Redesign Handoff

Status: approved by the product owner on 2026-08-14.

This package is the canonical visual and interaction handoff for the authenticated
student experience. It covers the student shell, Today/check-in, Partner
Recitation, Weekly Plan, My Progress, Account, blocking gates, and resilient
loading/error/offline states.

The canvases define hierarchy, density, responsive composition, color roles, and
interaction intent. Live application data, the current scoring version, existing
authorization, privacy, weekly-plan, accountability, and duplicate-prevention
contracts remain authoritative. Do not copy sample names, dates, scores, group
labels, filenames, task labels, or task weights into production.

The product-facing wordmark is always **ITQAN**. Never display `ITQAN Lite` in the
application shell and do not substitute a new logo font or treatment.

## Canonical canvases

1. [Today and check-in](canvases/01-today-check-in.png)
2. [Partner Recitation](canvases/02-partner-recitation.png)
3. [Weekly Plan — uploaded and replacement](canvases/03-weekly-plan-uploaded.png)
4. [Weekly Plan — in-browser preview](canvases/04-weekly-plan-preview.png)
5. [Weekly Plan — missing](canvases/05-weekly-plan-missing.png)
6. [Grades](canvases/06-grades.png)
7. [Check-In History](canvases/07-check-in-history.png)
8. [Leaderboard](canvases/08-leaderboard.png)
9. [Badge Awards](canvases/09-badge-awards.png)
10. [Account and password](canvases/10-account-password.png)
11. [Mobile account sheet](canvases/11-mobile-account-sheet.png)
12. [Weekly-plan-required gate](canvases/12-weekly-plan-required-gate.png)
13. [Accountability gate](canvases/13-accountability-gate.png)
14. [Assignment pending](canvases/14-assignment-pending.png)
15. [Autosave failure and offline](canvases/15-autosave-offline.png)
16. [Loading, route error, and empty states](canvases/16-loading-error-empty-states.png)

Canvas 2 is the authoritative Partner Recitation design. It supersedes the
earlier approved Partner canvas only in navigation: Partner Recitation is now the
first My Progress subview. It retains the streamlined content without the
redundant `This week` section.

Some raster text is illustrative. Exact product copy and behavior in this
document override accidental image-generation spelling, punctuation, or data
errors.

## Information architecture

### Desktop shell

Use the persistent deep-forest sidebar shown in the canvases:

1. Today
2. My Progress
3. Weekly Plan
4. Account

The sidebar contains the compact gold `ITQAN` wordmark, student identity and
current placement, primary navigation, and the Surah Aal-Imran 3:8 verse card.
The active route receives the restrained gold leading rule and lighter green
surface. Account opens the account page on desktop.

### Mobile shell

Use a compact deep-forest header with `ITQAN`, the student's initials, and an
account-sheet disclosure. Use a fixed bottom navigation with exactly:

1. Today
2. My Progress
3. Weekly Plan

Account is intentionally absent from the bottom navigation. The avatar opens the
account sheet with student identity, `Account & security`, and `Sign out`. Do not
restore the previous eight-link mobile dropdown or duplicate primary navigation
inside this sheet.

Respect mobile safe areas. The bottom navigation must not cover the last content,
focused input, validation message, or primary action.

### My Progress

My Progress has five ordered subviews:

1. Partner Recitation
2. Grades
3. Check-In History
4. Leaderboard
5. Badge Awards

Desktop renders these as a local tab row. Mobile renders one labelled `Progress
view` selector. Selecting a subview navigates to its real route and remains
deep-linkable; it is not a client-only content swap.

The My Progress primary destination is Partner Recitation. Preserve the existing
route URLs:

| View | Route |
| --- | --- |
| Today | `/student/check-in` |
| Partner Recitation | `/student/partner-recitation` |
| Grades | `/student/grades` |
| Check-In History | `/student/history` |
| Leaderboard | `/student/leaderboard` |
| Badge Awards | `/student/rewards` |
| Weekly Plan | `/student/weekly-plan` |
| Account | `/account/change-password` |

Existing inbound links and query parameters must continue to work. Shared-shell
or layout refactoring must not weaken the server guards on individual routes.

## Shared visual system

- Product background: warm ivory `#f8f7f2`.
- Primary ink and navigation: deep forest/ink `#17211d`.
- Primary actions, saved states, and progress: `#315747` or the nearest existing
  accessible moss token.
- Restrained emphasis: gold `#b58a3c`; use it for active indicators, verse-card
  trim, warnings, and small moments of emphasis—not as the default button color.
- Work surfaces are white or warm ivory with subtle stone separators.
- Prefer whitespace, alignment, typography, and row dividers over nested cards.
- Use shadows only for overlays, sheets, and meaningful elevation.
- Body text is generally 14–16 px. Do not shrink mobile metadata into unreadable
  display-copy sizes merely to reproduce the raster exactly.
- Use the project's icon library. Do not trace raster icons, use emoji, or create
  improvised SVGs.
- Checklist items are deliberately icon-free. Their label, point weight, and
  checkbox provide enough structure.
- Minimum practical touch target: 44 × 44 px.
- All interactive elements need visible keyboard focus.

## Responsive composition

Verify at 390 × 844, 768 px, and 1440 × 1024.

- At desktop widths, use the persistent sidebar and a bounded readable content
  column; do not stretch tables and forms across the entire viewport.
- On mobile, use the header and bottom navigation. Content becomes one column,
  but information and actions may not disappear.
- Tablet may use the mobile navigation model or a collapsed sidebar, provided
  the hierarchy remains unchanged and the breakpoint does not cause a cramped
  desktop shell.
- Tables become compact labelled rows only where necessary. Preserve meaning,
  sorting context, the current-student highlight, scores, status, and actions.
- Drawers, modals, and sheets must remain within the visual viewport and account
  for on-screen keyboards.

## Surah Aal-Imran 3:8

Use this verse consistently throughout the student shell:

- Label: `Surah Aal-Imran 3:8`
- Arabic: `رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا وَهَبْ لَنَا مِن لَّدُنكَ رَحْمَةً ۚ إِنَّكَ أَنتَ الْوَهَّابُ`
- Translation: `Our Lord, do not let our hearts deviate after You have guided us, and grant us mercy from Yourself. Indeed, You are the Ever-Giving.`

The card treatment follows the earlier Quran 83:26 visual reference: deep green
surface, thin restrained gold border, small gold source label, prominent Arabic,
and supporting translation. Spell out the surah name; do not display only a
numeric surah reference.

On desktop, the verse lives near the bottom of the persistent sidebar. On the
mobile Today screen, it appears between the weekly overview and the checklist.
Do not move it below the checklist. The verse does not need to repeat inside
every mobile My Progress or Weekly Plan page.

## Surface contracts

### Today and daily check-in

- Show the greeting, effective Toronto date, current operational week, and a
  Sunday-through-Saturday overview.
- Day states are `Saved`, `Missing`, `Today`, and `Upcoming`. Do not characterize
  an upcoming day as missing.
- Mobile order is: greeting, week overview, verse, checklist, weekly progress.
- Desktop places the checklist and weekly progress side by side when space
  permits.
- Checklist rows show only the live task label, its maximum point weight, and a
  checkbox. Do not show redundant `40 / 40`, `12 / 20`, or similar earned-point
  fractions per row.
- Task labels and weights come from the date/version-aware scoring system. The
  redesign does not hard-code the sample canvas checklist.
- Checking or unchecking one item saves that item automatically. There is no
  page-level `Save today's check-in` button.
- While a row is saving, disable only that row and provide a non-layout-shifting
  saving indication. After success, update the daily and weekly totals and show
  `Saved just now` or a meaningful saved timestamp.
- The optional note remains available and follows its current separate save
  behavior. Do not remove it.
- The weekly progress summary retains Daily checklist, Partner recitation,
  Halaqa, total points/percentage, and the below-70 streak. The streak uses
  completed weeks only.
- Remove `Upcoming responsibility`; Partner Recitation has a durable My Progress
  destination.

### Partner Recitation

- Explain that two rounds are completed each week.
- Show both round windows and whether each is closed, open, completed, or
  upcoming.
- Emphasize the current actionable round and its point value.
- The primary action is `Confirm partner recitation` only when the round is
  currently confirmable.
- Preserve duplicate-confirmation prevention and the existing server-side date,
  student-scope, and round checks.
- Do not reintroduce a redundant `This week` summary block.

### Weekly Plan

#### Missing plan

- Show the selected operational week, current placement/teacher context, and the
  accepted types and size: PNG, JPG, or PDF up to 3 MB.
- Desktop supports drag-and-drop and file selection. Mobile uses a clear
  `Choose file` action without promising drag-and-drop.
- Preserve the privacy message: the plan is available only to the student,
  assigned/authorized teachers, and authorized admins.

#### Uploaded plan

- Show one current plan with preview thumbnail when supported, filename, file
  type, upload timestamp, `View plan`, and `Download`.
- The replacement area is secondary. Selecting a new file does not replace the
  current plan immediately.
- The current plan remains available until the replacement upload completes
  successfully. A failed replacement leaves the current plan intact.
- Use the live file constraints and validation strings from `lib/weekly-plans.ts`.

#### In-browser preview

- `View plan` opens an overlay in the same browser tab; it does not force a
  download or navigate away from the weekly-plan workspace.
- Desktop uses a centered modal with filename/week context, zoom out, zoom in,
  zoom percentage, fit-to-width, download, and close controls.
- Mobile uses a full-viewport viewer with back/close, filename, download, page
  count, zoom out, fit, and zoom in.
- PDF and image plans must be viewable. Preserve aspect ratio and allow scrolling
  or panning at zoomed sizes.
- The overlay traps focus, closes with Escape and its explicit close control,
  restores focus to `View plan`, and does not expose a permanent public Storage
  URL.

### Grades

- Default to the current operational week when available; allow selecting an
  available week and applying it with `View week`.
- Current weeks are marked `In progress`; completed weeks are marked `Final`.
- Keep the total score, Daily checklist, Partner recitation, Halaqa grade,
  below-70 streak, Saturday attendance, recitation mark, halaqa total, and
  teacher feedback.
- Historical week selection changes the displayed result in this same Grades
  surface; do not create a second historical-grades route.
- Do not display final language for an incomplete current week.

### Check-In History

- Keep this as its own My Progress subview, separate from weekly Grades.
- Default to the current week and allow week selection.
- Summarize saved, missing, today-in-progress, and upcoming day counts.
- Render days as an accessible disclosure list. Only one expanded row is needed
  by default; opening several is acceptable if keyboard and mobile behavior stay
  clear.
- Expanded saved days show stored completed items, missed items, point weights,
  daily total, saved timestamp, and the student's own note when one exists.
- Today with no saved activity says `Not completed yet`. Historical unchecked
  items are `Missed`. Upcoming days do not imply failure and show no score.
- Preserve historical stored labels and weights; do not recompute old days from
  the newest checklist version.

### Leaderboard

- Keep it cohort-scoped and week-selectable.
- Show whether the selected week is `Final` or `In progress`.
- Lead with the student's rank, score/points, rank movement, and distance behind
  the next rank where applicable.
- Highlight the current student's row without hiding other cohort rows.
- Mobile may combine score and points into one column but must preserve rank,
  student, threshold status, and rank movement.
- Do not expose phone numbers, notes, private check-in details, or students from
  another authorized scope.

### Badge Awards

- Explain the actual award rule: one badge for each percentage point above 90%
  in a completed week; current and orientation weeks do not earn badges.
- Show total badges and badges for the selected month.
- Include the approved month selector. It filters Award history and updates the
  month-specific total; the all-time total remains all-time.
- Award history shows completed week, weekly score, and badges earned.
- Do not add unrelated incentives, payments, or accountability data to this
  student surface.

### Account and password

- Show the student's name, role, masjid/cohort/group context, and phone as
  read-only identity information when available.
- Do not imply these identity fields are editable.
- Keep the existing password route and server action.
- Password form fields are `New password` and `Confirm new password`, each with
  an accessible show/hide control.
- Preserve the minimum eight-character rule and exact server validation.
- Pending label: `Updating...`
- Success: `Password updated successfully.`
- Validation examples: `Password must be at least 8 characters.` and `Passwords
  do not match.`
- Sign out is visually separated from the password form and requires no new
  confirmation dialog.

## Blocking and degraded states

### Weekly-plan-required gate

This gate blocks only the Today/check-in route. Preserve the operational week
derived by the reset-aware effective date.

- Heading: `Upload this week's plan to unlock today's checklist`
- Support: `Weekly plans are due at the start of the week. Upload this week's plan before continuing today's checklist.`
- Week label: `Required plan week`
- Action: `Upload weekly plan`

The action navigates to Weekly Plan. My Progress, Account, and other permitted
student routes remain accessible.

### Accountability gate

This gate also blocks only the Today/check-in route and uses the oldest pending
blocking obligation selected by existing backend logic.

- Heading: `Confirm your sadaqa to unlock today's checklist`
- Support: `Your score for a previous week was below 70%. Please confirm your required sadaqa before continuing today’s checklist.`
- Required label: `Required sadaqa`
- Question: `Have you paid the required sadaqa?`
- Primary action: `Yes, I paid the sadaqa`
- Secondary action: `Not yet`
- Not-yet feedback: `Your checklist will remain paused until sadaqa is confirmed.`

Do not merge this gate with the weekly-plan gate or change accountability status
without the existing authenticated server action.

### Assignment pending

- Explain that the account is active but the student has not been assigned to an
  active halaqa context for the selected week.
- Tell the student to contact an administrator; do not blame the student or
  expose internal IDs.
- Account and sign-out remain available.
- Today, My Progress, and Weekly Plan are visually subdued and non-actionable
  while their required scope is absent.
- Do not fabricate a default masjid, cohort, group, or teacher.

### Autosave failure

- Use optimistic interaction only if failure reliably rolls the checkbox back to
  the last persisted state.
- Display a row-specific error and `Retry`; retain the failed intended value for
  that retry.
- Do not update aggregate scores until the write succeeds.
- A failure in one row must not freeze unrelated saved content or navigate away.
- Repeated clicks must not create duplicate daily records or conflicting item
  rows.

### Offline

- Detect loss of browser connectivity and show a persistent but compact offline
  status.
- Preserve visibly saved checkbox values but disable further checklist changes
  until connectivity returns.
- Do not claim changes will sync later: this design does not authorize an
  offline mutation queue.
- On reconnection, refresh authoritative state before allowing another edit if
  the client cannot prove its displayed version is current.

### Loading

- Use shell-stable skeletons so the sidebar/header and bottom navigation do not
  jump during route loading.
- Skeletons reflect the destination's real hierarchy; do not show fake numbers,
  fake students, or a generic centered spinner as the whole page.
- Announce extended loading accessibly without repeatedly interrupting screen
  readers.

### Route error

- Keep the student shell available.
- Explain that the specific page could not be loaded and provide `Try again`.
- Offer a safe route back to Today when retry is not successful.
- Do not show raw Supabase, storage, stack-trace, or internal authorization text.

### Empty states

Exact Grades empty copy:

- `No grade data for this week`
- `Checklist, partner recitation, and halaqa results will appear here when they are available.`

Exact Badge Awards empty copy:

- `No badge awards yet. Complete a week above 90% to earn your first badge.`

Use similarly factual, non-blaming copy for other empty states. An empty state is
not an error and should not offer a retry unless data loading actually failed.

## Accessibility and interaction acceptance

- Sidebar, bottom navigation, local tabs, and mobile selector expose the current
  destination programmatically.
- Desktop local tabs use links or correctly implemented tab semantics; do not
  apply `role="tab"` to ordinary navigation without the full keyboard model.
- Mobile account sheet and plan preview trap focus, close with Escape where a
  keyboard exists, restore focus to their trigger, and prevent background
  interaction.
- Checkboxes have accessible names containing the real task label and saving or
  error state when relevant.
- Status is never communicated by color alone.
- Contrast meets WCAG AA for normal text and controls.
- Zoom to 200% and text-only zoom must not hide core actions.
- Reduced-motion preferences disable non-essential transitions.

## Authorization, privacy, and data integrity

- This is a frontend redesign, not permission to broaden reads or writes.
- Students may only read and mutate their own authorized data.
- Masjid, cohort, group, teacher, weekly-plan, leaderboard, and scoring scope
  remains server-derived and independently protected by RLS.
- Keep service-role credentials out of browser code.
- Weekly-plan viewing uses authenticated, short-lived access.
- Daily checklist duplicate prevention and item uniqueness remain intact.
- Partner-recitation duplicate prevention remains intact.
- Historical labels, points, group identity, and teacher feedback remain tied to
  their recorded week/version.
- Do not expose admin correction metadata, teacher-private records, audit data,
  or other students' private activity.

## Intentionally unchanged

- Scoring formulas, checklist-version effective dates, and Saturday behavior.
- Weekly-plan accepted types, maximum size, storage ownership, and gating rules.
- Accountability amounts, qualification rules, and status lifecycle.
- Partner-recitation windows, point values, and duplicate rules.
- Halaqa grading and teacher feedback semantics.
- Badge calculation and orientation-week exclusion.
- Student route URLs and server-side role checks.
- Admin, teacher, and super-admin interfaces.

## Implementation acceptance

Every implementation PR must include:

- Consistent desktop screenshots at 1440 × 1024.
- Mobile screenshots at 390 × 844 for each materially different surface/state.
- Side-by-side comparison against the matching canonical canvas.
- Authenticated verification with realistic populated data.
- Current and completed week verification where behavior differs.
- Missing-plan and accountability-gate verification.
- Assignment-pending, loading, empty, route-error, autosave-error, offline, and
  reconnection verification.
- Weekly-plan PDF and image preview verification, including zoom, close,
  download, keyboard focus, and mobile overflow.
- Checklist check, uncheck, rapid interaction, failure rollback, retry, and score
  synchronization verification.
- Keyboard and screen-reader-oriented checks for navigation, disclosures,
  checkboxes, account sheet, password form, and plan preview.
- No fixture-only production route, hard-coded sample identity, or authorization
  bypass.
- No unrelated role, route, scoring, schema, or admin/teacher redesign.
- `npm run check` passing.

Visual acceptance requires matching the canvases' hierarchy, spacing, density,
brand treatment, navigation model, and action order on both desktop and mobile.
Passing automated tests alone is not visual acceptance.

## Recommended implementation boundaries

1. **Shared student shell:** responsive sidebar/header/bottom navigation, My
   Progress navigation, account sheet, route loading/error boundaries.
2. **Today and gates:** Today composition, binary item autosave states, weekly
   progress, plan gate, accountability gate, assignment pending, offline/retry.
3. **Weekly Plan:** missing/uploaded/replacement states and authenticated
   in-browser preview.
4. **My Progress:** Partner Recitation, Grades, Check-In History, Leaderboard,
   Badge Awards, week/month selectors, and empty states.
5. **Account and integration QA:** identity presentation, password form, full
   responsive and authenticated regression pass.

These boundaries are implementation guidance, not authorization to merge in
parallel without considering shared-shell conflicts. Preserve existing routes and
backend contracts unless a separately reviewed backend-fit audit identifies a
genuine gap.
