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

base_ref="${UPGRADE_BASE_REF:-origin/main}"
if ! git rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
  git fetch --no-tags origin main:refs/remotes/origin/main
  base_ref="origin/main"
fi
base_commit="$(git rev-parse "${base_ref}^{commit}")"
cutoff_filename="20260731224257_temporal_teacher_week_authorization_followup.sql"
cutoff_path="supabase/migrations/${cutoff_filename}"

if ! git cat-file -e "${base_commit}:${cutoff_path}"; then
  echo "Base commit ${base_commit} is missing the required migration ${cutoff_path}." >&2
  exit 1
fi

# Every migration already present in main through the production cutoff must
# be byte-for-byte identical in the checkout. This also sees uncommitted edits.
while IFS= read -r migration_path; do
  migration_filename="${migration_path##*/}"
  if [[ "$migration_filename" > "$cutoff_filename" ]]; then
    echo "Base main contains a migration after the requested cutoff: ${migration_path}." >&2
    exit 1
  fi
  if [[ ! -f "$repo_root/$migration_path" ]]; then
    echo "Previously applied migration was removed: ${migration_path}." >&2
    exit 1
  fi
  if ! git show "${base_commit}:${migration_path}" | cmp -s - "$repo_root/$migration_path"; then
    echo "Previously applied migration was edited: ${migration_path}." >&2
    echo "Restore it and carry the behavior in a later additive migration." >&2
    exit 1
  fi
done < <(git ls-tree -r --name-only "$base_commit" supabase/migrations | rg '\.sql$' | sort)

forward_migrations=()
while IFS= read -r migration_filename; do
  forward_migrations+=("$migration_filename")
done < <(
  find "$repo_root/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -exec basename {} \; |
    sort |
    awk -v cutoff="$cutoff_filename" '$0 > cutoff'
)

if ((${#forward_migrations[@]} == 0)); then
  echo "No forward migration exists after ${cutoff_filename}." >&2
  exit 1
fi

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

git archive "$base_commit" supabase/config.toml supabase/migrations | tar -x -C "$base_root"
git archive "$base_commit" supabase/config.toml supabase/migrations | tar -x -C "$upgrade_root"
cp "$repo_root/supabase/config.toml" "$clean_root/supabase/config.toml"
for migration_path in "$repo_root"/supabase/migrations/*.sql; do
  cp "$migration_path" "$clean_root/supabase/migrations/$(basename "$migration_path")"
done

for migration_filename in "${forward_migrations[@]}"; do
  cp "$repo_root/supabase/migrations/$migration_filename" "$upgrade_root/supabase/migrations/$migration_filename"
done

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
  'private.raw_profile_access_projection(uuid,date)'
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
    'enforce_group_hierarchy_readiness'
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
  'private.raw_profile_access_projection(uuid,date)'
]::text[]) as signatures(signature)
join pg_proc as procedures on procedures.oid = to_regprocedure(signatures.signature)
cross join lateral aclexplode(coalesce(procedures.proacl, acldefault('f', procedures.proowner))) as privileges
where privileges.privilege_type = 'EXECUTE'
order by signatures.signature, privileges.grantee;
SQL
}

echo "Running pre-deployment audit against main through ${cutoff_filename}..."
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
)
upgrade_snapshot="$temp_root/upgrade-schema.snapshot"
capture_schema_snapshot "$upgrade_snapshot"

if ! cmp -s "$clean_snapshot" "$upgrade_snapshot"; then
  echo "Clean-install and production-upgrade critical schema snapshots differ." >&2
  diff -u "$clean_snapshot" "$upgrade_snapshot" >&2 || true
  exit 1
fi

echo "Clean-install and production-upgrade critical schemas match."
echo "Pre-deployment audit completed; sample redacted output:"
sed -n '1,80p' "$base_audit_output"
