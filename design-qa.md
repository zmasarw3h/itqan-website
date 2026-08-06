# Login Redesign — Design QA

## Comparison target

- Source visual truth: `/Users/zmasarweh/.codex/generated_images/019fc37c-1e2b-7b32-95bf-709a2ae87ce1/exec-6d5034f7-b3c4-426c-90be-310cfd6ed900.png`
- Browser-rendered desktop capture: `/Users/zmasarweh/Documents/itqan-lite/artifacts/design-qa/login-desktop-final-1487x1058.png`
- Normalized desktop capture: `/Users/zmasarweh/Documents/itqan-lite/artifacts/design-qa/login-desktop-final-normalized.png`
- Full-view side-by-side comparison: `/Users/zmasarweh/Documents/itqan-lite/artifacts/design-qa/login-desktop-final-comparison.png`
- Browser-rendered mobile capture: `/Users/zmasarweh/Documents/itqan-lite/artifacts/design-qa/login-mobile-final-390x844.png`
- Normalized mobile capture: `/Users/zmasarweh/Documents/itqan-lite/artifacts/design-qa/login-mobile-final-normalized.png`
- State: unauthenticated `/login`, light theme, empty form.

## Viewport and density normalization

- Source: 1487 × 1058 pixels at density 1.
- Desktop CSS viewport: 1486 × 1058. The in-app browser returned a 1651 × 1174 PNG with extra capture-canvas pixels; DOM measurements confirmed the app occupied the top-left 1487 × 1058 region, so the implementation was cropped to that region without resizing.
- Mobile CSS viewport: 390 × 844. The in-app browser returned a 433 × 938 PNG with the same extra capture-canvas behavior; it was cropped to the top-left 390 × 844 region without resizing.
- The mobile document height is 868px, requiring 24px of normal vertical scrolling. There is no horizontal overflow.

## Full-view comparison evidence

The final side-by-side comparison shows the intended 45/55 split, deep-moss and paper surfaces, full-height panels, reference-scale ITQAN wordmark, enlarged Arabic focal point, stronger divider, centered sign-in group, generous field heights, and left-aligned support copy. The divider lands at 669px in a 1486px CSS viewport, within 0.3 percentage points of the source position. The wordmark measures 143px wide and sits approximately 11% from the left edge and 9% from the top.

The source includes a subtle vignette and gold-tinted Arabic diacritics. Those remain P3 visual polish rather than required geometry: the production implementation keeps the existing flat moss token and renders the ayah as accessible semantic Arabic text.

## Focused comparison evidence

A separate focused crop was not needed because the source and implementation were compared at their original 1487 × 1058 scale and all critical details—Arabic shaping, wordmark size, divider, labels, helper text, controls, and support copy—remain legible in the full-view artifact. DOM measurements were also used to verify exact panel, wordmark, field, and control dimensions.

## Required fidelity surfaces

- Fonts and typography: passed. Noto Naskh Arabic preserves correct RTL shaping and diacritics. The Arabic line is 76.6px at the reference viewport, scales down without clipping, and stays on one line at 1024px and 320px after the final breakpoint correction. UI type preserves ITQAN's existing sans-serif stack.
- Spacing and layout rhythm: passed. Desktop is 45/55 with zero-minimum tracks, the form remains capped at 36rem, and both panels fill the viewport. Mobile uses a deliberate 352px hero followed immediately by a flexible form section; no paper gap appears on tall mobile or tablet screens.
- Colors and visual tokens: passed. Deep moss, warm paper, ink, white, and warm gold match the approved direction with readable contrast. The source vignette remains optional P3 polish.
- Image quality and asset fidelity: passed. The target contains no required photography or raster illustration. The ayah remains real Arabic text, and the ornamental diamond uses the installed Phosphor icon library.
- Copy and content: passed. ITQAN, the ayah, translation, citation, labels, helper text, primary action, and administrator support message match the selected direction.
- Interaction and states: passed. `+442079460958` formats to `+44 20 7946 0958`; Show changes the password field to text and updates to Hide; loading, authentication error, and expired-session behavior are preserved.
- Accessibility: passed for the implemented scope. Inputs retain explicit labels and helper association, mobile controls are 56px high, desktop controls are 72px high, focus treatment remains visible, Arabic has `dir="rtl"` and `lang="ar"`, and error/status announcements remain semantic.
- Responsiveness: passed at 1487 × 1058, 1440 × 900, 1024 × 768, 768 × 1024, 430 × 932, 390 × 844, 375 × 812, and 320 × 568. No viewport has horizontal overflow, inter-panel gaps, collapsed fields, or clipped Arabic.

