# ITQAN Lite Admin Operating Model

Status: Phase 1 synthesis draft  
Date: July 24, 2026  
Scope: normal masjid admins and admin-teachers  
Implementation status: requirements only; no redesign or production implementation in this phase

## 1. Outcome

The future admin experience should operate as one scoped weekly workspace rather than a collection of unrelated pages.

It must help an admin:

1. establish the correct masjid, cohort, and tracker week;
2. understand what requires attention;
3. complete repeatable weekly work efficiently;
4. open an individual student only for investigation or an exception;
5. prepare and publish the Saturday halaqa rotation safely;
6. review and export outcomes;
7. switch to Teaching only when the person has that capability.

The model preserves all current routes and features. It changes how the work is organized and connected, not the underlying product scope.

## 2. Sources

- `AGENTS.md`
- `README.md`
- Current `/admin`, `/teacher`, and account routes
- Current Supabase migrations and authorization helpers
- [Admin audit](../admin-audit-2026-07-23/admin-audit.md)
- Twenty-one desktop and mobile audit screenshots
- Phase 0 Rotation and login safeguards

No saved Product Design context was available, so the current application, audit evidence, and existing ITQAN visual system are the design source of truth.

## 3. Product principles

### Scope before action

Every operational action has an explicit, server-validated scope. A single available option may be selected automatically, but its value remains visible.

### Weekly work before records

The primary admin mental model is the work that must be completed for a cohort and week. Student records support that work; they are not the only way to reach it.

### Review before consequential mutation

The interface distinguishes edited, saved, previewed, and published state. An admin must never be able to publish a stale preview or mistake local edits for persisted data.

### Batch for routine work, individual for exceptions

Repeated grading, plan review, and status completion should be queue- or batch-oriented. Historical investigation, manual correction, and destructive account actions remain individual.

### Historical truth uses historical scope

Historical reports, student records, streaks, monthly totals, and lifetime totals use membership and operational records effective for the period being viewed. They never substitute today’s roster or infer calendar coverage from a global row cap.

This historical population rule does not make former staff authorization historical. A normal admin may read or mutate that historical population only when they have an active admin membership for the relevant masjid on the current configured effective date. A past admin membership never grants present access to historical data. Any exceptional rule needed to reconcile a partially completed deletion must be narrowly server-defined and must not restore general access to the former scope.

### One definition of time

The canonical stored context is the Sunday tracker-week start. User-facing text may foreground the Saturday halaqa date, but it always includes or remains traceable to the same tracker week.

### Capability-aware, not role-inventing

An admin-teacher remains `profiles.role = 'admin'`. Teaching remains a separate capability-aware surface under `/teacher`.

### Existing visual language

Future visual work uses the current paper, ink, moss, gold, stone, green, amber, and red system; the existing typography, focus treatment, spacing rhythm, and restrained surfaces remain the baseline.

## 4. Admin work cycle

### A. Establish context

Required before operational work:

- active masjid;
- cohort where the task is cohort-bound;
- tracker week;
- effective student membership for that week.

Changing masjid clears a cohort that is no longer valid. Changing week recalculates student membership, scoring, plans, grading, and rotation state from the same canonical week.

### B. Monitor and triage

The admin needs a cohort-level view of:

- active students;
- weekly score and status;
- missing due check-ins;
- partner-recitation completion;
- halaqa-grade completion;
- weekly-plan presence;
- streak or follow-up indicators.

This stage answers: “What needs attention in this scope and week?”

### C. Complete repeatable weekly work

Routine work includes:

- reviewing weekly-plan presence and opening a plan;
- recording Saturday halaqa grades;
- correcting partner-recitation completion where authorized;
- moving through a filtered set of students without returning to the full leaderboard after every save.

This stage must support a work queue or equivalent sequential-throughput model. It does not require unrestricted bulk mutation: each saved grade or correction may remain individually validated and attributed.

After an individual action, the admin returns to the same masjid/cohort/week, filters, ordering, and queue position.

### D. Resolve exceptions

Individual student inspection remains the place for:

- detailed daily activity;
- historical week investigation;
- manual check-in correction;
- detailed plan metadata;
- account deletion.

Destructive account action remains separated from routine weekly completion and retains exact-name confirmation.

### E. Prepare Saturday operations

For one explicit masjid, cohort, and Saturday:

1. confirm group readiness;
2. explicitly review and confirm student rebalancing, if any;
3. edit and save teacher availability;
4. review assignments calculated from persisted availability;
5. publish teacher assignments.

Publishing assignments never changes student group membership. Rebalancing and publishing remain separate mutations.

