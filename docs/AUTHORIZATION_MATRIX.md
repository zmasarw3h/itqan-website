# Authorization Matrix

`profiles.role` is a current default-experience projection, not standalone
authorization. Admin precedence is a currently effective (Toronto civil-date)
admin membership, then
teacher membership, then student placement; memberships and exact assignment
scope remain mandatory. Staff transitions follow
[`ACCESS_TRANSITION_SEMANTICS.md`](ACCESS_TRANSITION_SEMANTICS.md): masjid grants
are additive, while Guided Change replacement is confined to the selected
masjid.

This matrix records the current authorization boundary enforced by the database, server guards, and local
RLS integration suite. Teacher operational reads now use only the current published-session contracts;
the legacy permanent-membership roster endpoint is revoked.

| Surface | Student | Teacher / admin-teacher | Scoped admin | Super admin |
| --- | --- | --- | --- | --- |
| Profiles | Own active profile only | Own profile; student identity is returned only through documented published-session roster projections, never by direct student-profile reads | Active people with student or staff history in a currently administered masjid | Global read; writes only through guarded service-role workflows |
| Check-ins and items | Own rows; writes require an effective matching group snapshot, canonical tasks, and database-derived scores | No direct raw-table reads; current published students' checklist details are available only through the sanitized version/group/student/date RPC | Read only through RLS; corrections use one internally scoped transactional RPC | Global operational access |
| Weekly plans | Own metadata and own storage path only | Read only metadata for students in the current published session snapshot of an authorized cohort/week; signed links use the same published-session check | Read only metadata and signed links for students in a currently administered masjid | Global operational access |
| Partner recitation | Own rows; current round writes require an effective, matching group snapshot | Read only assigned group/week rows | Scoped read/write for administered masajid | Global operational access |
| Halaqa grades | Own read only | Read and grade any group in the current published session snapshot of an authorized cohort/week; exact published version/group/student membership is required for each grade write, and assigned/primary groups are highlight-only | Scoped read/write for administered masajid; historical session-backed grades retain their snapshot identity | Global operational access |
| Incentives/accountability | Own eligible post-`score_starts_on` obligations and badges; only the existing self-attestation update is allowed | No direct access | Scoped rows; guarded scoring-boundary activation/forward moves require authority over all affected history | Global operational access; guarded scoring-boundary changes may also move backward |
| Below-70 streak reset | Read own minimal typed active-streak projection (`student_id`, `active_streak_length`, `streak_through_week_start`); every `latest_reset_*` field is null; no reset command | No read or reset command unless the profile also has active scoped admin authority | Read scoped typed projection including reset metadata; `reset_student_below70_streak(...)` only for an active student in the admin's relevant masjid after explicit passed-test confirmation and a server-calculated positive active streak; three consecutive below-70 weeks trigger the intervention/test process | Read the complete operational projection if needed; reset command is explicitly denied |
| Masajid/cohorts/groups | Active hierarchy connected to a current Toronto-civil-date membership | Active hierarchy connected to a current Toronto-civil-week assignment with Saturday teacher eligibility | Active currently administered masajid and active descendants | Global setup access, including inactive entities |
| Student memberships | Own history | Rows whose membership window overlaps an effective assignment week | Scoped insert and deliberate open-row closure; identity/history rewrites and deletion are denied | Global read; signed direct insert/update/delete denied |
| Staff memberships | Own history | Own history | Scoped teacher insert and deliberate deactivation/closure; identity/history rewrites, reactivation, admin grants, and deletion are denied | Global read; writes only through guarded service-role workflows |
| Teacher assignments/rotation | None | Assignment navigation may show own upcoming/history. For a selected Sunday week, active teacher/admin-teacher staff capability plus any exact active group assignment in the cohort authorizes the published-session dashboard, every published group roster, plan metadata/link, and individual grade writes; assigned/primary groups are highlight-only. Legacy assignment-only projections retain their narrower contract. | Scoped assignment insert/deactivation and rotation inputs; rotation runs are read only and generation uses the guarded service-role RPC | Global access, but no teacher-surface access through the super-admin role |
| Super-admin audit | None | None | None | Read only through signed sessions; guarded service-role workflows may insert but cannot update, delete, or truncate |
| Guided Change review intents | None | None | None | No direct signed-session access; short-lived rows are created and read only by guarded server actions using the service role |
| Cohort leaderboard | Sanitized projection only: name, rank, score summary, change/status, and own-row marker | None | Separate admin scoring surface | Global operational access |

