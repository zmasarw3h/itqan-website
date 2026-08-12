# Student UI foundation

The student experience shares the visual language established by the ITQAN login page while preserving every existing workflow and route.

## Foundation tokens

- `paper` is the application background.
- `surface` is the standard card background.
- `ink` is primary text.
- `forest` is reserved for branded dark surfaces and active student navigation.
- `action` is the primary button color.
- `moss` supports focus and emphasis.
- `gold-on-dark` is the accessible gold used on forest surfaces. The existing `gold` remains decorative on light surfaces.

## Shared student patterns

- `AppNav` keeps role and capability loading on the server. Student links receive route-aware active states through the client-only `NavLinks` presentation component.
- Student navigation uses a forest account bar and a separate desktop route row. The native mobile menu, route labels, and sign-out action remain intact.
- `StudentPage` supplies consistent responsive spacing, width variants, and the main-content skip target.
- `StudentPageHeader`, `StudentSurface`, and `StudentNotice` define the initial page, card, and feedback hierarchy.
- `StudentWeekContextPanel` uses a semantic description list and remains visually secondary to the page task.

## Phase 1 boundaries

This foundation does not change gate ordering, checklist autosave, student scope loading, calculations, route visibility, server authorization, or Supabase policies. Domain-specific page and form refinements belong in later phases.