### F. Review and export outcomes

The admin can:

- review the weekly incentive report;
- review monthly badge rewards;
- export the selected weekly scoring dataset;
- understand whether the export represents the complete selected scope or the current filtered view.

### G. Manage people and account

Lower-frequency work includes:

- creating a student with exact masjid/cohort/group placement;
- creating a teacher with exact masjid scope;
- changing the signed-in person’s password;
- switching between Admin and Teaching when teacher capability is active.

## 5. Cadence and interaction model

| Job | Typical cadence | Natural level | Interaction model | Risk |
|---|---|---|---|---|
| Review weekly standing | Daily/weekly | Masjid or cohort | Monitor and filter | Medium |
| Find missing work | Daily/weekly | Cohort | Triage queue | Medium |
| Review plans | Weekly | Cohort, then student | Queue with individual file access | Medium |
| Enter halaqa grades | Weekly/Saturday | Group or cohort | Sequential work queue | High |
| Correct partner recitation | Exception/weekly | Student | Individual validated save | High |
| Correct daily check-in | Exception | Student/date | Individual canonical review | High |
| Rebalance groups | Occasional | Cohort/week | Preview, confirm, atomic apply | High |
| Save teacher availability | Weekly | Cohort/Saturday | Draft then save | High |
| Publish assignments | Weekly | Cohort/Saturday | Persisted preview then publish | High |
| Add student | As needed | Masjid/cohort/group | Guided creation | High |
| Add teacher | As needed | Masjid | Guided creation | High |
| Export scores | Weekly/monthly | Explicit selected scope | Download | Medium |
| Review incentives/rewards | Weekly/monthly | Selected scope | Report and exception review | Low |
| Delete student | Rare | Student | Isolated destructive flow | Critical |
| Switch to Teaching | As needed | Capability | Explicit surface switch | Medium |

## 6. Conceptual information architecture

The conceptual categories are independent of exact navigation treatment:

### Weekly work

Monitoring, triage, weekly completion, and a clear entry into student exceptions.

### Students and people

Active student roster, student records, student/teacher creation, placement, and low-frequency account actions.

### Saturday rotation

Group setup, teacher availability, assignment preview, and publishing for an explicit cohort/week.

### Reports

Weekly scoring/exports, incentive follow-up, and badge rewards.

### Teaching

Available only to an admin-teacher and kept under the existing `/teacher` authorization model.

### Account

Password and sign-out actions.

The exact navigation labels, layout, and responsive presentation are Phase 2 decisions.

Recommended task taxonomy:

```text
Admin workspace
├── Weekly Operations
│   ├── Overview
│   ├── Student follow-up
│   ├── Plans and halaqa grading
│   └── Student record
├── People
│   ├── Students
│   ├── Teachers
│   └── Add student or teacher
├── Halaqa Operations
│   ├── Group structure and student balance
│   ├── Teacher availability
│   └── Weekly teacher assignments
├── Recognition
│   ├── Weekly follow-up
│   └── Badge rewards
└── Account

Capability-aware workspace switch
├── Admin
└── Teaching
```

This is a conceptual grouping. It does not require every leaf to become a route.

Terminology decisions for Phase 2:

| Current term | Conceptual term | Meaning |
|---|---|---|
| Admin Dashboard | Weekly Operations | Scoped current or historical operational work |
| Add User | Add student or teacher | The two supported admin outcomes |
| Week | Tracker week | Sunday–Saturday, stored as `week_start` |
| This Saturday | Halaqa Saturday | Derived from the selected tracker week |
| Rotation | Halaqa Operations | Parent domain containing student balance and teacher assignments |
| Group setup/rebalance | Student group balance | Effective-dated placement operation |
| Assignment preview/publish | Weekly teacher assignments | Teacher-to-group assignment for one tracker week |
| Incentives | Weekly follow-up | Below-70, streak, and related operational reporting |
| Rewards | Badge rewards | Recognition and monthly badge ranking |
| Teaching | Teaching workspace | Capability-aware operational mode |
| Student Page | Student record | Student identity plus selected-week operations/history |

Use one spelling and capitalization for “Halaqa” in user-facing headings.

## 7. Route compatibility

| Existing route | Capability that must remain | Phase 1 conceptual area |
|---|---|---|
| `/admin` | Weekly leaderboard, scoring, filters, student entry, CSV | Weekly work |
| `/admin/students/[id]` | Student overview, activity, plan, corrections, grading, deletion | Student record / exceptions |
| `/admin/students/new` | Scoped student or teacher creation | Students and people |
| `/admin/rotation` | Explicit masjid/cohort/week rotation workflow | Saturday rotation |
| `/admin/incentives` | Weekly incentive report | Reports |
| `/admin/rewards` | Monthly badge leaderboard | Reports |
| `/admin/export` | Scoped CSV export | Reports |
| `/teacher` | Assigned groups for an admin-teacher | Teaching |
| `/account/change-password` | Password change | Account |