## Comparison history

1. The inherited implementation used a 46/54 desktop split, an undersized wordmark, a low Arabic focal point, a weaker divider, a slightly low form group, and centered support copy. It also relied on a full-page mobile capture that falsely appeared collapsed.
2. The first correction pass changed the split to 45/55, enlarged and repositioned the wordmark and ayah, strengthened the divider, raised the content groups, left-aligned support copy, and introduced a controlled mobile hero. A normal viewport capture proved the mobile page itself was healthy; only the full-page capture path was faulty.
3. The responsive matrix then found two P2 issues: unused height created a paper gap between sections on tall mobile/tablet screens, and the ayah wrapped at 1024px and 320px. Switching the mobile shell to a flexible column and adding breakpoint-aware Arabic sizing removed both issues.
4. The final desktop comparison and responsive metrics found no remaining actionable P0, P1, or P2 differences. Remaining P3 polish is limited to the optional source vignette and two-tone diacritic treatment.

## Browser verification

- Primary interactions tested: adaptive international phone formatting and password Show/Hide.
- Browser console errors and warnings: none.
- Responsive DOM checks: no horizontal overflow, no inter-panel gaps, minimum 56px interactive height, and single-line Arabic at the narrow desktop and smallest mobile targets.

## Final result

final result: passed

---

# Admin Session Rotation UI — Design QA

## Comparison target

- Source visual truth: `/Users/zmasarweh/.codex/generated_images/019fd2bd-297c-70c3-aae9-29b4ca82e251/exec-62d3be5b-a237-48c8-82b7-2589029e024a.png`, plus the approved Step 2 and Step 4 canvases in `/Users/zmasarweh/.codex/visualizations/2026/08/06/019fd78c-8176-76f1-8d19-678eac4efc45/`.
- Intended implementation route: `/admin/rotation`.
- Browser attempt: `http://127.0.0.1:3001/admin/rotation`, desktop viewport.

## Evidence

The browser-rendered implementation could not reach the authenticated Rotation UI. The local server stops at the server-side configuration guard because this worktree has no `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The captured browser artifact is the Next.js configuration error at `http://127.0.0.1:3001/admin/rotation`; it is not treated as a visual implementation capture.

Static implementation review confirms that the added UI preserves the approved one-page sequence and existing green-header/warm-white/table-first language: Step 2 provides session-only placement, group counts, moved/unchanged distinction, unplaced blockers, and imbalance warnings; Step 3 retains availability and adds primary responsibility selection; Step 4 composes availability, placements, teacher responsibility, review, atomic publish, live-version, revision, stale-refresh confirmation, and audit states. Native controls have at least 44px heights and semantic tables/labels are retained. This review does not replace browser comparison.

## Required fidelity surfaces

- Fonts and typography: blocked from browser comparison.
- Spacing and layout rhythm: blocked from browser comparison.
- Colors and visual tokens: blocked from browser comparison.
- Image quality and asset fidelity: no new raster assets are required by the supplied dense application references; blocked from browser comparison.
- Copy and content: verified statically against the approved state labels; browser verification remains blocked.
- Accessibility and responsiveness: semantic table/label and mobile-control implementation reviewed statically; browser verification remains blocked.

## Primary interactions intended for browser verification

- Draft load, student placement/unplacement, primary-teacher assignment, review, publish, revision, and stale refresh confirmation.
- Desktop and mobile table overflow, section continuation focus/scroll, blocked versus warning-only readiness, and published/read-only audit views.
- Console error check after configured authenticated rendering.

## Final result

final result: blocked

---

# Student availability design QA

## Visual references

- Source visual truth: `/Users/zmasarweh/.codex/generated_images/019fd2bd-297c-70c3-aae9-29b4ca82e251/exec-62d3be5b-a237-48c8-82b7-2589029e024a.png` (1487 × 1058).
- Implementation capture: `/tmp/itqan-student-availability-qa/implementation-desktop.png` (1280 × 720).
- Mobile capture: `/tmp/itqan-student-availability-qa/implementation-mobile.png` (390 × 844).
- Side-by-side comparison: `/tmp/itqan-student-availability-qa/reference-vs-implementation.png`.

## Evidence and findings

The implemented page retains the existing ITQAN shell while applying the reference's dark green rotation header, compact readiness ledger, four-step in-page indicator, table-first availability section, default-attending language, and green/white control system. The implementation intentionally uses the application's existing scoped masjid/cohort/week controls and responsive card/table conventions rather than duplicating mock-only data or creating another route.

