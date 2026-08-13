# ITQAN admin redesign visual QA — PR #74 amendment

## Comparison target and evidence

- Approved source canvases: `/Users/zmasarweh/.codex/visualizations/2026/08/12/itqan-admin-redesign-option-2/01-unified-admin-shell-desktop.png` through `10-badge-rewards-mobile.png`.
- Authenticated implementation captures: `/Users/zmasarweh/.codex/visualizations/2026/08/12/019ff851-c3be-7c62-8bdd-55a8da072394/authenticated/`.
- Production-mode Missing activity amendment captures: `/Users/zmasarweh/.codex/visualizations/2026/08/13/itqan-admin-redesign-pr74-missing-activity/authenticated/`.
- Desktop evidence: `admin-dashboard-desktop-1440.png`, `reports-desktop-1440.png`, `badge-rewards-desktop-1440.png`, and `add-user-desktop-1440.png`.
- Mobile evidence: `admin-dashboard-mobile-list-390.png`, `dashboard-selected-mobile-viewport-390-final.png`, `reports-mobile-viewport-390.png`, `badge-rewards-mobile-viewport-390-final.png`, and `add-user-mobile-viewport-390.png`.
- Paired source/implementation evidence: the eight `compare-*-desktop.png` and `compare-*-mobile-viewport.png` files in the same authenticated directory. The final selected-dashboard and multi-award badge captures were also opened beside their source canvases at original resolution after the last layout change.
- Source desktop canvases are 1487 × 1058 px and source mobile canvases are 853 × 1844 px. The in-app Browser normalized the requested 1440-ish desktop viewport to 1600 CSS px (1778 backing px) and the requested 390-ish viewport to 433 CSS px (481 backing px). Comparison therefore uses state, proportions, breakpoints, hierarchy, and responsive behavior rather than literal backing-pixel equality.
- The 2026-08-13 production-mode amendment exports are 1600 × 1176 px for the normalized 1600 × 1175 CSS desktop viewport and 481 × 1041 px for the normalized 433 × 938 CSS mobile viewport. Side-by-side comparisons normalize desktop halves to 1200 × 854 and mobile halves to 481 × 1041 with contain fitting; they do not stretch either source.
- State: an authenticated scoped admin using the repository's disposable local Supabase/RLS fixture. No production or remote staging data was read or mutated, and no credential is recorded here.

## Authenticated interaction coverage

- Dashboard: list state; desktop student selection while the dashboard remains mounted; mobile student selection and Back to dashboard; All students, Below 70%, Active streaks, and the enabled Missing activity filter. The authenticated fixture showed `Missing activity (5)` from six rows after one fully submitted row was made non-missing; that submitted row did not appear in the five filtered results.
- Selected student: real authorized score data, 1/5 due days saved, four missing due days, and three recent due-day activity statuses from the existing bounded student workspace loader. No sample counts, fabricated dates, or client-computed due semantics are used.
- Weekly follow-up: Below 70%, Pending sadaqa, and 3+ weeks below 70%. The authenticated production-mode fixture exercised populated below-70/3+ views and the empty Pending sadaqa view; populated rows displayed stored `requiredSadaqaCents` and canonical backend streaks.
- Badge rewards: month selection, zero/one/multiple-award component coverage, and two real recent weekly awards in the authenticated browser state.
- Add User: Student → Teacher → Student role switching, masjid/cohort/group placement changes, and the review state. The form was not submitted because creation semantics were outside visual QA.
- Preserved routes/navigation: Admin, Teaching, Rotation, Reports, Add User, and Password remained reachable; `/admin/incentives` redirected to `/admin/reports?tab=weekly` and `/admin/rewards` redirected to `/admin/reports?tab=badges`.
- Responsive checks: no document-level horizontal overflow at the 390-ish viewport; grouped follow-up rows replace the desktop table; badge awards occupy a full-width mobile region; practical controls are at least 44 px high.
- State checks: selected-student loading feedback was captured, dashboard search and Pending sadaqa empty states rendered their production copy, and a deliberate local backend outage failed closed to Sign in rather than exposing stale protected data. Healthy-state console inspection reported no warnings or errors.
- Console: zero application errors in the authenticated admin flows.

## Direct comparison findings

- Shell, page titles, moss/gold/ink tokens, typography hierarchy, restrained borders, filter/tabs, dense desktop split/table views, and mobile state transitions follow the approved canvases.
- Dashboard mobile retains the canvas's Back to dashboard affordance, identity hierarchy, due-days summary, recent activity rows, and workspace action. Fixture names, scores, and due counts intentionally differ from the mock.
- Weekly follow-up mobile uses an identity-first row and a three-part secondary region for score, below-70 streak, and required sadaqa. It has no squeezed four-column table or horizontal clipping.
- Badge rewards displays every returned recent award. The post-QA amendment gives Month and Lifetime two readable columns and gives the multiple-award list the full content width on mobile.
- Add User retains the approved progressive form and review hierarchy while preserving the production validation, authorization, and placement controls.
- The amendment captures use `next start` after the production build, so no development indicator or development-only behavior is present.

## Review findings resolved

- Desktop selection no longer takes the mobile-only detail path. Viewport-safe tests cover 1280 px and 390 px behavior.
- Missing activity uses exactly `row.missingDueDays > 0`, and the displayed count is derived from that same filtered row set. The frontend performs no score, percentage, or civil-date inference. A focused test and authenticated fixture both cover a submitted student being excluded when the authoritative count is zero.
- The selected preview uses the existing authorized workspace overview contract for `due_days`, `submitted_days`, and recent daily progress. Loading is one bounded request per selection, not N+1 list loading, and privacy/historical-profile behavior remains enforced.
- The frontend consumes `WeeklyFollowUpReport` and `WeeklyFollowUpRow` directly, including `report.pendingSadaqaRows`, `report.below70ThreePlusWeeks`, `row.below70Streak`, and `row.requiredSadaqaCents`. The obsolete adapter and fallback streak reconstruction are deleted.
- Desktop and mobile render all recent badge awards returned by the model.

## Remaining limitations

- Dashboard and Reports do not define route-specific error boundaries. In the authenticated production-mode fault check, an unavailable local auth/backend service failed closed to the existing Sign in page. Loading and empty states are product-specific; backend-unavailable presentation remains the shared authentication/error behavior.
- Live fixture values differ from canvas sample values by design.

No actionable P0, P1, or P2 visual or responsive findings remain.

final result: passed