Routes may gain query parameters, context controls, or new supporting views, but existing routes remain valid unless the user explicitly approves removal.

Compatibility requirements:

- `/admin` remains the default admin landing route.
- Existing `week`, `below70`, `status`, `view`, `month`, and recovery parameters remain valid.
- Legacy `/admin/leaderboard` and `/admin/leaderboard/export` redirects continue to forward supported filters.
- Student links opened from a historical week preserve that exact `week`.
- Back links preserve the originating scope, week, and supported filters.
- Existing bookmarks with incomplete context canonicalize to an authorized context rather than failing.
- CSV export remains a server-generated download.

## 8. Context contract

### Masjid

- Required for every admin read or mutation.
- If the admin has one active masjid, it is automatically resolved and visibly named.
- If the admin has multiple masajid, the operational surface requires an explicit selection.
- An “all masajid” view may summarize but must not permit ambiguous mutation.

### Cohort

- Required for rotation and cohort-level weekly work.
- Optional only for a clearly labelled masjid-wide summary.
- Cohort options are limited to the selected masjid and effective date.

### Week

- Stored and transmitted as canonical Sunday `week_start`.
- Displayed as a Sunday–Saturday range.
- Rotation additionally names the corresponding Saturday.
- Week changes recalculate effective memberships and every derived score/status.
- A report resolves its student population for the report period, not from the current-week roster.
- A month-based report retains explicit masjid/cohort scope even though its time control is a month.

### Student

- The student and data population for a selected reporting week is resolved from the student’s group membership effective for that week.
- Authorization is evaluated on a separate time dimension: a normal admin must have an active admin membership for that historical population’s masjid on the current configured effective date.
- Former admin scope never grants access to historical weeks. Server guards and RLS enforce both the historical population resolution and the current admin-membership check.
- Student name and phone are never sufficient authorization or canonical identity.

### URL and server

- Operational scope is representable in the URL so refresh, back, and deep-link behavior are deterministic.
- The server validates every supplied identifier independently.
- RLS remains an independent boundary; client state never grants access.

## 9. Capability coverage matrix

| Capability | Current route | Required context | Future operating role | Current gap | Preserve |
|---|---|---|---|---|---|
| Admin login | `/login` | Identity | Entry | Phase 0 removed credential-bearing Server Action trace | Yes |
| Active student roster | `/admin` | Masjid, week | Monitor | Multiple administered masajid are blended without attribution | Yes |
| Weekly scores and rank | `/admin` | Masjid/cohort, week | Monitor | History discovery uses global row caps | Yes |
| Status/week filtering | `/admin` | Same as results | Triage | Scope is incomplete | Yes |
| Student search | `/admin` | Same as results | Triage | Client-only state is lost on return | Yes |
| Student detail | `/admin/students/[id]` | Student, week | Investigate | Dashboard link drops the selected historical week | Yes |
| Daily check-in correction | Student detail | Student, date/week | Exception | Long mixed-purpose page; concurrent overwrite contract incomplete | Yes |
| Partner-recitation correction | Student detail | Student, week | Weekly/exception | Delete and insert are not one atomic mutation | Yes |
| Halaqa grading | Student detail | Student/group, week | Weekly completion | One-record-at-a-time and last-write-wins | Yes |
| Weekly-plan view/download | Student detail | Student, week | Weekly completion | One-record-at-a-time; failure can resemble absence | Yes |
| CSV export | `/admin/export` | Masjid/cohort, week, declared filter semantics | Report | Scope/filter population is not fully communicated | Yes |
| Add student | `/admin/students/new` | Masjid/cohort/group | People management | Shared initial password has no mandatory first-login reset | Yes |
| Add teacher | `/admin/students/new` | Masjid | People management | Same initial-credential issue; identity re-entry after failure | Yes |
| Rotation target groups | `/admin/rotation` | Masjid/cohort/week | Saturday preparation | No concurrent revision contract | Yes |
| Student rebalance | `/admin/rotation` | Masjid/cohort/week | Confirmed structural operation | Separate atomic RPC is a strong baseline | Yes |
| Teacher availability | `/admin/rotation` | Masjid/cohort/week | Draft/save | Same-tab dirty state fixed; cross-tab revision remains | Yes |
| Assignment preview/publish | `/admin/rotation` | Masjid/cohort/week | Review/publish | Publish has no expected preview digest/revision | Yes |
| Incentive report | `/admin/incentives` | Masjid/cohort, completed week | Report/follow-up | Historical report population comes from current-week roster | Yes |
| Badge rewards | `/admin/rewards` | Masjid/cohort, month | Report | Current roster and capped history make attribution incomplete | Yes |
| Admin-teacher switch | Global nav | Active teacher capability | Surface switch | Week/scope continuity is not explicit | Yes |
| Change password | `/account/change-password` | Signed-in identity | Account | Preventive guidance is limited | Yes |
| Delete student | Student detail | Student | Isolated destructive action | No durable audit/reconciliation for cross-system outcome | Yes |

