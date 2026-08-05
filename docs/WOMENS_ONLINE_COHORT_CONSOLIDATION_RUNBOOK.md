# Women's Online Cohort Consolidation Runbook

Status: prepared for review and a date-gated production cutover. No production membership mutation has been performed by this operation.

This runbook prepares the consolidation of the two active women's online halaqa groups into one retained group. It preserves effective-dated history, operational scope snapshots, weekly plans, grades, reporting, and the one-primary-teacher-per-group/week assignment model.

The prepared files are:

- [`scripts/preview-womens-online-cohort-consolidation.sql`](../scripts/preview-womens-online-cohort-consolidation.sql): read-only preview, ambiguity checks, and canonical before-state digest.
- [`scripts/execute-womens-online-cohort-consolidation.sql`](../scripts/execute-womens-online-cohort-consolidation.sql): fail-closed, transactional, idempotency-aware production operation. It was not run.
- [`scripts/validate-womens-online-cohort-consolidation.sql`](../scripts/validate-womens-online-cohort-consolidation.sql): read-only post-change validation.
- [`scripts/backup-womens-online-cohort-files.ts`](../scripts/backup-womens-online-cohort-files.ts): read-only Storage download for the affected weekly-plan objects, with a manifest and SHA-256 hashes.

## Read-only finding captured on 2026-08-05

The connected Supabase project named `itqan` was inspected read-only. The project reference is `gtqszvivxkdhsjikbsns`, it reported `ACTIVE_HEALTHY`, and its remote migration list reached `20260803144609_rotation_publication_integrity`, matching the repository migration set inspected here. The project identity and environment still require human confirmation immediately before execution.

The exact candidate hierarchy is:

| Item | UUID | Observed state |
| --- | --- | --- |
| Masjid: ITQAN Online Sisters Program | `75045252-d92d-4235-8379-4fae886a8f31` | active |
| Cohort: Sisters (`kind = sisters`) | `73e33333-05a3-4af8-850c-515e61c0d04d` | active |
| Retained candidate: Group 1 | `e0be1ac1-ef0e-4448-b49f-e9bbeb6ea11c` | active, sort order 10 |
| Retired candidate: Group 2 | `7c16791c-7614-4c78-913e-6e7c7e7640e9` | active, sort order 20 |

Both groups are in the same cohort. No third active group was observed. Group 1 is the provisional retained group because it is older and has the lower stable sort order; this is not yet an approval to retain it.

The database reported Toronto civil date `2026-08-05`, current tracker week `2026-08-02`, and current halaqa Saturday `2026-08-08`.

The point-in-time canonical digest captured during this preparation was `f153358bf37ab1574565275b318405a684fc9aaf7b4221f68e7b108c8d25cab7`, covering 2 target groups, 18 membership rows, 3 assignment rows, 18 affected profiles, and 133 affected-student activity-scope rows. This digest is evidence for the preparation report only; it must not be reused as execution approval after state changes.

### Membership preview

- 18 membership rows cover 18 distinct students in the two groups.
- The current tracker-week roster is 10 students in Group 1 and 8 students in Group 2.
- All 18 rows are open-ended and effective at the proposed cutover; no future-only membership row was observed.
- Group 2 therefore has 8 source memberships to close at `2026-08-08` and replace with Group 1 memberships starting `2026-08-09`.
- The row-level `membership_id`, `student_id`, dates, `assigned_by`, and profile state are emitted by the preview script. Do not use a copied student list after the final preview; the operation recomputes and validates it under lock.

### Teacher assignment and rotation preview

- Historical Group 1 assignment: week `2026-07-19`, teacher UUID `ff28a33a-ab8b-4a0c-b22c-f66c30f894af`; its teacher staff row ended `2026-07-20`, so the preview reports a pre-existing historical Saturday-coverage warning. It is not changed.
- Historical Group 1 assignment: week `2026-07-26`, teacher UUID `0d7e01e4-a3b8-432e-ba54-921df367d48d`; Saturday coverage was present.
- Historical Group 2 assignment: week `2026-07-26`, teacher UUID `aebac095-e9d6-4ca9-980e-841a909e84c7`; Saturday coverage was present.
- No Group 2 assignment at or after `2026-08-09` was observed. No assignment for `2026-08-02` or `2026-08-09` was observed in either group.
- The active cohort rotation setting currently has `target_group_count = 2`. The prepared operation changes that setting to `1` in the same transaction and audits the change.
- Teacher availability is cohort/week-scoped, not group-scoped. The consolidation does not change availability or teacher assignments. A separate approved rotation publication is needed if the shared Group 1 needs a teacher assignment for week `2026-08-09`.

