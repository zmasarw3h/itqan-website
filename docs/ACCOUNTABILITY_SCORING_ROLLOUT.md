# Accountability scoring boundary rollout

This rollout separates immediate student access from the first official scored
Sunday. It preserves the existing Sadaqa self-attestation gate for genuinely
eligible completed weeks below 70%.

## Required order

1. Run `npm run check` and `npm run test:rls` against the release commit.
2. Back up production and apply these migrations in filename order:
   `20260724020959_contain_accountability_scope.sql`,
   `20260724021627_add_student_score_start.sql`, then
   `20260724022500_reconcile_score_start_security_definers.sql`.
3. Verify the new column, constraints, function grants, empty function search
   paths, and existing RLS policies before deploying application code.
4. Run only the read-only phases of
   `scripts/accountability-score-start-repair.sql`. Review every affected
   student with the stakeholder. Do not infer official scoring dates in bulk.
5. After approval, run the malformed-obligation repair and the explicitly
   populated scoring-boundary repair in separate reviewed transactions.
   Malformed or pre-boundary obligations are waived with audit notes; they are
   never marked paid or silently deleted.
6. Deploy the matching application commit only after the migrations and
   reviewed repair succeed.

## Verification

- A new student has orientation access immediately and can upload a weekly
  plan or explore check-ins before `score_starts_on`.
- Orientation activity does not appear in scores, streaks, rewards,
  leaderboard weeks, or Sadaqa obligations.
- A legitimate post-boundary completed week below 70% creates a scoped pending
  obligation and blocks the next check-in.
- The student can choose “Yes, I paid”; the obligation persists as
  `attested_paid` through the existing student RLS policy.
- Rotation and group transfer operations do not alter `profiles.score_starts_on`.
- Review the audit event for every super-admin correction and repair.

## Rollback posture

The migrations are additive. If application rollout fails, roll back the app
while leaving the schema in place, then prepare a forward fix. Do not drop the
column, constraints, functions, or audit history as an emergency rollback.
