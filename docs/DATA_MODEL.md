# Data Model

## profiles

- `id`: Supabase Auth user UUID.
- `name`
- `email`: internal synthetic auth email.
- `phone`: optional display-only phone.
- `role`: `student | teacher | admin | super_admin`
- `active`
- `created_at`

`profiles.role` is a routing/default-experience hint. Scoped authorization comes from membership and assignment tables plus Supabase RLS.

## Multi-Masjid Scope

The scope hierarchy is:

```text
masajid
  -> cohorts: brothers | sisters
    -> halaqa_groups
      -> student_group_memberships
      -> group_teacher_assignments
```

Core tables:

- `masajid`: masjid name, slug, active flag.
- `cohorts`: brothers/sisters cohort inside one masjid.
- `halaqa_groups`: operational student groups inside one cohort.
- `student_group_memberships`: historical student-to-group membership with `starts_on` and optional `ends_on`.
- `masjid_staff_memberships`: admin/teacher membership in one masjid.
- `group_teacher_assignments`: one teacher assigned to one group for one tracker `week_start`.
- `teacher_rotation_availability`: per-teacher, per-cohort weekly availability for Saturday halaqa rotation.
- `cohort_rotation_settings`: active rotation configuration for a cohort, including target stable group count.
- `teacher_rotation_runs`: audit metadata for generated weekly rotation runs.
- `super_admin_audit_events`: append-only audit target for future super-admin mutations and account recovery actions.

Internal transactional state lives in the unexposed `private` schema:

- `workflow_mutation_requests`: completed service-workflow requests keyed by caller-generated UUID. It stores the normalized input and result so an exact retry returns the original result without duplicating memberships or audit events. It has no browser or service-role table grants; only the guarded definer functions can use it.
- `workflow_expected_state_snapshots`: binds a staff-grant request UUID to its stable desired inputs and original canonical access snapshot, so a committed response can be replayed after the target state changes.
- `masjid_update_requests`: stores stable masjid-update inputs and committed results for exact replay without repeating the hierarchy update or audit event.

Server-side helper functions expose narrow caller-relative views used by the app:

- `student_weekly_teacher_name(week_start)`: returns only the signed-in student's assigned teacher display name.
- `teacher_assignment_contexts()`: returns only the signed-in teacher's effective assignments with safe masjid/cohort/group labels and roster counts.
- `teacher_group_roster_context(group_id, week_start)`: returns only active students effective in the caller's exact assigned group/week, with student ID/name and capped daily-check-in and partner-recitation aggregates. It never returns contact details, notes, or raw records.
- `can_teacher_read_weekly_plan_path(path)`: authorizes a weekly-plan Storage path only when its metadata, student membership, and the caller's exact group/week assignment agree.
- `student_cohort_leaderboard_for_week(week_start)`: returns the minimum documented same-cohort leaderboard projection without peer UUIDs or contact details.
- `student_leaderboard_available_weeks()`: returns weeks with activity in the signed-in student's effective cohort.
- `admin_students_for_week(week_start)`: returns active students only in masajid the signed-in admin currently serves.
- `cohort_masjid_id(cohort_id)`: returns a cohort's masjid only when the caller can read that cohort.

The superseded `student_weekly_teacher(student_id, week_start)` and
`student_cohort_students_for_week(student_id, week_start)` functions remain in the schema for migration
compatibility but have no browser-role execute grant.

Service-only transactional functions added for Phase 1A and used by the Phase 1B server actions:

- `apply_scoped_user_setup(...)`: validates the Auth user, actor, active hierarchy, and masjid scope before creating the profile, one student/teacher membership, and one audit event atomically.
- `get_scoped_user_setup_request_result(...)`: validates the current actor and exact original setup payload before returning a completed request result. This lets an identical form retry finish without creating a second Auth user.
- `get_scoped_user_setup_auth_recovery(...)`: resolves an Auth-only identity only when its trusted Auth metadata exactly matches the setup request UUID, actor, normalized email, and complete canonical setup payload. It never exposes Auth identity lookup to browser roles.
- `get_person_access_state(actor_id, target_profile_id)`: returns a canonical profile/membership snapshot only after verifying that the passed actor is currently an active super admin.
- `apply_super_admin_access_change(...)`: locks and compares that snapshot, derives the access transition in PostgreSQL, writes profile/membership/audit changes atomically, and protects the last active super admin and last active admin of an active masjid.
- `apply_super_admin_masjid_staff_grant(...)`: atomically promotes an active person, reconciles student access, inserts the requested admin and/or teacher memberships, and writes all audit events using an idempotent request ledger and canonical stale-state check.
- `prepare_super_admin_masjid_staff_grant(...)`: captures or replays the original canonical access snapshot for one stable staff-grant request before the mutation RPC runs.
- `apply_super_admin_staff_membership_end(...)`: closes one open staff membership and writes its audit event in the same transaction after checking the canonical snapshot, date, target relationship, and continuous future admin-coverage invariant.
- `apply_super_admin_masjid_update(...)`: atomically updates masjid fields and active state, writes the audit event, rejects stale state, and prevents activation without continuous admin coverage.

