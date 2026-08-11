# Admin student workspace — Checkpoint 1 amended design QA

## Scope and source of truth

This report replaces the original Checkpoint 1 QA. It covers only the shared
workspace shell and Overview against:

- `docs/design-handoff/admin-student-workspace-2026-08-10/canvases/01-overview-desktop.png`
- `docs/design-handoff/admin-student-workspace-2026-08-10/canvases/02-overview-mobile.png`

The verified page used a real locally authenticated, scoped admin and real
Supabase rows. The fixture deliberately uses a long student and group name to
exercise wrapping. It has no active teacher staff membership, so `Teaching` is
correctly absent; all standard admin links remain present.

## Browser zoom, CSS viewport, and raster dimensions

Browser zoom was reset with Command+0 before measurement. Every measured state
reported `visualViewport.scale = 1`. The in-app capture environment reported
`window.devicePixelRatio = 0.8999999761581421`; this is recorded but was not
treated as the CSS viewport.

| State | CSS geometry | Saved raster | Document geometry |
| --- | --- | --- | --- |
| Mobile initial | `innerWidth 390`, `visualViewport.width 390`, `innerHeight 844` | 433 × 938 | `clientWidth 390`, `scrollWidth 390`, `scrollHeight 1629` |
| Mobile complete | `innerWidth 390`, `visualViewport.width 390`, `innerHeight 1630` | 433 × 1811 | `clientWidth 390`, `scrollWidth 390`, `scrollHeight 1630` |
| Tablet target | `innerWidth 768`, `visualViewport.width 767.7778`, `innerHeight 900` | 852 × 1000 | `clientWidth 768`, `scrollWidth 768`, `scrollHeight 1499` |
| Desktop | `innerWidth 1440`, `visualViewport.width 1440`, `innerHeight 1060` | 1600 × 1178 | `clientWidth 1440`, `scrollWidth 1440`, `scrollHeight 1060` |

The tablet fractional visual viewport is the capture environment's DPR
rounding for the 768 CSS-pixel target; both `innerWidth` and root `clientWidth`
were exactly 768. The complete mobile and desktop captures use a normal
viewport screenshot with the same responsive width and a height equal to the
measured document height. This avoids the in-app browser's distorted
`fullPage` capture mode. No page content was cropped or stitched.

Raw readings and all relevant element bounds are saved in `geometry.json`.

## Mobile element bounds at 390 CSS px

- App header: x `0`, width `390.0000`, right `390.0000`.
- Workspace header: x `15.9983`, width `358.0035`, right `374.0017`.
- Long cohort/group context: x `15.9983`, width `358.0035`, right `374.0017`,
  height `48.0035`; it wraps to two lines.
- Menu trigger: x `312.2222`, width `61.7795`, right `374.0017`, height
  `43.9931` (browser fractional rounding of the 44 px target).
- Score summary: x `15.9983`, width `358.0035`, right `374.0017`.
- Daily: x `15.9983`, right `135.3299`; Partner: x `135.3299`, right
  `254.6615`; Halaqa: x `254.6615`, right `373.9931`. All three totals are
  simultaneously present and readable.
- Due-day summary: x `15.9983`, width `358.0035`, right `374.0017`, height
  `65.1042`; the saved count deliberately wraps while both cells remain inside
  the viewport.
- Recent week activity: x `15.9983`, width `358.0035`, right `374.0017`, y
  `1239.1667`, bottom `1580.7987`; it is present, reachable, and included in
  the complete capture.
- DOM overflow scan: zero elements crossed the left or right root boundary.

At 390 CSS px, root `scrollWidth` equaled root `clientWidth` (`390`). At the
tablet and desktop targets they also matched (`768` and `1440`). The report's
no-horizontal-overflow finding is therefore based on measurements plus the
inspected screenshots, not raster width assumptions.

## Navigation fidelity

Desktop visibly contains `Admin`, `Rotation`, `Incentives`, `Rewards`, `Add
User`, `Password`, and `Sign out`. The complete five workspace tabs are also
visible. The fixture is a normal admin without active teacher capability, so
`Teaching` is correctly omitted by the existing role/capability contract.

Mobile shows the Menu trigger in the initial viewport. Opening it shows the
same six applicable links plus `Sign out`. The open panel bounds are x
`118.0035` through `374.0018`, entirely inside the 390 CSS-pixel viewport.

At the 768 target, the responsive shell uses Menu plus the full-width Section
selector and does not render the desktop workspace tab row. No overflow was
measured.

## Fixes made in this amendment

- Added a browser-safe shared workspace-state module so server links, desktop
  tabs, week changes, and mobile section changes use one canonical URL builder.
- Canonicalized a missing `view` to an explicit `view=overview`, as well as
  correcting invalid/non-Sunday weeks and invalid views. Existing mutation
  status is preserved across that redirect.
- Added focused tests for canonical correction, complete section options,
  preserving week while switching sections, and preserving view while
  switching weeks.
- Added safe wrapping for long live cohort/group context.
- Hardened score and due-day grids with explicit `minmax(0, 1fr)`, `min-w-0`,
  and wrapping so labels and totals cannot force horizontal overflow.
- Added stable QA hooks only for measurement; no mock production behavior or
  authorization bypass was introduced.
- Removed the superseded distorted screenshots/comparisons from the original
  Checkpoint 1 commit and replaced them with inspected production-build
  captures.

Section-aware server loading, scope/RLS checks, existing mutations, Saturday
tasks/scoring, and all non-Overview capabilities remain unchanged. No migration
or backend contract was added or altered.

## Screenshot and comparison evidence

- `overview-desktop-full.jpg` — complete 1440 CSS-pixel Overview.
- `overview-mobile-390-full.jpg` — complete 390 CSS-pixel Overview, including
  Recent week activity.
- `overview-mobile-390-initial.jpg` — 390 × 844 CSS initial viewport with Menu.
- `overview-mobile-390-menu-open.jpg` — complete applicable menu links and Sign
  out.
- `overview-tablet-768.jpg` — 768 CSS-pixel sanity state.
- `overview-desktop-comparison-amended.jpg` — canvas 01 left, implementation
  right; each panel is proportionally resized to the same display width, with
  no crop.
- `overview-mobile-comparison-amended.jpg` — canvas 02 left, true 390 × 844 CSS
  initial implementation state right; the source raster is proportionally
  resized to the implementation backing width, with no crop.

Every saved screenshot above was opened and visually inspected. Live score,
saved-day, student-name, and group-name values intentionally differ from the
illustrative canvases. Accessible 44–48 px controls and the long live fixture
make the implementation's mobile document taller than the illustrative source;
the complete capture is supplied separately rather than shrinking body text or
touch targets to force all content into the initial viewport.

## Automated checks

- Focused: 2 test files, 25 tests passed; typecheck passed; lint passed.
- Full `npm run check`: lint passed, typecheck passed, 56 test files / 455 tests
  passed, and the production Next.js build passed.
- Production-browser verification confirmed that the default URL became
  `?week=2026-08-09&view=overview`, switching to Weekly activity retained
  `week=2026-08-09`, switching the week retained `view=activity`, and an
  invalid Monday/invalid-view URL corrected to the current canonical Sunday
  plus `view=overview`. No browser console errors were recorded.
- The first full build attempt was interrupted by local `ENOSPC`; only the
  rebuildable `.next` cache was cleared, and the complete command then passed.

No P0, P1, or P2 Checkpoint 1 issue remains. Remaining visual differences are
live-data wrapping and the accessibility-preserving mobile density described
above.

final result: passed
