# Contributing

ITQAN Lite is now a maintained masjid operations app. Keep changes small, practical, and inside the current product scope.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` from `.env.example` if present, or from the variable list in `README.md`.
3. Fill in Supabase environment variables:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   ```

4. Apply database migrations in `supabase/migrations` in filename order. See `README.md` for the supported `supabase db push` or SQL editor options.
5. Start the app:

   ```bash
   npm run dev
   ```

## Branch and PR Workflow

- Branch from `main`.
- Use a short, descriptive branch name.
- Keep PRs focused on one change.
- Include screenshots for UI changes when useful.
- Document database, auth, storage, or operations impact in the PR.
- Request review before merging.
- Do not merge until `npm run check` passes.

## Required Check

Run this before opening a PR and before merge:

```bash
npm run check
```

This runs lint, typecheck, tests, and build.

## Database Migration Rules

- Every schema change must be stored as a migration in `supabase/migrations`.
- Name migrations with the next numeric prefix and a clear description.
- Apply migrations to staging before production.
- Do not manually change production schema in the Supabase dashboard unless it is an emergency.
- If an emergency dashboard change is made, add the matching migration as soon as possible so the repo remains the source of truth.

## Secrets

- Never commit `.env.local`, service-role keys, import result CSVs, or real user lists.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Do not expose it in browser code.
