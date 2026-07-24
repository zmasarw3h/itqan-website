# ITQAN Lite Admin Experience Audit

Date: July 23, 2026  
Branch: `codex/super-admin-console-overhaul`  
Viewport coverage: 1440 × 900 desktop and 390 × 844 mobile  
Accounts used: scoped “Mock Admin” and scoped “Test Admin Teacher (TIC)”

## Executive assessment

The admin experience is functionally broad and mostly operational, but it is not yet a coherent weekly operations workspace. The dashboard is a useful scoreboard; the rest of the recurring work is distributed across a long per-student page, separate rotation workflow, and table-heavy reports. The result is a high amount of navigation, scrolling, and context reconstruction for routine work.

No P0 blocker was found. Three P1 problems materially affect accuracy or task completion:

1. Rotation can show unsaved availability selections alongside a stale assignment preview and an apparently available Publish action.
2. High-frequency grading, correction, plan, and recitation work is only reachable one student at a time through a very long mixed-purpose detail page.
3. The core dashboard table is not usable at a 390 px viewport without horizontal overflow; status text is clipped and the Open action is off-screen.

## P1 findings

### 1. Rotation mixes unsaved selections with a stale publish state

**Evidence:** [11-rotation-unsaved-selection.png](11-rotation-unsaved-selection.png), [12-rotation-stale-preview.png](12-rotation-stale-preview.png)

After “Select all,” Step 2 reports 4 of 4 teachers selected, but Step 3 continues to warn that fewer teachers are available than groups and keeps every proposed teacher unassigned. This is because the selection has not yet been saved. The interface does not clearly mark the availability changes as unsaved, and “Publish assignments” remains visually available.

This is more than a polish issue: an admin can reasonably interpret the whole page as one current draft and publish assignments based on stale persisted availability.

### 2. Recurring student operations are fragmented into one-record-at-a-time work

**Evidence:** [01-admin-dashboard-desktop.png](01-admin-dashboard-desktop.png), [02-student-detail-overview.png](02-student-detail-overview.png), [03-student-weekly-actions.png](03-student-weekly-actions.png), [04-plan-correction-danger.png](04-plan-correction-danger.png), [05-student-danger-zone.png](05-student-danger-zone.png)

The dashboard provides an “Open” action per student, but grading, partner recitation, weekly-plan review, correction, and account deletion all live on the individual student page. For the audited cohort of 29 students, completing recurring weekly work requires repeatedly opening records, finding the relevant section in a long page, acting, returning, and locating the next student.

The information is present, but the interaction cost scales poorly with cohort size and increases the chance of losing one’s place.

### 3. The mobile dashboard loses core columns and the row action

**Evidence:** [17-mobile-dashboard.png](17-mobile-dashboard.png)

At 390 × 844, the desktop table remains wider than the viewport. Status text is visibly clipped and the Student Page action is outside the visible area. The screen does not visibly explain that the table can be scrolled horizontally. A mobile admin can see the leading score columns but cannot immediately complete the primary row action.

## P2 findings

### 4. The student page mixes monitoring, routine edits, and destructive actions in one long flow

**Evidence:** [02-student-detail-overview.png](02-student-detail-overview.png), [03-student-weekly-actions.png](03-student-weekly-actions.png), [04-plan-correction-danger.png](04-plan-correction-danger.png), [05-student-danger-zone.png](05-student-danger-zone.png), [20-mobile-student-detail.png](20-mobile-student-detail.png)

The page moves from weekly status to recitation, grading, plan access, manual correction, and permanent deletion. The sections are individually understandable, but their combined length makes orientation difficult—especially on mobile—and places a destructive account action in the same scroll context as routine weekly operations.

The delete safeguard itself is strong: it requires the exact student name and keeps the destructive action disabled until confirmation. See [06-delete-confirmation.png](06-delete-confirmation.png).

### 5. Administrative scope is not consistently visible

**Evidence:** [01-admin-dashboard-desktop.png](01-admin-dashboard-desktop.png), [07-add-user-form.png](07-add-user-form.png), [21-admin-teacher-navigation.png](21-admin-teacher-navigation.png)

