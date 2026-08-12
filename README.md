# ITQAN Lite

Lightweight masjid operations system that started as an emergency Canvas replacement.

## What This App Does

- Students sign in, autosave one weighted daily Quran checklist throughout the day, confirm partner recitation rounds, view weekly grades, see a student-facing leaderboard, see today's saved checklist and score, and view their own history.
- Students upload one weekly plan image/PDF for the current Sunday-Saturday tracker week before using daily check-in.
- Admins sign in, add students/teachers/admins, view all active students, review weekly/date submission scores, filter by student/date/status, correct check-ins, enter Saturday halaqa grades, and export CSV.
- Admins can view/download a student's uploaded weekly plan from that student's admin screen.
- Teachers can open the current published session dashboard for their authorized cohort/week, view every published group, download published-roster students' weekly plans, and save individual halaqa grades. Admin-teachers can switch between admin and teaching views.
- The app now includes scoped masjid/cohort foundations and weekly teacher rotation operations. It still excludes plan approval, comments, plan parsing/OCR, announcements, payments, booking, parent accounts, and Quran selection.

Teacher rotation publication is authoritative in PostgreSQL. Sunday `week_start` is the tracker identity;
teacher staff eligibility is evaluated on Saturday, and missing exact availability means unavailable.
Publication uses a database snapshot, request-ID replay, stale-state comparison, and a scoped advisory
lock. See [`docs/ROTATION_PUBLICATION.md`](docs/ROTATION_PUBLICATION.md).

Student availability is a separate, session-only admin ledger on `/admin/rotation`. It is scoped to the
selected masjid, cohort, and canonical Sunday `week_start`; the page displays the corresponding Saturday.
Students attend by default, so only an explicit absence row is stored. This workflow never changes
`student_group_memberships`, historical placement, or published teacher assignments.

