# Operations

This guide covers routine manual operations for ITQAN Lite.

## Add One User

Manual in the app:

1. Sign in as an admin.
2. Open `Admin Dashboard -> Add User`.
3. Enter the user's name and phone number.
4. Choose Student or Teacher.
5. For a student, choose the masjid, cohort, and group.
6. For a teacher, choose the masjid where they should have teacher access.
7. Share the temporary password shown by the app flow: `itqan2026`.
8. Ask the user to change their password after first sign-in.

The app creates the Supabase Auth user first, then calls `apply_scoped_user_setup(...)` once to create
the matching active `public.profiles` row, scoped membership, and audit event in one database transaction.
It assigns:

- New students to the selected active group, effective from the current tracker week.
- New teachers to the selected active masjid with `staff_role = 'teacher'`, effective from the current tracker week.

Normal admins can only create students and teachers inside their active masjid admin scope. They cannot
grant `profiles.role = 'admin'` or `super_admin` access, reset passwords, or move users across masajid
from the normal admin app. Use the super-admin console for those operations.

Admins can also participate in teacher rotation. Keep their profile role as `admin` and add an active
`masjid_staff_memberships` row with `staff_role = 'teacher'` for the relevant masjid.

Supabase Auth creation and the PostgreSQL transaction cannot share one transaction. Before creating an
Auth user, an exact retry checks `get_scoped_user_setup_request_result(...)`; a completed request returns
its original result without calling Auth again. An unknown setup-RPC response is retried with the same
request UUID and then checked for boundedly before any cleanup decision. The app never deletes the Auth
identity after an unresolved response. It reports `setup-uncertain` and logs only request/profile IDs and
error codes for operator review. The uncertain redirect preserves the validated request UUID and scoped
selections but no name, phone, or password; the operator re-enters the same name and phone to resume the
exact request. Other outcomes render a fresh request UUID. Only a definitive database rejection triggers Auth deletion compensation;
cleanup success and failure remain distinct statuses.

An Auth Admin API response can be lost before PostgreSQL setup begins. This cannot be made atomic across
Supabase Auth and Postgres. The first attempt reports `auth-uncertain`; unknown Auth failures are not
reported as an existing account. New Auth identities carry trusted `app_metadata` containing the request
UUID, actor UUID, and canonical setup payload. Retrying the exact same form causes the duplicate Auth
response to use `get_scoped_user_setup_auth_recovery(...)`; only an Auth-only identity with an exact actor,
email, request, and payload match is resumed. Cross-actor, changed-payload, and unrelated duplicate-email
attempts remain denied. If exact recovery remains unresolved, inspect the logged request ID and use the
documented repair workflow rather than deleting an identity whose database state is uncertain.

## Transactional Workflow Rollout

Deploy `20260720053556_transactional_workflow_foundation.sql` and then
`20260720082914_close_transactional_hardening_findings.sql` before deploying the matching app code.
Both migrations are backward-compatible with the previously deployed actions: they add private
idempotency state, guarded triggers, and service-only functions without removing current contracts.

After applying the migration:

1. Run the schema sanity query and `supabase migration list`.
2. Confirm `service_role` alone can execute `apply_scoped_user_setup`, `get_scoped_user_setup_request_result`, `get_scoped_user_setup_auth_recovery`, `get_person_access_state`, `apply_super_admin_access_change`, `prepare_super_admin_masjid_staff_grant`, `apply_super_admin_masjid_staff_grant`, `apply_super_admin_staff_membership_end`, and `apply_super_admin_masjid_update`.
3. Confirm `anon` and `authenticated` cannot execute those functions.
4. Deploy the Phase 1B application wiring only after those checks pass. Do not deploy Phase 1B before
   the migration because user creation, composite access changes, and standalone staff-membership closure now depend on these RPCs.

Each rendered mutation form carries one request UUID through its server action. Retrying the exact same
request UUID and payload returns the stored result. Reusing a request UUID with different input is
rejected. The form carries its original server-generated snapshot only as an untrusted retry token. The
super-admin action reloads target and scope records and calls `get_person_access_state(...)` on every
submission. On the normal path it passes the freshly loaded canonical snapshot. If the original token
differs, PostgreSQL accepts it only for an already-completed exact request replay; otherwise the database
stale-state comparison rejects it and the UI asks the operator to review current access before submitting
again.