`week_start` is always the Sunday tracker-week key. The corresponding halaqa event is the following
Saturday, derived with `public.halaqa_saturday_for_week(week_start)`. A teacher assignment is valid only
when the assignment is active for the exact Sunday key and the teacher (including an admin-teacher) has
teacher staff membership covering that Saturday. Operational access is denied before Sunday. From Sunday
through Saturday, that Saturday coverage is sufficient, including a staff membership that begins on the
Saturday. After Saturday, the historical Saturday coverage must still exist and the teacher must also
have current active teacher staff access for the same masjid on the Toronto civil request date. A Saturday
offboarding therefore prevents later roster, plan, signed-file, and grade access.

`public.current_toronto_civil_date()` is the literal Toronto calendar date and governs rotation navigation
and request-time staff authorization. `public.current_effective_date()` remains the 1:00 AM operational
date exclusively for daily check-ins, partner recitation, and scoring rules tied to that reset.

Ordinary hierarchy reads additionally require the referenced masjid, cohort, and group to be active and
the caller's membership or teacher assignment to be current by Toronto civil date/current civil week.
Teacher assignments additionally require staff coverage through their derived Saturday halaqa date. Historical membership
rows remain available where the matrix permits them, but expired/future relationships and inactive
foundation entities neither reveal the current hierarchy nor grant current operational access. Weekly
projection RPCs reject any caller-supplied week start that is not a Sunday.

Internal trigger functions and raw scope resolvers are not application APIs. Application-facing RPCs
must authorize the caller internally and return only the fields documented for that surface.

## RLS policy inventory

The hardening migration replaces every pre-existing policy in the requested surface (the audit read
policy was already super-admin-only and remains unchanged):

| Relation | Policies after Phase 1 |
| --- | --- |
| `profiles` | `Users can read own active profile`; `Admins can read all profiles` (scoped read); assigned teachers cannot read student profile rows and use the safe roster RPC instead; `Admins can insert profiles` and `Admins can update profiles` (super-admin-only) |
| `checkins` | Student own select/current-day insert/constrained update; database trigger protects date, scope, attribution, and derived totals; scoped-admin/super-admin select only; teachers have no direct raw SELECT, and checklist reads use the sanitized published-session RPC; direct signed-admin insert/update/delete denied, with corrections routed through the scoped transactional RPC |
| `checkin_items` | Student own parent-consistent select/canonical insert/completion-only update; database trigger validates task definitions and recalculates the parent score; parent-inherited scoped-admin/super-admin select only; teachers have no direct raw SELECT, and checklist reads use the sanitized published-session RPC; direct signed-admin insert/update/delete denied, with replacement included in the correction transaction |
| `weekly_plans` | Student own select and path/snapshot-checked insert/update; scoped admin or current published-session cohort-authorized teacher select |
| `partner_recitations` | Student own select and current-round insert; scoped admin or assigned-teacher select; scoped admin insert/update/delete |
| `halaqa_grades` | Student own select; scoped admin or current published-session cohort-authorized teacher select; scoped admin or exact current published-session version/group/student teacher insert/update. Historical session snapshots remain available to the scoped admin correction path. |
| `session_roster_version_teachers` | No student access; scoped normal-admin and current captured participant reads for the current published version only; immutable history, with writes limited to the guarded publication trigger/service path |
| `weekly_incentive_runs` | Masjid-scoped admin/super-admin select/insert/update |
| `accountability_obligations` | Student own select and constrained attestation; masjid-scoped admin/super-admin select/insert/update; pending rows require a valid week-specific masjid/cohort/group scope |
| `badge_awards` | Student own select; masjid-scoped admin/super-admin select/insert/update |
| `masajid`, `cohorts`, `halaqa_groups` | Active caller-connected hierarchy select for ordinary roles; super admins can read all hierarchy, while mutations use guarded service-only workflows |
| `student_group_memberships` | Student own history; effective assigned-teacher read; subject-, attribution-, and masjid-scoped normal-admin insert and open-row closure; signed super-admin direct writes and all direct deletes denied |
| `masjid_staff_memberships` | Own history; teacher-only, attribution-checked normal-admin insert and deactivation/closure; signed super-admin direct writes and all direct deletes denied |
| `group_teacher_assignments` | Saturday-eligible teacher own reads; eligible-teacher, attribution-, and masjid-scoped admin insert and active-to-inactive transition; a table-specific trigger independently enforces Saturday eligibility for direct service-role inserts, identity changes, and active-only reactivation; immutable teacher/group/week/creator history; delete is super-admin-only |
| Rotation tables | Saturday-eligible teacher own availability read; masjid-scoped admin/super-admin management for availability and settings; signed-session run access is scoped `SELECT` only and guarded generation is service-role-only. Session-roster drafts, published snapshots, and audit rows are readable only by the scoped normal admin for the cohort; all session-roster mutations are service-role-only and super-admin sessions are deliberately excluded |
| `super_admin_audit_events` | `Active super admins can read audit events`; no signed-role insert/update/delete policy; table ACL grants service role only `SELECT` and `INSERT` |
| `below70_streak_resets` | No direct table read/write; own data is returned only by the typed read RPC | No direct table read/write; ordinary teachers have no typed read/reset access | No direct table read/write; scoped rows are returned only by the typed read RPC, and reset plus audit are written atomically by the guarded RPC | No direct table read/write; typed read is available, reset is denied |
| `super_admin_guided_change_reviews` | RLS enabled with no signed-role policies; table ACL revokes `anon` and `authenticated`; the service role alone may create/read/delete a short-lived review intent that binds operation, scope, effective date, target, actor, and expected canonical access state |
| `storage.objects` weekly-plan policies | Student-owned select and masjid-scoped admin select via `can_admin_read_weekly_plan_path(text)`; bucket-scoped restrictive policies deny authenticated insert/update/delete regardless of any differently named permissive policy because guarded server actions own that workflow |