The header identifies the person but not the masjid or active administrative scope. Rotation is the exception: it explicitly shows Toronto Islamic Centre and the cohort. On the dashboard and Add User flow, an admin with more than one active masjid membership would have little persistent confirmation of where the work applies.

This creates a context-risk problem as multi-masjid administration grows, even though the audited account was scoped to one masjid.

### 6. Dashboard export does not communicate its relationship to active filters

**Evidence:** [01-admin-dashboard-desktop.png](01-admin-dashboard-desktop.png)

Search and the below-70 filter are client-side view controls, while the Export CSV link only contains the selected week. There is no indication whether export means all students for the week or the currently filtered result. The current URL confirms the export is week-scoped but not search- or below-70-scoped.

### 7. Add User relies on browser validation and has inconsistent readiness cues

**Evidence:** [07-add-user-form.png](07-add-user-form.png), [08-add-teacher-form.png](08-add-teacher-form.png)

Student creation correctly remains disabled until a placement is chosen. Teacher mode, however, shows an enabled Create user action even with empty required fields. Submitting focuses the browser-native required field, but the audited state did not expose an inline error or `aria-invalid` state.

The mode switch therefore changes both the fields and the apparent validation model without explaining the difference.

### 8. Halaqa grading presents contradictory zero/non-zero values

**Evidence:** [03-student-weekly-actions.png](03-student-weekly-actions.png)

When attendance is “No,” the recitation input is disabled but still displays `50`, while the summary correctly reads `Recitation points: 0 / 50` and `Halaqa grade 0 / 150`. The stored/effective value and the visible field value disagree, which makes the grading rule harder to trust.

### 9. Incentives and rewards are table-heavy and weakly triaged

**Evidence:** [14-incentive-report.png](14-incentive-report.png), [15-rewards-leaderboard.png](15-rewards-leaderboard.png)

Both pages render successfully, but the reports present long lists with little support for finding exceptions, narrowing the cohort, or separating actionable records from zero/no-award rows. The summary cards on Incentives help, but the transition from totals to action is unclear. Rewards has less filtering support than the main dashboard.

### 10. Mobile navigation works visually, but its exposed semantics are weak

**Evidence:** [18-mobile-menu.png](18-mobile-menu.png)

The menu is readable, keyboard focus is visible, and every admin destination is present. In the accessibility snapshot, however, the trigger is exposed as a generic “Menu” rather than a button. That can make its interactive role less clear to assistive technology.

## P3 findings

### 11. Password change offers little preventive guidance

**Evidence:** [16-change-password.png](16-change-password.png)

The form is simple, but it does not show password requirements, provide visibility controls, or help users understand whether a proposed password will be accepted before submission.

### 12. Personal phone numbers dominate operational tables

**Evidence:** [01-admin-dashboard-desktop.png](01-admin-dashboard-desktop.png), [15-rewards-leaderboard.png](15-rewards-leaderboard.png)

Phone numbers appear directly beneath student names throughout the main administrative views. They can help disambiguate people, but they add visual density and expose personal data even when the current task is grading or performance review.

### 13. Date context is accurate but requires mental translation across workflows

**Evidence:** [01-admin-dashboard-desktop.png](01-admin-dashboard-desktop.png), [09-rotation-overview.png](09-rotation-overview.png), [03-student-weekly-actions.png](03-student-weekly-actions.png)

The dashboard uses a Sunday–Saturday week range, Rotation foregrounds the Saturday date, and the student page mixes the week range with daily rows. These are logically consistent, but an admin has to translate between tracker week, selected week, and halaqa Saturday while moving among pages.

## Workflow health

