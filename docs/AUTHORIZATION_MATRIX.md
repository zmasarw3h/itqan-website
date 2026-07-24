# Authorization Matrix

This matrix records the Phase 1 authorization boundary enforced by the hardening migration. The database,
server guards, and local RLS integration suite must agree with it.

| Surface | Student | Teacher / admin-teacher | Scoped admin | Super admin |
| --- | --- | --- | --- | --- |
| Profiles | Own active profile only | Own profile plus active students whose membership overlaps an effective assigned group/week | Active people with student or staff history in a currently administered masjid | Global read; writes only through guarded service-role workflows |
| Check-ins and items | Own rows; writes require an effective matching group snapshot, canonical tasks, and database-derived scores | Read only rows in an effective assigned group for that row's tracker week | Read only through RLS; corrections use one internally scoped transactional RPC | Global operational access |
| Weekly plans | Own metadata and own storage path only | Read only assigned group/week metadata; signed links require the same server-side scope check | Read only metadata and signed links for students in a currently administered masjid | Global operational access |
| Partner recitation | Own rows; current round writes require an effective, matching group snapshot | Read only assigned group/week rows | Scoped read/write for administered masajid | Global operational access |
| Halaqa grades | Own read only | Read/write only the exact assigned group/week | Scoped read/write for administered masajid | Global operational access |
| Incentives/accountability | Own eligible post-`score_starts_on` obligations and badges; only the existing self-attestation update is allowed | No direct access | Scoped to the row's masjid | Global operational access; audited scoring-boundary correction is server guarded |
| Masajid/cohorts/groups | Active hierarchy connected to a current effective membership | Active hierarchy connected to a current-week effective assignment/staff membership | Active currently administered masajid and active descendants | Global setup access, including inactive entities |
| Student memberships | Own history | Rows whose membership window overlaps an effective assignment week | Scoped insert and deliberate open-row closure; identity/history rewrites and deletion are denied | Global read; signed direct insert/update/delete denied |
| Staff memberships | Own history | Own history | Scoped teacher insert and deliberate deactivation/closure; identity/history rewrites, reactivation, admin grants, and deletion are denied | Global read; writes only through guarded service-role workflows |
| Teacher assignments/rotation | None | Own effective assignment/availability rows | Scoped assignment insert/deactivation and rotation inputs; rotation runs are read only and generation uses the guarded service-role RPC | Global access |
| Super-admin audit | None | None | None | Read only through signed sessions; guarded service-role workflows may insert but cannot update, delete, or truncate |
| Guided Change review intents | None | None | None | No direct signed-session access; short-lived rows are created and read only by guarded server actions using the service role |
| Cohort leaderboard | Sanitized projection only: name, rank, score summary, change/status, and own-row marker | None | Separate admin scoring surface | Global operational access |

Effective dates use `public.current_effective_date()` and Sunday tracker weeks. A teacher assignment is
valid only when the assignment is active for the exact week and the teacher (including an admin-teacher)
has an active teacher staff membership covering that week. Future, expired, or inactive memberships do
not grant current access.

