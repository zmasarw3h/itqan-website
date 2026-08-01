# Access-transition semantics

This document is the source of truth for staff-access transitions. It applies to
the super-admin Guided Change flow, the masjid-level staff form, direct staff
membership-ending workflows, and the database RPCs behind them.

## Two different operations

The masjid page provides additive grants:

- Add admin access
- Add teacher access
- Add admin + teacher access

An additive grant inserts only missing staff capabilities at the selected
masjid. It never ends a staff membership, removes access at another masjid, or
silently converts a student placement. The form previews the current masjid
state, resulting masjid state, and current/future global role before submission.
If all selected capabilities are already present, the operation is reported as
a no-op.

Guided Change provides selected-masjid replacement:

- Set Teacher only
- Set Admin only
- Set Admin + Teacher

Replacement affects the selected masjid only. The first two operations end the
opposite capability at the selected effective boundary. The third ensures both
capabilities and removes nothing. Access at every other masjid remains intact.

Student placement and account deactivation remain separate replacement
operations. They close the affected staff capabilities in the same transaction;
they do not delete historical rows except for an unstarted same-day row where a
new effective-dated row would otherwise overlap it.

## Current role projection

For non-super-admin profiles, `profiles.role` is the cached current
primary/default application experience. The authoritative projection uses
`public.current_effective_date()` and the effective, active membership windows:

1. `admin` when any active admin staff membership exists at an active masjid;
2. otherwise `teacher` when any active teacher staff membership exists;
3. otherwise `student` when an active student placement exists;
4. otherwise the profile is inactive.

An admin-teacher keeps `profiles.role = 'admin'`; the teacher capability is
still proved by the scoped teacher membership and, for teacher workflows, the
exact group/week assignment. A future membership does not change the current
role or current active flag before its `starts_on` date. The projection is
recomputed by membership triggers, guarded mutations, and the authenticated
session refresh used when loading a profile.

The role is a routing/default-experience value, not authorization by itself.
RLS and server-side checks continue to require the relevant masjid, cohort,
group, week, membership, and assignment scope.

## Boundaries and deactivation

Membership windows are inclusive: a membership ending on a date is effective
through that date. Direct membership-ending therefore accepts an inclusive
`ends_on` date and rejects ending teacher access before an active assignment's
Saturday halaqa event.

Account deactivation is immediate on the current application date. It removes
current access on that date, closes effective memberships at the preceding
date, and marks same-day not-yet-started rows inactive when needed to preserve
the date constraints. Future-dated global deactivation is rejected. A later
future membership that cannot be cancelled without rewriting its history is
reported as a guarded dependency and must be resolved through a separate
future-cancellation workflow.

## Teacher assignment safety

Every guarded teacher-membership closure checks active assignments for the same
masjid. A teacher capability cannot end before an assigned week's Saturday
halaqa event. This check is enforced in PostgreSQL for:

- Set Admin only;
- student conversion;
- account deactivation; and
- direct membership-ending.

Set Teacher only retains or creates teacher capability; it does not remove a
teacher membership, so existing teacher assignments remain valid.

Assignments are not silently deleted or reassigned. The operator must resolve
the assignment or choose an inclusive end date that covers its event.

## Atomicity and auditability

Each staff-access transition uses the existing request ledger, expected-state
comparison, transaction locks, and guarded service-role RPCs. Membership
changes, the projected profile state, admin-coverage checks, and audit events
commit together or roll back together. Retries with the same request UUID
return the original result; a changed canonical state requires a fresh review.

No production deployment or data mutation is part of this slice. Apply the
migration through the normal deployment process only after local checks and a
review of the draft pull request.
