**Source visual truth**

- `docs/design-handoff/student-experience-redesign-2026-08-14/canvases/01-today-check-in.png`
- Source pixels: 1536 × 1024. This is a design board containing separate desktop and mobile compositions, not one CSS viewport.

**Rendered implementation evidence**

- `artifacts/student-redesign-batch-1/today-1440x1024.png`
- `artifacts/student-redesign-batch-1/today-390x844.png`
- `artifacts/student-redesign-batch-1/today-canvas-comparison.png`
- Desktop: 1440 × 1024 CSS pixels and output pixels, device scale factor 1.
- Mobile: 390 × 844 CSS pixels and output pixels, device scale factor 1.
- Comparison board: 3366 × 1024, with the unscaled canonical canvas, desktop capture, and mobile capture together in one image. The source board was not density-normalized because it combines two differently sized compositions; layout and region-level evidence were compared instead of making false pixel claims.
- State: authenticated disposable local student, current Toronto operational date Sunday, August 16, 2026. The canonical canvas illustrates Thursday. The implementation intentionally uses the current Sunday checklist definition (six weighted tasks) rather than copying the sample Thursday data.

**Full-view comparison evidence**

- The persistent forest sidebar, compact gold wordmark, identity, four desktop destinations, active gold rule, and bottom verse treatment match the canonical hierarchy.
- The mobile forest header and exactly three fixed bottom destinations match the canonical navigation model. Account remains in the accessible avatar sheet.
- Today preserves the canonical order: greeting, week strip, mobile verse, checklist, and weekly progress. Desktop places checklist and weekly progress side by side.
- Warm ivory, deep forest, moss, gold, white work surfaces, stone rules, restrained radii, and minimal shadow follow the approved token roles.

**Focused region comparison evidence**

- Typography: system sans fallback, weights, hierarchy, readable 12–16 px support text, compact uppercase metadata, and long-text wrapping were inspected in the exact captures. The implementation deliberately does not shrink mobile body copy to the raster's illustrative size.
- Spacing: sidebar width, content bounds, week-strip rhythm, checklist row heights, card padding, fixed-nav clearance, and safe-area padding were inspected. No horizontal overflow or fixed-nav clipping remains.
- Colors: forest, moss, gold, ivory, saved/missing/today/upcoming states, error, and offline colors retain semantic contrast and are not color-only.
- Icons and assets: the existing ITQAN wordmark is text as approved; all UI icons use the installed Phosphor library. There are no generated raster assets in this screen and no placeholder imagery.
- Copy: the exact handoff verse, Today labels, autosave language, completed-week streak qualifier, gate copy, and assignment-pending language are present. Dynamic student/date/checklist content remains authoritative.

**Comparison history**

1. P2 — initial evidence was accidentally captured during the route loading skeleton, so it was invalid for fidelity judgment. Fix: the E2E capture now waits for the greeting and real checklist before taking screenshots. Post-fix evidence: both exact screenshots show populated Today.
2. P2 — desktop content exceeded the viewport because a full-width max container was combined with the fixed sidebar margin. Fix: desktop `.student-page` width is now `calc(100% - 16rem)`. Post-fix evidence: the 1440 × 1024 capture includes the full seven-day strip, all six Sunday checklist rows, the entire progress card, and no horizontal overflow.
3. P2 — the first mobile verse treatment consumed too much of the initial viewport. Fix: compact mobile Arabic, translation, and padding were tightened while retaining readable text and the required placement. Post-fix evidence: the 390 × 844 capture shows the complete week strip, verse, checklist heading, score, saved state, and first live row above the fixed nav.

**Findings**

- No actionable P0, P1, or P2 visual differences remain.
- P3: the desktop sidebar is slightly broader than the illustrative source crop, but it preserves the approved hierarchy and gives real placement/verse text safer wrapping.
- P3: the Sunday disposable-fixture state has one more checklist row than the Thursday illustration; this is required by live date/version-aware scoring and is not design drift.

