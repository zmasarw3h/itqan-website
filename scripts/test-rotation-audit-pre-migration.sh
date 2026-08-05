#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

# The production audit must run before the Slice 5 migration as well as after
# it. Build the post-Slice-4 migration base without the Slice 5 file and run
# the checked-in audit unchanged against that disposable database.

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
supabase_cli="$repo_root/node_modules/.bin/supabase"
slice_migration="20260803144609_rotation_publication_integrity.sql"
base_ref="${ROTATION_AUDIT_COMPAT_BASE_REF:-e233b29c2b0c27b17e837080a5d323507d39a636}"

if [[ ! -x "$supabase_cli" ]]; then
  echo "Repository-local Supabase CLI is missing; run npm ci first." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Rotation audit compatibility testing requires a running Docker daemon." >&2
  exit 1
fi

if ! git -C "$repo_root" rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
  git -C "$repo_root" fetch --no-tags origin main:refs/remotes/origin/main
fi
base_commit="$(git -C "$repo_root" rev-parse "${base_ref}^{commit}")"

if git -C "$repo_root" cat-file -e "${base_commit}:supabase/migrations/${slice_migration}" 2>/dev/null; then
  echo "Audit compatibility base ${base_commit} already contains ${slice_migration}." >&2
  exit 1
fi

temp_root="$(mktemp -d -t itqan-rotation-audit-compat.XXXXXX)"
stack_root="$temp_root/base"

cleanup() {
  (cd "$stack_root" && "$supabase_cli" stop --no-backup >/dev/null 2>&1 || true)
  rm -rf "$temp_root"
}
trap cleanup EXIT INT TERM

mkdir -p "$stack_root"
git -C "$repo_root" archive "$base_commit" supabase/config.toml supabase/migrations | tar -x -C "$stack_root"

sed -i.bak \
  -e 's/^project_id = ".*"/project_id = "itqan-rotation-audit-compat"/' \
  -e 's/^port = 54321$/port = 59321/' \
  -e 's/^port = 54322$/port = 59322/' \
  -e 's/^shadow_port = 54320$/shadow_port = 59320/' \
  "$stack_root/supabase/config.toml"
rm -f "$stack_root/supabase/config.toml.bak"

(cd "$stack_root" && "$supabase_cli" start >/dev/null)
docker exec -i supabase_db_itqan-rotation-audit-compat \
  psql --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
  < "$repo_root/scripts/audit-rotation-publication-integrity.sql" >/dev/null

echo "Rotation audit pre-migration compatibility passed from ${base_commit}."