All transactional functions are denied to `PUBLIC`, `anon`, and `authenticated` and granted only to
`service_role`. Their passed actor IDs are treated as untrusted input and revalidated from current
database state inside each call.

## Weekly Rotation Foundation

Stable student groups are separate from weekly teacher availability. Admins intentionally rebalance
`student_group_memberships` when group sizes need to change; weekly availability does not rebalance
students automatically.

Rotation tables:

- `teacher_rotation_availability`: stores whether a teacher is available for one cohort and tracker week. Availability is opt-in: rows default to unavailable until an admin marks the teacher available. It is unique on `teacher_id`, `cohort_id`, and `week_start`, and `week_start` must be the Sunday tracker week start. Rows must reference an active teacher with an active teacher staff membership for the masjid during that week.
- `cohort_rotation_settings`: stores one active rotation setting row per cohort. `target_group_count` must be positive.
- `teacher_rotation_runs`: stores generation counts for audit: available teachers, groups, assignments, and warnings.

RLS is conservative: active admins for the scoped masjid manage rotation data. Teachers may read only
their own availability rows.

## Scoped Operational Records

These student-owned operational tables snapshot scope with nullable `masjid_id`, `cohort_id`, and `halaqa_group_id` columns so historical reporting stays correct after group moves:

- `checkins`
- `weekly_plans`
- `partner_recitations`
- `halaqa_grades`
- `accountability_obligations`
- `badge_awards`

`checkin_items` does not duplicate scope initially because each item belongs to a scoped `checkins` row.

## Existing Student Records

Existing data is backfilled into:

- Masjid: `Toronto Islamic Centre (TIC)`
- Cohort: `brothers`
- Group: `TIC Brothers Default Group`

Existing admins receive TIC admin staff memberships. Existing active students receive historical group memberships starting on `1900-01-01` so past records can resolve scope.

## Rules

- Phone numbers are globally unique across masajid.
- One check-in per student per date.
- One partner-recitation record per student, week, and round.
- One halaqa grade per student and week.
- One weekly plan per student and plan week.
- One active/effective student group membership per student for a date range.
- One active/effective staff membership per profile, masjid, staff role, and date range.
- One teacher assignment per halaqa group and tracker week.
- One teacher availability row per teacher, cohort, and tracker week.
- One active rotation settings row per cohort.
- Students can only view and submit their own records. Student leaderboard rows are limited to the student's cohort for the selected week.
- Student checklist items must match the canonical task key/label/weight for the date. Database triggers protect check-in identity, scope, date, and attribution and recalculate score-bearing columns from task completion.
- Active students without an effective group membership see setup-incomplete screens and cannot create check-ins, weekly plans, or partner recitations.
- Admin app queries and mutations are scoped by masjid membership. Phase 0 also tightens direct Data API write policies so normal admins cannot grant admin access, mutate global foundation setup, or change other masajid through broad RLS.
- Signed super-admin sessions are read-capable but cannot directly mutate profiles or student/staff membership history through the Data API. Super-admin access writes use the guarded service-only transactional functions.
- An active masjid must have gap-free admin coverage from the current effective date through every future membership boundary, ending in at least one open-ended active admin membership. Inactive masajid are exempt until reactivated.
- Active super admins can read `super_admin_audit_events`; browser/client writes to the audit table are not exposed.
- Normal admins close or deactivate membership/assignment rows instead of deleting foundation history. Direct signed-session deletes of student and staff membership history are denied, including for super admins.
- Teachers are scoped by assigned group/week and can grade/view weekly plans only for students whose membership is effective in that exact assignment.
