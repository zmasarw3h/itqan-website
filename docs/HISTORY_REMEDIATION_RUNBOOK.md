# Repository History Remediation Runbook

This runbook is for a separately approved privacy-incident response. It was not executed by this slice.

## Affected path

The confirmed path is `data/itqan_admin_add.xlsx`. It was added by commit
`f1a7ec58865fa974a8b1ce2af6d82eed7fa8ecd6` and is reachable from the inspected `main` descendants.
Current-tree deletion removes the path from new checkouts only; it does not remove old commits, blob
objects, raw URLs, repository archives, forks, or existing clones.

## Approval and preservation

1. Assign an incident owner and obtain written approval from the repository owner, privacy/security owner,
   and any required legal or compliance contacts before rewriting remote history.
2. Preserve a restricted, access-controlled evidence copy and record the affected commit/path, discovery
   date, repository visibility, known refs, and operator actions. Do not place the evidence copy in the
   repository or a shared issue/PR.
3. Inventory active branches, tags, open pull requests, forks, mirrors, CI caches, release archives, and
   local clones. Decide whether any copies require separate notification or deletion.
4. Coordinate a maintenance window and a communication list before changing the remote.

## Rewrite options

The preferred technical option is a fresh mirror clone followed by a reviewed `git filter-repo` rewrite
that removes the exact affected path. If additional confirmed sensitive import artifacts are found, add
only those exact paths after review; do not use an unbounded pattern without approval. A Git hosting support
request may also be required to expire cached views, raw URLs, pull-request refs, or repository archives.

Do not run BFG, `git filter-repo`, force-pushes, tag deletion, or branch deletion as part of this branch.
History rewriting changes commit IDs and is not equivalent to the current-tree deletion already made.

## Branch, tag, fork, and clone implications

- Every rewritten descendant commit receives a new ID.
- All affected branches and tags must be mapped, reviewed, and either rewritten or intentionally left as
  documented historical refs; leaving a reachable ref preserves the old object.
- Open pull requests, branch protections, release automation, deployment references, and commit-based
  integrations must be rechecked after the rewrite.
- Forks, mirrors, downloaded archives, and third-party caches may retain the old object outside the main
  repository's control and need owner-specific communication.
- Existing clones should not simply continue from the old history. Provide replacement-clone guidance,
  remove old refs, expire reflogs, and run repository garbage collection according to the approved policy.
  When practical, invalidate or replace clones that may be redistributed.

## Post-rewrite verification

Run from a fresh clone of the rewritten remote and capture results without printing file contents:

1. Verify the affected path is absent from every intended branch and tag.
2. Search reachable objects with `git rev-list --objects --all` for the exact path and any separately
   approved related paths.
3. Inspect remote branch/tag listings, pull-request refs, release archives, and hosting-provider cache
   status for the old commit/path.
4. Confirm the application build, deployment source, backups, and CI artifacts do not reintroduce the file.
5. Record verification commit IDs, commands, timestamps, and any remaining external copies.

## Communication and closure

Notify contributors, fork/mirror owners, deployment operators, and affected repository administrators of
the maintenance window, new base commit, replacement-clone instructions, and the fact that current-tree
deletion did not itself erase history. Keep the incident inventory redacted. Close the remediation only
after the approved verification is complete and the remaining credential/privacy follow-ups are assigned.