Historical assignments remain attached to their original group and week. This preserves the historical teacher identity and avoids rewriting a prior group/week or creating two primary teachers for one group/week.

### Operational and reporting dependencies

The two group snapshots contain the following rows. These rows are historical evidence and are not updated by the prepared operation.

| Table | Group 1 | Group 2 | Date/week span |
| --- | ---: | ---: | --- |
| `checkins` | 55 | 6 | `2026-07-19` through `2026-08-02` |
| `weekly_plans` | 23 | 4 | `2026-07-19` through `2026-08-02` |
| `partner_recitations` | 21 | 9 | `2026-07-19` through `2026-08-02` |
| `halaqa_grades` | 6 | 3 | `2026-07-19` through `2026-07-26` |
| `accountability_obligations` | 4 | 1 | week `2026-07-26` |
| `badge_awards` | 0 | 0 | none observed |

All 27 weekly-plan metadata rows had matching objects in the private `weekly-plans` bucket during the preview; no file bytes were changed. Their recorded metadata size totaled 7,906,971 bytes. The existing database backup helper does not back up Storage bytes, so the prepared Storage archive script is recommended before execution.

The broader affected-student audit also found pre-existing same-masjid placement mismatches in historical snapshots: 11 check-ins, 5 partner recitations, 1 halaqa grade, and 8 weekly plans. These are counted by the historical reporting disposition as same-masjid placement mismatches and must remain untouched. One older accountability obligation for week `2026-06-07` has all scope IDs null and is already excluded for lack of historical membership; it is not repaired by this operation.

Historical reporting currently has evidence for this cohort at tracker weeks `2026-07-26` and `2026-08-02`; the effective-placement preview returned 14 and 18 placement rows respectively. A cutover on `2026-08-09` leaves both existing report weeks unchanged and makes the shared Group 1 the effective placement for later weeks.

## Effective date

The original recommended effective date was Sunday `2026-08-09`. The approved immediate option may instead use the current Toronto civil date, provided it is no later than that tracker week's halaqa Saturday and all fresh-preview gates pass.

A Sunday cutover keeps the in-progress `2026-08-02` week intact. An immediate midweek cutover preserves existing Group 2 check-ins, plans, partner recitations, grades, and assignments as immutable historical snapshots, closes Group 2 memberships on the day before the cutover, and begins replacement Group 1 memberships on the approved date. Teacher roster and grading authorization resolve the membership effective on the week's halaqa Saturday, so an immediate cutover before Saturday makes Group 1 authoritative for that Saturday. The execution script refuses to mutate unless `public.current_toronto_civil_date()` is exactly the approved effective date.

If this date passes, do not run the script with an old digest. Re-run the read-only preview, obtain a new approval, take a fresh backup, and use the new digest.

## Prepared operation

The later approved execution is one `SERIALIZABLE` transaction protected by an advisory lock derived from the cohort ID. It performs these actions in order:

1. Require an active super-admin actor, an explicit confirmation token, exact hierarchy UUIDs, the approved civil date, and the digest produced by the final read-only preview.
2. Lock the masjid, cohort, both groups, the active rotation setting, affected profiles, memberships, and assignments. Recheck the hierarchy and all ambiguity conditions.
3. Abort before any write if there is a future-only Group 2 membership, an ambiguous effective placement, a retained-group overlap, a Group 2 assignment at/after cutover, a Group 2 operational snapshot at/after cutover, an unexpected rotation setting, a changed active-group topology, or a changed canonical digest.
4. Close each Group 2 membership that spans the cutover at `2026-08-08`.
5. Insert one replacement membership into Group 1 starting `2026-08-09`, preserving any finite original end date and recording the approving actor in `assigned_by`.
6. Change the active cohort rotation setting from target group count 2 to 1.
7. Call the existing guarded `apply_super_admin_hierarchy_change(...)` inside the same transaction to deactivate Group 2 without deletion and to produce the normal group audit/workflow ledger entry.
8. Verify that every affected student has exactly one effective Group 1 placement at the cutover, Group 2 has no current/future placement or assignment, the rotation target is one, and no operational row was changed.
9. Write an operation-level audit event containing the before/after state digests, source and replacement membership sets, effective date, request ID, and explicit declarations that operational snapshots and teacher assignments were not mutated.
10. Commit. Any error, stale state, constraint violation, timeout, or validation failure rolls back all database changes and audit rows.

The operation is idempotency-aware through the operation request UUID and the operation audit event. Retrying the same request and exact inputs after a committed success returns a verified `already_applied` no-op. A reused request UUID with changed inputs, an incomplete final state, or a missing audit event aborts rather than guessing.

The operation intentionally does not:

- update or delete `checkins`, `checkin_items`, `weekly_plans`, `partner_recitations`, `halaqa_grades`, `accountability_obligations`, or `badge_awards`;
- rename Group 1;
- rewrite historical memberships, teacher assignments, or scope snapshots;
- move or delete Storage objects;
- publish a new teacher assignment;
- change cohort kind, masjid state, student profiles, teacher staff memberships, or availability.

## Fresh backup procedure

No production backup has been taken for this preparation. Before execution, use an approved operator workstation, a direct link to the confirmed project, and a new off-repo destination. Keep the service-role key out of shell history and logs.

The repository’s database helper creates a schema dump and a public data-only dump:

```bash
backup_root="/secure/itqan-backups/womens-online-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_root"

BACKUP_ROOT="$backup_root/database" npm run backup:db
```

The helper is [`scripts/backup-db.sh`](../scripts/backup-db.sh). It uses `supabase db dump --linked` and writes owner-only files. Before execution, use the repository-approved CLI and confirm the linked project is the confirmed `gtqszvivxkdhsjikbsns` project. If the workstation is not linked, link it locally with the CLI’s current documented `--project-ref` command; do not change production schema or configuration.

Archive the private weekly-plan objects separately:

```bash
CONSOLIDATION_STORAGE_BACKUP_ROOT="$backup_root/storage" \
NEXT_PUBLIC_SUPABASE_URL="<confirmed-itqan-url>" \
SUPABASE_SERVICE_ROLE_KEY="<read-from-secure-secret-store>" \
CONSOLIDATION_MASJID_ID="75045252-d92d-4235-8379-4fae886a8f31" \
CONSOLIDATION_COHORT_ID="73e33333-05a3-4af8-850c-515e61c0d04d" \
CONSOLIDATION_RETAINED_GROUP_ID="e0be1ac1-ef0e-4448-b49f-e9bbeb6ea11c" \
CONSOLIDATION_RETIRED_GROUP_ID="7c16791c-7614-4c78-913e-6e7c7e7640e9" \
npm run backup:cohort-plans
```

This script only selects metadata and downloads exact object paths. It refuses unsafe paths, refuses to write inside the repository, refuses an empty affected roster, and records object size plus SHA-256 in `weekly-plan-storage-manifest.json`. It does not upload, replace, or delete Storage objects.

After both backups complete:

- verify the database dump files are non-empty and mode `600`;
- verify the Storage manifest reports the expected current rows and zero download errors;
- compute and record SHA-256 hashes for every dump, manifest, and archived object;
- encrypt the backup directory and store it outside the repository;
- record the backup timestamp and operator in the change log;
- do not proceed if the backup target, project ref, or object counts are ambiguous.

## Explicit approval gate

Execution requires written confirmation of every item below. The operation remains prepared but blocked until all are confirmed.

