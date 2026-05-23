# Deployment

This app should use manual, reviewable deployments for now. Do not add automated production deployment or automated production database migrations until staging has been proven reliable.

## Environments

Use three separate environments:

- `local`: developer machine, local `.env.local`, and a disposable or development Supabase project.
- `staging`: Vercel Preview deployments and a staging Supabase project with non-production data.
- `production`: Vercel Production deployment from `main` and a production Supabase project with real user data.

Staging and production should use separate Supabase projects. Do not point Preview deployments at the production database.

## Vercel Deployments

Vercel Preview deployments should be enabled for pull requests and branches. Preview deployments are for review, QA, and staging verification before merging to `main`.

Vercel Production should deploy from `main` only. Merge approved pull requests to `main` after `npm run check` passes, then let Vercel create the production deployment from that commit.

Do not add GitHub Actions deployment workflows for this app yet. GitHub Actions may run checks, but production deployment should remain controlled through Vercel's Git integration.

## Environment Variables

Configure these variables in each Vercel environment and in local `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it in browser code, logs, or client-side configuration.

Use values from the staging Supabase project for Vercel Preview deployments. Use values from the production Supabase project for Vercel Production.

## Storage

Each Supabase project used by the app must have the private weekly plan Storage bucket configured:

- Bucket name: `weekly-plans`
- Public access: off/private
- Recommended file size limit: 1 MB
- Recommended allowed MIME types: `image/png`, `image/jpeg`, `application/pdf`

Storage configuration must be created separately in staging and production.

## Database Migrations

All database schema changes must be stored as migration files under `supabase/migrations`.

Use this process for every database change:

1. Create a migration.
2. Test the migration locally.
3. Apply the migration to staging.
4. Verify the app against staging.
5. Apply the migration to production manually.

Production database migrations should not be automated until staging has a reliable history of catching migration and app compatibility issues.

Apply migrations with the Supabase CLI or the Supabase SQL editor in filename order. Avoid dashboard schema edits except for emergencies, and capture any emergency schema change in a migration afterward.

## Rollback

App rollback is handled through Vercel. If a deployment is bad, promote or roll back to the last known good Vercel deployment, then smoke test login, student check-in, admin dashboard, and CSV export.

Database rollback is separate from app rollback. Vercel cannot roll back Supabase schema or data. Every risky migration needs an explicit reverse migration or a restore plan before it is applied to production.

When a database migration causes a production issue, prefer a forward-fix migration if it is safer than reversing the original change.
