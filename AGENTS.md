# AGENTS.md

## Mission

Build the ITQAN Daily Check-In emergency app.

This is a temporary one-masjid system while Canvas is unavailable.

The app has only two roles:

- Student
- Admin

## Core Features

Students can:

- Log in
- Submit one daily check-in
- See whether they already checked in today
- View their own history

Admins can:

- Log in
- View all students
- View completion by date/week
- Filter by student, date, and status
- Manually correct check-ins
- Export CSV

## Out of Scope

Do not build:

- Teacher role
- Weekly plans
- Plan approval
- Saturday scoring
- Sadaqa
- Announcements
- Multi-masjid support
- Payments
- Booking
- Parent accounts
- Quran ayah selector

## Development Rules

- Use TypeScript.
- Keep the app simple.
- Do not over-engineer.
- Do not add features outside the scope.
- Protect all admin data server-side.
- Students must never see other students’ data.
- Prevent duplicate check-ins for the same student/date.
- Use a single configured timezone for “today.”
- Store database changes as migrations.
- Never expose secret keys to the browser.

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

If a check fails, fix it before stopping.

## Definition of Done

The project is done only when:

- Student login works.
- Student daily check-in works.
- Duplicate same-day check-ins are blocked.
- Student history works.
- Admin dashboard works.
- Admin filters work.
- Admin correction works.
- CSV export works.
- Server-side role protection works.
- Supabase migration exists.
- Setup instructions exist.
- `npm run check` passes.

## Final Response Required

When complete, report:

- What was built
- How to run locally
- How to deploy
- What checks passed
- Any known limitations
