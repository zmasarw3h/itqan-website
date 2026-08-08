# Teacher screens design QA

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
