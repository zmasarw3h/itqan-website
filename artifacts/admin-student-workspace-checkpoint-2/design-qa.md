# Admin student workspace — Checkpoint 2 design QA

## Scope

This checkpoint implements only Weekly activity and Corrections. It was reviewed
against canonical canvases 03, 04, 09, and 10. Halaqa & plan, the weekly-plan
viewer, Student settings, and scoring settings remain at their preserved
Checkpoint 1 presentation.

The evidence uses an authenticated local admin with a real active masjid staff
membership, a real in-scope student membership, stored check-ins/items, and a
stored partner round. The production routes and normal RLS/server authorization
were used; no fixture-only page or authorization bypass was added.

## Geometry

Browser zoom was 100%. The browser reported `devicePixelRatio = 1` and
`visualViewport.scale = 1` for every final production-build capture.

| Section and state | CSS viewport | Root document geometry | Overflow scan |
| --- | --- | --- | --- |
| Activity, saved day expanded | 390 × 844 | `clientWidth 390`, `scrollWidth 390`, `scrollHeight 1853` | 0 boundary offenders |
| Activity, missing day expanded | 390 × 844 | `clientWidth 390`, `scrollWidth 390`, `scrollHeight 1493` | 0 boundary offenders |
| Activity tablet | 768 × 900 | `clientWidth 768`, `scrollWidth 768`, `scrollHeight 1144` | 0 boundary offenders |
| Activity desktop | 1440 × 1060 | `clientWidth 1440`, `scrollWidth 1440`, `scrollHeight 1060` | 0 boundary offenders |
| Corrections mobile | 390 × 844 | `clientWidth 390`, `scrollWidth 390`, `scrollHeight 2194` | 0 boundary offenders |
| Corrections tablet | 768 × 900 | `clientWidth 768`, `scrollWidth 768`, `scrollHeight 1968` | 0 boundary offenders |
| Corrections desktop | 1440 × 1060 | `clientWidth 1440`, `scrollWidth 1440`, `scrollHeight 1430` | 0 boundary offenders |

At 390px, the daily and partner form contents both measured x `33` through
`357` (324 CSS px wide). Both submit buttons measured 324 × 44 CSS px. Long
task and student/group labels wrapped without crossing the root boundary.
Raw readings are in `geometry.json`.

## Weekly activity verification

- Desktop uses the approved seven-day list and selected-day detail layout.
- Mobile uses a single-open accordion; it does not render the desktop columns.
- Saved, missing, open-today, and upcoming states are derived from stored rows
  plus the Toronto operational effective date.
- The detail uses stored `checkin_items.task_label` and `weight` values only.
  It never consults the current checklist template, and focused tests include a
  retired historical key/label/weight fixture.
- Saved details show daily score, stored earned/possible checklist points,
  completed and missed items, stored save time, and the permitted student note.
- A missing/open/upcoming selection presents a deliberate empty explanation.
- The section contains no correction action, edit button, or mutation form.
- Day expansion is local presentation state; the canonical `week` and `view`
  URL contract remains unchanged. Reload selects the latest saved day, so no
  additional day query parameter was needed.

## Corrections verification

- Daily and partner corrections are separate forms with independent submit,
  pending, success, and error states.
- The daily date control contains only selected-week dates at or before the
  operational effective date. The server also rejects a submitted date outside
  the canonical selected week before checking or mutating another week.
- Changing dates loaded the stored note/status/completed keys and the checklist
  version effective on that date. Historical and current version behavior is
  covered by focused tests.
- Retryable daily and partner failures restore only their own tab-scoped draft;
  browser verification restored the exact daily date, note, and task set, and a
  distinct partner round set after separate error redirects.
- Partner controls expose exactly Round 1 and Round 2. The existing parser and
  payload contract reject any other value and award exactly 75 points per saved
  round. No arbitrary points field exists.
- Real local saves verified that daily and partner mutations remain independent
  and preserve `week=2026-08-09&view=corrections` through their redirects.

## Accessibility and interaction checks

- Section headings, nested headings, labels, fieldsets/legends, buttons, and
  checkboxes expose meaningful roles/names in the accessibility snapshot.
- Mobile activity triggers expose `aria-expanded`; desktop day controls expose
  `aria-pressed`; targeted mutation feedback uses `role=status` or `role=alert`.
- Keyboard Tab navigation reached the daily date control with a computed 2px
  visible focus outline. Back/forward restored the canonical correction URL and
  corresponding status message.
- Submit controls disable and change label during pending state; the captured
  pending screenshot was taken while a production request was deliberately
  delayed in the browser.
- New checkpoint UI has no animation. The inherited admin loading shell now
  disables its pulse under reduced-motion preference.
- Screenshots support visual review but are not claimed as full accessibility
  certification.

## Evidence

- `weekly-activity-desktop.png`
- `weekly-activity-mobile-390-saved.png`
- `weekly-activity-mobile-390-missing.png`
- `weekly-activity-tablet-768.png`
- `corrections-desktop.png`
- `corrections-mobile-390.png`
- `corrections-tablet-768.png`
- `corrections-mobile-390-pending.png`
- `corrections-mobile-390-daily-success.png`
- `corrections-mobile-390-partner-success.png`
- `corrections-mobile-390-error.png`
- `weekly-activity-desktop-comparison.png`
- `weekly-activity-mobile-comparison.png`
- `corrections-desktop-comparison.png`
- `corrections-mobile-comparison.png`

Every listed screenshot and comparison was opened and visually inspected. The
comparisons resize each source proportionally and do not crop either panel.

## Checks

- Focused: 5 test files, 51 tests passed; lint and typecheck passed.
- Full: `npm run check` passed — lint, typecheck, 57 test files / 463 tests,
  and the optimized Next.js production build.
- Production browser console: zero application errors or warnings during the
  final capture session.

## Documented differences and limitations

- The local student and group names are intentionally longer than canvas copy,
  so the shared approved header wraps and the mobile documents are taller.
- The implementation keeps 44px form actions and comfortable checklist rows;
  it does not shrink controls to match the denser illustrative raster.
- At exactly 768 CSS px and DPR 1, the approved Checkpoint 1 `md` breakpoint
  renders its desktop navigation/tabs; the sections still stack safely and do
  not overflow. At widths below that breakpoint, the approved Menu and Section
  selector are used.
- Pending state was verified using browser-side request delay. Validation and
  retryable error rendering were verified without creating a production-only
  failure path.

No P0, P1, or P2 Checkpoint 2 issue remains.

final result: passed