## 10. Interaction and correctness contracts

### State language

Every consequential workflow uses explicit state:

- unchanged;
- edited/unsaved;
- saving;
- saved;
- preview current;
- preview stale or paused;
- publishing;
- published;
- failed;
- uncertain outcome where applicable.

### Save and publish

- A preview reflects persisted canonical inputs, never merely edited local controls.
- A dirty input pauses or clearly invalidates its dependent preview.
- Publish is disabled when the preview is stale, incomplete, or out of scope.
- After a save, dependent server data is reloaded before publishing.
- Repeated submission is idempotent where the workflow can span multiple rows.
- A preview carries an expected revision or digest of every persisted input that affects it.
- If another administrator or tab changes an input after preview, the server rejects publication as stale.
- A stale response offers refresh and review; it never silently overwrites the newer state.
- An uncertain response reconciles or safely retries using the same request identifier.

### Validation

- Required scope is selected before submission.
- Errors are specific to the field or operation.
- Non-sensitive input is preserved after recoverable validation failure.
- The first invalid control or the error summary receives focus.
- Loading state prevents accidental double submission.

### Grading and corrections

- Displayed values and effective stored values agree.
- Attendance rules explicitly determine recitation input availability and effective points.
- The admin sees student, week, and group context at save time.
- Corrections disclose the exact date and before/after state.
- Every mutation remains server-authorized and auditable.
- Existing mutable records carry a revision or last-updated token where concurrent edits are possible.
- Partner-recitation correction is one atomic operation; removing and adding rounds cannot partially commit.

### Destructive actions

- Deletion is isolated from routine weekly work.
- Exact identity confirmation remains required.
- Scope and consequences are restated immediately before submission.
- Partial cleanup or uncertain outcomes return an actionable result.
- Permanent deletion writes an immutable actor/target/outcome audit event.
- Retrying an uncertain deletion first reconciles identity, profile, and storage state.

### Export

- Export scope is explicit.
- The interface states whether transient search and filters are included.
- Server-side export authorization re-resolves scope rather than trusting the page.

### Account creation

- Student and teacher placement are re-resolved server-side from active scoped relationships.
- Creation uses a stable request identifier and supports idempotent reconciliation.
- A shared reusable initial password is not an acceptable completed-account state.
- An issued initial credential is single-use or forces password change before other app use.
- Authentication, profile creation, scoped placement, audit outcome, and cleanup failures are represented distinctly.

## 11. Security and data invariants

- Students never see another student’s operational data.
- Normal admins never read or mutate outside active administered masajid.
- Teachers never read or grade outside exact assigned group/week.
- Admin-teachers remain admins with a separate active teacher capability.
- Service-role clients are created only in guarded server code.
- Service-role keys and login credentials never reach browser bundles or logs.
- Role checks and Supabase RLS both enforce access.
- Effective dates use the configured application timezone.
- Rotation publishing never changes student group memberships.
- Multi-row mutations and their audit events are atomic.
- Destructive migrations remain out of scope.

## 12. Responsive and accessibility acceptance criteria

- All critical admin workflows are completable at 390 × 844 without relying on an undisclosed horizontal-scroll action.
- The same workflows remain usable at 320 CSS pixels and at 400% zoom.
- Essential row identity, status, and primary action remain visible together or are represented in a mobile-specific reading order.
- Tables may remain for secondary comparison, but core mobile work cannot depend on off-screen columns.
- Menu triggers and all controls expose the correct interactive role and accessible name.
- Keyboard focus is visible and follows task order.
- Status, error, and success messages use appropriate live-region semantics.
- Color is never the sole status signal.
- Pointer targets are comfortably tappable.
- Primary touch targets are at least 44 × 44 CSS pixels.
- Forms expose inline validation and programmatic error relationships.

## 13. Priority requirements

### P0

No open P0 product-design issue is currently known from the completed audit or Phase 0.

