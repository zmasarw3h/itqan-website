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

Server-side helper functions expose narrow scoped views used by the app:

- `student_weekly_teacher(student_id, week_start)`: returns the assigned teacher display name for that student's group/week.
- `student_cohort_students_for_week(student_id, week_start)`: returns student names in the same cohort for the student-facing leaderboard.
- `admin_students_for_week(week_start)`: returns active students in masajid the signed-in admin serves.
- `cohort_masjid_id(cohort_id)`: resolves a cohort to its masjid for scoped RLS checks.

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
- Active students without an effective group membership see setup-incomplete screens and cannot create check-ins, weekly plans, or partner recitations.
- Admin app queries and mutations are scoped by masjid membership. The initial foundation migration still keeps older broad admin RLS policies until the scoped-RLS phase.
- Teachers are eventually scoped by assigned group/week and can grade/view weekly plans only for assigned students.