| Workflow or state | Result | Notes |
|---|---|---|
| Admin login | Healthy | Scoped Mock Admin authenticated successfully. |
| Admin dashboard load | Healthy with issues | Ranking and weekly metrics load; information density and mobile overflow remain. |
| Dashboard search | Healthy | “Yusuf” reduced the result to 1 of 29 and clearing restored the list. |
| Week and below-70 controls | Healthy with evidence limits | Controls render; all current-week records were already below 70, limiting meaningful filter contrast. |
| CSV export | Partially verified | Link is present and week-scoped; no file download was retained during the audit. |
| Student overview | Healthy with issues | Status is clear; page is long and mixed-purpose. |
| Partner recitation | Healthy with evidence limits | Existing state rendered; no test mutation was saved. |
| Halaqa grading | Needs attention | Form renders, but disabled recitation value conflicts with effective score. |
| Weekly plan access | Healthy with evidence limits | Existing plan area rendered; no upload or replacement was performed. |
| Manual correction | Healthy with risk | Form is available; no correction was submitted. |
| Delete student safeguard | Healthy | Exact-name confirmation and cancel flow worked; no deletion occurred. |
| Add student | Healthy with issues | Placement requirements are clear. |
| Add teacher | Needs attention | Enabled-empty submit relies on native validation and lacks clear inline feedback. |
| Rotation: cohort/week navigation | Healthy | Brothers and Sisters states, Previous/This Saturday/Next, and readiness content rendered. |
| Rotation: Sisters empty state | Healthy | Clearly reports zero groups/students and unset target. |
| Rotation: availability to publish | Unhealthy | Unsaved availability and stale assignment preview can coexist with Publish appearing available. |
| Incentives | Healthy with issues | Summary and report load; exception-finding is weak. |
| Rewards | Healthy with issues | Leaderboard loads; long low-signal table and limited filtering. |
| Change password | Healthy with issues | Form renders; preventive guidance is limited. |
| Mobile navigation | Healthy with accessibility concern | Menu opens and destinations are available; trigger semantics are generic. |
| Mobile dashboard | Unhealthy | Core status/action columns are clipped or off-screen. |
| Mobile student detail | Healthy with issues | Layout stacks cleanly, but the already-long workflow becomes more burdensome. |
| Admin-teacher capability switch | Healthy | “Teaching” appears only for the admin-teacher and opens the assigned-groups experience successfully. |

## Engineering/security observation

During local development, the Next.js server action trace printed the submitted phone number and password arguments for the login action into terminal output. The audit passwords were immediately rotated again after testing, and both test sessions were signed out. This was observed in development output rather than the production UI, but credentials should not appear in developer logs.

## Evidence limits

- The audit used one single-masjid admin and one admin-teacher at Toronto Islamic Centre. Multi-masjid context switching could not be evaluated with the audited account.
- No student data, grades, recitation state, rotation state, user record, or password belonging to a real user was changed.
- Destructive and externally visible actions were not completed.
- The audit did not include a screen reader session, automated contrast scan, production network latency, or a retained CSV download.
- Screenshots show representative states, not every row of long tables or every point on the student detail page.

## Screenshot inventory

1. [Admin dashboard, desktop](01-admin-dashboard-desktop.png)
2. [Student detail overview](02-student-detail-overview.png)
3. [Student weekly actions](03-student-weekly-actions.png)
4. [Plan and correction area](04-plan-correction-danger.png)
5. [Student danger zone](05-student-danger-zone.png)
6. [Delete confirmation safeguard](06-delete-confirmation.png)
7. [Add student form](07-add-user-form.png)
8. [Add teacher form](08-add-teacher-form.png)
9. [Rotation overview](09-rotation-overview.png)
10. [Rotation teachers and assignments](10-rotation-teachers-assignments.png)
11. [Rotation unsaved selection](11-rotation-unsaved-selection.png)
12. [Rotation stale preview](12-rotation-stale-preview.png)
13. [Rotation Sisters empty state](13-rotation-sisters-empty-state.png)
14. [Incentive report](14-incentive-report.png)
15. [Rewards leaderboard](15-rewards-leaderboard.png)
16. [Change password](16-change-password.png)
17. [Admin dashboard, mobile](17-mobile-dashboard.png)
18. [Mobile navigation](18-mobile-menu.png)
19. [Rotation, mobile](19-mobile-rotation.png)
20. [Student detail, mobile](20-mobile-student-detail.png)
21. [Admin-teacher navigation](21-admin-teacher-navigation.png)