**Interactions and resilience checked**

- Production build, authenticated local fixtures, check/uncheck, two-row rapid changes, failure rollback, retry, reload persistence, offline disable, reconnect refresh, assignment pending, shell-stable loading, long identity/group wrapping, account-sheet Enter/Escape/focus restoration, mobile fixed-nav clearance, and desktop/mobile overflow.
- Browser console and page errors were asserted empty in the screenshot flow. Production-build server output showed no application errors. Direct inspection of all three tracked images confirmed no development indicator, loading skeleton, layout clipping, horizontal overflow, or private/production data.
- The sanitized route-error boundary is covered by a focused component test because deliberately taking the disposable database offline would also invalidate the authenticated layout fixture during this production-browser run.

**Implementation checklist**

- [x] Exact 1440 × 1024 and 390 × 844 populated captures
- [x] Canonical source and both captures in one comparison image
- [x] Fonts, spacing, colors, icons/assets, copy, responsiveness, focus, reduced motion, and saved/error/offline states reviewed
- [x] Earlier P2 findings fixed and recaptured
- [x] No remaining P0/P1/P2 findings

**Follow-up polish**

- Revisit P3 density only if future Batch screens establish a tighter shared sidebar width.

final result: passed

---

## Preserved prior QA history

# Current admin redesign QA

The authenticated PR #74 amendment QA is recorded in `admin-design-qa.md`. It covers all ten approved admin canvases, authoritative Missing activity filtering, authenticated dashboard/report/Add User states, loading/empty/backend-unavailable behavior, desktop and 390-ish responsive behavior, direct image comparison, legacy redirects, and console checks. Final result: passed.

---

# Teacher screens design QA

> Checkpoint 4 evidence for the admin student workspace is recorded in `artifacts/admin-student-workspace-checkpoint-4/design-qa.md`. It covers the Student settings and official-scoring surfaces, direct comparisons to canvases 11–14, responsive geometry, interaction checks, and contract limitations. Final result: passed.

## Comparison target

- Source visual truth:
  - `docs/design-handoff/rotation-teacher-redesign-2026-08-08/canvases/01-teacher-dashboard.png`
  - `docs/design-handoff/rotation-teacher-redesign-2026-08-08/canvases/02-teacher-grading-workspace.png`
  - `docs/design-handoff/rotation-teacher-redesign-2026-08-08/canvases/03-teacher-checklist-details.png`
- Browser-rendered implementation:
  - `artifacts/teacher-redesign/teacher-dashboard-1440x1024.png`
  - `artifacts/teacher-redesign/teacher-grading-1440x1024.png`
  - `artifacts/teacher-redesign/teacher-checklist-drawer-1440x1024.png`
  - `artifacts/teacher-redesign/teacher-dashboard-390x844.png`
  - `artifacts/teacher-redesign/teacher-grading-390x844.png`
  - `artifacts/teacher-redesign/teacher-grading-actions-390x844.png`
  - `artifacts/teacher-redesign/teacher-checklist-sheet-390x844.png`
  - `artifacts/teacher-redesign/mobile-amendment/after-dashboard-390x844.png`
  - `artifacts/teacher-redesign/mobile-amendment/after-grading-initial-390x844.png`
  - `artifacts/teacher-redesign/mobile-amendment/after-grading-student-actions-390x844.png`
  - `artifacts/teacher-redesign/mobile-amendment/after-checklist-sheet-390x844.png`
  - `artifacts/teacher-redesign/mobile-amendment/after-dashboard-1440x1024.png`
  - `artifacts/teacher-redesign/mobile-amendment/after-grading-1440x1024.png`
  - `artifacts/teacher-redesign/mobile-amendment/after-checklist-1440x1024.png`
