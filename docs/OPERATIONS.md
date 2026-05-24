# Operations

This guide covers routine manual operations for ITQAN Lite.

## Add One Student

Manual in the app:

1. Sign in as an admin.
2. Open `Admin Dashboard -> Add Student`.
3. Enter the student's name and phone number.
4. Share the temporary password shown by the app flow: `itqan2026`.
5. Ask the student to change their password after first sign-in.

The app creates the Supabase Auth user and matching active `public.profiles` row.

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

## Reset or Change Passwords

- User self-service: signed-in users can open `Password` in the app navigation and change their own password.
- Admin reset: manual in Supabase Auth dashboard if the user cannot sign in.
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

## Emergency Production Changes

- Prefer app-level corrections first.
- Avoid direct production database edits unless the app cannot correct the issue.
- Record what changed, who changed it, and when.
- Add or update a migration afterward if schema or seed data changed.
