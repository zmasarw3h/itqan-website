# Rotation Publication Integrity

Rotation identity is `(cohort_id, week_start)`: `week_start` is always Sunday, while the halaqa event and teacher-staff eligibility boundary is Saturday (`week_start + 6`). Administrator scope uses `current_toronto_civil_date()`, never the 1:00 AM check-in date.

Student availability is intentionally outside teacher-assignment publication for now. The Step 1 admin ledger
uses the same `(cohort_id, Sunday week_start)` identity, displays Saturday, and saves only explicit absences;
no row means attending. `apply_student_rotation_availability(...)` verifies a current normal admin's selected
masjid/cohort scope and the effective student membership, then replaces that session's absence rows atomically.
It never changes `student_group_memberships`, group balancing, teacher authorization, or assignments. Future
attendance-aware session roster redistribution must consume this ledger in a separate reviewed slice.

Publication is a prepare/apply workflow. `prepare_teacher_rotation_publication(...)` stores a request UUID and returns the ordered canonical state: cohort/masjid activity, rotation settings, active groups and ordering, teacher memberships/profile activity, exact availability rows, Saturday-eligible teachers, and current/relevant prior assignments. The TypeScript planner consumes only this snapshot and does not receive unavailable teachers.

`apply_teacher_rotation_publication(...)` accepts that exact state and the desired assignment set, locks `rotation-publication:<cohort_id>:<week_start>`, locks relevant rows, recomputes state, and rejects a mismatch as stale. It takes a private per-cohort state-version row in shared mode only after locking the relevant public rows; all canonical-state writers first lock their public row and then advance that version under the conflicting lock. This order avoids writer/publication deadlocks and closes the missing-row race for availability, staff, groups, and assignments that ordinary row locks cannot see. Group activity/order, settings, availability, staff dates, profile activity, assignments, cohort activity, and masjid activity invalidate a prepared plan.

Every assigned teacher needs a currently active profile, a teacher staff membership covering Saturday, an active masjid/cohort, and an exact `(teacher_id, cohort_id, week_start)` availability row with `available = true`. Missing availability means unavailable. The existing direct-assignment trigger now enforces that same exact positive availability condition for newly active rows, including trusted service-role maintenance writes; it does not rewrite historical rows. Admin + Teacher capability is recognized by staff membership; no separate role exists.

PostgreSQL validates the complete desired set, derives counts/warnings, upserts valid assignments, deactivates obsolete selected-cohort/week assignments, and stores the final result plus IDs/counts/digest/Saturday in `teacher_rotation_runs`. An exact request replay returns its original result; changed request payload is rejected. Concurrent same-cohort/week attempts yield one success and one stale conflict.

The old `apply_teacher_rotation_generation(...)` signature remains service-role executable for migration-first rollout. It now uses the same availability/eligibility validation, lock, active-group validation, and database-derived outcome, but has no request ID or stale-state input and is intentionally not replay-idempotent. It also cannot change student memberships. Remove it only through a later reviewed cleanup migration after the new path has been verified.

`scripts/audit-rotation-publication-integrity.sql` is read-only and returns identifiers and reason codes only. `npm run test:rotation:compat` builds the pre-Slice-5 `main` schema, applies only the Slice 5 migration, and runs both the unchanged legacy RPC contract and the new guarded workflow against the same disposable database.
