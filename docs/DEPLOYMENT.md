# Deployment

This app should use manual, reviewable deployments for now. Do not add automated production deployment or automated production database migrations until staging has been proven reliable.

## Environments

Use three separate environments:

- `local`: developer machine, local `.env.local`, and a disposable or development Supabase project.
- `staging`: Vercel Preview deployments and a staging Supabase project with non-production data.
- `production`: Vercel Production deployment from `main` and a production Supabase project with real user data.

Staging and production should use separate Supabase projects. Do not point Preview deployments at the production database.

## Vercel Deployments

Vercel Preview deployments should be enabled for pull requests and branches. Preview deployments are for review, QA, and staging verification before merging to `main`.

Vercel Production should deploy from `main` only. Merge approved pull requests to `main` after the
deterministic `npm run check` job and separate Docker-backed `npm run test:rls` job pass, then let Vercel
create the production deployment from that commit.

Do not add GitHub Actions deployment workflows for this app yet. GitHub Actions may run checks, but production deployment should remain controlled through Vercel's Git integration.

## Login Abuse Monitoring

Supabase Auth provides its own authentication limits, but `/api/login` also performs an active-profile
lookup before password authentication. Use a Vercel Firewall rule as an additional edge safeguard so
abusive traffic can be identified before it consumes application, database, or Auth capacity.

Start with a monitoring-only rate-limit rule:

- Path equals `/api/login`
- Method equals `POST`
- Environment equals `production`
- Counting key: IP address
- Fixed window: 300 seconds
- Initial threshold: 100 requests per window
- Exceeded action: log only

The initial threshold is intentionally generous because many legitimate users may share one masjid
Wi-Fi address. Publish the rule in log-only mode, then review at least one week that includes normal
high-attendance periods. Confirm matching traffic is genuinely excessive before changing the exceeded
action to `rate_limit` (`429`). Do not add database-backed account lockouts for this workflow.

The equivalent Vercel CLI draft command is:

```bash
vercel firewall rules add "Monitor ITQAN login attempts" \
  --condition '{"type":"path","op":"eq","value":"/api/login"}' \
  --condition '{"type":"method","op":"eq","value":"POST"}' \
  --condition '{"type":"environment","op":"eq","value":"production"}' \
  --action rate_limit \
  --rate-limit-window 300 \
  --rate-limit-requests 100 \
  --rate-limit-keys ip \
  --rate-limit-action log \
  --yes
```

Firewall rule changes are staged as drafts. Inspect `vercel firewall diff` and have a project owner run
`vercel firewall publish --yes`; application deployments do not publish firewall drafts. To roll back,
change the exceeded action to `log`, disable the rule, review the diff, and publish that rollback. Never
log passwords, full phone numbers, synthetic Auth emails, cookies, or tokens while investigating login
traffic.

## Environment Variables

