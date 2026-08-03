# Historical reporting populations

ITQAN reports separate viewer authorization from report population.

- Authorization is current: a normal admin sees history only for masajid they actively administer on `current_toronto_civil_date()`. A super admin sees all report scopes. A student must be signed in through an active student profile and sees only a cohort they belonged to in the selected week.
- Population is historical: every canonical Sunday is resolved independently from `student_group_memberships.starts_on <= week_start` and a null or inclusive `ends_on >= week_start`. Later profile role/activity and hierarchy activity do not remove the row.
- Scoring eligibility is separate: `profiles.score_starts_on` must be non-null and no later than the report week. Population absence and scoring ineligibility produce no score row; an eligible row with no activity keeps the existing zero/missing score behavior.
- Contact projection is current: historical-only admins receive the current display name and metrics, but null phone/email and false profile-link flags unless the student is also in an active current student scope administered by that viewer. Super admins retain global visibility.
- Activity is accepted only when its immutable masjid, cohort, and group snapshot matches the effective membership for that student/week.

`historical_reporting_students_for_weeks(date[])` validates Sundays, deduplicates inputs, enforces current caller scope, and returns deterministic ordering. Application loaders page the batch result and activity queries beyond the Data API row cap, while chunking student filters. Operational current-roster loaders remain separate.

Accountability reconciliation remains a server-only workflow. PostgreSQL recomputes the authoritative historical weekly percentage, validates population and scoring eligibility, and atomically creates, refreshes, or auto-waives a pending row. Paid and already-waived obligations are not changed.

Monthly badge leaderboards use the union of students scoring-eligible in at least one completed week belonging to the selected month. A displayed student's lifetime total is the sum of all computed badge awards from completed, historically eligible weeks visible in the caller's current reporting scope—not merely today's roster and not a global total outside that scope.

Historical names are not versioned in this slice. Reports display the currently stored profile, group, cohort, and masjid names for the historical IDs. Saturday-key weekly-plan remediation is also intentionally deferred.
