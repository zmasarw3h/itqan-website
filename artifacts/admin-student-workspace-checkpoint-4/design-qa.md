# Admin student workspace — Checkpoint 4 design QA

## Scope and source truth

This pass covers only Student settings and the dedicated official-scoring workflow. The approved Checkpoints 1–3 shell and sections were treated as fixed. The source canvases are `11-student-settings-desktop.png`, `12-student-settings-mobile.png`, `13-scoring-settings-desktop.png`, and `14-scoring-settings-mobile.png`.

Authenticated evidence used the existing local scoped admin and active student. No production route, mock production behavior, authorization bypass, scoring mutation, or delete mutation was added or used. The fixture's long live student/cohort/group names intentionally differ from the illustrative canvas copy.

## Evidence

- Student settings: `student-settings-desktop.png`, `student-settings-mobile-390.png`, `student-settings-tablet-768.png`.
- Official scoring initial: `official-scoring-initial-desktop.png`, `official-scoring-initial-mobile-390.png`, `official-scoring-initial-tablet-768.png`.
- Review/confirmation: `official-scoring-preview-desktop.png`, `official-scoring-preview-mobile-390.png`.
- Validation: `official-scoring-validation-mobile-390.png`.
- Direct comparisons: `student-settings-desktop-comparison.png`, `student-settings-mobile-comparison.png`, `official-scoring-desktop-comparison.png`, `official-scoring-mobile-comparison.png`.
- Machine-readable readings: `geometry.json`.

## CSS geometry

Browser zoom and `visualViewport.scale` were 1. Device pixel ratio was 1, so these captures have a one-to-one CSS-to-raster relationship.

| State | CSS viewport | Root client / scroll width | Root scroll height |
| --- | ---: | ---: | ---: |
| Settings desktop | 1440 × 1000 | 1440 / 1440 | 1097 |
| Settings tablet | 768 × 900 | 768 / 768 | 1219 |
| Settings mobile | 390 × 844 | 390 / 390 | 1419 |
| Scoring initial desktop | 1440 × 1000 | 1440 / 1440 | 1000 |
| Scoring initial tablet | 768 × 900 | 768 / 768 | 1328 |
| Scoring initial mobile | 390 × 844 | 390 / 390 | 1514 |
| Scoring review desktop | 1440 × 1000 | 1440 / 1440 | 1657 |
| Scoring review mobile | 390 × 844 | 390 / 390 | 2477 |
| Scoring validation mobile | 390 × 844 | 390 / 390 | 1604 |

No page-level horizontal overflow or application console error was observed at any target.

## Visual comparison findings

- Student settings retains the canvas hierarchy: compact scoring summary, live status, explicit boundary, a single route action, then a spatially isolated danger zone. The delete confirmation is revealed only after intent and uses full-width mobile controls.
- Official scoring retains the canvas hierarchy: back action, eyebrow/title, live identity/status/boundary, Sunday review form, boundary consequences, and no-mutation notice. The existing impact state continues with the same hierarchy and adds live access eligibility, affected activity, obligation impact, reason, and exact-name confirmation.
- Desktop uses a dense two-column task layout; 390px uses deliberate single-column composition rather than squeezed desktop cards. Controls are at least 44px where practical and labels wrap without clipping.
- The implementation is taller than the sample mobile canvases because the live fixture name and scope copy are substantially longer and because the complete guarded confirmation state is shown. This is expected content variance, not hidden or fabricated data.
- No actionable P0, P1, or P2 visual discrepancy remained after direct side-by-side inspection.

## Interaction and accessibility checks

- The settings scoring link was read as `/admin/students/b2222222-2222-4222-8222-222222222222/official-scoring?return_week=2026-08-09&return_view=settings`.
- Back resolved to `/admin/students/b2222222-2222-4222-8222-222222222222?week=2026-08-09&view=settings`; reload and browser Back/Forward retained that route state.
- Review pending copy changed to `Reviewing…`; final confirmation has independent `Saving change…` pending copy.
- A non-Sunday submission produced the retained alert without mutation. Exact-name deletion stayed disabled for an incorrect name, enabled only for the exact name, and Cancel cleared the confirmation surface.
- Native labels, fieldsets/legends, `aria-expanded`, alert semantics, visible focus rules, and logical keyboard order were inspected. No claim of exhaustive accessibility conformance is made from screenshots.
- The only authenticated fixture has delete capability. The capability-false state is verified by focused rendering tests; a fabricated no-delete screenshot was intentionally not created.

## Security and data-contract review

The existing guarded preview and apply server actions, scope checks, RPCs, stale-preview code, audit mutation, and delete action were not changed. The `1900-01-07` legacy sentinel remains raw in data and is presented as `Legacy value — review required`; the frontend neither normalizes nor mutates it.

Final result: passed.
