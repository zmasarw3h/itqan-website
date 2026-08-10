# Data Model

## profiles

- `id`: Supabase Auth user UUID.
- `name`
- `email`: internal synthetic auth email.
- `phone`: optional display-only phone.
- `role`: `student | teacher | admin | super_admin`
- `active`
- `score_starts_on`: nullable first canonical Sunday included in student scoring. `null` means the student is not scorable yet; it never means score all history.
- `created_at`

`profiles.role` is the cached current primary/default experience for non-super-admins. The database projects it from currently effective admin staff, teacher staff, and student placement windows in that precedence order; a profile with no current placement becomes inactive. A future membership does not project early. Scoped authorization still comes from membership and assignment tables plus Supabase RLS.

## Multi-Masjid Scope

The scope hierarchy is:

```text
masajid
  -> cohorts: brothers | sisters
    -> halaqa_groups
      -> student_group_memberships
      -> group_teacher_assignments
```

Core tables:

- `masajid`: masjid name, slug, active flag.
- `cohorts`: brothers/sisters cohort inside one masjid.
- `halaqa_groups`: operational student groups inside one cohort.
- `student_group_memberships`: historical student-to-group membership with `starts_on` and optional `ends_on`.
- `masjid_staff_memberships`: admin/teacher membership in one masjid.
- `group_teacher_assignments`: one teacher assigned to one group for one tracker `week_start`.
- `teacher_rotation_availability`: per-teacher, per-cohort weekly availability for Saturday halaqa rotation.
- `student_rotation_availability`: explicit student absences for one cohort and tracker week. Missing rows mean attending.
- `cohort_rotation_settings`: active rotation configuration for a cohort, including target stable group count.
- `teacher_rotation_runs`: audit metadata for generated weekly rotation runs.
- `super_admin_audit_events`: append-only audit target for future super-admin mutations and account recovery actions.

Internal transactional state lives in the unexposed `private` schema:

- `workflow_mutation_requests`: completed service-workflow requests keyed by caller-generated UUID. It stores the normalized input and result so an exact retry returns the original result without duplicating memberships or audit events. It has no browser or service-role table grants; only the guarded definer functions can use it.
- `workflow_expected_state_snapshots`: binds a staff-grant request UUID to its stable desired inputs and original canonical access snapshot, so a committed response can be replayed after the target state changes.
- `masjid_update_requests`: stores stable masjid-update inputs and committed results for exact replay without repeating the hierarchy update or audit event.

## Below-70 Streak Resets

`below70_streak_resets` is an append-only, server-mediated ledger. Each row stores the student, the
historical `masjid_id`, `cohort_id`, and `halaqa_group_id` used for authorization, the effective-through
canonical Sunday, the server-calculated `previous_streak_length`, an always-true
`passed_test_confirmation`, an optional trimmed 280-character `admin_note`, the caller `actor_id`, a
caller `request_id`, and `created_at`. Foreign keys use `on delete restrict` so later hierarchy changes
cannot erase the meaning of a historical reset. A unique `(student_id, effective_through_week_start)`
boundary and unique request UUID make retries and concurrent submissions one logical reset.

