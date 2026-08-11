# Admin student workspace — focused pre-merge amendment replay

Date: 2026-08-11
Baseline: `1ae70f7b310f429d3de16d18e7b35d188bc88d45`

## Daily correction result

- Selected and saved the existing Sunday, August 9, 2026 record without changing its note, status, or checklist selections.
- The success redirect was `/admin/students/b2222222-2222-4222-8222-222222222222?status=corrected&week=2026-08-09&view=corrections&correction_date=2026-08-09`.
- After the redirect, the selected date remained `2026-08-09`; the saved status, stored note, and three stored checklist completions were reloaded from server data.
- The success notice read: `Daily correction saved. Stored state for Sun, Aug 9, 2026 is shown below.`
- Future `2026-08-12` and cross-week `2026-08-08` query values both fell back to the normal operational initial date, `2026-08-11`.
- A forged `correction_date` on `status=partner-corrected` was ignored. Only the partner success notice appeared and the daily form used its normal `2026-08-11` initial date.

## Official-scoring confirmation result

- The preview loaded with the live boundary `2026-08-09`; no apply request was submitted.
- Empty, incomplete, wrong-name, and case-mismatched states remained disabled in the focused interaction suite.
- During authenticated replay, a valid reason with a partial name remained disabled. Entering the exact live student name enabled `Confirm scoring change`.
- The form retains native `required`, `minLength=5`, and `maxLength=500` constraints; the server action retains its independent reason, exact-name, request-id, canonical-Sunday, scope, stale-preview, audit, and concurrency checks.
- A read-only database check after replay confirmed `score_starts_on = 2026-08-09`.

## Responsive and browser evidence

- Desktop viewport: 1280 CSS px. Root `clientWidth = scrollWidth = 1280`; DPR 1; `visualViewport.scale = 1`.
- Mobile viewport: 390 × 844 CSS px. Root `clientWidth = scrollWidth = 390`; DPR 1; `visualViewport.scale = 1`.
- The final browser console check reported zero errors and zero warnings.
- Evidence:
  - `amendment-correction-success-desktop.png`
  - `amendment-correction-success-mobile-390.png`
  - `amendment-scoring-ready-desktop.png`
  - `amendment-scoring-ready-mobile-390.png`

## Data safety

- The daily correction save reused the canonical stored values, so no fixture restoration was necessary.
- Partner correction was not submitted.
- Official scoring confirmation was not submitted and the boundary remained unchanged.
- Student deletion was not exercised.

## Partner-save correction-date follow-up

- Baseline for this focused follow-up: `055336c162b72ac69c0a751e42246577de5f88d0`.
- Desktop exact sequence at 1280 CSS px: opened the successful daily-correction URL for Sunday, August 9, 2026, then saved the unchanged partner correction. The partner success redirect retained `week=2026-08-09`, `view=corrections`, and `correction_date=2026-08-09`; the daily Date selector remained Sunday.
- A second desktop pass changed only the daily Date selector from Sunday to Monday before submitting the unchanged partner form. The redirect retained `correction_date=2026-08-10`, and Monday remained selected after canonical server reload.
- Mobile exact sequence at 390 x 844 CSS px produced the same Sunday retention. Root `clientWidth = scrollWidth = 390`; DPR 1; `visualViewport.scale = 1`.
- In both partner-success replays, only `Partner recitation correction saved` was present. The daily success notice was absent, and no daily form fields or checklist values were submitted through the partner form.
- The final browser console check reported zero errors and zero warnings. The desktop root measured `clientWidth = scrollWidth = 1280`.
- Both partner saves reused the fixture's existing round selections. No daily correction or scoring boundary was mutated, so no fixture restoration was required.
- Follow-up evidence:
  - `partner-date-followup-desktop.png`
  - `partner-date-followup-mobile-390.png`
