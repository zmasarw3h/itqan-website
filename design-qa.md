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
