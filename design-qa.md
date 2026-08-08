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
- Side-by-side evidence:
  - `artifacts/teacher-redesign/comparison-dashboard.png`
  - `artifacts/teacher-redesign/comparison-grading.png`
  - `artifacts/teacher-redesign/comparison-checklist.png`

## Viewports and normalization

- Desktop source images: 1487 × 1058 px.
- Desktop implementation: 1440 × 1024 CSS px in the Codex in-app browser. Browser screenshots are 1600 × 1138 backing pixels with reported `devicePixelRatio = 0.9`.
- Mobile implementation: 390 × 844 CSS px. Browser screenshots are 433 × 938 backing pixels with reported `devicePixelRatio = 0.9`.
- Tablet verification: 768 × 844 CSS px.
- Side-by-side desktop comparisons normalize both source and implementation to 1200 × 854 px before compositing. This removes backing-density differences while retaining the full viewport proportions.
- State: live, authenticated, current published local session data from the disposable RLS fixture. Live names, counts, item labels, and number of groups/students differ from the sample canvas by design.

## Full-view findings

- Information hierarchy matches: dark ITQAN shell, teaching/grading eyebrow, page title, week surface, cohort/group workspace, restrained published/assigned emphasis, and privacy footer.
- Dashboard and grading density match the source pattern. Live fixture counts produce three group rows and two grading rows rather than the canvas's sample four, but no fields or actions disappear.
- Checklist uses the intended desktop right drawer and mobile full-width bottom sheet. The overlay, summary, item rows, and privacy note match the approved ordering.
- No actionable P0, P1, or P2 findings remain.

## Focused-region findings

- Dashboard group region: responsibility badge, real primary teacher, student/plan/grade counts, cohort access, and grading CTA are all visible and separated.
- Grading table region: attendance, recitation, teacher notes, checklist, weekly plan state, save status, and individual save action align in the desktop grid and become labelled stacked fields on mobile.
- Drawer region: exact stored labels, completion labels, weights, earned points, record state, and daily totals are present. Private notes, raw check-ins, timestamps, correction actors, and audit metadata are absent.

## Required fidelity surfaces

- Fonts and typography: application system sans-serif matches the canvas's neutral sans character; hierarchy, weights, wrapping, line height, and uppercase eyebrow treatment are consistent. Long live group names wrap without hiding adjacent data.
- Spacing and layout rhythm: 1440 px frame, header height, page margins, section spacing, separators, and dense table rhythm match. Mobile keeps 16 px page gutters and reachable 44 px controls.
- Colors and tokens: approved `#17211d`, `#315747`, `#b58a3c`, `#f8f7f2`, white surfaces, stone borders, and restrained amber/green states are used without gradients or decorative substitutes.
- Image and asset fidelity: the source contains application UI only. Existing Phosphor icons are used; there are no generated images, fake raster assets, inline SVGs, CSS drawings, emoji, or placeholder art.
- Copy and content: approved ITQAN wordmark and presentation copy are retained. Production renders live group/teacher/student/checklist data rather than canvas sample data.

## Interaction and accessibility verification

- Week selector options were read and navigation was exercised.
- All published groups remained enabled, including non-assigned groups.
- Grading controls and resource actions were present at 1440, 768, and 390 CSS px; mobile actions were reached by vertical scrolling with `scrollWidth === viewportWidth`.
- Checklist opened from an exact published group/student/version/week context and loaded sanitized RPC data.
- Initial dialog focus moved to Close; Escape dismissed the dialog and restored focus to the Checklist trigger.
- Overlay dismissal is wired to the labelled backdrop button; dialog focus wraps between the first and last focusable controls.
- Empty checklist, loading skeleton, denied/stale/invalid messages, and retryable error action are implemented.
- Browser console was checked after dashboard, grading, and checklist interactions; no application errors or warnings were reported.

## Comparison history

1. Initial pass found a P2 dashboard issue: the absolutely positioned `Your assigned group` badge crowded the grading CTA with long live names. The assigned card now reserves desktop top space; post-fix evidence is `comparison-dashboard.png`.
2. Initial pass found a P2 drawer proportion issue: the 520 px desktop drawer was narrower than the canvas's approximately 39% width. It is now 560 px at a 1440 px viewport; post-fix evidence is `comparison-checklist.png`.
3. Post-fix pass found no actionable P0/P1/P2 differences. Remaining content-height differences come from real fixture row counts and are expected.

## Follow-up polish

- P3: very long production names can create different line breaks than the canvas sample. Current wrapping remains readable and does not hide data or actions.

final result: passed
