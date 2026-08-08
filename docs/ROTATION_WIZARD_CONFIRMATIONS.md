# Rotation wizard availability confirmations

This is an additive backend contract for the sequential Saturday rotation wizard. It records one
confirmation row per `(cohort_id, week_start)`; it does not materialize attending student rows or
replace the existing sparse absence and teacher-availability ledgers.

## Read-only preflight

After the migration is present in a disposable or staging database, use this report before enabling
the wizard application code. It identifies an untouched source separately from a confirmed
all-attending source:

```sql
select
  cohorts.masjid_id,
  confirmations.cohort_id,
  confirmations.week_start,
  confirmations.student_availability_confirmed_at is not null as student_confirmed,
  confirmations.teacher_availability_confirmed_at is not null as teacher_confirmed,
  coalesce(absences.absence_count, 0) as sparse_absence_count,
  coalesce(teachers.available_teacher_count, 0) as available_teacher_count,
  confirmations.student_availability_revision,
  confirmations.teacher_availability_revision
from public.session_roster_wizard_confirmations as confirmations
join public.cohorts on cohorts.id = confirmations.cohort_id
left join (
  select cohort_id, week_start, count(*)::integer as absence_count
  from public.student_rotation_availability
  group by cohort_id, week_start
) as absences using (cohort_id, week_start)
left join (
  select cohort_id, week_start, count(*) filter (where available)::integer as available_teacher_count
  from public.teacher_rotation_availability
  group by cohort_id, week_start
) as teachers using (cohort_id, week_start)
order by cohorts.masjid_id, confirmations.cohort_id, confirmations.week_start;
```

A cohort/week with no confirmation row remains an untouched, unconfirmed state. A confirmation row
with `student_confirmed = true` and `sparse_absence_count = 0` is the deliberate all-attending state.

## Deployment order

Apply migrations in filename order, then deploy the matching server code:

1. `20260806144640_student_rotation_availability.sql`
2. `20260806170351_session_roster_backend_foundation.sql`
3. `20260806185342_teacher_session_authorization_read_api.sql`
4. `20260806190708_session_roster_refresh_recovery.sql`
5. `20260807001300_teacher_session_authorization_refresh_reconciliation.sql`
6. `20260807032835_teacher_session_privacy_and_legacy_roster_reconciliation.sql`
7. `20260808130925_rotation_teacher_wizard_amendment.sql`
8. `20260808154200_rotation_teacher_wizard_review_amendment.sql`
9. `20260808175048_rotation_wizard_availability_confirmation.sql`

Run the disposable RLS suite, migration-order/upgrade harness, schema lint, catalog grant assertions,
and the read-only preflight query before staging. Deploy the application only after step 9 is
successful. Existing availability RPC signatures remain unchanged; their responses gain confirmation
revision fields, and the wizard response gains authoritative confirmation readiness and additive
last-published-primary fields.

## Rollback and forward fix

There is no destructive down migration. If the wizard contract has a problem, pause new wizard
generation/review/publication calls, keep the current published version and legacy availability flows
live, and roll back only the application deployment if needed. Do not delete confirmation rows,
availability rows, drafts, versions, memberships, grades, plans, or audit history. Correct database
behavior with a reviewed forward-fix migration, preserving the same cohort/week lock, service-only
RPC grants, dependency invalidation, and RLS boundaries.
