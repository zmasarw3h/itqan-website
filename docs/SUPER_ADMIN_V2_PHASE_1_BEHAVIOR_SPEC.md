# Super Admin V2 — Phase 1 Behavior Specification

Status: proposed approval baseline
Date: 2026-07-22
Scope: product behavior, domain rules, operational workflows, safety, and verification. This document intentionally does not prescribe the visual redesign.

## 1. Product outcome

An active super admin must be able to operate the multi-masjid platform without Codex, SQL, Supabase dashboard work, or terminal commands for normal operations.

The console must support:

- finding, creating, inspecting, activating, and deactivating people;
- managing student placement and per-masjid staff capabilities;
- safely managing super-admin privilege;
- resetting passwords through a recoverable, audited process;
- creating and maintaining masajid, cohorts, and halaqa groups;
- assigning the first masjid admin and maintaining continuous admin coverage;
- identifying and repairing inconsistent operational state;
- reviewing the result and history of sensitive mutations.

Bootstrap recovery when no active super admin exists remains an emergency runbook because no in-app actor would be authorized to perform it.

## 2. Authoritative access model

### 2.1 Identity and platform state

`profiles` is the Auth-linked identity and global account state. `profiles.active = false` blocks application use.

`profiles.role` remains one of:

- `student`
- `teacher`
- `admin`
- `super_admin`

The role selects the person's default product experience; it is not sufficient proof of scoped masjid access.

### 2.2 Super-admin privilege

An active `profiles.role = 'super_admin'` grants global platform operations. It requires no masjid membership.

Super-admin privilege is managed separately from student placement and masjid staff capabilities. A super admin may also have teacher or admin staff membership for a masjid, but this scoped membership is not required for the super-admin console and must not be treated as missing access when absent.

Super-admin promotion and removal are dedicated high-risk operations. They must never appear as an incidental side effect of editing a masjid membership.

### 2.3 Student placement

`student_group_memberships` is the authoritative student-placement history.

- A student may have at most one effective group membership system-wide on a date.
- Normal student moves occur at a Sunday tracker-week boundary.
- `ends_on` is inclusive: access remains effective through that day.
- A move closes the previous placement on the day before the new placement begins.
- Historical corrections are distinct from planned moves and must state which historical records and derived experiences they affect.
- Student and staff access remain mutually exclusive for normal non-super-admin accounts unless a future product requirement explicitly changes the data and authorization model.

### 2.4 Masjid staff capabilities

`masjid_staff_memberships` is the authoritative per-masjid capability history.

- `admin` and `teacher` are independent capabilities for one masjid.
- A person may hold either, both, or neither capability at a masjid.
- A person may hold different capabilities at different masajid.
- “Admin + Teacher” is a display summary of two membership rows, never a new profile role.
- An admin-teacher keeps `profiles.role = 'admin'`.
- Editing one `(person, masjid, staff role)` relationship must preserve every unrelated staff relationship.
- If a staff operation would also convert a student account, that conversion is an explicit cross-access operation with its own impact summary; it is never a hidden side effect of a simple capability toggle.

For non-super-admin staff, the default role is reconciled from effective capability:

1. any effective admin membership implies `profiles.role = 'admin'`;
2. otherwise any effective teacher membership implies `profiles.role = 'teacher'`;
3. otherwise an effective student membership implies `profiles.role = 'student'`;
4. an active person with none of these is an actionable access inconsistency.

### 2.5 Teacher assignments

`group_teacher_assignments` remains week-specific. Teacher authorization requires both:

- effective teacher staff membership for the assignment's masjid; and
- the exact group/week assignment.

Ending teacher membership must evaluate current and future assignments in the same change plan. The operation must either resolve incompatible assignments atomically or block and identify what must be resolved. It must not silently leave assignments that look valid but can no longer be used.

### 2.6 Effective dates

All date rules use the configured Toronto application date and 1:00 AM rollover.

An operation that accepts a future effective date must be future-effective in every authorization dimension. It must not change `profiles.role` or `profiles.active` before the selected date.

Until fully scheduled global profile transitions exist, V2 must reject future dates for any operation that changes profile role or active state. Membership-only scheduling is allowed only when current routing and authorization remain coherent.

User-facing behavior must consistently distinguish:

- **Ends on**: final effective day;
- **Stops on**: first ineffective day;
- **Starts on**: first effective day.