- Side-by-side evidence:
  - `artifacts/teacher-redesign/comparison-dashboard.png`
  - `artifacts/teacher-redesign/comparison-grading.png`
  - `artifacts/teacher-redesign/comparison-checklist.png`
  - `artifacts/teacher-redesign/mobile-amendment/comparison-dashboard-before-after.png`
  - `artifacts/teacher-redesign/mobile-amendment/comparison-grading-initial-before-after.png`
  - `artifacts/teacher-redesign/mobile-amendment/comparison-grading-actions-before-after.png`
  - `artifacts/teacher-redesign/mobile-amendment/comparison-checklist-before-after.png`

## Viewports and normalization

- Desktop source images: 1487 × 1058 px.
- Desktop implementation: 1440 × 1024 CSS px in the Codex in-app browser. Browser screenshots are 1600 × 1138 backing pixels with reported `devicePixelRatio = 0.9`.
- Mobile implementation: 390 × 844 CSS px. Browser screenshots are 433 × 938 backing pixels with reported `devicePixelRatio = 0.9`.
- Tablet verification: 768 × 844 CSS px.
- Side-by-side desktop comparisons normalize both source and implementation to 1200 × 854 px before compositing. Mobile comparisons keep the original 390 × 844 browser capture proportions and compare the same task state wherever the fixture permits.
- State: live, authenticated, current published local session data from the disposable RLS fixture. Live names, counts, item labels, and number of groups/students differ from the sample canvas by design.

## Mobile before-state findings

- P1 — Dashboard task distance: the original 390 × 844 capture ended inside the first nested group card before its primary grading action. The header, intro, week card, cohort card, and group card each added independent vertical padding and borders.
- P1 — Grading task distance: the original grading entry capture devoted essentially the full viewport to title, week, and four vertically stacked statistics; no student or grading control was visible.
- P2 — Student editing density: the desktop form was stacked without a mobile composition. Attendance and score occupied separate rows, notes dominated the card, and saved feedback was separated from an oversized full-width Save button.
- P2 — Checklist efficiency: the mobile sheet used a large boxed Close action and a tall summary. Fewer checklist items were visible despite the sheet technically fitting without horizontal overflow.
- Lack of horizontal overflow was therefore treated only as a safeguard, not as evidence of mobile usability.

## Mobile after-state findings

- Dashboard: the teacher header is 64 px, identity is removed from the mobile wordmark row, intro/week surfaces are compact, and cohort/group nesting is flattened. The first real group action begins at approximately 526 CSS px and is fully visible in the initial 844 px viewport.
- Grading entry: secondary published metadata is inline, the week surface and assigned marker are compact, and four statistics form one row. The first student begins at approximately 451 CSS px; Attendance, Recitation, notes, resources, status, and Save are visible without scrolling.
- Student editing: Attendance and Recitation share a two-column row at 390 px, notes are secondary, Checklist and Weekly plan share a resource row, and saved/dirty/error feedback is paired with the individual Save action. Adjacent students remain separated, scannable sections rather than oversized cards.
- Checklist: the sheet is near full height, has a sticky compact header and 44 px close control, and presents daily total, record state, stored labels, completion state, weight, and earned points with two items visible in the captured viewport.
- No actionable P0, P1, or P2 mobile-density findings remain after the amendment.

## Desktop regression findings

- Information hierarchy remains aligned with the approved canvases: dark ITQAN shell, teaching/grading eyebrow, page title, week surface, cohort/group workspace, restrained published/assigned emphasis, and privacy footer.
- The dense desktop grading table/list and 560 px right drawer remain unchanged in structure. Live fixture counts differ from the canvas sample, but no fields or actions disappear.
- New 1440 × 1024 dashboard, grading, and checklist captures show no responsive regression.

## Focused-region findings

- Dashboard group region: responsibility badge, real primary teacher, student/plan/grade counts, cohort access, and grading CTA are all visible and separated.
- Grading table region: attendance, recitation, teacher notes, checklist, weekly plan state, save status, and individual save action align in the desktop grid and become compact labelled mobile sections.
- Drawer region: exact stored labels, completion labels, weights, earned points, record state, and daily totals are present. Private notes, raw check-ins, timestamps, correction actors, and audit metadata are absent.

