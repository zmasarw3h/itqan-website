# Backup and Restore

This runbook covers practical backup and restore steps for ITQAN Lite.

ITQAN Lite stores app records in Supabase Postgres. Weekly plan files are stored separately in the private Supabase Storage bucket `weekly-plans`.

Weekly plan uploaded files are temporary operational uploads, not long-term records. They are not required backups for ITQAN Lite. It is acceptable for restored `weekly_plans` metadata to point to missing Storage objects after a database restore.

References:

- Supabase database backups: https://supabase.com/docs/guides/platform/backups
- Supabase CLI `db dump`: https://supabase.com/docs/reference/cli/supabase-db-dump

## Cadence

- Rely on Supabase daily database backups for normal database restore.
- Once per month, run a manual logical database export and store it encrypted outside the repo.
- After major schema changes, perform a restore drill on staging.

Do not add scheduled production backup jobs yet. Do not automate production restore.

## What Must Be Backed Up

Database:

- `profiles`
- `checkins`
- `checkin_items`
- `weekly_plans`
- `partner_recitations`
- `halaqa_grades`

Weekly plan files in the private `weekly-plans` Storage bucket are not backed up by this process. The `weekly_plans` database table stores metadata and object paths, but it does not contain the file bytes.

## Manual Database Logical Export

Use this export for staging restore drills, emergency analysis, and monthly off-repo copies. It is not the normal production restore path.

Prerequisites:

- Supabase CLI installed.
- Local project linked to the intended Supabase project with `supabase link`.
- Access approved for the environment being exported.

Run:

```bash
npm run backup:db
```

The script writes timestamped files under:

```txt
backups/database/
```

It creates:

- A schema dump with `supabase db dump --linked`.
- A `public` data dump with `supabase db dump --linked --data-only --use-copy --schema public`.

Keep generated dump files encrypted and off-repo. The repo ignores `backups/`.

Notes:

- This is a logical export helper, not a full Supabase project clone.
- Supabase-managed Auth and Storage internals may need separate handling for full environment migration.
- For normal production database recovery, use Supabase dashboard backups instead of importing a local dump into production.

## Production Database Restore

Production restore is manual and requires explicit approval from the project owner/admin responsible for the outage.

Use when a production data loss or corruption incident cannot be corrected safely through the app or a forward-fix migration.

Process:

1. Announce expected downtime and freeze writes.
2. Confirm the target restore point and who approved it.
3. In the Supabase dashboard, open `Database -> Backups`.
4. Restore the selected daily backup following the dashboard flow.
5. Re-apply any required forward migrations or manual fixes that happened after the restored backup, if approved.
6. Run the verification checklist below.
7. Smoke test the app before reopening writes.
8. Tell admins that older weekly plan links may be unavailable. Students can re-upload current weekly plans if needed.

Do not automate this flow from application code or local scripts.

## Logical Dump Restore to Staging

Use staging for monthly drills and for validating that a logical export is usable.

Process:

1. Confirm the staging project can be overwritten.
2. Export production or the source environment with `npm run backup:db`.
3. Import the schema dump and data dump into staging using an approved Postgres client such as `psql`.
4. Run the verification checklist below.
5. Expect old weekly plan file links to fail unless files already exist in staging Storage.

Example shape:

```bash
psql "$STAGING_DATABASE_URL" --single-transaction --variable ON_ERROR_STOP=1 --file backups/database/<timestamp>/itqan-lite-schema-<timestamp>.sql
psql "$STAGING_DATABASE_URL" --single-transaction --variable ON_ERROR_STOP=1 --file backups/database/<timestamp>/itqan-lite-public-data-<timestamp>.sql
```

Use staging credentials only. Do not paste production database URLs into shell history on shared machines.

## Weekly Plan Files After Restore

Weekly plan files are not backed up. After a database restore, `weekly_plans` rows may still exist, but their `file_path` values can point to Storage objects that are no longer available.

This is acceptable because weekly plans are temporary operational uploads. If a current weekly plan is still needed after restore, ask the student to upload it again through the app.

## Verification Checklist

After any restore or restore drill, verify these database tables:

- `profiles`: admins and students exist, roles are correct, inactive users remain inactive.
- `checkins`: expected daily check-ins exist and duplicate student/date rows are still blocked.
- `checkin_items`: checklist items are linked to restored check-ins.
- `weekly_plans`: metadata exists where expected. Missing old Storage objects are acceptable.
- `partner_recitations`: weekly round submissions are present and duplicate student/week/round rows are still blocked.
- `halaqa_grades`: attendance, recitation points, notes, and grader metadata look correct.

Then verify app behavior:

- Student login works.
- Student history and grades render.
- Admin dashboard filters render expected rows.
- Admin student detail pages render.
- CSV export works.
- Current weekly plan upload still works. Old weekly plan links may be unavailable after restore.

## Limitations

- Vercel app rollback does not roll back the database.
- Weekly plan uploaded files are not backed up.
- Database rollback may leave old `weekly_plans` metadata pointing to missing Storage objects.
- Restoring production causes downtime and can discard writes after the selected restore point.
- Production restore requires manual approval.
- This runbook does not assume Point-in-Time Recovery or any paid backup feature.
- The local database export helper requires operator credentials and should be run only from trusted machines.
