# Checkpoint 3 design QA — Halaqa & plan

## Scope and references

This report covers only the canonical `?week=2026-08-09&view=halaqa-plan` workspace section and its weekly-plan viewer. It compares the authenticated implementation with canonical canvases 05, 06, 07, 08, 15, and 16. Checkpoints 1 and 2 were treated as an approved shared shell and were not redesigned.

The source canvases are high-density raster references (desktop approximately 1487 × 1058 and mobile 853 × 1844 backing pixels). Implementation measurements below are CSS pixels at browser zoom 100%, `devicePixelRatio = 1`, and `visualViewport.scale = 1`; backing-image dimensions were not treated as viewport dimensions. Comparison images normalize the reference and implementation to the same visible panel width/state.

## Measured geometry

| State | CSS viewport | `innerWidth` | `visualViewport.width` | root client/scroll width | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Desktop Halaqa No/Yes | 1440 × 1060 | 1440 | 1440 | 1440 / 1440 | no horizontal overflow |
| Tablet Halaqa Yes | 768 × 900 | 768 | 768 | 768 / 768 | no horizontal overflow |
| Mobile Halaqa No/Yes | 390 × 844 | 390 | 390 | 390 / 390 | no horizontal overflow |
| Desktop viewer | 1440 × 1060 | 1440 | 1440 | 1440 / 1440 | dialog 1024 × 900 at x208/y80 |
| Mobile viewer | 390 × 844 | 390 | 390 | 390 / 390 | dialog exactly 390 × 844 at x0/y0 |

Full measured values are stored in `geometry.json`. The 390px captures use realistic long student, cohort, and group names; those values wrap instead of clipping, so their full-page captures are intentionally taller than the reference fixture.

## Visual comparison

- Typography: existing ITQAN fonts, hierarchy, weights, and approved shared-shell scale are preserved. Halaqa labels and live score values remain readable at 390px without shrinking below the approved shell's scale.
- Spacing and density: desktop uses the approved summary plus two task panels. Mobile uses full-width controls and a single compact reading order. No desktop tab strip appears at 390px.
- Color and controls: moss/ink, amber warning, selected-state tint, borders, radii, and 44px practical control targets follow the existing tokens and canvases.
- Imagery: preview evidence uses a locally scoped PNG weekly plan accessed through the authenticated preview contract. PDF rendering uses the browser's secured native PDF surface, rather than recreating the document in application markup.
- Copy: brand copy is `ITQAN`; Halaqa No/Yes guidance, read-only plan ownership, secure preview errors, and download fallback match the handoff intent.

Final side-by-side evidence:

- `halaqa-plan-no-desktop-comparison.png` — canvas 05
- `halaqa-plan-no-mobile-comparison.png` — canvas 06
- `halaqa-plan-yes-desktop-comparison.png` — canvas 07
- `halaqa-plan-yes-mobile-comparison.png` — canvas 08
- `weekly-plan-preview-desktop-comparison.png` — canvas 15
- `weekly-plan-preview-mobile-comparison.png` — canvas 16

The comparison pass found no P0, P1, or P2 visual mismatch. An interaction pass found that the initial focus-loop selector included hidden responsive toolbar controls; the selector was tightened to visible elements and both desktop and mobile viewer evidence was recaptured after the fix.

## Interaction and accessibility verification

- Halaqa No removes the recitation field and yields 0/150; Yes reveals a required integer field constrained to 10–50 and updates Attendance, Recitation, and Total live.
- Local invalid values block save and focus the field. Server validation, pending `Saving…`, saved feedback, retryable error feedback, draft restoration, reload, and canonical redirect state were exercised.
- Back/forward and reload preserve the canonical week/view identity. No competing date state was introduced.
- Weekly plan open/close, desktop backdrop close, Escape, initial close-button focus, focus containment, and trigger focus restoration were exercised with keyboard input.
- Loading was held for 500ms and observed before the authenticated preview resolved. A forced preview 500 produced the retained `Try again` and `Download` error state.
- Zoom-out/in boundaries (50%/200%), 150%, Fit to 100%, drag/pan behavior while zoomed, and the shared pinch-distance calculation were verified. Reduced motion disables the loading spinner animation.
- The mobile viewer occupies the complete 390 × 844 visual viewport with no clipped toolbar or dialog content. Desktop remains a focused modal.
- The final authenticated viewer recapture emitted no application console errors. One earlier clean-page pass observed the repository's pre-existing missing `/favicon.ico` 404; no Halaqa/viewer request or runtime error remained.

## Format and contract notes

The existing server contract previews `application/pdf`, `image/png`, and `image/jpeg`. PDF uses a secured object-backed native browser viewer; PNG/JPEG use a secured object-backed image preview. Empty, loading, render/fetch error, and unsupported-preview UI are implemented. Download actions continue through the existing guarded route and no storage URL is exposed.

The production upload contract already excludes arbitrary MIME types. Therefore the unsupported state is defensive for metadata/rendering drift; the implementation does not broaden the backend's accepted types. Files accepted by the existing contract remain downloadable when preview rendering fails.

## Limitations

- Native PDF controls and exact page-count presentation vary by browser; the application labels the PDF surface and leaves page controls inside the secured native viewer.
- The PNG used for authenticated evidence is local scoped QA data derived from the approved weekly-plan reference, not mock production behavior or a fixture-only route.
- Multi-touch hardware pinch was not available in the headless environment. The pointer interaction was implemented, its zoom calculation and boundaries are covered by focused tests, and mouse drag/pan plus toolbar zoom were exercised in-browser.

final result: passed
