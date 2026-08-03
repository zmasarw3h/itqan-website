#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
supabase_cli="$repo_root/node_modules/.bin/supabase"

if [[ ! -x "$supabase_cli" ]]; then
  echo "Repository-local Supabase CLI is missing; run npm ci first." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Upgrade-path RLS suite requires a running Docker daemon (Docker Desktop or Colima)." >&2
  exit 1
fi

if [[ -n "${UPGRADE_BASE_REF:-}" ]]; then
  base_ref="$UPGRADE_BASE_REF"
  if ! git rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
    echo "Explicitly configured UPGRADE_BASE_REF does not resolve: ${base_ref}." >&2
    exit 1
  fi
else
  base_ref="origin/main"
fi
if [[ -z "${UPGRADE_BASE_REF:-}" ]] && ! git rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
  git fetch --no-tags origin main:refs/remotes/origin/main
fi
base_commit="$(git rev-parse "${base_ref}^{commit}")"

base_migrations=()
while IFS= read -r migration_path; do
  base_migrations+=("$migration_path")
done < <(git ls-tree -r --name-only "$base_commit" supabase/migrations | rg '\.sql$' | sort)

if ((${#base_migrations[@]} == 0)); then
  echo "Configured base ${base_ref} (${base_commit}) contains no migrations." >&2
  exit 1
fi

# The configured commit is the immutable base: every migration it contains
# must still exist at the same path with identical bytes in this checkout.
for migration_path in "${base_migrations[@]}"; do
  if [[ ! -f "$repo_root/$migration_path" ]]; then
    echo "Base migration was deleted or renamed: ${migration_path}." >&2
    exit 1
  fi
  if ! git show "${base_commit}:${migration_path}" | cmp -s - "$repo_root/$migration_path"; then
    echo "Base migration was modified: ${migration_path}." >&2
    echo "Restore it and carry the behavior in a later additive migration." >&2
    exit 1
  fi
done

forward_migrations=()
while IFS= read -r migration_path; do
  if ! git cat-file -e "${base_commit}:${migration_path}" 2>/dev/null; then
    forward_migrations+=("$migration_path")
  fi
done < <(
  find "$repo_root/supabase/migrations" -maxdepth 1 -type f -name '*.sql' |
    sed "s#^$repo_root/##" |
    sort
)

if ((${#forward_migrations[@]} == 0)); then
  echo "No forward migration exists relative to ${base_ref} (${base_commit})." >&2
  exit 1
fi

echo "Upgrade base: ${base_ref} (${base_commit})"
echo "Base migrations selected (${#base_migrations[@]}):"
printf '  %s\n' "${base_migrations[@]}"
echo "Forward migrations selected (${#forward_migrations[@]}):"
printf '  %s\n' "${forward_migrations[@]}"

# Assert the deployed base contract that Phase A must preserve. The current
# application performs server-side direct inserts and both pending and
# auto-waive recalculations through the service-role client.
base_accountability_source="$(git show "${base_commit}:lib/weekly-incentives.ts")"
if [[ "$base_accountability_source" != *'.from("accountability_obligations")'* ]] \
  || [[ "$base_accountability_source" != *'.insert({'* ]] \
  || [[ "$base_accountability_source" != *'.update({'* ]] \
  || [[ "$base_accountability_source" != *'status: "waived"'* ]] \
  || [[ "$base_accountability_source" != *'Auto-waived after automatic score recalculation >= 70'* ]]; then
  echo "Configured base no longer has the expected legacy accountability write contract." >&2
  exit 1
fi
echo "Verified legacy direct insert/update application contract at ${base_commit}."

temp_root="$(mktemp -d -t itqan-access-upgrade.XXXXXX)"
base_root="$temp_root/base"
clean_root="$temp_root/clean"
upgrade_root="$temp_root/upgrade"
mkdir -p "$base_root" "$clean_root/supabase/migrations" "$upgrade_root"

cleanup() {
  if [[ -n "${active_project_root:-}" ]]; then
    (cd "$active_project_root" && "$supabase_cli" stop --no-backup >/dev/null 2>&1 || true)
  fi
  # This directory is disposable test state created by this script.
  rm -rf "$temp_root"
}
trap cleanup EXIT INT TERM

project_id="$(sed -n 's/^project_id = "\(.*\)"/\1/p' "$repo_root/supabase/config.toml")"
if [[ -z "$project_id" ]]; then
  echo "Unable to determine the local Supabase project id." >&2
  exit 1
fi
db_container="supabase_db_${project_id}"

git archive "$base_commit" | tar -x -C "$base_root"
git archive "$base_commit" supabase/config.toml supabase/migrations | tar -x -C "$upgrade_root"
cp "$repo_root/supabase/config.toml" "$clean_root/supabase/config.toml"
for migration_path in "$repo_root"/supabase/migrations/*.sql; do
  cp "$migration_path" "$clean_root/supabase/migrations/$(basename "$migration_path")"
done

for migration_path in "${forward_migrations[@]}"; do
  mkdir -p "$upgrade_root/$(dirname "$migration_path")"
  cp "$repo_root/$migration_path" "$upgrade_root/$migration_path"
done

# Build the exact deployed application source against the installed dependency
# tree before applying Slice 4. This proves the compatibility fixture is tied
# to a buildable current-main contract, not only to matching source snippets.
ln -s "$repo_root/node_modules" "$base_root/node_modules"
(cd "$base_root" && npm run build >/dev/null)
echo "Built exact base application contract at ${base_commit}."

active_project_root=""
start_stack() {
  active_project_root="$1"
  (cd "$active_project_root" && "$supabase_cli" stop --no-backup >/dev/null 2>&1 || true)
  (cd "$active_project_root" && "$supabase_cli" start)
}

stop_stack() {
  if [[ -n "$active_project_root" ]]; then
    (cd "$active_project_root" && "$supabase_cli" stop --no-backup)
    active_project_root=""
  fi
}

capture_schema_snapshot() {
  local snapshot_path="$1"
  docker exec -i "$db_container" psql \
    --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
    --no-psqlrc --tuples-only --no-align > "$snapshot_path" <<'SQL'
select 'function|' || signatures.signature || E'\n' || pg_get_functiondef(procedures.oid)
from unnest(array[
  'public.apply_super_admin_hierarchy_change(uuid,uuid,text,uuid,uuid,uuid,text,text,integer,boolean,jsonb)',
  'public.prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)',
  'public.apply_super_admin_access_change(uuid,uuid,uuid,text,date,uuid,uuid,jsonb)',
  'public.apply_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date,jsonb)',
  'public.apply_super_admin_staff_membership_end(uuid,uuid,uuid,uuid,date,jsonb)',
  'public.historical_reporting_available_weeks()',
  'public.historical_reporting_students_for_weeks(date[])',
  'public.student_historical_reporting_scope_for_week(date)',
  'public.student_cohort_leaderboard_for_week(date)',
  'public.student_leaderboard_available_weeks()',
  'public.reconcile_historical_accountability_obligation(uuid,date)',
  'public.enforce_student_accountability_attestation()',
  'public.set_student_scope_snapshot()',
  'public.validate_accountability_obligation_scope()',
  'private.raw_profile_access_projection(uuid,date)',
  'private.raw_historical_activity_scope_matches(uuid,date,uuid,uuid,uuid)',
  'private.raw_can_open_current_student_profile(uuid,uuid)',
  'private.raw_historical_report_week_scopes()',
  'private.raw_historical_weekly_percentage(uuid,date)'
]::text[]) as signatures(signature)
join pg_proc as procedures on procedures.oid = to_regprocedure(signatures.signature)
order by signatures.signature;

select 'trigger|' || namespaces.nspname || '.' || relations.relname || '|' || triggers.tgname || E'\n'
  || pg_get_triggerdef(triggers.oid)
from pg_trigger as triggers
join pg_class as relations on relations.oid = triggers.tgrelid
join pg_namespace as namespaces on namespaces.oid = relations.relnamespace
where not triggers.tgisinternal
  and triggers.tgname in (
    'project_staff_membership_profile_access',
    'project_student_membership_profile_access',
    'project_masjid_profile_access',
    'project_cohort_profile_access',
    'project_group_profile_access',
    'enforce_staff_grant_preview_transition',
    'enforce_masjid_hierarchy_readiness',
    'enforce_cohort_hierarchy_readiness',
    'enforce_group_hierarchy_readiness',
    'enforce_student_accountability_attestation_trigger',
    'set_accountability_obligations_scope_snapshot_trigger',
    'validate_accountability_obligation_scope_trigger'
  )
order by namespaces.nspname, relations.relname, triggers.tgname;

select 'policy|' || schemaname || '.' || tablename || '|' || policyname || E'\n'
  || permissive || '|' || array_to_string(roles, ',') || '|' || cmd || '|'
  || coalesce(qual, '') || '|' || coalesce(with_check, '')
from pg_policies
where schemaname = 'public'
order by schemaname, tablename, policyname;

select 'grant|' || signatures.signature || '|' ||
  case when privileges.grantee = 0 then 'PUBLIC' else privileges.grantee::regrole::text end || '|'
  || privileges.privilege_type
from unnest(array[
  'public.apply_super_admin_hierarchy_change(uuid,uuid,text,uuid,uuid,uuid,text,text,integer,boolean,jsonb)',
  'public.prepare_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date)',
  'public.apply_super_admin_access_change(uuid,uuid,uuid,text,date,uuid,uuid,jsonb)',
  'public.apply_super_admin_masjid_staff_grant(uuid,uuid,uuid,uuid,text,date,jsonb)',
  'public.apply_super_admin_staff_membership_end(uuid,uuid,uuid,uuid,date,jsonb)',
  'public.historical_reporting_available_weeks()',
  'public.historical_reporting_students_for_weeks(date[])',
  'public.student_historical_reporting_scope_for_week(date)',
  'public.student_cohort_leaderboard_for_week(date)',
  'public.student_leaderboard_available_weeks()',
  'public.reconcile_historical_accountability_obligation(uuid,date)',
  'public.enforce_student_accountability_attestation()',
  'public.set_student_scope_snapshot()',
  'public.validate_accountability_obligation_scope()',
  'private.raw_profile_access_projection(uuid,date)',
  'private.raw_historical_activity_scope_matches(uuid,date,uuid,uuid,uuid)',
  'private.raw_can_open_current_student_profile(uuid,uuid)',
  'private.raw_historical_report_week_scopes()',
  'private.raw_historical_weekly_percentage(uuid,date)'
]::text[]) as signatures(signature)
join pg_proc as procedures on procedures.oid = to_regprocedure(signatures.signature)
cross join lateral aclexplode(coalesce(procedures.proacl, acldefault('f', procedures.proowner))) as privileges
where privileges.privilege_type = 'EXECUTE'
order by signatures.signature, privileges.grantee;
SQL
}

echo "Running pre-deployment audit against exact base ${base_ref} (${base_commit})..."
start_stack "$base_root"
base_audit_output="$temp_root/pre-deployment-audit.txt"
docker exec -i "$db_container" psql \
  --set ON_ERROR_STOP=1 --username postgres --dbname postgres --no-psqlrc \
  < "$repo_root/scripts/audit-access-transition-rollout.sql" > "$base_audit_output"
stop_stack

echo "Building the clean final migration tree..."
start_stack "$clean_root"
clean_snapshot="$temp_root/clean-schema.snapshot"
capture_schema_snapshot "$clean_snapshot"
stop_stack

echo "Building the production upgrade path from main plus forward migrations:"
printf '  %s\n' "${forward_migrations[@]}"
start_stack "$upgrade_root"
(cd "$upgrade_root" && "$supabase_cli" db lint --local --schema public --level warning --fail-on error)
docker exec -i "$db_container" psql \
  --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
  < "$repo_root/scripts/test-rls-grants.sql"
eval "$(cd "$upgrade_root" && "$supabase_cli" status -o env)"
(
  export RLS_SUPABASE_URL="$API_URL"
  export RLS_SUPABASE_ANON_KEY="$ANON_KEY"
  export RLS_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
  cd "$repo_root"
  npx --no-install tsx scripts/test-rls.ts
  npx --no-install tsx scripts/test-historical-report-rollout-compatibility.ts
)
upgrade_snapshot="$temp_root/upgrade-schema.snapshot"
capture_schema_snapshot "$upgrade_snapshot"
historical_audit_output="$temp_root/historical-population-audit.txt"
docker exec -i "$db_container" psql \
  --set ON_ERROR_STOP=1 --username postgres --dbname postgres --no-psqlrc \
  < "$repo_root/scripts/seed-historical-report-audit-fixtures.sql" >/dev/null
docker exec -i "$db_container" psql \
  --set ON_ERROR_STOP=1 --username postgres --dbname postgres --no-psqlrc \
  < "$repo_root/scripts/audit-historical-report-populations.sql" > "$historical_audit_output"
for audit_section in checkins partner_recitations halaqa_grades accountability_obligations paid_or_waived_obligation_scope_mismatches; do
  if ! rg -q "$audit_section" "$historical_audit_output"; then
    echo "Historical audit did not enumerate fixture section: ${audit_section}." >&2
    exit 1
  fi
done
if ! rg -q 'scores_changed_by_scope_exclusion[[:space:]]+\|[[:space:]]+[1-9]' "$historical_audit_output"; then
  echo "Historical audit did not count scores changed by malformed activity exclusion." >&2
  exit 1
fi
query_plan_output="$temp_root/historical-population-query-plans.txt"
docker exec -i "$db_container" psql \
  --set ON_ERROR_STOP=1 --username postgres --dbname postgres --no-psqlrc \
  < "$repo_root/scripts/explain-historical-report-populations.sql" > "$query_plan_output"

if ! cmp -s "$clean_snapshot" "$upgrade_snapshot"; then
  echo "Clean-install and production-upgrade critical schema snapshots differ." >&2
  diff -u "$clean_snapshot" "$upgrade_snapshot" >&2 || true
  exit 1
fi

echo "Clean-install and production-upgrade critical schemas match."
echo "Pre-deployment audit completed; sample redacted output:"
sed -n '1,80p' "$base_audit_output"
echo "Historical population audit completed; sample ID-only fixture output:"
sed -n '1,80p' "$historical_audit_output"
echo "Historical scope mismatch fixture sections:"
rg 'checkins|partner_recitations|halaqa_grades|accountability_obligations|paid_or_waived|scores_changed_by_scope_exclusion' "$historical_audit_output" | tail -20
echo "Historical population query plans completed; bounded fixture summary:"
rg 'Execution Time|actual time=.*rows=' "$query_plan_output" | tail -20
