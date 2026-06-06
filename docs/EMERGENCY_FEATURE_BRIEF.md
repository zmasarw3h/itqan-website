# ITQAN Lite — Current Feature Brief

## Purpose

ITQAN Lite is a one-masjid masjid operations app for students and admins.

It began as an emergency Canvas replacement, but the current app includes daily Quran checklist tracking, weekly scoring, partner recitation, weekly plan uploads, student leaderboard views, halaqa grading, admin leaderboard views, CSV exports, and operational tooling. This document reflects the current maintained product scope, not only the original emergency MVP.

## Source of Truth

Use `README.md`, current routes, and current Supabase migrations as the source of truth for product behavior.

Do not remove existing functionality just because an older note described it as out of scope. If documentation conflicts with the current app, update the documentation rather than shrinking the app.

## Roles

- Student
- Admin

No teacher, parent, or multi-masjid roles exist in the current product.

## Current Student Scope

Students can:

- Log in with phone/password.
- Save a weighted daily Quran checklist.
- See today's checklist state, score, and history.
- Confirm partner recitation rounds.
- View weekly grades and point breakdowns.
- View sanitized weekly leaderboard rankings and rank movement.
- Upload one weekly plan file for the current Saturday-Friday halaqa week.
- Change their password.

## Current Admin Scope

Admins can:

- Log in.
- Add students.
- View active students.
- View weekly leaderboard/scoring data.
- Filter admin views where supported.
- Export CSV data.
- Open individual student admin pages.
- Correct check-ins.
- Enter Saturday halaqa grades.
- View/download a student's current weekly plan.

## Current Data Scope

The app currently uses Supabase Auth, Supabase Postgres, Supabase RLS, and private Supabase Storage for weekly plan files.

Core data areas include:

- `profiles`
- `checkins`
- `checkin_items`
- `weekly_plans`
- `partner_recitations`
- `halaqa_grades`
- private Storage bucket `weekly-plans`

## Preserved Features

These features are in scope and must not be removed unless explicitly requested:

- Weekly plan upload/view
- Partner recitation
- Student grades
- Student leaderboard
- Halaqa grading
- Leaderboard/admin scoring
- Admin correction
- CSV export
- User import tooling
- Backup tooling

Do not add destructive migrations that drop these tables or features unless the task explicitly asks for removal.

## Still Out of Scope

Do not add unrelated features such as:

- Teacher role
- Plan approval workflow
- Plan comments
- Plan parsing/OCR
- Standalone sadaqa calculation outside accountability obligations
- Announcements
- Multi-masjid support
- Payments
- Booking/scheduling
- Parent accounts
- Quran ayah selector

## Constraints

- One masjid only.
- Mobile-friendly.
- Server-side role checks are required.
- Supabase RLS must protect data boundaries.
- Students must not access other students' data.
- Admin features must stay admin-only.
- Service-role keys must never be exposed to browser code.
- Schema changes must be stored in migrations.
- Prefer additive changes over destructive changes.
