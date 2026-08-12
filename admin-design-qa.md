# ITQAN admin redesign visual QA

- Source visual truth: `/Users/zmasarweh/.codex/visualizations/2026/08/12/itqan-admin-redesign-option-2/`
- Fixture-rendered implementation evidence: `/Users/zmasarweh/.codex/visualizations/2026/08/12/019ff851-c3be-7c62-8bdd-55a8da072394/`
- Desktop target viewport: 1440 × 1058 CSS px; captured by the in-app Browser at 1600 × 1175 CSS px because its viewport capability applied a 0.9 density normalization (1778 × 1306 output pixels).
- Mobile target viewport: 393 × 852 CSS px; captured by the in-app Browser at its 436 × 946 CSS px minimum (484 px output width at 0.9 density).
- States exercised: dashboard list, dashboard selected student and Back to dashboard, weekly follow-up, and badge rewards. The Add User production component is covered by build/type checks but its fixture capture failed as noted below.

**Findings**

- [P1] Authenticated live-data visual comparison is unavailable.
  Location: all protected `/admin` routes.
  Evidence: the configured Supabase project is available, but this worktree has no disposable admin browser credentials. The protected route correctly redirects to `/login`. Production components were rendered through a temporary fixture-only QA route that was removed before commit.
  Impact: layout and responsive behavior were exercised, but screenshots cannot prove the final server-authorized data state.
  Fix: rerun the same captures with a disposable `E2E_TEST_PURE_ADMIN_*` account in local or staging Supabase after the backend report branch lands.

- [P2] The in-app Browser image export did not preserve a reliable normalized visual comparison for every capture.
  Location: saved desktop and mobile fixture captures.
  Evidence: DOM bounds reported no horizontal overflow and the expected 1360px desktop grid, but several exported PNG previews appeared partially clipped despite matching document and viewport widths.
  Impact: screenshots are retained as evidence, but cannot support a fidelity pass by themselves.
  Fix: repeat capture with the same in-app Browser after its viewport/export behavior is corrected.

**Required fidelity surfaces**

- Fonts and typography: system sans stack, weights, hierarchy, and wrapping match the existing ITQAN production system; screenshot comparison remains blocked as described above.
- Spacing and layout rhythm: responsive DOM bounds show no page-level horizontal overflow at the tested mobile width; desktop split grid resolves to 831px/509px tracks inside a 1360px grid.
- Colors and visual tokens: implementation uses existing `ink`, `moss`, `gold`, `paper`, and surface tokens.
- Image quality and assets: no raster imagery is required by the handoff. Phosphor icons replace generated decorative icon guidance.
- Copy and content: fixed Admin Dashboard, Weekly student overview, Students, four dashboard filters, Reports tabs, three weekly filters, Add User copy, and Back to dashboard states are present.

**Interaction and console evidence**

- Primary dashboard selection and Back to dashboard interaction passed.
- DOM audit found no horizontal overflow at the Browser's 436px mobile minimum.
- Visible targets were at least 44px high; hidden desktop/menu duplicates were excluded from the visible-target assessment.
- A temporary Add User fixture produced a server/client action serialization error before the component rendered; that fixture was removed and is not part of production code. Add User therefore remains part of the authenticated visual re-check. No production console error was found on the dashboard or report fixture surfaces.

**Comparison history**

1. Initial captures exposed the missing local Supabase environment. The server was restarted with the repository owner's existing local environment, and protected routes then correctly redirected to login.
2. Fixture component captures exercised desktop and mobile states. DOM measurements showed no responsive overflow, but exported-image previews remained unreliable.

**Implementation checklist**

- Re-run authenticated desktop/mobile screenshots after the backend report contract is merged.
- Re-check the pending-sadaqa row and 3+ streak views using live contract rows.
- Compare equal-density captures against all ten source canvases.

final result: blocked