Unknown or malformed super-admin mutation responses are retried once with the same request UUID and
payload. If both responses remain unresolved, the UI reports `access-uncertain`; review the freshly loaded
canonical access state before submitting a new request. The person editor's displayed role/memberships,
form defaults, and expected-state token all come from the same service-only canonical snapshot.

## Masjid Setup

Seeded masajid:

- `Toronto Islamic Centre (TIC)` with a brothers cohort and default brothers group.
- `Thunder Bay Masjid` with a brothers cohort and default brothers group.

Thunder Bay starts without assigned staff. Add an active `masjid_staff_memberships` row for each admin or teacher who should access that masjid before expecting them to manage students or rotation there.

## Import Users

Automated locally with the existing import script:

1. Prepare a local CSV with exactly:

   ```csv
   name,phone,role
   Sample Student,+1 555 010 1000,student
   Sample Admin,+1 555 010 1001,admin
   ```

2. Ensure these environment variables are available locally:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=
   SUPABASE_SERVICE_ROLE_KEY=
   ```

3. Run:

   ```bash
   npm run import-users -- data/users.csv
   ```

4. Review the generated local report in `data/import-results-*.csv`.

Do not commit real user CSVs or generated reports. The import sets new and existing imported users to the temporary password `itqan2026`.

The import tooling predates multi-masjid scope. After importing new users, verify they have the required `student_group_memberships` or `masjid_staff_memberships` rows before asking them to sign in.

## Reset or Change Passwords

- User self-service: signed-in users can open `Password` in the app navigation and change their own password.
- Super-admin reset: open `/super-admin/people`, select the person, and use the password reset section.
- Emergency admin reset: manual in Supabase Auth dashboard if the user cannot sign in and the super-admin console is unavailable.
- Bulk reset: manual via the local import script. Re-running `npm run import-users -- data/users.csv` resets imported users in that CSV to `itqan2026`.

## Deploy App

Manual through Vercel/Git integration:

1. Merge the approved PR to `main` after both `npm run check` and the Docker-backed `npm run test:rls`
   GitHub Actions jobs pass.
2. Confirm Vercel has these environment variables:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   ```

3. Let Vercel deploy from `main`.
4. Smoke test login, student check-in, admin dashboard, and CSV export.

There is no repo deploy script at this time.

## Backup and Restore

Use `docs/BACKUP_RESTORE.md` for the full backup cadence, manual export scripts, restore process, and verification checklist.

Monthly manual database export:

```bash
npm run backup:db
```

Do not automate production restore. Production database restore requires manual approval through Supabase. Weekly plan uploaded files are temporary operational files and are not backed up.

## Apply Database Migrations

Schema changes must be migration files in `supabase/migrations`.

Preferred order:

1. Apply migrations to staging.
2. Smoke test staging.
3. Apply the same migrations to production.
4. Deploy the app version that expects the migrated schema.

Supported application methods are the ones documented in `README.md`:

```bash
supabase db push
```

Or paste the SQL files into the Supabase SQL editor in filename order. Dashboard schema edits are manual and should only be used for production emergencies.

Before applying authorization migrations to staging, run the disposable local RLS suite with a running
Docker daemon:

```bash
npm run test:rls
```

The suite starts and destroys its own local Supabase stack. Never point it at staging or production.

## Delete A Student And Handle Storage Cleanup Warnings

Student deletion first verifies the signed-in admin, current student scope, all historical authorization
scope, and every weekly-plan object path. It then deletes the Supabase Auth identity, whose database
cascade removes the profile and owned operational metadata, before deleting the private weekly-plan
Storage objects.

Auth/Postgres deletion and Storage cleanup cannot be one atomic transaction. If identity deletion
succeeds but Storage cleanup fails or removes fewer objects than expected, the app reports that the
student identity was deleted and shows an amber cleanup warning; it does not report the identity
deletion itself as failed. The server log includes the deleted student UUID and the expected orphaned
paths. An operator should verify the UUID/path prefix and remove those objects from the private
`weekly-plans` bucket. Do not remove objects outside the logged student-owned paths.

This orphan cleanup procedure is the accepted residual limitation of the Supabase Auth Admin API and
Storage boundary. Keep the existing pre-deletion scope and path checks strong; cleanup warnings are not
permission to retry identity deletion or broaden a Storage path.

## Roll Back a Vercel Deployment

Manual in Vercel:

