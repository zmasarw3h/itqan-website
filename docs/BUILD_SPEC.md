# ITQAN Lite — Current Build Spec

## Purpose

Maintain ITQAN Lite, a one-masjid masjid operations app for students and admins.

The app started as a temporary Canvas replacement, but the maintained product now includes daily weighted checklist tracking, partner recitation, weekly plan uploads, weekly grades, Saturday halaqa grading, admin leaderboard/scoring, CSV exports, and operations tooling.

This spec describes the current app scope. It must not be used to roll the product back to the original emergency MVP.

## Source of Truth and Preservation Rules

Use these as the source of truth for current behavior:

- `README.md`
- existing routes under `app/`
- existing Supabase migrations under `supabase/migrations/`
- existing tests

If older docs conflict with current code, preserve the current product and update the docs.

Do not remove, hide, disable, or destructively migrate away existing functionality unless a task explicitly asks for removal.

Do not add migrations that drop tables, columns, functions, policies, or storage metadata unless the task explicitly requests a destructive migration.

## Stack

- Next.js App Router
- TypeScript
- Supabase Auth
- Supabase Postgres
- Supabase RLS with user-authenticated server clients
- Private Supabase Storage for weekly plan files
- Tailwind CSS
- Vitest
- Playwright smoke tests
- Vercel deployment

## Roles

### Student

Can access student pages and their own records only.

### Admin

Can access admin pages and all student/check-in/grade/weekly-plan records needed for operations.

No teacher, parent, or multi-masjid roles exist in the current app.

## Current Pages and Routes

### `/login`

User logs in with phone/password. Phone numbers map to synthetic Supabase Auth emails internally.

### `/student/check-in`

Shows:

- Student name
- Effective date in the configured timezone
- Daily weighted Quran checklist
- Saved daily score
- Optional note
- Existing saved checklist state when available

Current rules:

- One daily record per student/date.
- The app must prevent duplicate student/date records.
- Students can only save their own checklist.
- The checklist should support the maintained product behavior. If autosave is implemented, checkbox updates are saved immediately and there is no final submit button.

### `/student/history`

Shows the student's own check-in history, including completed and missed checklist items where available.

### `/student/partner-recitation`

Allows students to confirm the currently open partner recitation round for the tracker week.

Rules:

- Round 1 covers Sunday-Wednesday.
- Round 2 covers Thursday-Saturday.
- One submission per student/week/round.
- Students can only create their own current round submission.

### `/student/grades`

Shows the student's read-only weekly grade total and breakdown.

The weekly score is out of 1000 points:

- Daily checklist: up to 700 points
- Partner recitation: up to 150 points
- Saturday halaqa grade: up to 150 points

### `/student/leaderboard`

Shows a student-facing weekly leaderboard for active students.

The student leaderboard may show:

- Rank
- Student display name
- Weekly percentage score
- Total weekly points
- Rank change compared with the immediately previous Sunday-Saturday tracker week
- Whether the row belongs to the signed-in student

The student leaderboard must not show admin-only operational data such as phone numbers, email addresses, below-70 streaks, CSV export controls, private notes, correction links, or another student's detailed breakdown.

### `/student/weekly-plan`

Allows students to upload one weekly plan file for the current Saturday-Friday halaqa week.

Rules:

- Supported file types: PNG, JPG/JPEG, PDF
- Maximum file size: 1 MB
- Uploading again in the same week replaces the existing weekly plan
- Files live in the private `weekly-plans` Supabase Storage bucket
- Metadata lives in `public.weekly_plans`

### `/account/change-password`

Allows signed-in users to change their own password.

### `/admin`

Shows the admin dashboard/leaderboard.

Admin can:

- View active students
- View weekly percentage scores
- View daily, partner recitation, halaqa, and total points
- Filter by available week and below-70 view where supported
- Export CSV

### `/admin/students/new`

Allows admins to add a student or admin.

The app normalizes the phone number, creates a Supabase Auth user with a synthetic auth email, sets the temporary password, confirms the email, and creates a matching active profile.

### `/admin/students/[id]`

Shows one student's operational detail page.

Admin can:

- View the student's check-in history for the selected week
- Correct check-ins
- Enter Saturday halaqa grades
- View/download the student's current weekly plan

### `/admin/export`

Exports admin CSV data for the leaderboard/dashboard view.

## Database

### `profiles`

Stores user profile and role metadata.

Important fields:

- `id uuid primary key references auth.users(id)`
- `name text not null`
- `email text not null` synthetic auth email
- `phone text null`
- `role text not null check role in ('student', 'admin')`
- `active boolean not null default true`
- `created_at timestamptz not null default now()`

### `checkins`

Stores one daily checklist aggregate per student/date.

Important fields:

- `id uuid primary key`
- `student_id uuid not null references profiles(id)`
- `date date not null`
- `completed boolean not null default true`
- `note text`
- `earned_weight integer`
- `total_weight integer`
- `daily_score numeric`
- `submitted_at timestamptz`
- `updated_at timestamptz`
- `updated_by_admin uuid references profiles(id)`

Constraints:

- Unique: `student_id, date`

### `checkin_items`

Stores the task snapshot for a student's daily checklist.

Important fields:

- `id uuid primary key`
- `checkin_id uuid not null references checkins(id)`
- `student_id uuid not null references profiles(id)`
- `date date not null`
- `task_key text not null`
- `task_label text not null`
- `weight integer not null`
- `completed boolean not null`
- `created_at timestamptz not null default now()`

Constraints:

- Unique: `checkin_id, task_key`

### `weekly_plans`

Stores weekly plan metadata. Uploaded files live in private Supabase Storage.

Important fields:

- `id uuid primary key`
- `student_id uuid not null references profiles(id)`
- `week_start date not null`
- `file_path text not null`
- `file_name text not null`
- `file_type text not null`
- `file_size integer not null`
- `uploaded_at timestamptz not null default now()`

Constraints:

- Unique: `student_id, week_start`

### `partner_recitations`

Stores partner recitation confirmations.

Important fields:

- `id uuid primary key`
- `student_id uuid not null references profiles(id)`
- `week_start date not null`
- `round text not null check round in ('round_1', 'round_2')`
- `points integer not null default 75`
- `submitted_at timestamptz not null default now()`

Constraints:

- Unique: `student_id, week_start, round`
- Points must be 75

### `halaqa_grades`

Stores Saturday halaqa grades entered by admins.

Important fields:

- `id uuid primary key`
- `student_id uuid not null references profiles(id)`
- `week_start date not null`
- `attended boolean not null default false`
- `attendance_points integer not null default 0`
- `recitation_points integer not null default 0`
- `notes text`
- `graded_by uuid references profiles(id)`
- `graded_at timestamptz not null default now()`
- `updated_at timestamptz`

Constraints:

- Unique: `student_id, week_start`
- If absent, attendance and recitation points are 0
- If attended, attendance points are 100 and recitation points are 10-50

## Security Rules

- Unauthenticated users cannot access protected pages.
- Inactive users cannot use the app.
- Students can only read/write their own records.
- Students can read only sanitized cross-student leaderboard rows, after a server-side student role check.
- Students cannot access admin pages or admin data.
- Admins can read operational student/check-in/grade/weekly-plan data.
- Admins can update check-ins and halaqa grades.
- Role checks must happen server-side.
- Supabase RLS policies must enforce the same boundaries.
- `SUPABASE_SERVICE_ROLE_KEY` must stay server-only.
- Private weekly-plan Storage operations and the sanitized student leaderboard read model may use the service-role key only from server code after role checks.

## CSV Export

Admin CSV exports should include useful operational columns for the current dashboard/export view.

Daily/check-in CSV data should include, where relevant:

- student name
- student phone
- student email
- date
- status
- daily score
- earned weight
- total weight
- task breakdown
- submitted/saved timestamp where available
- note
- updated_at
- updated_by_admin

Leaderboard CSV data should include, where relevant:

- rank
- student name
- student phone
- student email
- weekly percentage
- status
- below-70 streak
- daily points
- partner points
- halaqa points
- total points

CSV exports should respect active filters where reasonable.

## Required Tests

Keep or add tests for:

- duplicate daily record prevention
- student cannot access another student's data
- student cannot access admin data
- admin can view operational data
- daily score calculation
- weekly score calculation
- partner recitation duplicate prevention
- weekly plan validation
- CSV output contains expected columns

For autosaved checklist work, add tests for:

- first checkbox save creates one daily record
- repeated checkbox saves do not create duplicate daily records
- toggling a checkbox updates only that task state
- daily score recalculates after check/uncheck
- invalid task keys are rejected

## Required Scripts

`package.json` must include the standard scripts used by the project:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build --webpack",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "check": "npm run lint && npm run typecheck && npm run test && npm run build"
  }
}
```

## Deployment

Use Vercel.

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not expose service-role keys to the browser.

Apply all Supabase migrations before deploying app code that depends on migrated schema.

## Still Out of Scope

Do not add unrelated features such as:

- Teacher accounts
- Parent accounts
- Multi-masjid support
- Plan approval workflow
- Plan comments
- Plan parsing/OCR
- Standalone sadaqa features outside accountability obligations
- Announcements
- Payments
- Booking/scheduling
- Quran ayah selector

## Do Not Ask Unless Blocked

Make reasonable defaults.

Use these assumptions:

- One masjid only.
- Timezone is configured in one app constant.
- Students work against the current effective calendar date.
- Admin correction is allowed.
- Existing weekly plan, partner recitation, grades, halaqa, leaderboard, import, backup, and CSV functionality must be preserved unless explicitly removed.