Configure these variables in each Vercel environment and in local `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it in browser code, logs, or client-side configuration.

Use values from the staging Supabase project for Vercel Preview deployments. Use values from the production Supabase project for Vercel Production.

## Storage

Each Supabase project used by the app must have the private weekly plan Storage bucket configured:

- Bucket name: `weekly-plans`
- Public access: off/private
- Recommended file size limit: 3 MB
- Recommended allowed MIME types: `image/png`, `image/jpeg`, `application/pdf`

Storage configuration must be created separately in staging and production.

## Database Migrations

All database schema changes must be stored as migration files under `supabase/migrations`.

Use this process for every database change:

1. Create a migration.
2. Run `npm run test:rls` against its disposable local Supabase stack and run `npm run check`.
3. Apply the migration to staging.
4. Verify the app against staging.
5. Apply the migration to production manually.

Production database migrations should not be automated until staging has a reliable history of catching migration and app compatibility issues.

`npm run test:rls` is a local/CI destructive harness for its own disposable stack. Never configure or
adapt it to target staging or production.

Apply migrations with the Supabase CLI or the Supabase SQL editor in filename order. Avoid dashboard schema edits except for emergencies, and capture any emergency schema change in a migration afterward.

### Attendance-aware Saturday session-roster backend

The session-roster and teacher-session migrations are additive and depend on the canonical availability foundation:

1. Apply `20260806144640_student_rotation_availability.sql` (from the availability foundation branch)
   before `20260806170351_session_roster_backend_foundation.sql`. Do not copy or rewrite the availability
   migration; the session-roster migration only adds its own tables, locks, triggers, contracts, grants,
   and audit/version metadata.
2. Apply `20260806185342_teacher_session_authorization_read_api.sql` after the session-roster foundation.
   It adds the published-session teacher capability/read contracts, exact session grade snapshots, and
   the same-scope weekly-plan/checklist protections. It does not grant teacher access to drafts,
   superseded versions, permanent memberships, or super-admin sessions.
3. Apply `20260806190708_session_roster_refresh_recovery.sql` after the teacher-session migration. This
   additive function/constraint replacement adds only the stale-draft recovery state and service RPC;
   it does not drop tables/columns or mutate production/source rows. It replaces the explicit security
   definer inventory, so the next reconciliation migration is required.
4. Apply `20260807001300_teacher_session_authorization_refresh_reconciliation.sql` before the final
   privacy/legacy-roster amendment. It restores the
   complete teacher-session security-definer inventory after the refresh migration's copied replacement;
   it does not change the authorization predicates or data model.
5. Apply `20260807032835_teacher_session_privacy_and_legacy_roster_reconciliation.sql` last. It narrows
   only the raw checklist SELECT policies to scoped admin/super-admin access, revokes the permanent-
   membership `teacher_group_roster_context` endpoint for every role, and leaves
   `can_read_operational_student_row(...)` and the published-session RPCs unchanged.
6. Apply `20260808130925_rotation_teacher_wizard_amendment.sql`, then
   `20260808154200_rotation_teacher_wizard_review_amendment.sql`. The first is the focused wizard
   amendment; the second adds the bounded smaller-count v2 contract, immutable participant snapshot,
   legacy-draft preview/transition, and the corresponding authorization/grant reconciliation. Both are
   additive and must be applied in filename order. Before any staging or production apply, run the read-only
   `scripts/report-rotation-legacy-drafts.sql` report and explicitly review each affected cohort/week.
7. Apply `20260808175048_rotation_wizard_availability_confirmation.sql` last. It adds one sparse
   cohort/week confirmation row, atomically records student/teacher confirmation in the existing
   availability RPCs, extends readiness, and adds scoped last-published-primary context. It does not
   rewrite availability ledgers or published history. Run the read-only confirmation preflight in
   `docs/ROTATION_WIZARD_CONFIRMATIONS.md` before enabling the wizard UI.
8. Before staging, run `npm run test:rls`, `npx supabase db lint --local --schema public --level warning
   --fail-on error`, and `npx supabase db advisors --local --type all --level warn --fail-on error` against
   a disposable local stack. The advisor command may report existing warnings on legacy tables and the
   public `btree_gist` extension; treat new findings from this migration as release blockers.
9. Apply all nine migrations to staging, verify the normal-admin draft/review/publish flow and the
   explicit stale-draft refresh/review flow for an explicitly selected cohort, and verify that signed
   browser clients cannot write roster tables or execute the mutation RPCs. Also verify direct teacher
   reads of raw checkins/checkin_items are denied, the sanitized checklist RPC succeeds, the legacy roster
   RPC is denied before/during/after publication, the confirmed smaller-count path preserves cohort-wide
   co-teacher access without a primary highlight, and the legacy-draft transition preserves the live
   publication. Confirm that the existing availability and teacher-rotation flows remain unchanged.
10. Back up production, apply the same migration order manually, run the catalog/RLS smoke checks, and
   deploy application code only after the schema is ready. This backend slice does not backfill drafts,
   versions, memberships, grades, plans, or teacher assignments; production remains unchanged until an
   admin explicitly uses the existing application workflow. Deploy matching server actions/routes only
   after all nine migrations are applied and the catalog assertion confirms the teacher-session grants,
   participant snapshot grants, transition grants, and legacy/raw-checklist restrictions. No migration is
   applied to production by this PR.

The migration keeps published versions immutable and has no destructive down migration. If the new flow
has a problem, pause session-roster calls, leave the availability and existing teacher-rotation paths in
place, preserve any published snapshots for audit, and ship a forward-fix migration. Do not delete
published/superseded rows or roll back by mutating permanent memberships/assignments. A revision or
forward refresh fix is the supported way to correct a published Saturday roster after the current version
is reviewed. Do not reverse the constraint replacement on a live database merely to hide a failed refresh;
preserve the audit trail and use a reviewed forward fix.

### Below-70 streak reset backend

Apply `20260809185224_below70_streak_reset.sql` after
`20260808175048_rotation_wizard_availability_confirmation.sql`, then apply
`20260810031942_below70_streak_read_privacy.sql` after the reset migration, then apply
`20260810131306_below70_positive_streak_reset_eligibility.sql` after the privacy migration. The first
creates the append-only reset ledger, typed read RPCs, the scoped reset RPC, immutable-row triggers, and
the audit uniqueness guard; the second is a forward-fix for read projections and batch authorization; the
third safely replaces the previous-streak check and reset guard so any positive active streak is eligible
after passed-test confirmation. The first two migrations are already part of the production baseline; do
not apply the new forward-fix migration to production as part of this PR.

Use database-first deployment for staging and any later production rollout:

1. Run `npm run test:rls`, `npm run test:rls:upgrade`, `npx supabase db lint --local --schema public --level warning --fail-on error`, and `npx supabase db advisors --local --type all --level warn --fail-on error` against disposable/local databases.
2. Apply the new forward-fix after the two production-baseline migrations in filename order to staging, then verify the catalog grants, typed read rows, positive-streak reset path, zero-streak denial, failed-test denial, replay behavior, and historical grade immutability.
3. Deploy the matching server code only after the migration and catalog checks pass. The later Terra UI must consume the typed contracts documented below rather than writing `below70_streak_resets` directly.

There is no destructive rollback. If a deployment issue occurs, roll back the app server code while
leaving reset rows and audit history intact, pause the reset action, and ship a reviewed forward-fix
migration. Never delete reset rows, audit events, or historical grades to simulate a rollback. A forward
fix may correct validation or read behavior; it must preserve the append-only ledger and the existing
`request_id`/student-week uniqueness guarantees.

## Rollback

App rollback is handled through Vercel. If a deployment is bad, promote or roll back to the last known good Vercel deployment, then smoke test login, student check-in, admin dashboard, and CSV export.

Database rollback is separate from app rollback. Vercel cannot roll back Supabase schema or data. Every risky migration needs an explicit reverse migration or a restore plan before it is applied to production.

When a database migration causes a production issue, prefer a forward-fix migration if it is safer than reversing the original change.
