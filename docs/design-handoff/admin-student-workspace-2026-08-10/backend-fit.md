# Admin student workspace backend-fit contract

This document is the backend handoff for the approved five-section workspace.
It intentionally does not implement the workspace presentation or viewer UI.

## Findings and changes

- The existing admin page created a one-hour service-role signed URL with a
  forced-download disposition while rendering the page. It did not provide a
  separate inline preview contract, and the existing admin Storage helper
  authorized an object-shaped path without requiring the exact weekly-plan
  metadata row.
- Admin access now uses request-bound server routes. The service-role client is
  created only after the active admin guard, exact scope resolution, RLS-bound
  metadata lookup, MIME/size validation, and exact path/file-name checks pass.
- The existing student and teacher weekly-plan flows were not changed. The
  current admin link remains a download action and now targets the attachment
  route.
- Mutation forms and the official-scoring workflow now carry `week`/`view`
  state through redirects. Invalid section values normalize to `overview`.

## Weekly-plan endpoints

Both endpoints require the current authenticated session and an active
`admin` or `super_admin` profile:

```text
GET /admin/students/:studentId/weekly-plan/preview?week=YYYY-MM-DD
GET /admin/students/:studentId/weekly-plan/download?week=YYYY-MM-DD
```

The route rechecks `can_admin_manage_student_for_week` on every request, then
resolves `student_group_for_week`, `student_cohort_for_week`, and
`student_masjid_for_week`. It reads the exact student/week row through the
request-bound Supabase client and requires all three stored scope snapshots to
match. The row must have a supported type (`application/pdf`, `image/png`, or
`image/jpeg`), a non-empty size from 1 through 3 MiB, and a normalized path in the exact
`student UUID/canonical Sunday/safe filename` shape. The object is downloaded
from the private bucket only after those checks succeed, and its byte length
must equal the stored metadata size.

Successful responses include:

- the metadata `Content-Type`;
- `Content-Disposition: inline` for preview or `attachment` for download;
- `Content-Length` matching the downloaded object;
- `Cache-Control: private, no-store, max-age=0`;
- `X-Content-Type-Options: nosniff`; and
- `Referrer-Policy: no-referrer`.

Unauthenticated requests return 401, a non-admin role or failed current scope
returns 403, malformed route/query context returns 400, and missing,
unsupported, substituted, stale, or unavailable plan data returns 404. No
service-role credential or signed URL is sent to browser code; access is bound
to the live server request and is not cacheable.

The additive migration
`supabase/migrations/20260810153000_admin_weekly_plan_access_contract.sql`
must run after the existing migrations (in particular after the latest
authorization and teacher-session migrations). It redefines the existing
`can_admin_read_weekly_plan_path(text)` Storage-policy helper to require the
exact canonical metadata row, scope snapshot, supported MIME, and size. It
does not alter production records or remove schema objects.

## Legacy official-scoring boundary

Repository evidence identifies `1900-01-07` as a legacy/data-quality value,
not an application sentinel:

- the profile schema documents `NULL` as “not scorable yet”;
- legitimate boundaries are eligible canonical Sundays;
- the scoring workflow does not define or special-case 1900; and
- the RLS fixture deliberately creates a 1900 row to verify that it does not
  expand reporting weeks.

The raw profile value is not migrated or silently changed. The read/display
contract now exposes `officialScoringStatus(...).state === "legacy"` and
`displayOfficialScoringBoundary("1900-01-07") === "Legacy value — review
required"`. Admin surfaces must never render that value as a real active date
or reinterpret it as `NULL`; the existing guarded preview/apply workflow at
`/admin/students/[id]/official-scoring` remains the correction path.

## Section-aware server contracts

The reusable server-only module is `lib/admin-student-workspace.ts`.

First load the shared shell for the selected canonical week:

```ts
loadAdminStudentWorkspaceShell(supabase, {
  studentId,
  selectedWeekStart
})
```

It re-runs admin scope authorization, verifies an active student identity,
loads the selected week’s historical scope, and returns the student, selected
week, a server-derived current tracker week, available historical week options, and resolved
masjid/cohort/group scope. It throws `AdminStudentWorkspaceError` with one of
`invalid-context`, `scope-denied`, `not-found`, or `load-error`.

Then load only the active section:

| Section | Server call | Returned data |
| --- | --- | --- |
| Overview | `loadAdminStudentOverview(supabase, shell)` | selected-week check-ins, partner rounds, halaqa grade, score totals, due-day progress, below-70 streak, and four recent week starts |
| Weekly activity | `loadAdminStudentWeeklyActivity(supabase, shell)` | selected-week check-ins and stored checklist items, including historical labels and weights |
| Halaqa & plan | `loadAdminStudentHalaqaPlan(supabase, shell)` | selected-week halaqa grade and weekly-plan metadata |
| Corrections | `loadAdminStudentCorrections(supabase, shell)` | selected-week daily records/items and partner rounds |
| Student settings | `loadAdminStudentSettings(supabase, shell)` | delete eligibility, scoring status, and raw score boundary |

Existing server mutations remain the authority: `correctCheckIn`,
`correctPartnerRecitations`, `saveHalaqaGrade`,
`resetStudentBelow70Streak`, `deleteStudent`, and the official-scoring review
and apply actions. They continue to perform server-side role/scope checks,
RLS-backed writes, and existing audit/atomicity behavior. The frontend should
submit `redirect_week` and `redirect_view` for workspace mutations and
`return_week` and `return_view` for official-scoring forms.

Frontend-only work intentionally deferred to the workspace worker includes the
five-section layout, responsive tabs/selector, section-specific rendering,
focus management, and the accessible PDF/image viewer. The viewer should use
the preview endpoint for inline content and the download endpoint for its
separate download control; it must not mint or expose service-role or direct
Storage credentials.