### P1

1. Preserve the Phase 0 guarantee that unsaved Rotation availability cannot coexist with an actionable stale publish preview.
2. Make the complete recurring weekly workflow operable without repeatedly returning to the leaderboard after every student.
3. Make the core dashboard/student-entry workflow usable on the supported mobile viewport.
4. Make masjid, cohort, and week context explicit enough to prevent wrong-scope action; Dashboard, Incentives, Rewards, and export cannot silently blend multiple masajid.
5. Preserve every capability in the coverage matrix and every existing server/RLS boundary.
6. Preserve the Phase 0 guarantee that login credentials are not emitted in development action traces.
7. Preserve the selected historical week when opening a student from the dashboard and returning to the worklist.
8. Resolve Incentives and Rewards populations from the selected reporting period and explicit masjid/cohort scope.
9. Replace row-count-limited history discovery with date-/week-complete queries or durable aggregates.
10. Prevent silent concurrent overwrite of grades, corrections, Rotation settings, availability, and publication.
11. Make partner-recitation correction atomic.
12. Require an expected persisted revision for Rotation publication, not only same-tab dirty-state protection.
13. Replace the reusable shared initial-password outcome with a mandatory secure first-login transition.
14. Make permanent student deletion auditable and reconcile partial identity/storage outcomes.

### Deferred P2/P3

The audit’s report-triage, password-guidance, phone-density, terminology, and lower-impact visual-consistency findings remain recorded. README wording that says normal admins add admins also needs reconciliation with the current student/teacher-only route and the current AGENTS scope. These items are not authorized for implementation merely because Phase 1 documents them.

These are current-product implementation gates discovered during Phase 1. Phase 1 closes by specifying them completely; the production fixes belong to the implementation phase unless a separate safety phase is explicitly authorized.

## 14. Testable acceptance criteria

1. Given two admins open the same grade, when one saves first, the stale submission is rejected and the saved value remains unchanged.
2. Given a partner correction removes one round and adds another, a failure commits neither change.
3. Given locally edited Rotation availability, preview is unavailable and Publish is disabled until save succeeds.
4. Given another admin changes Rotation inputs after preview, publication is rejected as stale.
5. Given a publication retry after timeout, the same request produces at most one effective publication.
6. Given forged or out-of-scope identifiers, direct URL, form, RPC, export, and storage access fail independently.
7. Given the dashboard is showing a historical week, opening a student and returning retain that week and worklist context.
8. Given an Incentives historical week, its student population comes from effective membership for that week.
9. Given a monthly Rewards view, every row has a defined historical masjid/cohort attribution rule.
10. Given enough records to exceed legacy row caps, available weeks, streaks, monthly totals, and lifetime totals remain complete.
11. Given a new account uses its issued initial credential, the user must establish a private password before using the rest of the app.
12. Given student deletion succeeds while storage cleanup fails, the result reports partial cleanup and records an immutable audit event.
13. Given a 320-pixel viewport, student identity, status, and primary action remain reachable without horizontal page scrolling.
14. Given a query failure, the experience shows an error/retry state rather than an empty-state claim.
15. Given admin-teacher capability is revoked mid-session, subsequent teacher reads and mutations fail server-side.
16. Automated authorization coverage includes cross-masjid, cross-cohort, cross-group, historical-week, inactive-membership, and forged-actor cases.

## 15. Phase 2 visual-design brief

Phase 2 should produce exactly three independent visual directions for the admin’s primary weekly-operations surface.

Each direction must:

- use the existing ITQAN visual language and real audit screenshots as grounding;
- target 1440 × 1024 desktop and define a credible 390 × 844 mobile translation;
- make masjid, cohort, and week context unambiguous;
- foreground triage and repeatable weekly completion;
- provide an obvious route to individual exceptions;
- show how Saturday rotation and reports relate to the same operating model without cramming every feature into one frame;
- avoid inventing unrelated features;
- preserve current terminology unless a Phase 1 terminology decision explicitly changes it;
- represent realistic current dates and operational data.

The three directions should vary information hierarchy and interaction model, not branding alone. No production code begins until the user selects or refines a direction.

## 16. Phase 1 exit criteria

- Every current admin capability is mapped.
- Weekly, exceptional, Saturday, reporting, people, teaching, and account work are distinct.
- Masjid/cohort/week/student context rules are testable.
- Route, role, server, RLS, atomicity, and preserved-feature constraints are explicit.
- Phase 2 has a bounded visual brief.
- A fresh independent reviewer reports zero open P0/P1 findings after remediation.
- P2/P3 findings remain listed and deferred.