The additive migration explicitly replaces affected legacy table policies. Storage direct-write denial
uses restrictive bucket-scoped policies, so a separately named permissive policy cannot reopen writes to
the private weekly-plan bucket.

## Function privilege inventory

No `anon` role has `EXECUTE` on an application `SECURITY DEFINER` function. Phone-to-auth-email login
resolution remains a server-only, read-only service-role lookup and is not exposed as an RPC.
Application-owned definer functions are tracked by an explicit shared allowlist; extension-owned and
external functions are excluded by ownership/dependency checks. The migration and catalog assertion use
that identical scope.

The `authenticated` role can execute only these caller-relative definer functions:

- Role/date checks: `is_active_admin()`, `is_active_student()`, `is_active_teacher()`,
  `is_active_super_admin()`, `current_toronto_civil_date()`, `current_effective_date()`, and
  `current_partner_recitation_round()`. `refresh_current_profile_role()` is also available to an
  authenticated session only as a guarded repair tool for its own cached projection; it is not called by
  login or ordinary profile reads, does not reactivate an intentionally inactive profile, and does not
  authorize any scope by itself.
- Scoped authorization: `is_admin_for_masjid(uuid)`, `is_staff_for_masjid(uuid)`,
  `is_teacher_for_group_week(uuid,date)`, `can_read_student_for_week(uuid,date)`,
  `can_grade_student_for_week(uuid,date)`, `can_admin_manage_student_for_week(uuid,date)`, and
  `can_admin_delete_student(uuid)` (which requires all membership and operational history to be in
  caller scope and rejects former staff identities for normal-admin deletion).
- Caller-safe scope projection: `student_group_for_week(uuid,date)`, `student_current_group_id(uuid)`,
  `student_cohort_for_week(uuid,date)`, `student_masjid_for_week(uuid,date)`,
  `group_masjid_id(uuid)`, `cohort_masjid_id(uuid)`, `can_read_profile(uuid)`,
  `can_read_masjid(uuid)`, `can_read_cohort(uuid)`, and `can_read_group(uuid)`.
- Policy helpers: `can_read_operational_student_row(uuid,uuid,date)`,
  `student_scope_snapshot_matches(uuid,date,uuid,uuid,uuid)`,
  `teacher_can_read_membership(uuid,date,date)`, and
  `is_rotation_teacher_for_masjid_week(uuid,uuid,date)`, plus the path-only
  `can_admin_read_weekly_plan_path(text)` and `can_teacher_read_weekly_plan_path(text)` used by Storage RLS and the history-safe
  `can_admin_manage_group_history(uuid)` closure helper.
