# Admin Overhaul Independent Review Policy

This policy applies at the end of every admin-overhaul phase.

## Independence

- The reviewer must not have authored or edited the phase deliverables.
- The reviewer receives the agreed phase brief, the actual artifacts or code diff, source evidence, and test results.
- The reviewer evaluates the work directly rather than reviewing a summary from the producing agents.
- The reviewer does not edit the deliverables. The main agent owns triage and remediation.

## Severity rubric

### P0 — stop-ship

A P0 is limited to:

- an authorization or scope escape;
- exposure of credentials or service-role material;
- likely irreversible loss or corruption of operational data;
- an unsafe destructive action without a reliable confirmation or recovery boundary;
- a critical admin workflow that cannot be completed at all;
- a design or implementation direction that fundamentally contradicts the agreed product scope.

### P1 — must fix before the phase closes

A P1 is limited to:

- a preserved admin capability missing from the model, design, prototype, or implementation;
- a likely path to saving or publishing a state different from the one the admin reviewed;
- ambiguous masjid, cohort, student, or week scope that could cause action in the wrong context;
- a major recurring workflow that remains structurally one-record-at-a-time when the phase explicitly requires operational throughput;
- a core workflow that is unusable on the supported mobile viewport or inaccessible by keyboard/assistive technology;
- a material regression in student, teacher, admin-teacher, admin, or super-admin behavior;
- missing server-side authorization, RLS, atomicity, idempotency, or stale-state protection required by the operation;
- missing verification evidence for a high-risk workflow.

### P2 — record and defer

A P2 is a meaningful usability, consistency, accessibility, performance, or maintainability issue that does not meet the P0/P1 thresholds.

### P3 — record and defer

A P3 is polish, wording, visual refinement, or low-impact consistency work.

## Review loop

1. Freeze the phase deliverables and evidence.
2. Have a fresh reviewer report findings with severity, evidence, violated requirement, and the minimum sufficient remediation.
3. The main agent validates each finding against the rubric.
4. Fix every confirmed P0 and P1.
5. Do not intentionally fix P2 or P3 findings.
6. If a P0/P1 fix unavoidably resolves a lower-severity issue, disclose the incidental effect.
7. Send the revised deliverables and remediation notes back to the same reviewer.
8. Repeat until the reviewer reports zero open P0/P1 findings.
9. Close the phase with deferred P2/P3 findings listed separately.

## Phase-specific review evidence

- **Phase 1 — operating model:** audit traceability, capability coverage, context rules, route preservation, state/security invariants, and a usable Phase 2 brief.
- **Phase 2 — visual directions:** direct comparison with audit screenshots and requirements, critical-state coverage, responsive intent, and selection clarity.
- **Phase 3 — prototype:** working critical interactions, realistic states, desktop/mobile evidence, and no misleading or dead-end primary actions.
- **Phase 4 — production implementation:** code diff, server/RLS boundaries, migrations, atomicity, regression tests, and screenshot comparison.
- **Phase 5 — release verification:** complete role regression, production build, deployment readiness, known limitations, and rollback/recovery evidence.
