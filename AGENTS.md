# AGENTS.md

## Mission

Maintain ITQAN Lite, a one-masjid masjid operations app for students and admins.

The app started as an emergency Canvas replacement, but the current product is larger than the original MVP. Do not reduce the app back to the original emergency scope.

`README.md`, the current routes, and the current database migrations are the source of truth for product scope. If an older brief conflicts with existing app behavior, preserve the existing app behavior and update the stale brief instead of deleting features.

## Roles

The app has two roles:

- Student
- Admin

Do not add teacher, parent, or multi-masjid roles unless explicitly requested.

## Current Core Features

Students can:

- Log in with phone/password backed by Supabase Auth.
- Save a weighted daily Quran checklist.
- See today's saved checklist state and score.
- Confirm partner recitation rounds.
- View weekly grades and grade breakdowns.
- Upload one weekly plan file for the current halaqa week.
- View their own check-in history.
- Change their password.

Admins can:

- Log in.
- Add students.
- View all active students.
- View weekly leaderboard/scoring data.
- Filter dashboard data by week/status where supported.
- Open individual student admin pages.
- Correct check-ins.
- Enter Saturday halaqa grades.
- View/download a student's current weekly plan.
- Export CSV data.

## Preserved Features

Do not remove, hide, disable, or migrate away these existing features unless the user explicitly asks for that removal:

- Weekly plans
- Partner recitation
- Student grades
- Halaqa grading
- Leaderboard/admin scoring
- Admin student detail pages
- CSV exports
- User import tooling
- Backup tooling

Do not add migrations that drop tables, columns, functions, policies, or storage-related metadata unless the task explicitly requests a destructive migration.

## Out of Scope

Do not build unrelated new features such as:

- Teacher role
- Plan approval workflow
- Plan comments
- Plan parsing/OCR
- Sadaqa
- Announcements
- Multi-masjid support
- Payments
- Booking/scheduling
- Parent accounts
- Quran ayah selector

## Development Rules

- Use TypeScript.
- Keep changes focused and practical.
- Protect all admin data server-side.
- Students must never see other students' data.
- Use server-side role checks plus Supabase RLS.
- Use a single configured timezone for effective dates.
- Store schema changes as migrations.
- Never expose service-role keys to browser code.
- Prefer additive migrations over destructive migrations.
- Preserve existing routes unless route removal is the explicit task.

## Required Checks

Before finishing, run:

```bash
npm run check
```

`npm run check` must run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

If a check fails, fix it before stopping or clearly explain why it could not be fixed.

## Definition of Done

For broad app changes, the project is healthy only when:

- Student login works.
- Student daily checklist works.
- Duplicate same-day daily records are prevented.
- Partner recitation works.
- Student grades work.
- Weekly plan upload/view works.
- Student history works.
- Admin dashboard/leaderboard works.
- Admin student detail pages work.
- Admin correction works.
- Halaqa grading works.
- CSV export works.
- Server-side role protection works.
- Supabase migrations match the intended schema.
- Setup and operations docs stay accurate.
- `npm run check` passes.

## Final Response Required

When complete, report:

- What changed
- What was intentionally not changed
- How to run locally, when relevant
- How to deploy, when relevant
- What checks passed
- Any known limitations
