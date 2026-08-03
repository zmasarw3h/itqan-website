#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

# Database-first compatibility proof for the staged Slice 5 rollout. It builds
# the current main migration tree, adds only the forward Slice 5 migration,
# then runs the disposable RLS fixture. That fixture calls the exact legacy
# RPC shape used by the currently deployed application for both a valid
# available teacher and invalid/missing availability, and also exercises the
# new prepare/apply path against the same database.

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
supabase_cli="$repo_root/node_modules/.bin/supabase"
slice_migration="20260803144609_rotation_publication_integrity.sql"
base_ref="${ROTATION_COMPAT_BASE_REF:-origin/main}"

if [[ ! -x "$supabase_cli" ]]; then
  echo "Repository-local Supabase CLI is missing; run npm ci first." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Rotation compatibility testing requires a running Docker daemon." >&2
  exit 1
fi

if ! git rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
  git -C "$repo_root" fetch --no-tags origin main:refs/remotes/origin/main
  base_ref="origin/main"
fi
base_commit="$(git -C "$repo_root" rev-parse "${base_ref}^{commit}")"

if git -C "$repo_root" cat-file -e "${base_commit}:supabase/migrations/${slice_migration}" 2>/dev/null; then
  echo "Compatibility base ${base_commit} already contains ${slice_migration}." >&2
  echo "Choose the pre-Slice-5 deployment base with ROTATION_COMPAT_BASE_REF." >&2
  exit 1
fi

if [[ ! -f "$repo_root/supabase/migrations/$slice_migration" ]]; then
  echo "Slice 5 migration is missing: $slice_migration" >&2
  exit 1
fi

temp_root="$(mktemp -d -t itqan-rotation-compat.XXXXXX)"
stack_root="$temp_root/upgrade"
active_project_root=""

cleanup() {
  if [[ -n "$active_project_root" ]]; then
    (cd "$active_project_root" && "$supabase_cli" stop --no-backup >/dev/null 2>&1 || true)
  fi
  rm -rf "$temp_root"
}
trap cleanup EXIT INT TERM

mkdir -p "$stack_root"
git -C "$repo_root" archive "$base_commit" supabase/config.toml supabase/migrations | tar -x -C "$stack_root"
cp "$repo_root/supabase/migrations/$slice_migration" "$stack_root/supabase/migrations/$slice_migration"

# This private stack never shares a project ID, volumes, or ports with the
# normal RLS harness or any other workspace.
sed -i.bak \
  -e 's/^project_id = ".*"/project_id = "itqan-rotation-compat"/' \
  -e 's/^port = 54321$/port = 58321/' \
  -e 's/^port = 54322$/port = 58322/' \
  -e 's/^shadow_port = 54320$/shadow_port = 58320/' \
  "$stack_root/supabase/config.toml"
rm -f "$stack_root/supabase/config.toml.bak"

active_project_root="$stack_root"
(cd "$stack_root" && "$supabase_cli" start)
(cd "$stack_root" && "$supabase_cli" db lint --local --schema public --level warning --fail-on error)

docker exec -i supabase_db_itqan-rotation-compat \
  psql --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
  < "$repo_root/scripts/test-rls-grants.sql"

eval "$(cd "$stack_root" && "$supabase_cli" status -o env)"
(
  export RLS_SUPABASE_URL="$API_URL"
  export RLS_SUPABASE_ANON_KEY="$ANON_KEY"
  export RLS_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
  export RLS_DB_CONTAINER="supabase_db_itqan-rotation-compat"
  cd "$repo_root"
  "$repo_root/node_modules/.bin/tsx" scripts/test-rls.ts
)

echo "Rotation publication database-first compatibility passed from ${base_commit} plus ${slice_migration}."
