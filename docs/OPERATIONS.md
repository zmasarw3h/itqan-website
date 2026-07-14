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

The app creates the Supabase Auth user and matching active `public.profiles` row. It also assigns:

- New students to the selected active group, effective from the current tracker week.
- New teachers to the selected active masjid with `staff_role = 'teacher'`, effective from the current tracker week.

Normal admins can only create students and teachers inside their active masjid admin scope. They cannot
grant `profiles.role = 'admin'` or `super_admin` access, reset passwords, or move users across masajid
from the normal admin app. Use the super-admin console for those operations.

Admins can also participate in teacher rotation. Keep their profile role as `admin` and add an active
`masjid_staff_memberships` row with `staff_role = 'teacher'` for the relevant masjid.

The app validates the selected scope before creating the Auth user. If a later membership insert fails,
the user may exist in Auth/Profile but will not have usable app access until the masjid/cohort/group or
staff membership is fixed.

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

1. Merge the approved PR to `main` after `npm run check` passes.
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

The app prevents duplicate student/date check-ins at the database level.

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

## Super Admin Setup

Super admin workflow in the app:

1. Sign in as an active `super_admin`.
2. Open `Super Admin -> Masajid`.
3. Create a masjid with a slug, active state, optional starter brothers/sisters cohort, and optional starter group.
4. Open the masjid detail page to edit the masjid, create or deactivate cohorts, and create or deactivate groups.
5. Grant the first admin or admin-teacher from an existing active person by email or phone.

Setup changes are audited in `super_admin_audit_events`. The UI does not delete masajid, cohorts, groups,
or staff memberships; deactivation uses the `active` flag and requires typed confirmation when turning
active setup records off. Admin grants require typed confirmation of both the masjid name and person name.

## Emergency Production Changes

- Prefer app-level corrections first.
- Avoid direct production database edits unless the app cannot correct the issue.
- Record what changed, who changed it, and when.
- Add or update a migration afterward if schema or seed data changed.
