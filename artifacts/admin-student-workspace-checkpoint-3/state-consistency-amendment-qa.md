# Checkpoint 3 state-consistency amendment QA

## Scope

This amendment changes no layout, copy, grading contract, weekly-plan route, authorization rule, or persisted scoring behavior. It adds a student/week remount boundary for the Halaqa & plan task surface, a loaded-grade/result remount boundary for the form, and dismisses redirected result feedback only after an explicit field edit.

## Automated interaction coverage

The jsdom client interaction suite performs real React renders, field events, portal opening, and keyed rerenders:

- Week A starts with a saved Yes grade (140/150), feedback, and a plan.
- The test changes Week A to 145/150, changes feedback, and opens the plan viewer.
- A keyed rerender to Week B with a saved No grade or empty data removes the viewer, recitation input, Week A feedback, transient status, and plan. FormData contains only Week B's student/week and no Week A recitation or notes.
- A second keyed rerender changes the student while retaining the week and verifies only that student's grade, feedback, hidden student ID, and hidden week are present.
- Saved feedback is initially announced, then dismissed by each explicit attendance, recitation, or feedback edit in favor of `Unsaved changes`.
- Restored invalid and retryable-error drafts retain their alert through programmatic restoration and dismiss it only on the next explicit edit.
- A new result-status/form revision initializes its own feedback rather than retaining the previous transient state.

## Authenticated browser verification

Verification used the existing scoped admin and student fixture plus a local historical saved-No grade for Aug 2–8, 2026. The local fixture has no weekly plan for that historical week.

At both 1440 × 1060 and 390 × 844 CSS pixels:

1. Loaded Aug 9–15 at canonical `?week=2026-08-09&view=halaqa-plan&status=grade-saved` with saved Yes grade 140/150 and an uploaded plan.
2. Confirmed the redirected `Halaqa grade saved.` announcement.
3. Changed recitation to 45 and feedback to an unsaved Week A draft; the success announcement disappeared and `Unsaved changes` appeared.
4. Opened and closed the authenticated viewer; desktop behavior remained modal and mobile bounds remained exactly x0/y0/390/844.
5. Used the Week selector, which calls `router.push`, to select Aug 2–8.
6. The canonical URL became `?week=2026-08-02&view=halaqa-plan`; the stale `status` parameter was removed.
7. Week B showed saved No, 0/150, empty feedback, no recitation input, no viewer, and no uploaded plan. The Week A draft and 145/150 total were absent.
8. Browser Back restored only Week A's server-loaded 40 points, saved feedback, 140/150 total, plan, and saved announcement—not the unsaved 45-point draft. Forward restored only Week B.

Measured geometry:

| Viewport | DPR | `visualViewport.scale` | root client/scroll width | Console |
| --- | ---: | ---: | ---: | --- |
| 1440 × 1060 | 1 | 1 | 1440 / 1440 | 0 errors after transition |
| 390 × 844 | 1 | 1 | 390 / 390 | 0 errors after transition |

The mobile viewer retained full-screen 390 × 844 bounds and the existing Escape behavior. No horizontal overflow or viewer regression was observed.

## Limitation

The historical No-grade record used to expose a second Week-selector option is local QA data only and is not part of the commit. Student-context isolation is covered by the real React rerender test rather than a second authenticated local student fixture.

final result: passed