- Teacher session API: `teacher_session_authorized_scopes(date)`,
  `get_teacher_session_dashboard(uuid,date)`, `get_teacher_session_group_roster(uuid,uuid,date)`,
  `get_teacher_session_student_context(uuid,date)`,
  `get_teacher_session_checklist_details(uuid,uuid,uuid,date,date)`, and
  `save_teacher_session_halaqa_grade(uuid,uuid,uuid,date,boolean,integer,text)`. These APIs use
  published session snapshots and cohort authorization; the primary teacher marker is accepted only
  together with active teacher/admin profile and Saturday staff checks, and never exposes super-admin
  access through teacher surfaces.
- Application RPCs: `student_weekly_teacher_name(date)`,
  `student_cohort_leaderboard_for_week(date)`, `student_leaderboard_available_weeks()`,
  `teacher_assignment_contexts()`, and
  `admin_students_for_week(date)`, plus the atomic, actor-scoped
  `apply_admin_checkin_correction(uuid,date,text,text,text[])` mutation.
- Below-70 streak contracts: `get_student_below70_streak(uuid,date)` preserves the student's own read but
  returns students only the three-field active-streak projection with every `latest_reset_*` field null;
  scoped admins and super admins receive the complete authorized reset projection. The batch
  `get_students_below70_streaks(uuid[],date)` is restricted to active admins and super admins and returns
  only per-student authorized rows. `reset_student_below70_streak(uuid,uuid,boolean,text)` accepts a request UUID, target
  student, explicit `true` passed-test confirmation, and optional concise note; it is granted to
  authenticated sessions only but internally accepts only active normal admins/admin-teachers with
  current administration authority for the student's historical reset scope. It excludes students,
  ordinary teachers, cross-masjid admins, anonymous callers, and signed super-admin callers.

`teacher_group_roster_context(uuid,date)` remains in the catalog inventory for migration-drift checks,
but its `PUBLIC`, `anon`, `authenticated`, and `service_role` execute privileges are revoked. It cannot
be used as a permanent-membership teacher roster endpoint before publication, for a draft, or for a
superseded version.

`prepare_teacher_rotation_publication(...)` and `apply_teacher_rotation_publication(...)` are
service-role-only. They independently validate a current Toronto-civil-date admin/super-admin actor,
enforce Saturday eligibility plus an exact `available = true` row, and compare canonical prepared state
under a cohort/week advisory lock. Browser roles cannot execute either RPC. The legacy generation RPC is
also service-role-only and guarded, but temporarily has no request-ID stale-state protection.
The legacy session-roster contracts (`load_or_create_session_roster_draft(...)`,
`refresh_session_roster_draft(...)`,
`get_session_roster_draft(...)`, `move_session_roster_student(...)`,
`assign_session_roster_primary_teacher(...)`, `compute_session_roster_readiness(...)`,
`review_session_roster_draft(...)`, `publish_session_roster_draft(...)`,
`create_session_roster_revision(...)`, `get_current_session_roster(...)`, and
`get_session_roster_history(...)`) are service-role-only. Their normal-admin actor checks exclude
`super_admin`, enforce active masjid/cohort scope, use canonical Sunday identity, serialize the
cohort/week, and keep each mutation plus its audit event atomic. `can_read_session_roster_cohort(...)`
is the only signed-role helper for these tables and grants scoped normal-admin reads only.
Refresh is also service-only and requires an explicit discard-confirmation input. It can supersede only
the exact stale draft token supplied by the scoped normal admin; it cannot be used by a super-admin
through this normal-admin path, cannot mutate permanent memberships or existing teacher assignments,
and cannot change the live published version.