The table has no browser-role table grants and a deny-only RLS policy. `reset_student_below70_streak(...)`
is the only authenticated write contract; it locks the student, resolves the latest completed week from
`current_effective_date()` (Toronto's existing 1:00 a.m. operational boundary), resolves exactly one
historical scope, requires an active normal admin/admin-teacher for that scope's masjid, requires explicit
passed-test confirmation, recomputes the active streak, and inserts the reset plus its
`super_admin_audit_events` row atomically. Super-admin and ordinary-teacher sessions cannot execute it.

`get_student_below70_streak(student_id, through_week_start)` is the student-specific typed read: an active
student reading their own row receives only `student_id`, `active_streak_length`, and
`streak_through_week_start`; every nullable `latest_reset_*` field is returned as null. Scoped admins and
super admins receive the complete authorized latest-reset summary. The batch
`get_students_below70_streaks(student_ids, through_week_start)` is an administrative read for active admins
and super admins only and returns complete reset metadata for rows authorized by the existing scope rules.
A null through-week means the latest completed canonical week. The database
calculation counts only completed qualifying weeks after the latest reset boundary; missing activity is
the existing zero-contribution score, while missing/ambiguous historical membership, incomplete weeks,
and passing weeks break the consecutive run. Grades, activity, and historical snapshots are never
rewritten, so a report through a week before the reset retains the original interpretation.

Server-side helper functions expose narrow caller-relative views used by the app:

- `student_weekly_teacher_name(week_start)`: returns only the signed-in student's assigned teacher display name.
- `teacher_assignment_contexts()`: returns only the signed-in teacher's assignment labels. It returns a roster count only
  while the exact group/week passes operational authorization; upcoming and historical labels carry no roster data.
- `teacher_group_roster_context(group_id, week_start)`: legacy permanent-membership roster RPC retained only for catalog compatibility; execute is revoked for every role. It is not an application API.
- `can_teacher_read_weekly_plan_path(path)`: authorizes a weekly-plan Storage path only when its metadata and the student's exact current published session snapshot agree with an authorized cohort/week teacher session.
- `teacher_session_authorized_scopes(week_start)`: returns active teacher/admin-teacher capability for each authorized cohort/week, the current publication identity/time when present, and assigned group IDs only as responsibility highlights.
- `get_teacher_session_dashboard(cohort_id, week_start)`: returns the stable dashboard contract: authorized scope, publication/version/time, every published group, primary-teacher identity, roster/plan counts, and grade progress.
- `get_teacher_session_group_roster(version_id, group_id, week_start)`: returns one exact current published group snapshot with student identity, plan availability, and the current session-grade projection.
- `get_teacher_session_student_context(student_id, week_start)`: returns the exact current published student/group/version context used by server-side plan and grade actions.
- `get_teacher_session_checklist_details(version_id, group_id, student_id, week_start, checklist_date)`: returns only privacy-safe checklist details with stored item labels/weights, completion, earned points, stored totals/score, and `missing | in_progress | complete | partial` state.
- `save_teacher_session_halaqa_grade(version_id, group_id, student_id, week_start, attended, recitation_points, notes)`: saves one individual grade against the exact current published snapshot and records the historical grader identity.
- `student_cohort_leaderboard_for_week(week_start)`: returns the minimum documented same-cohort leaderboard projection without peer UUIDs or contact details.
- `student_leaderboard_available_weeks()`: returns weeks with activity in the signed-in student's effective cohort.
- `admin_students_for_week(week_start)`: returns active students only in masajid the signed-in admin currently serves.
- `cohort_masjid_id(cohort_id)`: returns a cohort's masjid only when the caller can read that cohort.

`student_weekly_teacher(student_id, week_start)` remains as an authenticated, caller-checked historical teacher
identity projection for a student themselves or a currently scoped admin. It does not expose operational student
records. The superseded `student_cohort_students_for_week(student_id, week_start)` remains only for migration
compatibility and has no browser-role execute grant.

Service-only transactional functions added for Phase 1A and used by the Phase 1B server actions:

- `apply_scoped_user_setup(...)`: validates the Auth user, actor, active hierarchy, masjid scope, and independent student scoring boundary before creating the profile, one student/teacher membership, and one audit event atomically.
- `get_scoped_user_setup_request_result(...)`: validates the current actor and exact original setup payload before returning a completed request result. This lets an identical form retry finish without creating a second Auth user.
- `get_scoped_user_setup_auth_recovery(...)`: resolves an Auth-only identity only when its trusted Auth metadata exactly matches the setup request UUID, actor, normalized email, and complete canonical setup payload. It never exposes Auth identity lookup to browser roles.
- `get_person_access_state(actor_id, target_profile_id)`: returns a canonical profile/membership snapshot only after verifying that the passed actor is currently an active super admin.
- `apply_super_admin_access_change(...)`: locks and compares that snapshot, derives the access transition in PostgreSQL, writes profile/membership/audit changes atomically, and protects the last active super admin and last active admin of an active masjid.
- `apply_super_admin_masjid_staff_grant(...)`: atomically adds only missing admin and/or teacher memberships at one masjid. It never ends an existing staff capability or changes another masjid, and writes all audit events using an idempotent request ledger and canonical stale-state check.
- `prepare_super_admin_masjid_staff_grant(...)`: captures or replays the original canonical access snapshot for one stable staff-grant request before the mutation RPC runs.
- `apply_super_admin_staff_membership_end(...)`: closes one open staff membership, recomputes the projected profile role, and writes its audit event in the same transaction after checking the canonical snapshot, inclusive date, teacher-assignment safety, and continuous future admin-coverage invariant.
- `refresh_current_profile_role()`: guarded, self-only repair of a cached current role/active projection; it is not called during login or ordinary profile reads, does not reactivate an intentionally inactive profile, and does not grant scope by itself.
- `apply_super_admin_masjid_update(...)`: atomically updates masjid fields and active state, writes the audit event, rejects stale state, and prevents activation without continuous admin coverage.
- `preview_official_scoring_start_change(...)`: returns the direction, affected activity weeks, and pending pre-boundary obligations only after revalidating the active admin actor and the complete affected masjid scope.
- `apply_official_scoring_start_change(...)`: atomically changes the student-wide boundary, waives pending pre-boundary obligations without marking them paid, writes profile and per-obligation audit events, and records an idempotent request result. Scoped admins may activate or move forward only when all affected history is inside their current masjid authority; super admins may also move backward.

The former `apply_super_admin_score_start_correction(...)` remains only for schema compatibility and has
no service-role execute grant.

All transactional functions are denied to `PUBLIC`, `anon`, and `authenticated` and granted only to
`service_role`. Their passed actor IDs are treated as untrusted input and revalidated from current
database state inside each call.

## Weekly Rotation Foundation

Stable student groups are separate from weekly teacher availability. Admins intentionally rebalance
`student_group_memberships` when group sizes need to change; weekly availability does not rebalance
students automatically.

Rotation tables:

- `student_rotation_availability`: session-only attendance ledger for the selected Saturday. It is unique on `student_id`, `cohort_id`, and Sunday `week_start`; `available` is always `false` because attendance is represented by no row. An optional concise reason and `recorded_by` identify each absence update. Its service-only atomic save function verifies the current normal admin's masjid scope and the student's effective membership in the selected cohort/week. Browser RLS permits only scoped normal-admin reads and no direct browser writes; super-admin sessions are deliberately excluded.
- `teacher_rotation_availability`: stores whether a teacher is available for one cohort and tracker week. Availability is opt-in: rows default to unavailable until an admin marks the teacher available. It is unique on `teacher_id`, `cohort_id`, and `week_start`, and `week_start` must be the Sunday tracker week start. Rows must reference an active teacher with an active teacher staff membership for the masjid during that week.
- `cohort_rotation_settings`: stores one active rotation setting row per cohort. `target_group_count` must be positive.
- `teacher_rotation_runs`: stores generation counts for audit: available teachers, groups, assignments, and warnings.
  Slice 5 adds nullable request, masjid, Saturday, expected-state digest, eligibility, unassigned-ID,
  assignment-result, warning-code, completion, and source metadata without rewriting historical rows.

Rotation mutations are intentionally separate:

- `apply_student_rotation_availability`: atomically replaces only the selected cohort/week absence ledger after validating the normal admin actor, canonical Sunday, active cohort/masjid, and effective student membership. It does not write memberships, groups, or assignments.
- `apply_cohort_group_rebalance`: creates missing active groups and applies effective-dated balanced
  student memberships for one cohort/week in a single transaction. It is service-role-only and verifies
  the supplied actor's scoped admin access.
- `prepare_teacher_rotation_publication` / `apply_teacher_rotation_publication`: service-only prepare/apply
  lifecycle. PostgreSQL supplies and compares canonical state under a scoped lock, validates Saturday
  eligibility plus exact availability, and derives all run results.
- `apply_teacher_rotation_generation`: temporary service-only compatibility wrapper for the prior app
  signature. It enforces the guarded database boundary but has no request-ID stale-state protection.
- `load_or_create_session_roster_draft`, `get_session_roster_draft`,
  `move_session_roster_student`, `assign_session_roster_primary_teacher`,
  `compute_session_roster_readiness`, `review_session_roster_draft`,
  `publish_session_roster_draft`, `create_session_roster_revision`,
  `refresh_session_roster_draft`,
  `get_current_session_roster`, and `get_session_roster_history`: service-only
  contracts for the attendance-aware Saturday session roster layer described below.

RLS is conservative: active admins for the scoped masjid manage rotation data. Teachers may read only
their own availability rows. Session-roster tables grant signed sessions only scoped `SELECT`; all
draft, review, publish, revision, and audit writes stay inside the service-only contracts. The helper
`can_read_session_roster_cohort(cohort_id)` intentionally recognizes only an active normal admin
(`profiles.role = 'admin'` plus an active admin staff membership), so a signed super-admin session does
not inherit this normal-admin workflow.

## Attendance-Aware Saturday Session Rosters

The session-roster layer is an additive Saturday-specific planning and historical snapshot. Its identity
is `(cohort_id, week_start)`, where `week_start` is canonical Sunday and
`halaqa_saturday = week_start + 6`. It consumes `student_rotation_availability` but does not replace it,
and it never mutates `student_group_memberships` or `group_teacher_assignments`.

The public tables are:

- `session_roster_drafts`: one current mutable draft per cohort/week, with a monotonic revision number,
  source-state digest, optimistic `state_version`, review metadata, and links to its base/current
  published version. Legacy drafts keep `wizard_mode = 'legacy'`; teacher-driven drafts add only the
  wizard readiness/dependency fields (`default_group_count`, `requested_group_count`, actual/derived group
  count, available teacher count, prerequisite state, count-vs-anchor mismatch/confirmation state, unplaced
  count, imbalance warning, primary responsibilities, and recovery guidance). A stale legacy refresh follows
  the existing contract; a wizard source change requires the explicit discard-confirmation regeneration path.
  A current legacy draft is never silently rewritten by the wizard loader; it must finish through the legacy
  contract or use the explicit audited transition before the wizard is used for that cohort/week.
- `session_roster_draft_groups`: legacy permanent-group snapshots plus nullable primary responsible-teacher
  identity/name. These remain for the existing contract and are not weekly assignment replacements.
- `session_roster_draft_slots`: additive Saturday-only session slots. Each slot has an immutable-in-draft
  identity, deterministic order/name, optional `anchor_group_id`, primary teacher snapshot, and explicit
  mismatch confirmation/reason. Slots are independent of permanent `halaqa_groups` and are the source for
  teacher-driven wizard publication.
- `session_roster_draft_students`: one row per effective active student in the usual group for the
  selected week. Missing availability is `attending`; an explicit absence is `unavailable` and cannot
  have a session group. Legacy drafts initially use the usual group; teacher-driven drafts use the
  additive `session_group_slot_id` and can redistribute only inside the draft. Published student rows
  contain attending, placed students only, so an unavailable student never appears in a published roster.
- `session_roster_versions`, `session_roster_version_groups`, `session_roster_version_slots`, and
  `session_roster_version_students`: immutable published snapshots. Legacy rows keep their permanent-group
  session identity; wizard rows use the additive slot identity and leave the legacy `session_group_id` null.
  Snapshot names, optional permanent anchor, week/Saturday, primary-teacher identity/name, version, and
  publishing actor/time are retained for history.
- `session_roster_version_teachers`: immutable published participant snapshots. It records every available
  eligible teacher captured by a teacher-driven publish, whether that teacher has a unique primary slot or
  participates as a cohort co-teacher without a primary responsibility. This snapshot is the authorization
  source for current-version cohort-wide teacher surfaces and preserves participant identity historically.
- `session_roster_audit_events`: append-only draft movement, responsibility, review, publish, revision,
  and `draft_refreshed` history. A refresh event records the superseded and replacement draft/version
  identities, source digest, actor, request, and discard scope in its before/after/metadata payloads.
  `private.session_roster_mutation_requests` stores request UUID, normalized input, actor, and result
  for exact replay; changing any input under a committed request UUID is rejected.

Readiness is database-derived. Every attending student must be placed exactly once; unplaced attending
students, source changes, an unreviewed current state, no session groups with attending students, and
missing primary responsibility are blockers. In the wizard, zero teachers, targets above the available
teacher count, and unconfirmed smaller counts are blockers; a confirmed smaller count is allowed. Duplicate
primary responsibilities and unconfirmed teacher/anchor mismatches are explicit blockers. A group-count
imbalance is a warning only. Primary teachers must be active, authorized cohort
teachers with Saturday staff coverage and exact positive teacher availability; responsibility is a
highlight/ownership marker, not an exclusivity rule for future teacher viewing or grading. The
published-session teacher APIs authorize an active teacher or admin-teacher with an exact active assignment
somewhere in the cohort/week or primary responsibility in the current published session to view and grade
every group in that published cohort snapshot. They never authorize a draft or superseded version.

The wizard dependency revision advances for student availability, teacher availability, and affected
Saturday teacher staff/profile eligibility edits. The source digest is also recomputed at every stateful
operation, so a changed or reverted source cannot silently authorize a stale placement.

Publishing locks the cohort/week, checks the expected draft `state_version`, rechecks source and teacher
eligibility, inserts a new immutable version and all snapshot rows, closes the draft, records the audit
event, and stores the replay result in one transaction. A wizard revision creates a new draft from the
current published slot/student snapshot while the published version remains live. Concurrent or stale
submissions fail with a refresh/review error rather than partially applying. Legacy
`refresh_session_roster_draft(...)` remains the old contract; wizard regeneration requires explicit discard
confirmation and never implicitly reviews or publishes the replacement draft.

## Published-Session Teacher Authorization

The teacher authorization/read layer is separate from permanent membership and from the primary-teacher
highlight. A teacher or admin-teacher is authorized for a cohort/week only when the profile is active,
the teacher staff membership is active for the masjid and Saturday, and at least one active group
assignment for that teacher covers the exact cohort/week. A `super_admin` profile does not satisfy this
capability, even if it has historical assignments. Once authorized, the read APIs expose every group in
the current published version for that cohort/week; `assigned_group_ids` and `is_assigned_group` are
highlight-only fields.

Only the current published `session_roster_version_id` is exposed to teacher surfaces. Drafts and
superseded versions are denied. Student roster membership comes from
`session_roster_version_students`, not current permanent membership. Published group, student, primary
teacher, version, Saturday, publisher, publication time, and roster identity are therefore historical
snapshot values.

`halaqa_grades` keeps nullable session snapshot columns for backward compatibility. A session-backed row
stores the version ID/number, Saturday, masjid/cohort/group IDs and names, primary-teacher identity/name,
and `graded_by`. The database trigger validates and canonicalizes those values. Grade writes are one
student at a time, require the exact current published version/group/student membership, serialize on
the cohort/week lock, and reject stale or superseded versions. Admin correction may update a historical
session-backed grade without replacing its snapshot identity.

Checklist details are a read-only projection. It uses the saved `checkin_items.task_label` and `weight`
snapshots rather than current task definitions, returns stored daily totals/score and a derived record
state, and omits notes, raw check-in records, submission timestamps, correction actors, and audit metadata.
Weekly-plan metadata and five-minute signed links use the same current published-session authorization
boundary.

Teachers cannot directly select `checkins` or `checkin_items`, even for a student in an authorized
published session. The only teacher checklist read is `get_teacher_session_checklist_details(...)`,
which returns the documented sanitized projection and excludes notes, raw rows, task IDs, submission or
correction metadata, and audit fields. Scoped admins/super-admins and students retain their existing
direct table behavior.

## Scoped Operational Records

These student-owned operational tables snapshot scope with nullable `masjid_id`, `cohort_id`, and `halaqa_group_id` columns for authorization and integrity diagnostics:

- `checkins`
- `weekly_plans`
- `partner_recitations`
- `halaqa_grades`
- `accountability_obligations`
- `badge_awards`

`halaqa_grades` additionally stores nullable published-session identity columns for session-backed grades:
`session_roster_version_id`, `session_roster_version_number`, `session_halaqa_saturday`,
`session_group_id`, `session_group_slot_id`, `session_group_name`, `session_primary_teacher_id`, and
`session_primary_teacher_name`. A legacy session grade uses `session_group_id`; a wizard slot grade uses
`session_group_slot_id` and optionally snapshots its permanent anchor in `halaqa_group_id`. Legacy grade
rows with null session identity remain supported by the existing student/admin paths.

`checkin_items` does not duplicate scope initially because each item belongs to a scoped `checkins` row.

Historical membership—not an activity snapshot—determines report population and
display placement. Report scoring attributes exact and same-masjid activity to
that membership placement, accepts legacy null-masjid activity only with one
unambiguous membership, and excludes activity when any stored masjid, cohort
owner, or group owner supplies cross-masjid evidence. Exact
snapshot equality remains required for new writes and pending obligations.

## Existing Student Records

Existing data is backfilled into:

- Masjid: `Toronto Islamic Centre (TIC)`
- Cohort: `brothers`
- Group: `TIC Brothers Default Group`

Existing admins receive TIC admin staff memberships. Existing active students receive historical group memberships starting on `1900-01-01` so past records can resolve scope.

## Rules

- Phone numbers are globally unique across masajid.
- One check-in per student per date.
- One partner-recitation record per student, week, and round.
- One halaqa grade per student and week.
- One weekly plan per student and plan week.
- One active/effective student group membership per student for a date range.
- One active/effective staff membership per profile, masjid, staff role, and date range.
- One teacher assignment per halaqa group and tracker week.
- One teacher availability row per teacher, cohort, and tracker week.
- One explicit absence row per student, cohort, and tracker week; a missing row means attending.
- One active rotation settings row per cohort.
- One current session-roster draft per cohort/week, one row per scoped student in that draft, and one
  immutable published version number per cohort/week. Wizard drafts have exactly one slot per available
  teacher after generation; published rosters contain each attending student exactly once and no
  unavailable students.
- Session roster drafts and publish/revision audit events are mutated only by atomic service contracts;
  browser clients have no direct write grants, and signed reads are normal-admin masjid/cohort scoped.
- Students can only view and submit their own records. Student leaderboard rows are limited to the student's cohort for the selected week.
- Student checklist items must match the canonical task key/label/weight for the date. Database triggers protect check-in identity, scope, date, and attribution and recalculate score-bearing columns from task completion.
- Active students without an effective group membership see setup-incomplete screens and cannot create check-ins, weekly plans, or partner recitations.
- Admin app queries and mutations are scoped by masjid membership. Phase 0 also tightens direct Data API write policies so normal admins cannot grant admin access, mutate global foundation setup, or change other masajid through broad RLS.
- Signed super-admin sessions are read-capable but cannot directly mutate profiles or student/staff membership history through the Data API. Super-admin access writes use the guarded service-only transactional functions.
- An active masjid must have gap-free admin coverage from the current Toronto civil date through every future membership boundary, ending in at least one open-ended active admin membership. Inactive masajid are exempt until reactivated.
- Active super admins can read `super_admin_audit_events`; browser/client writes to the audit table are not exposed.
- Normal admins close or deactivate membership/assignment rows instead of deleting foundation history. Direct signed-session deletes of student and staff membership history are denied, including for super admins.
- Teachers use the published-session contracts for cohort-wide group reads, checklist detail reads,
  weekly-plan metadata/links, and individual grade writes. Exact version/group/student snapshot
  membership is required; the primary/assigned group is only a highlight, and legacy assignment-only
  projections remain narrower.
- Access transition semantics, including selected-masjid replacement, additive previews, multi-masjid preservation, deactivation, and assignment-aware teacher removal, are documented in [`ACCESS_TRANSITION_SEMANTICS.md`](ACCESS_TRANSITION_SEMANTICS.md).
