# ITQAN Daily Check-In — Build Spec

## Purpose

Build a temporary one-masjid check-in system while Canvas is unavailable.

## Stack

- Next.js
- TypeScript
- Supabase Auth
- Supabase Postgres
- Tailwind CSS
- Vercel deployment
- Vitest or equivalent for tests

## Roles

### Student

Can only access student pages and their own records.

### Admin

Can access all student/check-in records.

## Required Pages

### `/login`

User logs in.

### `/student/check-in`

Shows:

- Student name
- Today’s date
- Check-in status
- Button: “I completed today’s work”
- Optional note field
- Confirmation timestamp after submission

Rules:

- One check-in per student per date.
- If already submitted, show submitted state instead of allowing another submission.

### `/student/history`

Shows the student’s own check-in history.

### `/admin`

Shows:

- All students
- Current week completion table
- Completed/missing status
- Filters:
  - student
  - date
  - status
- CSV export

### `/admin/students/[id]`

Shows one student’s check-in history.

Admin can manually correct a check-in.

## Database

### `profiles`

Fields:

- `id uuid primary key`
- `name text not null`
- `email text not null` (internal synthetic auth email)
- `phone text null`
- `role text not null check role in ('student', 'admin')`
- `active boolean not null default true`
- `created_at timestamptz not null default now()`

### `checkins`

Fields:

- `id uuid primary key`
- `student_id uuid not null references profiles(id)`
- `date date not null`
- `completed boolean not null default true`
- `note text`
- `submitted_at timestamptz not null default now()`
- `updated_at timestamptz`
- `updated_by_admin uuid references profiles(id)`

Constraints:

- Unique: `student_id, date`

## Security Rules

- Unauthenticated users cannot access protected pages.
- Inactive users cannot use the app.
- Students can only read/write their own check-ins.
- Students cannot access admin pages.
- Admins can read all profiles and check-ins.
- Admins can update check-ins.
- Role checks must happen server-side.
- Supabase RLS policies should enforce the same rules.

## CSV Export

Admin CSV must include:

- student name
- student email
- date
- completed
- submitted_at
- note
- updated_at
- updated_by_admin

CSV export should respect active filters when reasonable.

## Required Tests

Add tests for:

- duplicate check-in prevention
- student cannot access another student’s data
- student cannot access admin data
- admin can view all data
- CSV output contains expected columns

## Required Scripts

`package.json` must include:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "npm run lint && npm run typecheck && npm run test && npm run build"
  }
}
```

## Deployment

Use Vercel.

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- server-only Supabase key if needed

Do not expose service-role keys to the browser.

## Do Not Ask Unless Blocked

Make reasonable defaults.

Use these assumptions:

- One masjid only.
- Timezone is configured in one app constant.
- Students check in for the current calendar date.
- Check-ins are all-or-nothing.
- Admin correction is allowed.
- No teacher accounts.
- No announcements.
