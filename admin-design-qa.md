# ITQAN admin redesign visual QA — PR #74 amendment

## Comparison target and evidence

- Approved source canvases: `/Users/zmasarweh/.codex/visualizations/2026/08/12/itqan-admin-redesign-option-2/01-unified-admin-shell-desktop.png` through `10-badge-rewards-mobile.png`.
- Authenticated implementation captures: `/Users/zmasarweh/.codex/visualizations/2026/08/12/019ff851-c3be-7c62-8bdd-55a8da072394/authenticated/`.
- Desktop evidence: `admin-dashboard-desktop-1440.png`, `reports-desktop-1440.png`, `badge-rewards-desktop-1440.png`, and `add-user-desktop-1440.png`.
- Mobile evidence: `admin-dashboard-mobile-list-390.png`, `dashboard-selected-mobile-viewport-390-final.png`, `reports-mobile-viewport-390.png`, `badge-rewards-mobile-viewport-390-final.png`, and `add-user-mobile-viewport-390.png`.
- Paired source/implementation evidence: the eight `compare-*-desktop.png` and `compare-*-mobile-viewport.png` files in the same authenticated directory. The final selected-dashboard and multi-award badge captures were also opened beside their source canvases at original resolution after the last layout change.
- Source desktop canvases are 1487 × 1058 px and source mobile canvases are 853 × 1844 px. The in-app Browser normalized the requested 1440-ish desktop viewport to 1600 CSS px (1778 backing px) and the requested 390-ish viewport to 433 CSS px (481 backing px). Comparison therefore uses state, proportions, breakpoints, hierarchy, and responsive behavior rather than literal backing-pixel equality.
- State: an authenticated scoped admin using the repository's disposable local Supabase/RLS fixture. No production or remote staging data was read or mutated, and no credential is recorded here.

## Authenticated interaction coverage

- Dashboard: list state; desktop student selection while the dashboard remains mounted; mobile student selection and Back to dashboard; All students, Below 70%, Active streaks, and the visibly disabled Missing activity filter.
- Selected student: real authorized score data, 1/5 due days saved, four missing due days, and three recent due-day activity statuses from the existing bounded student workspace loader. No sample counts, fabricated dates, or client-computed due semantics are used.
- Weekly follow-up: Below 70%, Pending sadaqa, and 3+ weeks below 70%. The live pending row displayed its stored `$35` obligation and the 3+ view used the canonical backend streak.
- Badge rewards: month selection, zero/one/multiple-award component coverage, and two real recent weekly awards in the authenticated browser state.
- Add User: Student → Teacher → Student role switching, masjid/cohort/group placement changes, and the review state. The form was not submitted because creation semantics were outside visual QA.
- Preserved routes/navigation: Admin, Teaching, Rotation, Reports, Add User, and Password remained reachable; `/admin/incentives` redirected to `/admin/reports?tab=weekly` and `/admin/rewards` redirected to `/admin/reports?tab=badges`.
- Responsive checks: no document-level horizontal overflow at the 390-ish viewport; grouped follow-up rows replace the desktop table; badge awards occupy a full-width mobile region; practical controls are at least 44 px high.
- Console: zero application errors in the authenticated admin flows.

## Direct comparison findings

- Shell, page titles, moss/gold/ink tokens, typography hierarchy, restrained borders, filter/tabs, dense desktop split/table views, and mobile state transitions follow the approved canvases.
- Dashboard mobile retains the canvas's Back to dashboard affordance, identity hierarchy, due-days summary, recent activity rows, and workspace action. Fixture names, scores, and due counts intentionally differ from the mock.
- Weekly follow-up mobile uses an identity-first row and a three-part secondary region for score, below-70 streak, and required sadaqa. It has no squeezed four-column table or horizontal clipping.
- Badge rewards displays every returned recent award. The post-QA amendment gives Month and Lifetime two readable columns and gives the multiple-award list the full content width on mobile.
- Add User retains the approved progressive form and review hierarchy while preserving the production validation, authorization, and placement controls.
- The local Next.js development indicator appears in the lower-left of captures. It is development chrome, not application UI, and is absent from production builds.

## Review findings resolved

- Desktop selection no longer takes the mobile-only detail path. Viewport-safe tests cover 1280 px and 390 px behavior.
- Missing activity no longer uses a zero-points heuristic. Because the dashboard aggregate has no authoritative expected/due field, the filter is visibly disabled with an em dash and dependency explanation rather than returning false results.
- The selected preview uses the existing authorized workspace overview contract for `due_days`, `submitted_days`, and recent daily progress. Loading is one bounded request per selection, not N+1 list loading, and privacy/historical-profile behavior remains enforced.
- The frontend consumes `WeeklyFollowUpReport` and `WeeklyFollowUpRow` directly, including `report.pendingSadaqaRows`, `report.below70ThreePlusWeeks`, `row.below70Streak`, and `row.requiredSadaqaCents`. The obsolete adapter and fallback streak reconstruction are deleted.
- Desktop and mobile render all recent badge awards returned by the model.

## Remaining limitations

- Dashboard Missing activity remains disabled until an authoritative expected/due-activity field is added to the dashboard aggregate. Luna PR #75 deliberately did not add that dashboard contract; this frontend does not attribute the dependency to WeeklyFollowUpReport.
- Running `scripts/test-rls.ts` directly was used only to seed the disposable browser fixture. It reached a late forced-audit rollback assertion that did not match the direct-run local context, so that invocation is not reported as a passing RLS suite. Repository unit/integration/build checks are reported separately.
- Live fixture values differ from canvas sample values by design.

No actionable P0, P1, or P2 visual or responsive findings remain.

final result: passed
