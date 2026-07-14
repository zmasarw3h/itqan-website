# Authorization Matrix

This matrix records the Phase 1 authorization boundary enforced by the hardening migration. The database,
server guards, and local RLS integration suite must agree with it.

| Surface | Student | Teacher / admin-teacher | Scoped admin | Super admin |
| --- | --- | --- | --- | --- |
| Profiles | Own active profile only | Own profile plus active students whose membership overlaps an effective assigned group/week | Active people with student or staff history in a currently administered masjid | Global read and guarded writes |
| Check-ins and items | Own rows; writes require an effective matching group snapshot, canonical tasks, and database-derived scores | Read only rows in an effective assigned group for that row's tracker week | Read/write only rows snapshotted to a currently administered masjid | Global operational access |
| Weekly plans | Own metadata and own storage path only | Read only assigned group/week metadata; signed links require the same server-side scope check | Read only metadata and signed links for students in a currently administered masjid | Global operational access |
| Partner recitation | Own rows; current round writes require an effective, matching group snapshot | Read only assigned group/week rows | Scoped read/write for administered masajid | Global operational access |
| Halaqa grades | Own read only | Read/write only the exact assigned group/week | Scoped read/write for administered masajid | Global operational access |
| Incentives/accountability | Own obligations and badges; only the existing self-attestation update is allowed | No direct access | Scoped to the row's masjid | Global operational access |
| Masajid/cohorts/groups | Only hierarchy connected to own membership history | Only hierarchy connected to effective assignments/staff access | Only currently administered masajid and their hierarchy | Global setup access |
| Student memberships | Own history | Rows whose membership window overlaps an effective assignment week | Scoped create/update by group masjid; no history deletion | Global access |
| Staff memberships | Own history | Own history | Teacher rows only inside administered masajid; no admin grants or history deletion | Global access |
| Teacher assignments/rotation | None | Own effective assignment/availability rows | Scoped by administered masjid; assignment history cannot be deleted | Global access |
| Super-admin audit | None | None | None | Read only through signed sessions; writes remain guarded service-only |
| Cohort leaderboard | Sanitized projection only: name, rank, score summary, change/status, and own-row marker | None | Separate admin scoring surface | Global operational access |

Effective dates use `public.current_effective_date()` and Sunday tracker weeks. A teacher assignment is
valid only when the assignment is active for the exact week and the teacher (including an admin-teacher)
has an active teacher staff membership covering that week. Future, expired, or inactive memberships do
not grant current access.

Internal trigger functions and raw scope resolvers are not application APIs. Application-facing RPCs
must authorize the caller internally and return only the fields documented for that surface.

## RLS policy inventory

The hardening migration replaces every pre-existing policy in the requested surface (the audit read
policy was already super-admin-only and remains unchanged):

| Relation | Policies after Phase 1 |
| --- | --- |
| `profiles` | `Users can read own active profile`; `Admins can read all profiles` (scoped read); `Admins can insert profiles` and `Admins can update profiles` (super-admin-only) |
| `checkins` | Student own select/current-day insert/constrained update; database trigger protects date, scope, attribution, and derived totals; scoped admin or assigned-teacher select; scoped admin insert/update/delete |
| `checkin_items` | Student own parent-consistent select/canonical insert/completion-only update; database trigger validates task definitions and recalculates the parent score; parent-inherited scoped admin or teacher select; scoped admin insert/update/delete |
| `weekly_plans` | Student own select and path/snapshot-checked insert/update; scoped admin or assigned-teacher select |
| `partner_recitations` | Student own select and current-round insert; scoped admin or assigned-teacher select; scoped admin insert/update/delete |
| `halaqa_grades` | Student own select; scoped admin or assigned-teacher select; scoped admin or exact assigned-teacher insert/update |
| `weekly_incentive_runs` | Masjid-scoped admin/super-admin select/insert/update |
| `accountability_obligations` | Student own select and constrained attestation; masjid-scoped admin/super-admin select/insert/update |
| `badge_awards` | Student own select; masjid-scoped admin/super-admin select/insert/update |
| `masajid`, `cohorts`, `halaqa_groups` | Caller-connected hierarchy select; foundation mutation is super-admin-only |
| `student_group_memberships` | Student own history; effective assigned-teacher read; subject-, attribution-, and masjid-scoped admin create/update; restrictive delete is super-admin-only |
| `masjid_staff_memberships` | Own history; existing teacher-only, attribution-checked scoped admin create/update; restrictive delete is super-admin-only |
| `group_teacher_assignments` | Effective teacher own reads; eligible-teacher, attribution-, and masjid-scoped admin create/update; restrictive delete is super-admin-only |
| Rotation tables | Effective teacher own availability read; masjid-scoped admin/super-admin management for availability, settings, and run rows |
| `super_admin_audit_events` | `Active super admins can read audit events`; no signed-role insert/update/delete policy |
| `storage.objects` weekly-plan policies | Student-owned select and masjid-scoped admin select via `can_admin_read_weekly_plan_path(text)`; signed clients cannot insert/update/delete objects because guarded server actions own that workflow |

The exact legacy policy names are preserved so the additive migration can use `ALTER POLICY`, including
the formerly broad `Admins can read weekly plan files` policy in existing Storage deployments.

## Function privilege inventory

No `anon` role has `EXECUTE` on an application `SECURITY DEFINER` function. Phone-to-auth-email login
resolution remains a server-only, read-only service-role lookup and is not exposed as an RPC.

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
  `can_admin_read_weekly_plan_path(text)` used by Storage RLS.
- Application RPCs: `student_weekly_teacher_name(date)`,
  `student_cohort_leaderboard_for_week(date)`, `student_leaderboard_available_weeks()`, and
  `admin_students_for_week(date)`.

`apply_teacher_rotation_generation(...)` is service-role-only and repeats actor/cohort scope validation
inside the transaction. Trigger functions (`enforce_student_accountability_attestation()`,
`enforce_student_checkin_integrity()`, `enforce_student_checkin_item_integrity()`,
`recalculate_student_checkin_score()`, `set_student_scope_snapshot()`, `teacher_rotation_row_scope_matches()`, and
`protect_foundation_row_identity()`) and the superseded broad
student RPCs (`student_weekly_teacher(uuid,date)` and `student_cohort_students_for_week(uuid,date)`) have
no `PUBLIC`, `anon`, or `authenticated` execute grant. All definer functions use an empty `search_path`.

The non-definer helpers `week_start_for_date(date)` and `weekly_plan_path_is_owned(uuid,date,text)` are
also executable by authenticated callers because RLS policies use them; neither reads protected data.