The additive teacher-driven wizard contracts are also service-role-only:
`load_or_create_session_roster_wizard_draft(...)`, `generate_session_roster_wizard_groups(...)`,
`move_session_roster_wizard_student(...)`, `assign_session_roster_wizard_primary_teacher(...)`,
`review_session_roster_wizard_draft(...)`, `publish_session_roster_wizard_draft(...)`, and
`create_session_roster_wizard_revision(...)` remain stable contracts. The additive v2 generation and
publication calls add `generate_session_roster_wizard_groups_v2(...)` and
`publish_session_roster_wizard_draft_v2(...)`: the default count is exactly the available eligible-teacher
count; only a confirmed smaller positive count is allowed, and extra available teachers are preserved in
the immutable participant snapshot without a primary highlight. Expected state/dependency markers,
request IDs, and explicit discard confirmation protect replay and regeneration. The wizard loader does not
silently convert an existing legacy draft. `preview_session_roster_wizard_legacy_transition(...)` returns
the blocking draft/source/live-version recovery state, while
`transition_session_roster_wizard_legacy_draft(...)` is the normal-admin-scoped, service-only,
explicit-discard, replay-safe supersede-and-create transition.

The teacher session contracts are authenticated, caller-checked projections over the current published
version only. Authorization also accepts an active eligible teacher captured in the current
`session_roster_version_teachers` participant snapshot, while the legacy exact-assignment path remains
available: `teacher_session_authorized_scopes(date)`,
`get_teacher_session_dashboard(uuid,date)`, `get_teacher_session_group_roster(uuid,uuid,date)`,
`get_teacher_session_student_context(uuid,date)`, and
`get_teacher_session_checklist_details(uuid,uuid,uuid,date,date)` are read-only; the individual
`save_teacher_session_halaqa_grade(uuid,uuid,uuid,date,boolean,integer,text)` RPC is the only teacher
grade write. They require an active `teacher` or `admin` profile, active teacher staff membership for
the masjid, either an exact active assignment somewhere in the cohort/week or primary responsibility in
the current published session, the current published version, and exact snapshot membership.
`super_admin` is explicitly denied. The assigned/primary group is returned
only as a highlight. Checklist details return stored labels/weights, completion, earned points, stored
daily totals/score, and a privacy-safe record state; notes, raw records, timestamps, correction actors,
and audit metadata are excluded. Weekly-plan metadata and five-minute signed links use the same current
published-session scope.

The Phase 1A functions `apply_scoped_user_setup(...)`,
`get_scoped_user_setup_request_result(...)`, `get_scoped_user_setup_auth_recovery(...)`,
`get_person_access_state(uuid,uuid)`, `apply_super_admin_access_change(...)`,
`prepare_super_admin_masjid_staff_grant(...)`, `apply_super_admin_masjid_staff_grant(...)`,
`apply_super_admin_staff_membership_end(...)`, `apply_super_admin_masjid_update(...)`,
`apply_super_admin_masjid_provision(...)`, and `apply_super_admin_hierarchy_change(...)` are also
service-role-only. They independently validate the passed actor, use explicit current-state or hierarchy
checks, and keep membership/profile changes plus audit insertion inside one transaction.
`preview_official_scoring_start_change(...)` and `apply_official_scoring_start_change(...)` are likewise
service-role-only: the former previews affected weeks and obligations, while the latter uses a stable
request ID to change the boundary, waive pending pre-boundary obligations without payment attestation,
and write the corresponding audits atomically. Trigger functions (`enforce_student_accountability_attestation()`,
`enforce_student_checkin_integrity()`, `enforce_student_checkin_item_integrity()`,
`recalculate_student_checkin_score()`, `set_student_scope_snapshot()`, `teacher_rotation_row_scope_matches()`, and
`protect_foundation_row_identity()`) and the superseded broad student RPC
(`student_cohort_students_for_week(uuid,date)`) have no `PUBLIC`, `anon`, or `authenticated` execute grant.
`student_weekly_teacher(uuid,date)` is a deliberately narrow authenticated historical-identity projection: its
definer body limits students to themselves and scoped admins to their masjid, and it cannot authorize operational
student data. All definer functions use an empty `search_path`.

The non-definer helpers `week_start_for_date(date)` and `weekly_plan_path_is_owned(uuid,date,text)` are
also executable by authenticated callers because RLS policies use them; neither reads protected data.

## Deferred weekly incentive uniqueness change

The existing `weekly_incentive_runs_week_start_key` remains globally unique on `week_start`. It limits
the product to one masjid's incentive run per tracker week even though RLS scopes incentive rows by
masjid. Phase 1 intentionally leaves the production constraint unchanged. A separate reviewed
migration should audit existing rows and replace it with `(masjid_id, week_start)` uniqueness, with an
explicit staging rollout and rollback plan.