1. Open the project in Vercel.
2. Go to deployments.
3. Promote or roll back to the last known good deployment.
4. Smoke test the restored app.

Database migrations are not automatically rolled back by Vercel. If a migration caused the issue, create and apply a forward-fix migration unless a manual emergency database change is clearly safer.

## Handle Bad Check-In Data

Manual in the app:

1. Sign in as an admin.
2. Open the student's admin detail page from the dashboard.
3. Use the correction form to update the affected check-in date.
4. Add a correction note when context matters.
5. Re-check the dashboard filters and CSV export for the affected date.

The app submits the parent correction, canonical checklist-item replacement, and derived totals through
one scoped database RPC. The transaction commits all of those changes together or rolls all of them
back. The app also prevents duplicate student/date check-ins at the database level.

## Handle Bad Halaqa Data

Manual in the app:

1. Sign in as an admin.
2. Open the student's admin detail page.
3. Update the Saturday halaqa grade for the current tracker week.
4. If the student did not attend, set attendance to no.
5. If the student attended, enter a valid recitation mark and optional notes.
6. Verify the student's weekly grade view if needed.

## Weekly Teacher Rotation

Admin workflow in the app:

1. Sign in as an admin.
2. Open `Admin Dashboard -> Rotation`.
3. Choose the target Sunday tracker week. The page defaults to next week.
4. Set the cohort's target group count.
5. Check the teachers who are available for that week and save availability.
6. Use `Generate / rebalance` to balance active students across stable groups and assign available teachers.

Target group count cannot be saved below the current number of active groups. The app does not
deactivate or delete groups automatically in this release.

If fewer teachers are available than groups, some groups remain unassigned and the run should surface a
warning. If more teachers are available than groups, extra teachers remain unassigned and the run should
surface a warning. Do not rebalance student groups based on weekly teacher availability; rebalance only
when an admin intentionally runs the rotation action.

Current limitation: the rotation page resolves one active brothers cohort from the signed-in admin's
masjid memberships. It does not yet provide an explicit masjid/cohort selector and cannot operate a
sisters cohort. Server-side checks still verify that the signed-in admin manages the resolved masjid.

## Weekly Incentive Run Constraint Limitation

`weekly_incentive_runs_week_start_key` remains globally unique by `week_start`. Consequently, a run for
one masjid prevents another masjid from recording an incentive run for that same tracker week. Do not
drop or replace this production constraint as part of routine operations or Phase 1 authorization
deployment.

Resolve it in a separate reviewed migration after auditing existing rows. That migration should replace
the global key with uniqueness on `(masjid_id, week_start)` and include explicit staging validation,
production rollout, and rollback steps.

## Super Admin Setup

Super admin workflow in the app:

1. Sign in as an active `super_admin`.
2. Open `Super Admin -> Masajid`.
3. Create a masjid with a slug, active state, optional starter brothers/sisters cohort, and optional starter group.
4. Open the masjid detail page to edit the masjid, create or deactivate cohorts, and create or deactivate groups.
5. Grant the first admin or admin-teacher from an existing active person by email or phone.

Staff grants use one stable form request UUID and the guarded transactional workflow. Profile promotion,
student-membership reconciliation, one or both staff memberships, and all audit events commit or roll back
together. An ambiguous response is retried with the same UUID and reports `staff-grant-uncertain` if its
result still cannot be established. After commit, the same UUID and stable grant inputs replay the stored
result even when the current expected-state token has changed; actor, target, masjid, grant, and effective
date remain part of replay identity. Active masajid must retain continuous future admin coverage through
all scheduled handoffs and ultimately have open-ended admin coverage.

Masjid edits and active-state changes use one guarded transaction for the row update and audit event.
Reactivation locks against concurrent admin-access changes and is rejected unless coverage is continuous
from the current effective date through an open-ended administrator. An ambiguous update preserves its
validated request UUID in the form so the exact desired update can be replayed; changed inputs with that UUID are rejected.

Setup changes are audited in `super_admin_audit_events`. The UI does not delete masajid, cohorts, groups,
or staff memberships; deactivation uses the `active` flag and requires typed confirmation when turning
active setup records off. Admin grants require typed confirmation of both the masjid name and person name.

## Emergency Production Changes

- Prefer app-level corrections first.
- Avoid direct production database edits unless the app cannot correct the issue.
- Record what changed, who changed it, and when.
- Add or update a migration afterward if schema or seed data changed.