Ordinary hierarchy reads additionally require the referenced masjid, cohort, and group to be active and
the caller's membership or teacher assignment to be effective now/current week. Historical membership
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
| `checkins` | Student own select/current-day insert/constrained update; database trigger protects date, scope, attribution, and derived totals; scoped admin or assigned-teacher select; direct signed-admin insert/update/delete denied, with corrections routed through the scoped transactional RPC |
| `checkin_items` | Student own parent-consistent select/canonical insert/completion-only update; database trigger validates task definitions and recalculates the parent score; parent-inherited scoped admin or teacher select; direct signed-admin insert/update/delete denied, with replacement included in the correction transaction |
| `weekly_plans` | Student own select and path/snapshot-checked insert/update; scoped admin or assigned-teacher select |
| `partner_recitations` | Student own select and current-round insert; scoped admin or assigned-teacher select; scoped admin insert/update/delete |
| `halaqa_grades` | Student own select; scoped admin or assigned-teacher select; scoped admin or exact assigned-teacher insert/update |
| `weekly_incentive_runs` | Masjid-scoped admin/super-admin select/insert/update |
| `accountability_obligations` | Student own select and constrained attestation; masjid-scoped admin/super-admin select/insert/update; pending rows require a valid week-specific masjid/cohort/group scope |
| `badge_awards` | Student own select; masjid-scoped admin/super-admin select/insert/update |
| `masajid`, `cohorts`, `halaqa_groups` | Active caller-connected hierarchy select for ordinary roles; super admins can read all hierarchy, while mutations use guarded service-only workflows |
| `student_group_memberships` | Student own history; effective assigned-teacher read; subject-, attribution-, and masjid-scoped normal-admin insert and open-row closure; signed super-admin direct writes and all direct deletes denied |
| `masjid_staff_memberships` | Own history; teacher-only, attribution-checked normal-admin insert and deactivation/closure; signed super-admin direct writes and all direct deletes denied |
| `group_teacher_assignments` | Effective teacher own reads; eligible-teacher, attribution-, and masjid-scoped admin insert and active-to-inactive transition; immutable teacher/group/week/creator history; delete is super-admin-only |
| Rotation tables | Effective teacher own availability read; masjid-scoped admin/super-admin management for availability and settings; signed-session run access is scoped `SELECT` only and guarded generation is service-role-only |
| `super_admin_audit_events` | `Active super admins can read audit events`; no signed-role insert/update/delete policy; table ACL grants service role only `SELECT` and `INSERT` |
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

- Role/effective-time checks: `is_active_admin()`, `is_active_student()`, `is_active_teacher()`,
  `is_active_super_admin()`, `current_effective_date()`, and `current_partner_recitation_round()`.
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
- Application RPCs: `student_weekly_teacher_name(date)`,
  `student_cohort_leaderboard_for_week(date)`, `student_leaderboard_available_weeks()`,
  `teacher_assignment_contexts()`, `teacher_group_roster_context(uuid,date)`, and
  `admin_students_for_week(date)`, plus the atomic, actor-scoped
  `apply_admin_checkin_correction(uuid,date,text,text,text[])` mutation.

`apply_teacher_rotation_generation(...)` is service-role-only and repeats actor/cohort scope validation
inside the transaction. The Phase 1A functions `apply_scoped_user_setup(...)`,
`get_scoped_user_setup_request_result(...)`, `get_scoped_user_setup_auth_recovery(...)`,
`get_person_access_state(uuid,uuid)`, `apply_super_admin_access_change(...)`,
`prepare_super_admin_masjid_staff_grant(...)`, `apply_super_admin_masjid_staff_grant(...)`,
`apply_super_admin_staff_membership_end(...)`, `apply_super_admin_masjid_update(...)`,
`apply_super_admin_masjid_provision(...)`, and `apply_super_admin_hierarchy_change(...)` are also
service-role-only. They independently validate the passed actor, use explicit current-state or hierarchy
checks, and keep membership/profile changes plus audit insertion inside one transaction. Trigger functions (`enforce_student_accountability_attestation()`,
`enforce_student_checkin_integrity()`, `enforce_student_checkin_item_integrity()`,
`recalculate_student_checkin_score()`, `set_student_scope_snapshot()`, `teacher_rotation_row_scope_matches()`, and
`protect_foundation_row_identity()`) and the superseded broad
student RPCs (`student_weekly_teacher(uuid,date)` and `student_cohort_students_for_week(uuid,date)`) have
no `PUBLIC`, `anon`, or `authenticated` execute grant. All definer functions use an empty `search_path`.

The non-definer helpers `week_start_for_date(date)` and `weekly_plan_path_is_owned(uuid,date,text)` are
also executable by authenticated callers because RLS policies use them; neither reads protected data.

## Deferred weekly incentive uniqueness change

The existing `weekly_incentive_runs_week_start_key` remains globally unique on `week_start`. It limits
the product to one masjid's incentive run per tracker week even though RLS scopes incentive rows by
masjid. Phase 1 intentionally leaves the production constraint unchanged. A separate reviewed
migration should audit existing rows and replace it with `(masjid_id, week_start)` uniqueness, with an
explicit staging rollout and rollback plan.
