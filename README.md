# ITQAN Daily Check-In

Emergency lightweight check-in system for one masjid while Canvas is unavailable.

## What This App Does

- Students sign in, submit one weighted daily Quran checklist, see today's submitted checklist and score, and view their own history.
- Students upload one weekly plan image/PDF for the current Saturday-Friday halaqa week.
- Admins sign in, view all active students, review weekly/date submission scores, filter by student/date/status, correct check-ins, and export CSV.
- Admins can view/download a student's uploaded weekly plan from that student's admin screen.
- The app intentionally excludes teacher roles, plan approval, comments, plan parsing/OCR, sadaqa, announcements, payments, booking, parent accounts, multi-masjid support, and Quran selection.

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

5. Create the private Supabase Storage bucket for weekly plan files:

   - Bucket name: `weekly-plans`
   - Public bucket: off/private
   - File size limit: 1 MB if configured in the dashboard
   - Allowed MIME types: `image/png`, `image/jpeg`, `application/pdf` if configured in the dashboard

   Add these Storage RLS policies for `storage.objects` so signed-in students can manage only their own folder and admins can read all plan files:

   ```sql
   create policy "Students can upload own weekly plan files"
     on storage.objects
     for insert
     with check (
       bucket_id = 'weekly-plans'
       and auth.uid()::text = (storage.foldername(name))[1]
       and public.is_active_student()
     );

   create policy "Students can update own weekly plan files"
     on storage.objects
     for update
     using (
       bucket_id = 'weekly-plans'
       and auth.uid()::text = (storage.foldername(name))[1]
       and public.is_active_student()
     )
     with check (
       bucket_id = 'weekly-plans'
       and auth.uid()::text = (storage.foldername(name))[1]
       and public.is_active_student()
     );

   create policy "Students can read own weekly plan files"
     on storage.objects
     for select
     using (
       bucket_id = 'weekly-plans'
       and auth.uid()::text = (storage.foldername(name))[1]
       and public.is_active_student()
     );

   create policy "Students can delete replaced weekly plan files"
     on storage.objects
     for delete
     using (
       bucket_id = 'weekly-plans'
       and auth.uid()::text = (storage.foldername(name))[1]
       and public.is_active_student()
     );

   create policy "Admins can read weekly plan files"
     on storage.objects
     for select
     using (
       bucket_id = 'weekly-plans'
       and public.is_active_admin()
     );
   ```

   Weekly plan metadata is stored in `public.weekly_plans` by the migration. Uploaded files are stored in Supabase Storage, not in the database.

6. Create Supabase Auth users with email/password, then insert matching rows in `public.profiles`. Users enter phone numbers at login, but Supabase Auth still uses email/password internally.

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

7. Run the app:

   ```bash
   npm run dev
   ```

8. Open `http://localhost:3000/login`.

## Weekly Plans

Students use the `Weekly Plan` navigation link to upload one plan file for the current halaqa week. Plan weeks run Saturday-Friday, and `week_start` is stored as the Saturday date.

The upload accepts:

- PNG
- JPG
- PDF
- Maximum size: 1 MB

Uploading again during the same week replaces the existing weekly plan record. The page shows the uploaded file name, upload timestamp, and a signed view/download link. If nothing is uploaded, it shows `No weekly plan uploaded yet.`

Admins open `/admin/students/[id]` from the student list to view the student's current weekly plan. If a plan exists, the admin sees the file name, upload timestamp, and a signed view/download link. If no plan exists, the page shows `No plan uploaded for this week.`

## Import Users From CSV

Use the local import script to create/update Supabase Auth users and matching `public.profiles` rows from a CSV.

The input CSV must have exactly these columns:

```csv
name,phone,role
Sample Student,+1 555 010 1000,student
Sample Admin,+1 555 010 1001,admin
```

A fake sample file is available at `docs/sample-users.csv`.

Run the import with:

```bash
npm run import-users -- data/users.csv
```

Required environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

The script uses the Supabase Admin API locally with `SUPABASE_SERVICE_ROLE_KEY`. Never expose that key to browser code and do not log it.

Phone login still uses Supabase email/password internally. The import normalizes phone numbers and creates synthetic auth emails:

- `5550101000` becomes `+15550101000`
- Auth email becomes `15550101000@itqan.local`

The script sets the same temporary password for every imported user:

```txt
itqan2026
```

New users are created with that password. Existing imported users are also reset to that password when you rerun the import, and their `public.profiles` rows are updated.

After each run, a local credential report is written to:

```txt
data/import-results-YYYY-MM-DD-HHMMSS.csv
```

Report CSV files include the temporary password for imported users. Keep real import CSV files and generated reports local. The repo ignores `data/*.csv`; commit only `data/.gitkeep` and fake samples under `docs/`.

## Deployment

Deploy to Vercel and configure these environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` is optional for this app runtime and must stay server-only. Normal page and action behavior uses the signed-in user's Supabase session and RLS.

Apply all files in `supabase/migrations` to the production Supabase project before using the deployed app. The weighted checklist migration keeps `public.checkins`, adds aggregate score columns, and stores each submitted task snapshot in `public.checkin_items` so historical labels and weights remain stable.

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