The additive backend also provides attendance-aware Saturday session-roster drafts and immutable
published versions. A draft starts attending students in their usual active group, excludes explicit
absences, supports Saturday-only moves and primary teacher responsibility, and requires review before
publish. Unplaced students, stale source state, and missing responsibility block publish; imbalance is a
warning only. Session-roster mutations are service-only and normal-admin scoped, and publishing never
changes permanent memberships or current teacher assignments. A stale draft can be explicitly refreshed
into a new review-required draft; the old manual placement/responsibility edits are discarded and the
currently published version remains live. The later admin UI will consume the stable contracts documented
in [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

The teacher-session backend now authorizes an active teacher or admin-teacher for every published group
in a cohort/week when that teacher has active Saturday capability and any exact active group assignment
in the cohort. The primary/assigned group is a responsibility highlight only. The API exposes only the
current published snapshot, uses the same scope for weekly-plan links, and requires exact version/group/
student membership for individual grade writes. Drafts, superseded versions, cross-scope requests, and
super-admin teacher surfaces remain denied. The later Terra teacher UI will consume these contracts;
this slice does not redesign that UI.

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
# Server-only key used by guarded account-management workflows and private weekly-plan Storage operations.
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
   - File size limit: 3 MB if configured in the dashboard
   - Allowed MIME types: `image/png`, `image/jpeg`, `application/pdf` if configured in the dashboard

   The app performs private Storage uploads and signed URL creation from server actions with `SUPABASE_SERVICE_ROLE_KEY`, after checking the signed-in user's role and target path. Do not expose that key to the browser. The Phase 1 migration creates or replaces the `storage.objects` policies for student-owned and masjid-scoped admin reads, disables direct signed-client object mutations, and replaces the older global-admin read policy in existing deployments.

   Weekly plan metadata is stored in `public.weekly_plans` by the migration. Uploaded files are stored in Supabase Storage, not in the database.

6. Create the first admin Supabase Auth user with email/password, then insert a matching row in `public.profiles`. Users enter phone numbers at login, but Supabase Auth still uses email/password internally.

   Convert phone numbers to synthetic auth emails:

   - `4165551234` normalizes to `+14165551234`
   - Auth email becomes `14165551234@itqan.local`

   Each profile `id` must equal the Auth user UUID. `profiles.email` stores the synthetic auth email. `profiles.phone` is optional display-only data shown to admins.

   After an admin can log in, they can add students and teachers inside masajid they actively administer from `Admin Dashboard -> Add User`. Super admins use `/super-admin/people/new` for the same recoverable global workflow, then use Guided Change for explicit selected-masjid replacement or the masjid page for additive staff grants. The app normalizes the phone number, creates a Supabase Auth user with the synthetic auth email and password `itqan2026`, confirms the email, creates the matching active profile, and assigns the selected scoped membership. The service-role key is used only in guarded server code. See [`docs/ACCESS_TRANSITION_SEMANTICS.md`](docs/ACCESS_TRANSITION_SEMANTICS.md) for the role-projection and date-boundary rules.

   Example profile data is in `docs/SEED_DATA.md`:

   ```csv
   name,email,phone,role,active
   Synthetic Admin,15550101000@itqan.local,+1 555 010 1000,admin,true
   Synthetic Student,15550101001@itqan.local,+1 555 010 1001,student,true
   Synthetic Student Two,15550101002@itqan.local,+1 555 010 1002,student,true
   ```

7. Run the app:

   ```bash
   npm run dev
   ```

8. Open `http://localhost:3000/login`.

## E2E Smoke Tests

Playwright is configured for lightweight browser smoke tests.

Install the browser once:

```bash
npx playwright install chromium
```

Run the default E2E smoke suite:

```bash
npm run test:e2e
```

By default, Playwright starts the app on `http://127.0.0.1:3100` and verifies `/login` in desktop and mobile Chromium projects. It does not require Supabase credentials and does not sign in.

To run against an already-running app:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

Authenticated E2E tests are opt-in and should use a local or staging Supabase project, never production. They are skipped unless all of these environment variables are set:

```bash
E2E_AUTH_ENABLED=true
E2E_TEST_ENVIRONMENT=local
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
E2E_TEST_STUDENT_PHONE=
E2E_TEST_STUDENT_PASSWORD=
E2E_TEST_TEACHER_PHONE=
E2E_TEST_TEACHER_PASSWORD=
E2E_TEST_ADMIN_TEACHER_PHONE=
E2E_TEST_ADMIN_TEACHER_PASSWORD=
E2E_TEST_PURE_ADMIN_PHONE=
E2E_TEST_PURE_ADMIN_PASSWORD=
E2E_TEST_SUPER_ADMIN_PHONE=
E2E_TEST_SUPER_ADMIN_PASSWORD=
```

Each role fixture is independently optional. Teacher coverage verifies available-week canonicalization,
published-session group access, roster grade/plan context, no-publication handling, and desktop/mobile overflow.
Admin-teacher and pure-admin fixtures verify capability-aware routing and navigation. The super-admin
fixture verifies the guarded `/super-admin` redirect and console entry. To exercise grade
submission against disposable local or staging data, also set `E2E_TEST_DATA_MUTATIONS_ENABLED=true`;
only the desktop project submits. The suite refuses an `E2E_TEST_ENVIRONMENT=production` or an
`itqan.website`/`itqan.app` target.

Normal CI runs the deterministic `npm run check` job and a separate Docker-backed `npm run test:rls`
job. The E2E workflow is manual for now and can be run from GitHub Actions when a browser smoke check
is needed.

## Local RLS Integration Suite

Run the Phase 1 authorization suite against a disposable local Supabase stack:

```bash
npm run test:rls
```

Prerequisites are a running Docker daemon and the repository's pinned Supabase CLI dependency. The
command starts a local stack, applies every migration, seeds two isolated masajid and signed-in role
fixtures, runs assertions through anon-key clients, then stops the stack and deletes its volumes. It
refuses non-local Supabase URLs. The same command is a required, separate GitHub Actions merge gate.
Never adapt this command to point at production.

## Backup and Restore

Operational backup and restore steps are documented in `docs/BACKUP_RESTORE.md`.

Manual local helpers are available for monthly exports:

```bash
npm run backup:db
```

Database restore is manual through Supabase backups. Weekly plan uploaded files are temporary operational files and are not backed up.

## Daily Check-In

Students use `Today's Check-In` to save weighted Quran checklist tasks throughout the day. There is no final submit button: each checkbox toggle saves immediately, updates the live daily score, and remains checked after refresh or returning from another device. Opening the page alone does not create a daily record; the row is created on the first checkbox save or note save.

Admins, history, grades, and leaderboard views continue to use the latest saved `checkins.daily_score` after refresh.

Checklist definitions are versioned by the canonical Sunday tracker-week start. Dates before Sunday
2026-08-09 use the original Thursday/Friday definition, including the 10-point `Tafsir` task. Starting
with the 2026-08-09 tracker week, Thursday and Friday remove that task and increase the existing new-
memorization task from 20 to 30 points. Sunday-Wednesday, Saturday, the 100-point daily maximum, and the
700-point weekly daily-checklist maximum are unchanged. Each saved `checkin_items` row remains a snapshot
of the definition used for that date, so historical labels, weights, scores, exports, and reports are not
rewritten by a later version.

## Weekly Plans

Students use the `Weekly Plan` navigation link to upload one plan file for the current Sunday-Saturday tracker week. `week_start` is stored as the Sunday date. Starting Sunday, the daily check-in page is blocked until the current week's plan is uploaded.

The upload accepts:

- PNG
- JPG
- PDF
- Maximum size: 3 MB

Uploading again during the same week replaces the existing weekly plan record. The page shows the uploaded file name, upload timestamp, and a signed view/download link. If nothing is uploaded, it shows `No weekly plan uploaded yet.`

Admins open `/admin/students/[id]` from the student list to view the student's current weekly plan. If a plan exists, the admin sees the file name, upload timestamp, and a signed view/download link. If no plan exists, the page shows `No plan uploaded for this week.`

Historical leaderboards, incentives, rewards, streaks, and their CSV output use each tracker week's effective student membership rather than today's roster. Current viewer authorization and contact privacy remain separate from historical population. See [Historical reporting populations](docs/historical-reporting.md) for the exact population, scoring, privacy, lifetime badge, and naming rules.

Teachers open `/teacher` and choose an authorized tracker week. `week_start` remains the Sunday
tracker-week storage key, while the halaqa event date is the following Saturday. Teacher staff eligibility
for the assignment is evaluated on that Saturday, not on the Sunday storage key. Rotation navigation uses
Toronto civil dates; all current staff/account-access decisions use the literal Toronto civil date. The
1:00 AM effective date is limited to daily check-ins, partner recitation, and reset-linked scoring. The
current teacher pages render only published session dashboards and versioned group rosters. Before
publication they show an unavailable/no-publication state and expose no students. A weekly-plan link uses
the same current published-session cohort scope and version as the displayed roster; the download route
rechecks that scope server-side and creates a five-minute signed URL with the signed-in session. The
legacy permanent-membership roster RPC is revoked. The later Terra task may redesign the teacher UI while
consuming these contracts.

Teacher operational access never begins before the assignment Sunday. From that Sunday through the
Saturday halaqa event, an exact active assignment and staff coverage of that Saturday are required; a
teacher whose staff membership begins on Saturday is therefore eligible for the whole tracker week.
After Saturday, the exact assignment and historical Saturday coverage remain necessary, and the teacher
must also have active teacher staff access for the same masjid on the Toronto civil request date. A
teacher offboarded on Saturday cannot later open the roster, plans, signed files, or grades. Historical
student and admin displays retain the assigned teacher's name even if that teacher or the hierarchy is
later deactivated; displaying that history does not grant operational access.

## Weekly Scoring

Weekly scoring totals 1000 points:

- Daily checklist: 100 points per day, 700 per Sunday-Saturday tracker week.
- Partner recitation: Round 1 is Sunday-Wednesday for 75 points; Round 2 is Thursday-Saturday for 75 points.
- Saturday halaqa grade: 100 attendance points plus an admin-entered recitation mark out of 10. The app stores that mark as 10-50 recitation points by multiplying by 5, for 150 max.

Students use `Partner Recitation` to confirm the currently open round. The server determines the round from the same 1:00 AM effective date used by daily check-ins, and the database prevents duplicate submissions for the same student, week, and round. Students use `Grades` to view their read-only weekly total and breakdown. Students use `Leaderboard` to view sanitized weekly rankings for active students, including their own rank, weekly score, rank change from the previous tracker week, and points behind the next rank.

Admins enter halaqa grades from `/admin/students/[id]`. If a student did not attend, both attendance and recitation points are stored as 0. If they attended, recitation mark must be 2-10. Students use `Grades` to view attendance, recitation mark, stored recitation points, total halaqa points, and feedback entered in the grade notes field.

Completed weeks below 70% create self-attested required sadaqa obligations when the student check-in gate evaluates prior scores; the app does not process payments, collect card details, or integrate with payment providers. Completed weeks above 90% count toward badge awards automatically. Students can view accumulated badges from `Rewards`, and admins can view the scoped Weekly follow-up populations plus the separate monthly Badge Rewards leaderboard. See [Historical reporting populations](docs/historical-reporting.md) for the exact follow-up contract and compatibility rollout note.

Known multi-masjid limitation: `weekly_incentive_runs_week_start_key` is still globally unique by
`week_start`, so only one masjid can own an incentive run for a given tracker week. Phase 1 deliberately
does not replace this production constraint. A separate reviewed migration should first audit existing
rows, then replace it with a masjid-and-week uniqueness rule and include an explicit rollout/rollback
plan.

## Legacy User Import (Validation Only)

The legacy CSV importer is quarantined. It performs local validation only and is not a production mutation
path. It does not connect to Supabase, create Auth users, update existing Auth identities, write profiles,
change roles, assign memberships, or choose/report passwords. `--mutate` and other mutation modes are
intentionally unsupported and exit before any external connection. Use the guarded application workflows
for normal user and access creation; no bulk mutation replacement is provided in this slice.

The input CSV must have exactly these columns. Only student rows are accepted for validation; teacher,
admin, and super-admin rows are rejected.

```csv
name,phone,role
Synthetic Student,+1 555 010 1000,student
Synthetic Student Two,+1 555 010 1001,student
```

A clearly synthetic sample file is available at `docs/sample-users.csv`.

Run validation with either form:

```bash
npm run import-users -- docs/sample-users.csv
npm run import-users -- --dry-run docs/sample-users.csv
```

The command needs no Supabase environment variables. It writes a local validation report to
`data/import-validation-YYYY-MM-DD-HHMMSS.csv`; the report contains only row number, validation status,
and a generic error. Keep real input files and generated reports local and never commit them.

Phone login still uses Supabase email/password internally. The validation step normalizes phone numbers and
checks the synthetic auth-email shape that a future guarded workflow may use:

- `5550101000` becomes `+15550101000`
- Auth email becomes `15550101000@itqan.local`

The contained importer never creates or updates an account, never resets an existing password, and never
mutates a profile merely because a person appears in a file. Existing passwords were intentionally not
changed by this slice; any remaining shared-password risk is a separate follow-up.

The confirmed real-data workbook was removed from the current tree. Deletion does not remove its Git
history; review `docs/PRIVACY_INCIDENT_INVENTORY.md` and `docs/HISTORY_REMEDIATION_RUNBOOK.md` for the
redacted inventory and separately approved history-remediation process.

## Deployment

See `docs/DEPLOYMENT.md` for the recommended safe deployment model, including Preview deployments, separate staging and production Supabase projects, manual production migrations, and rollback notes.

Deploy to Vercel and configure these environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` must stay server-only. Database page and action behavior uses the signed-in user's Supabase session and RLS where students read or write their own records. Checklist triggers accept only canonical task definitions, protect date/scope/attribution, and derive score columns from completion rows. Private weekly-plan file upload, replacement cleanup, and signed URL creation use the service-role key only on the server after role and target-scope checks; signed clients cannot mutate Storage objects directly. The student leaderboard uses a signed-session, minimum-field cohort RPC and does not expose peer profile IDs or raw operational rows.

Apply all files in `supabase/migrations` to the production Supabase project before using the deployed app. The weighted checklist migration keeps `public.checkins`, adds aggregate score columns, and stores each saved task snapshot in `public.checkin_items` so historical labels and weights remain stable. Never run `npm run test:rls` against production; it owns and destroys a disposable local stack.

## CI

GitHub Actions runs two independent jobs on every pull request to `main` and every push to `main`:

- `npm run check` for lint, types, unit tests, and the production build.
- `npm run test:rls` in a Docker-backed disposable local Supabase stack.

Both jobs must pass before merging authorization or database changes.

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