## Required fidelity surfaces

- Fonts and typography: application system sans-serif matches the canvas's neutral sans character; hierarchy, weights, wrapping, line height, and uppercase eyebrow treatment are consistent. Long live group names wrap without hiding adjacent data.
- Spacing and layout rhythm: the 1440 px frame, header height, page margins, section spacing, separators, and dense table rhythm match. Mobile keeps 16 px page gutters, 44 px practical controls, flatter grouping, and short task distance.
- Colors and tokens: approved `#17211d`, `#315747`, `#b58a3c`, `#f8f7f2`, white surfaces, stone borders, and restrained amber/green states are used without gradients or decorative substitutes.
- Image and asset fidelity: the source contains application UI only. Existing Phosphor icons are used; there are no generated images, fake raster assets, inline SVGs, CSS drawings, emoji, or placeholder art.
- Copy and content: approved ITQAN wordmark and presentation copy are retained. Production renders live group/teacher/student/checklist data rather than canvas sample data.

## Interaction and accessibility verification

- Week selector options were read and navigation was exercised.
- All published groups remained enabled, including non-assigned groups.
- Grading controls and resource actions were present at 1440, 768, and 390 CSS px. At 390 px the first student's actionable controls and Save are visible in the initial viewport, with `scrollWidth === viewportWidth`.
- Checklist opened from an exact published group/student/version/week context and loaded sanitized RPC data.
- Initial dialog focus moved to Close; Escape dismissed the dialog and restored focus to the Checklist trigger.
- Overlay dismissal was exercised through the exposed backdrop; dialog focus wraps from the first control to the date selector and both Escape and backdrop dismissal restore focus to the Checklist trigger.
- Empty checklist, loading skeleton, denied/stale/invalid messages, and retryable error action are implemented.
- Browser console was checked after dashboard, grading, and checklist interactions; no application errors or warnings were reported.

## Comparison history

1. Initial pass found a P2 dashboard issue: the absolutely positioned `Your assigned group` badge crowded the grading CTA with long live names. The assigned card now reserves desktop top space; post-fix evidence is `comparison-dashboard.png`.
2. Initial pass found a P2 drawer proportion issue: the 520 px desktop drawer was narrower than the canvas's approximately 39% width. It is now 560 px at a 1440 px viewport; post-fix evidence is `comparison-checklist.png`.
3. Post-fix pass found no actionable P0/P1/P2 differences. Remaining content-height differences come from real fixture row counts and are expected.
4. Mobile amendment reclassified the four original 390 × 844 captures as a before state. Although they had no horizontal overflow, they failed first-viewport task efficiency on dashboard and grading.
5. Mobile amendment flattened dashboard nesting, compressed grading context/summary, recomposed each student form, and compacted the checklist sheet. The four `mobile-amendment/comparison-*-before-after.png` files are the post-fix evidence.
6. Desktop was re-captured at 1440 × 1024 after the responsive changes; the approved dense table and right drawer remain intact.

## Follow-up polish

- P3: very long production names can create different line breaks than the canvas sample. Current wrapping remains readable and does not hide data or actions.

final result: passed

---

# Admin rotation wizard design QA — superseded preflight

## Comparison target

- Source visual truth:
  - `docs/design-handoff/rotation-teacher-redesign-2026-08-08/canvases/04-admin-student-availability.png`
  - `docs/design-handoff/rotation-teacher-redesign-2026-08-08/canvases/05-admin-teacher-availability.png`
  - `docs/design-handoff/rotation-teacher-redesign-2026-08-08/canvases/06-admin-session-groups.png`
  - `docs/design-handoff/rotation-teacher-redesign-2026-08-08/canvases/07-admin-review-publish.png`
