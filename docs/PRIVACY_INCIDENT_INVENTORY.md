# Privacy Incident Inventory (Redacted)

This inventory records repository artifacts without reproducing names, phone numbers, email addresses,
or workbook contents. File contents were not copied into source, tests, logs, screenshots, or commits.

## Confirmed and related artifacts

| Affected path | File type | Current tree | Git history | Possible exposure surfaces | Recommended operator action | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `data/itqan_admin_add.xlsx` | Excel workbook | No; removed on `codex/privacy-importer-containment` | Yes; path was added by commit `f1a7ec58865fa974a8b1ce2af6d82eed7fa8ecd6` and is reachable from the inspected `main` descendants | Public repository tree before this change, raw/blob URLs, repository archives, clones, forks, CI/build caches, and local copies | Treat the workbook as exposed. Preserve incident evidence in an approved restricted location, coordinate history remediation separately, and assess any external copies. | Current-tree removal complete; history remediation pending approval |
| `data/itqan_admin_add.csv` | CSV import input | No; local ignored artifact only | No path history found | Local worktrees, operator transfer paths, or accidental staging if ignore rules are bypassed | Treat as potentially sensitive, do not commit, and quarantine/delete only under the operator's approved data-retention process. | Local-only artifact observed; not part of this branch |
| `data/itqan_student_list.csv`, `data/itqan_student_list2.csv`, `data/itqan_student_list3.csv` | CSV import inputs | No; local ignored artifacts only | No path history found | Local worktrees, operator transfer paths, or accidental staging if ignore rules are bypassed | Treat as potentially sensitive, do not commit, and quarantine/delete only under the operator's approved data-retention process. | Local-only artifacts observed; not part of this branch |
| `data/itqan_new_student.csv` | CSV import input | No; local ignored artifact only | No path history found | Local worktrees, operator transfer paths, or accidental staging if ignore rules are bypassed | Treat as potentially sensitive, do not commit, and quarantine/delete only under the operator's approved data-retention process. | Local-only artifact observed; not part of this branch |
| `data/import-results-*.csv` | Generated importer report | No; ignored local artifacts only | No path history found | Local worktrees, local report sharing, or accidental staging if ignore rules are bypassed | Do not generate reports from real data until the replacement workflow is approved; quarantine/delete existing reports under the operator's approved process. | Local-only report pattern observed; legacy output removed |
| `docs/sample-users.csv` | CSV fixture | Yes; synthetic only | Yes | Source checkouts and documentation review | Keep only clearly synthetic values; do not replace it with an operational export. | Retained as safe validation fixture |

No other tracked Excel workbook or spreadsheet import path was found in reachable repository history during
the trace. The confirmed workbook had no source or documentation reference, was not under `public/`, and
had no copy rule in the Next.js or deployment configuration. It was therefore not an application runtime
dependency, browser asset, or documented download route; repository and build-source access remained the
relevant exposure surfaces.

## Reference trace

The legacy importer and its documentation were referenced by:

- `package.json` (`import-users` script entry);
- `scripts/import-users.ts` (local command implementation);
- `lib/import-users.ts` (CSV parsing and validation helpers);
- `test/import-users.test.ts` (import helper tests);
- `README.md` and `docs/OPERATIONS.md` (operator instructions); and
- `docs/sample-users.csv` (synthetic example).

There was no reference to the confirmed workbook path itself. The importer was not called by an app route,
server action, Next.js build step, or deployment script.