1. The target environment is the production project `itqan`, ref `gtqszvivxkdhsjikbsns`, not a local, staging, or unrelated project.
2. The masjid, cohort, retained group, and retired group UUIDs above are correct.
3. Group 1 is the retained group; Group 2 is the retired group. Group 1 keeps its current name. Any display rename is a separate approved change.
4. The effective date is `2026-08-09`, with writes frozen while the transaction runs.
5. The final preview’s 8 source memberships and 18-student affected roster are correct. Any changed row, student, start/end date, profile state, or extra group aborts the run.
6. The approving `actor_id` is an active super admin in the target environment.
7. The final preview digest is copied exactly to `expected_before_state_digest`; the request UUID is newly generated and recorded.
8. The rotation setting should change from target group count 2 to 1.
9. No teacher assignment is to be created or reassigned by this consolidation. A separate rotation publication may be run after cutover for week `2026-08-09`.
10. The historical Group 1 assignment warning for week `2026-07-19` is accepted as pre-existing and left unchanged.
11. The database and Storage backup locations, hashes, encryption, and recovery owner are confirmed.
12. The operator has a rollback decision owner and understands that a post-cutover rollback must not delete operation-created membership rows after new activity exists.

## Rollback and recovery

Before commit, the only rollback is the transaction itself: stop on any error and confirm that no operation audit event exists and no source membership was closed.

After a committed run:

- If no post-cutover activity exists, freeze writes, take another backup, inspect the operation audit event, and obtain explicit approval before restoring the exact prior source `ends_on` values, changing the rotation setting back to 2, deleting only the exact operation-created replacement membership IDs, and reactivating Group 2 through the guarded hierarchy workflow. Do not use a broad delete or delete by group alone.
- If any post-cutover check-in, plan, recitation, grade, obligation, badge, or other scope evidence exists, do not naively delete replacement memberships or reopen source intervals. Preserve the new history and use a reviewed forward corrective operation, or use an approved Supabase point-in-time restore with a write freeze and full loss assessment.
- The Storage archive is independent of a database restore. A database restore may restore plan metadata without restoring file bytes; use the archived Storage files only through an approved recovery procedure.
- Vercel rollback is not a database rollback. Do not deploy or change application code as part of this data operation.

## Post-change validation

Run [`scripts/validate-womens-online-cohort-consolidation.sql`](../scripts/validate-womens-online-cohort-consolidation.sql) with the same confirmed UUIDs, effective date, and operation request UUID. All checks must be `PASS`:

- masjid and cohort remain active;
- exactly one active group remains and it is Group 1; Group 2 remains present but inactive;
- every affected student has exactly one effective Group 1 placement at `2026-08-09`;
- no Group 2 membership or assignment is current/future;
- rotation target group count is one;
- the operation audit event exists and declares no operational/teacher-assignment mutation;
- no post-cutover operational snapshot points at Group 2;
- weekly-plan object presence remains intact.

Then perform the application audit checklist:

- open the admin roster for the Sisters cohort and confirm all 18 students appear once in the retained group;
- open the student detail pages for the moved students and verify current weekly plans, history, grades, leaderboard participation, and CSV output;
- verify the current `2026-08-02` history still attributes records to the original Group 1/Group 2 snapshots;
- verify a new `2026-08-09` plan/check-in path resolves to Group 1 after the cutover;
- publish a separate teacher assignment only if approved, and verify the exact group/week still has at most one active primary teacher;
- inspect the super-admin audit events for the hierarchy change, rotation-setting update, and consolidation operation;
- retain the final validation output, backup hashes, request UUID, actor UUID, and operator timestamp.

## Known limitations and remaining unknowns

- The read-only project connection established the likely production identifiers, but a human must confirm the environment immediately before execution.
- The live preview is a point-in-time report captured on 2026-08-05 and is not an execution authorization. The final preview/digest must be taken immediately before the fresh backup.
- The production backup command was prepared and shell-reviewed but has not yet been executed; backups must be fresh at the date-gated cutover.
- Storage bytes are not included in the existing database logical backup; the prepared Storage archive is therefore required if weekly-plan files must be recoverable.
- The historical invalid assignment and same-masjid placement mismatches predate this operation. They are surfaced for human acknowledgement and are intentionally not repaired here.
- No migration or application feature change is required for the prepared operation. If the project later needs a first-class UI/API workflow for this consolidation, that should be a separately reviewed schema/app change.