- Source dimensions: 1487 × 1058 px each, opened at original resolution.
- Required implementation captures: 390 × 844, 768 px, and 1440 × 1024 authenticated `/admin/rotation` screens.
- Implementation screenshot paths: unavailable; no valid browser-rendered rotation screenshot was captured.
- Side-by-side comparison evidence: unavailable because the implementation capture failed before the rotation route rendered.
- Density normalization: not applicable without implementation screenshots.

## Browser verification attempted

- Started the full disposable local Supabase stack and applied every migration through `20260808154200_rotation_teacher_wizard_review_amendment.sql`.
- Created local-only representative admin, teacher, student, permanent-group, teacher-availability, and student-absence records.
- Authenticated successfully as the disposable scoped admin and reached the live local admin dashboard.
- Switched the in-app browser to the required 390 × 844 viewport before opening the rotation route.
- The host volume reached zero free space while Next.js compiled `/admin/rotation`. That crashed the disposable Postgres container and left Docker's local metadata returning input/output errors. Regenerable `.next` and npm cache data were removed, but Docker could not restart or remove the dead database container.
- No production or remote staging environment was accessed or mutated.

## Findings

- [P0] Visual comparison evidence is missing.
  - Location: all four `/admin/rotation` steps at mobile, tablet, and desktop viewports.
  - Evidence: source canvases are available, but there is no authenticated browser-rendered implementation image to place beside them.
  - Impact: hierarchy, density, clipping, overflow, action reachability, and keyboard behavior cannot receive the required visual acceptance.
  - Fix: free host disk space or restart Docker Desktop, restart the disposable Supabase stack, reseed local QA records, then capture and compare all four steps and material states.

## Static and automated evidence

- The production route renders exactly one selected step.
- Mobile student rows switch from the desktop table to compact labelled rows; group and review surfaces use responsive grids and stacked labelled rows without primary-workflow horizontal scrolling.
- Step parsing, canonical URL scope/week/step preservation, prerequisite locking, readiness mapping, and separate mismatch messages have focused unit coverage.
- Loading, denied/no-context, stale, validation-blocked, mismatch confirmation, regeneration discard, legacy recovery, retryable error, revision draft, and already-published presentations are implemented.
- `npm run check` passes with 47 test files and 376 tests.

## Open questions

- None about intended behavior. The remaining blocker is local visual infrastructure only.

## Implementation checklist

- Restore a healthy disposable local database.
- Capture students, teachers, groups, and review at 390 × 844 and 1440 × 1024, plus the 768 px breakpoint.
- Exercise Back/Forward, search/filter, absence editing, zero-teacher blocking, smaller group-count confirmation, regeneration confirmation, student movement, primary responsibility assignment, review, and explicit publish confirmation.
- Check keyboard focus, console errors, full-page horizontal overflow, and action reachability.
- Build side-by-side comparisons and resolve every P0/P1/P2 visual finding.

final result: superseded by the completed authenticated pass below

---

# Admin rotation wizard design QA — PR #63 amendment

## Comparison target and evidence

- Canonical source canvases: `docs/design-handoff/rotation-teacher-redesign-2026-08-08/canvases/04-admin-student-availability.png` through `07-admin-review-publish.png`, each opened at its original 1487 × 1058 resolution.
- Authenticated desktop captures at 1440 × 1024:
  - `artifacts/design-qa/admin-rotation-pr63/04-students-desktop-1440x1024.png`
  - `artifacts/design-qa/admin-rotation-pr63/05-teachers-desktop-1440x1024.png`
  - `artifacts/design-qa/admin-rotation-pr63/06-groups-desktop-1440x1024.png`
  - `artifacts/design-qa/admin-rotation-pr63/07-review-desktop-1440x1024.png`
