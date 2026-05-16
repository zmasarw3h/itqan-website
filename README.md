# ITQAN Daily Check-In

Emergency lightweight check-in system for one masjid while Canvas is unavailable.

## What This App Does

- Students sign in, submit one weighted daily Quran checklist, confirm partner recitation rounds, view weekly grades, see today's submitted checklist and score, and view their own history.
- Students upload one weekly plan image/PDF for the current Saturday-Friday halaqa week.
- Admins sign in, add students, view all active students, review weekly/date submission scores, filter by student/date/status, correct check-ins, enter Saturday halaqa grades, and export CSV.
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
# Server-only key used for user import and private weekly-plan Storage operations.
# Do not expose this in browser code.
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

   The app performs private Storage uploads and signed URL creation from server actions with `SUPABASE_SERVICE_ROLE_KEY`, after checking the signed-in user's role. Do not expose that key to the browser.

   If you also want direct authenticated-user access to Storage objects outside the app server, add these Storage RLS policies for `storage.objects`:

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

6. Create the first admin Supabase Auth user with email/password, then insert a matching row in `public.profiles`. Users enter phone numbers at login, but Supabase Auth still uses email/password internally.

   Convert phone numbers to synthetic auth emails:

   - `4165551234` normalizes to `+14165551234`
   - Auth email becomes `14165551234@itqan.local`

   Each profile `id` must equal the Auth user UUID. `profiles.email` stores the synthetic auth email. `profiles.phone` is optional display-only data shown to admins.

   After an admin can log in, they can add students from `Admin Dashboard -> Add Student`. The app normalizes the phone number, creates a Supabase Auth user with the synthetic auth email and password `itqan2026`, confirms the email, and creates the matching active student profile. The service-role key is used only in server code.

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

## Weekly Scoring

Weekly scoring totals 1000 points:

- Daily checklist: 100 points per day, 700 per Sunday-Saturday tracker week.
- Partner recitation: Round 1 is Sunday-Wednesday for 75 points; Round 2 is Thursday-Saturday for 75 points.
- Saturday halaqa grade: 100 attendance points plus an admin-entered recitation mark out of 10. The app stores that mark as 10-50 recitation points by multiplying by 5, for 150 max.

Students use `Partner Recitation` to confirm the currently open round. The server determines the round from the same 1:00 AM effective date used by daily check-ins, and the database prevents duplicate submissions for the same student, week, and round. Students use `Grades` to view their read-only weekly total and breakdown.

Admins enter halaqa grades from `/admin/students/[id]`. If a student did not attend, both attendance and recitation points are stored as 0. If they attended, recitation mark must be 2-10. Students use `Grades` to view attendance, recitation mark, stored recitation points, total halaqa points, and feedback entered in the grade notes field.

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

`SUPABASE_SERVICE_ROLE_KEY` must stay server-only. Database page and action behavior uses the signed-in user's Supabase session and RLS. Private weekly-plan file upload, replacement cleanup, and signed URL creation use the service-role key only on the server.

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
