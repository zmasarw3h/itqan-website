# AGENTS.md

## Mission

Maintain ITQAN Lite, a scoped multi-masjid operations app for students, teachers, masjid admins, and super admins.

The app started as an emergency Canvas replacement, but the current product is larger than the original MVP. Do not reduce the app back to the original emergency scope.

`README.md`, the current routes, and the current database migrations are the source of truth for product scope. If an older brief conflicts with existing app behavior, preserve the existing app behavior and update the stale brief instead of deleting features.

## Roles And Scope

`profiles.role` supports:

- `student`
- `teacher`
- `admin`
- `super_admin`

Scoped access comes from `student_group_memberships`, `masjid_staff_memberships`, and
`group_teacher_assignments`. An admin-teacher remains `profiles.role = 'admin'` and also has an active
teacher staff membership for the relevant masjid. Do not add a separate `admin_teacher` role.

The teacher-facing dashboard is implemented under `/teacher`. Teacher access remains week-specific and
must always be derived from active teacher staff membership plus an exact group assignment.

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

Teachers can:

- View every group assigned to them for a selected tracker week.
- View only the students whose group membership is effective for that assigned group/week.
- View/download assigned students' weekly plans through short-lived, server-guarded links.
- Create or update halaqa grades only for the exact assigned student/group/week.

Admin-teachers keep `profiles.role = 'admin'`, default to the admin experience, and can switch to the
teacher dashboard through capability-aware navigation.

Admins can:

- Log in.
- Add students and teachers inside masajid they actively administer.
- View active students inside their scoped masajid.
- View weekly leaderboard/scoring data.
- Filter dashboard data by week/status where supported.
- Open individual student admin pages.
- Correct check-ins.
- Enter Saturday halaqa grades.
- View/download a student's current weekly plan.
- Export CSV data.
- Configure and generate the weekly teacher rotation for an explicitly selected scoped cohort.

Super admins can:

- Search and inspect people and their historical access.
- Change profile access and reset passwords.
- Create and maintain masajid, cohorts, and halaqa groups.
- Grant scoped admin or admin-teacher access.

The rotation UI supports explicit masjid/cohort selection for brothers and sisters cohorts. Student
group balancing and weekly teacher assignment generation are still combined in one action until the
next rotation workflow phase separates them.

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

- Plan approval workflow
- Plan comments
- Plan parsing/OCR
- Sadaqa
- Announcements
- Payments
- Booking/scheduling
- Parent accounts
- Quran ayah selector

## Development Rules

- Use TypeScript.
- Keep changes focused and practical.
- Protect all admin data server-side.
- Students must never see other students' data.
- Normal admins must never read or mutate data outside masajid they actively administer.
- Teachers must never read students outside groups assigned to them for the relevant week.
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
- Supabase RLS independently enforces masjid, cohort, group, and role boundaries.
- Super-admin service-role access is created only after a server-side super-admin guard.
- Database mutations and their audit events are atomic where the workflow spans multiple rows.
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