- Authenticated mobile captures at 390 × 844 use the same step-numbered names with `mobile-390x844`. Full-page mobile action-reachability captures use `mobile-full`.
- Direct three-column source/desktop/mobile comparisons:
  - `artifacts/design-qa/admin-rotation-pr63/04-students-comparison.png`
  - `artifacts/design-qa/admin-rotation-pr63/05-teachers-comparison.png`
  - `artifacts/design-qa/admin-rotation-pr63/06-groups-comparison.png`
  - `artifacts/design-qa/admin-rotation-pr63/07-review-comparison.png`
- State: disposable local Supabase data, authenticated scoped admin, canonical week `2026-12-06`. No production or remote staging data was read or mutated.

## Direct comparison findings

- Student availability retains the canvas hierarchy: compact title/metrics, Saturday-only integrity message, search/filter actions, dense desktop table, labelled mobile rows, and explicit confirmation/continue actions. The implementation correctly replaces the canvas's generic “Draft saved” treatment with authoritative server confirmation and unsaved-edit feedback.
- Teacher availability retains search, counts, dense rows, and explicit Available/Unavailable controls. The merged contract's last-published Saturday and group are shown; null history is “Never assigned.” Internal-looking email addresses are not presented.
- Session groups retains the compact group-count control, anchored group columns/cards, primary responsibility selects, redistribution disclosure, imbalance warning, and Back/Continue actions. Corrected “Moved for Saturday” markers appear only for attending placements whose selected anchored slot differs from the permanent group.
- Review restores A/B/C summaries and direct Edit students/teachers/groups links while keeping readiness, participant/placement totals, atomic/versioned/audited publication copy, history, explicit confirmation, and publish action.
- Live fixture row counts, names, dates, and two generated groups differ intentionally from the sample canvases. A revisited completed Step 1 correctly shows later steps completed because backend readiness is authoritative; the canvas depicts an untouched first-step state.
- The existing real navigation, ITQAN wordmark, Phosphor icons, stone surfaces, moss actions, green readiness states, amber warnings, restrained separators, and dense system typography match the approved color and hierarchy roles.

## Responsive and interaction findings

- At 390 × 844, the primary workflow has no horizontal scroll, desktop table squeezing, microscopic controls, card-per-student padding explosion, clipping, overlapping action bars, or off-viewport controls.
- Student rows become dense labelled rows; teacher availability uses full-width 44 px segmented controls; group cards preserve primary responsibility and movement context; review summaries become compact two-column labelled rows.
- Full-page mobile evidence confirms search, filters, absence controls, last-assigned context, redistribution disclosure, primary responsibility controls, direct edit links, audit disclosure, confirmation, Back/Continue/Publish actions, and integrity messaging remain reachable.
- Step changes now restore the viewport to the page top, preventing query-string navigation from inheriting a lower scroll position and clipping the next screen's header.
- Search and all practical action controls meet the 44 px target. Keyboard focus styling and native radio/checkbox/select semantics remain visible and logically ordered.
- Browser console inspection after all four steps reported zero errors and zero warnings. `document.documentElement.scrollWidth <= window.innerWidth` passed at 390 px.

## Authenticated journey and state coverage

- The disposable-local journey exercised student confirmation, confirmed zero-teacher blocking, locked groups deep link, teacher confirmation, group generation, regeneration/discard confirmation, redistribution, corrected moved marker/count, review Edit links, reload, Back/Forward, identical re-confirmation staleness, stale review clamping, regeneration, review confirmation, and publish readiness without publishing.
- Existing presentation paths remain for loading, denied, empty/no-context, stale, validation-blocked, mismatch confirmation, legacy recovery, retryable error, revision draft, and already-published states.

## Remaining differences

- The approved desktop canvases use sample production-like volumes (24 students and four teachers/groups); the disposable RLS fixture has four students, five active teachers, two available teachers, and two groups. Density and row structure were compared, not fabricated to match sample counts.
- Mobile has no separate approved canonical canvas. Its composition is a responsive adaptation of the same hierarchy and controls, verified at the required viewport and through full-page action evidence.
- No actionable P0, P1, or P2 visual or interaction finding remains.

final result: passed