## 3. Required operator workflows

### 3.1 Operational entry and triage

The super-admin entry point must expose work requiring attention, not duplicate the People destination. At minimum it must provide access to:

- people and account operations;
- masjid setup/readiness;
- repairable inconsistencies;
- recent or uncertain sensitive operations.

### 3.2 Find and inspect a person

The operator must be able to search server-side by name, phone, profile email, or Auth email and filter by active state, global role, masjid, staff capability, and student group.

Results must be deterministic and paginated, with the total and displayed range disclosed. A search must never silently omit matches because of an internal pre-load limit.

A person inspection must distinguish:

- Auth identity and profile state;
- global platform privilege;
- effective access today;
- scheduled future access;
- historical memberships;
- current and upcoming teacher assignments;
- actionable inconsistencies;
- recent sensitive changes.

### 3.3 Create a person

The console must support creating a student, teacher, admin, or super admin without requiring another product surface.

Creation is a recoverable cross-system workflow:

1. validate unique identity and requested access;
2. record a durable request intent;
3. create or reconcile the Auth user;
4. create the profile and requested memberships atomically in PostgreSQL;
5. record the outcome and audits;
6. clearly report success, safe retry, cleanup required, or uncertain completion.

Creating an admin includes explicit masjid capability. Creating a super admin is a separate privilege operation and does not silently grant masjid staff access.

### 3.4 Manage a person's access

Access changes are operation-specific, not a single global “preset.” Supported operations are:

- assign or move student placement;
- add admin capability at one masjid;
- end admin capability at one masjid;
- add teacher capability at one masjid;
- end teacher capability at one masjid;
- convert between mutually exclusive student and staff account modes;
- deactivate or reactivate the account;
- grant or remove super-admin privilege.

Before submission, every operation must calculate from canonical server state and disclose:

- exact scope and effective date;
- profile fields that will change;
- memberships that will be added, ended, preserved, or exceptionally cancelled;
- affected teacher assignments;
- affected masjid admin coverage;
- whether the change is immediate or scheduled.

Confirmations are proportional to impact. Typed confirmation verifies a high-risk target, but never substitutes for an understandable change summary.

### 3.5 Deactivate and reactivate an account

Deactivation is a global account operation. It must state whether access stops immediately and list every open or future membership and assignment affected.

Deactivation must close or cancel incompatible access in one atomic operation while retaining history. Reactivation does not guess access; the operator explicitly selects or restores a coherent target state.

Self-deactivation is prohibited. Removing the last active super admin is prohibited.

### 3.6 Reset a password

Password recovery remains separate from permissions.

The workflow must:

- require an active super-admin actor and confirmation of the target;
- create a durable intent before the Auth update;
- make retries safe and record the final outcome;
- never log or persist plaintext credentials in audit data;
- define whether existing sessions are revoked;
- define and enforce “must change password” if the credential is described as temporary;
- explicitly state that masjid access is unchanged.

Because Supabase Auth and PostgreSQL cannot share one native transaction, the durable intent/outcome record and reconciliation path are the atomicity substitute.

### 3.7 Create and activate a masjid

A new masjid begins inactive and incomplete. “Active” means operationally ready, not merely present in the database.

Minimum activation readiness is:

- at least one active cohort;
- at least one active group under an active cohort;
- an active eligible admin profile with continuous effective admin membership coverage.

Creating the masjid, starter hierarchy, and existing-person first-admin membership must be one idempotent database workflow when submitted together. If the first admin must also be created in Auth, the workflow uses the durable cross-system pattern defined for person creation.

Activation and reactivation must enforce the same readiness predicate. Readiness counts shown to the operator must use the same predicate as the database constraint.

### 3.8 Maintain hierarchy and staff

The operator must be able to create, rename, order, activate, and deactivate cohorts and groups while retaining history.

Before hierarchy deactivation, the system must calculate affected current/future student memberships and teacher assignments. The operation must resolve them atomically or block with actionable dependencies. No destructive delete UI is introduced.

Masjid staff management supports Admin and Teacher independently, including teacher-only grants. Candidate selection must resolve to one visible person before confirmation; ambiguous or inactive matches require explicit resolution.

### 3.9 Repair inconsistent state

The console must identify at least:

- active student without effective group;
- active teacher without effective teacher staff membership;
- inactive profile with open memberships;
- active non-super-admin profile without effective access;
- active masjid without valid admin coverage;
- teacher assignment without matching staff capability;
- profile missing Auth user;
- Auth user missing profile when feasible.

Repairs must follow the same canonical-state, idempotency, audit, and transaction guarantees as normal mutations. A repair that is no longer applicable returns resolved/stale, never permission to apply an old plan.

### 3.10 Audit and uncertain-operation recovery

The operator must be able to inspect recent sensitive operations and verify uncertain outcomes without database access.

Every sensitive audit record includes:

- actor;
- operation and request ID;
- target and masjid scope;
- before and after state;
- effective date;
- source workflow;
- final outcome where the workflow crosses Auth and PostgreSQL.

Plaintext passwords and secrets are prohibited. Failed or denied high-risk attempts should be recorded separately where doing so does not weaken transactional correctness.

## 4. Mutation safety contract

Every sensitive PostgreSQL mutation must:

1. authenticate the current user server-side and require an active super-admin profile;
2. construct the service client only after that guard;
3. recheck the actor inside the database workflow;
4. derive all hierarchy and membership scope server-side;
5. use a stable request UUID;
6. compare a canonical expected-state snapshot;
7. lock in a deterministic order and reject stale state;
8. make exact retries idempotent and reject request-ID reuse with different input;
9. commit the mutation, dependent changes, audit events, and replay result atomically;
10. return explicit success, validation, conflict, stale, denied, or uncertain outcomes.

Browser-authenticated users, including super admins, must have no direct Data API write path for profiles, memberships, masajid, cohorts, groups, assignments, or audit events. Normal admins retain only their existing scoped workflows.

Database-enforced invariants include:

- no overlapping student placement;
- no overlapping same-role staff membership per person and masjid;
- no self-demotion or self-deactivation;
- no removal of the last active super admin;
- no gap in active-masjid admin coverage;
- immutable membership identity/history outside explicit, audited exceptional correction.

## 5. Required states and recovery behavior

Every mutation flow must preserve entered non-secret values and support:

- idle;
- pending, with duplicate submission disabled;
- field validation error;
- confirmation mismatch;
- stale state with refreshed facts;
- permission denied;
- constraint/dependency conflict;
- success naming the person/masjid and exact change;
- uncertain completion with request ID and a direct verification path.

Status changes must be programmatically announced and focus must move to the relevant status or invalid field. Essential identity, current access, impact, and action information must not depend on horizontal scrolling on mobile.

## 6. Intentionally preserved scope

This overhaul does not remove or weaken:

- student, teacher, or normal-admin routes and scoped authorization;
- weekly plans, partner recitation, grades, halaqa grading, leaderboards, scoring, corrections, exports, imports, or backups;
- membership and assignment history;
- week-specific teacher authorization;
- the existing app visual language;
- server-side role checks and Supabase RLS.

No destructive migration or delete-oriented management flow is part of this work.

## 7. Verification gates for later phases

Before V2 is complete:

- unit tests cover domain planning and every date boundary;
- server-action tests cover authorization, FormData validation, confirmations, redirects, and outcome mapping;
- database integration tests cover direct-write denial, atomic rollback, stale state, exact replay, changed-input replay denial, concurrency, last-admin coverage, and last-super-admin protection;
- failure-injection tests cover setup-audit failure and every Auth/Postgres handoff;
- browser E2E covers person creation, multi-masjid capability changes, student movement, password recovery, masjid provisioning, repairs, and audit verification;
- accessibility verification covers keyboard operation, status announcements, focus recovery, 200% zoom, and mobile reflow;
- `npm run check` and `npm run test:rls` pass.

## 8. Phase 1 decisions requiring owner approval

This proposal resolves the current contradictions with the following product decisions:

1. Staff capability edits are relationship-specific; the global preset editor is not retained.
2. Student and staff access remain mutually exclusive for normal accounts.
3. Student moves use Sunday tracker boundaries; historical correction is a separate operation.
4. Future dates are rejected for role/active changes until those changes can be scheduled coherently.
5. Super-admin privilege is independent of masjid capabilities and receives a dedicated guarded workflow.
6. A new masjid starts inactive; activation always means ready and continuously administered.
7. Person creation, first-admin provisioning, repair, audit review, and uncertain-operation verification belong in the console.
8. Setup mutations are brought up to the atomic/idempotent standard already used by access RPCs.
