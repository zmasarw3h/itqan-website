# ITQAN Daily Check-In

Emergency lightweight check-in system for one masjid while Canvas is unavailable.

## What This App Does

- Students sign in, submit one daily completion check-in, see today's status, and view their own history.
- Admins sign in, view all active students, review weekly/date completion, filter by student/date/status, correct check-ins, and export CSV.
- The app intentionally excludes teacher roles, weekly plans, sadaqa, announcements, payments, booking, parent accounts, multi-masjid support, and Quran selection.

## Stack

- Next.js App Router
- TypeScript
- Supabase Auth and Postgres
- Supabase RLS with user-authenticated server clients
- Tailwind CSS
- Vitest
- Vercel

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

3. Fill in Supabase values:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   # Optional server-only key for setup/admin scripts only. Do not expose this in browser code.
   SUPABASE_SERVICE_ROLE_KEY=
   ```

4. Apply the database migration in Supabase:

   ```bash
   supabase db push
   ```

   Or paste the SQL files in `supabase/migrations` into the Supabase SQL editor in filename order.

5. Create Supabase Auth users with email/password, then insert matching rows in `public.profiles`. Users enter phone numbers at login, but Supabase Auth still uses email/password internally.

   Convert phone numbers to synthetic auth emails:

   - `4165551234` normalizes to `+14165551234`
   - Auth email becomes `14165551234@itqan.local`

   Each profile `id` must equal the Auth user UUID. `profiles.email` stores the synthetic auth email. `profiles.phone` is optional display-only data shown to admins.

   Example profile data is in `docs/SEED_DATA.md`:

   ```csv
   name,email,phone,role,active
   Admin One,14165550000@itqan.local,+1 416 555 0000,admin,true
   Student One,14165550101@itqan.local,+1 416 555 0101,student,true
   Student Two,14165550102@itqan.local,+1 416 555 0102,student,true
   ```

6. Run the app:

   ```bash
   npm run dev
   ```

7. Open `http://localhost:3000/login`.

## Deployment

Deploy to Vercel and configure these environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` is optional for this app runtime and must stay server-only. Normal page and action behavior uses the signed-in user's Supabase session and RLS.

Apply all files in `supabase/migrations` to the production Supabase project before using the deployed app.

## Required Checks

Run:

```bash
npm run check
```

That command runs:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```