At the desktop capture, the availability table is the first workflow section and exposes all required columns and controls. At 390 px, the controls wrap and the table remains usable through horizontal scrolling (860 px table width within a 326 px scroll viewport). The reference's bottom action treatment is adapted into the Step 1 action row so it stays reachable within the existing page flow.

Interaction QA covered marking a student absent, entering an optional reason, searching, filtering to absences, the absence count/save state, and selecting Continue. Continue moved keyboard focus and scrolled to `#session-group-setup` without changing route. Browser console error logs were empty.

No P0, P1, or P2 visual defects were found. A full-page browser capture was not used as evidence because its stitched result duplicated the page header; targeted desktop and mobile captures were used instead.

## Final result

Passed.

---

# Admin Session Rotation corrective amendment — Design QA

## Comparison target

- Approved source visuals: Step 1 implementation reference plus the supplied Step 2 and Step 4 draft/published/stale canvases.
- Deployed implementation: `https://itqan-lite-6ib0pfwky-zmasarw3hs-projects.vercel.app/admin/rotation`, Vercel deployment `2ehHEAcyFBFKrjhUu42no6iMZTFd`, commit `25e5645`.
- Source visual truth: `/Users/zmasarweh/.codex/generated_images/019fd2bd-297c-70c3-aae9-29b4ca82e251/exec-62d3be5b-a237-48c8-82b7-2589029e024a.png` (1487 × 1058).
- Authenticated implementation captures: `/Users/zmasarweh/.codex/visualizations/2026/08/06/019fd865-3979-7850-a6e8-990c9e8cb83c/admin-rotation-authenticated-server-error-desktop.png` (1280 × 720 desktop) and `/Users/zmasarweh/.codex/visualizations/2026/08/06/019fd865-3979-7850-a6e8-990c9e8cb83c/admin-rotation-authenticated-server-error-mobile-390x844.png` (390 × 844 mobile).
- State: successful normal scoped-admin login, then `/admin/rotation`.

## Browser evidence

The supplied scoped-admin account successfully authenticated and reached the admin dashboard. On navigation to `/admin/rotation`, the deployed page failed before rendering the workflow on both desktop and mobile. The page reports `This page couldn’t load` with digest `644741890`; the Vercel runtime log identifies the underlying server error as `Unable to load student availability.`

This arises in the first server-side availability query against `student_rotation_availability`. The source migration exists at `supabase/migrations/20260806144640_student_rotation_availability.sql`, but the preview environment cannot serve that query. This is a deployment-environment/schema availability blocker, not a change to be masked in the UI or repaired by altering backend contracts.

The source and implementation were opened together for comparison. The reference is the intended green-header/warm-white four-section workflow; the authenticated implementation is an error screen, so the state and viewport cannot be normalized for fidelity comparison. The failure is a P0 functional and visual blocker.

**Findings**

- [P0] Authenticated rotation page crashes before Step 1.
  Location: deployed `/admin/rotation` at desktop 1280 × 720 and mobile 390 × 844.
  Evidence: browser capture shows the server error screen; Vercel runtime log reports `Unable to load student availability.` after successful authenticated access.
  Impact: the four-section workflow, restored permanent balancing controls, teacher-assignment controls, table behavior, focus/scroll continuation, and draft states are inaccessible.
  Fix: deploy the already-approved availability/session-roster backend schema to the preview's Supabase environment (or point the preview to an environment that contains it), then rerun authenticated QA. Do not substitute client defaults or weaken the availability/backend contract.

**Open Questions**

- The deployed preview's database migration state is not exposed by the application. The runtime error proves the availability query fails but does not distinguish a missing table from a schema/permission mismatch.

**Implementation Checklist**

1. Make the preview's backend schema match the stacked availability/session-roster branch without altering the UI contract.
2. Recheck `/admin/rotation` with the scoped admin at desktop and mobile, including rendering, horizontal overflow, Continue focus/scroll, and safe non-destructive draft states.
3. Capture matching Step 1/2/4 views and update this report after the route renders.

## Required fidelity surfaces

- Fonts and typography: blocked by P0 before app content renders.
- Spacing and layout rhythm: blocked by P0 before app content renders.
- Colors and visual tokens: blocked by P0 before app content renders.
- Image quality and asset fidelity: no image assets are reachable on the implementation because of P0.
- Copy/content: the intended workflow content is absent; only the generic server error copy is visible.
- Accessibility interaction, responsive table usability, horizontal overflow, focus/scroll continuation, draft edit/review/publish/revision/stale states: blocked by P0. Console contains the matching Server Components error on both viewport captures.

## Final result

final result: blocked
