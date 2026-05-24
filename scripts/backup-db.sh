#!/usr/bin/env bash
set -euo pipefail

backup_root="${BACKUP_ROOT:-backups/database}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_dir="${backup_root}/${timestamp}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Missing Supabase CLI. Install it before running this backup."
  exit 1
fi

mkdir -p "${output_dir}"

schema_file="${output_dir}/itqan-lite-schema-${timestamp}.sql"
data_file="${output_dir}/itqan-lite-public-data-${timestamp}.sql"

echo "Writing schema dump to ${schema_file}"
supabase db dump --linked --file "${schema_file}"

echo "Writing public data dump to ${data_file}"
supabase db dump --linked --data-only --use-copy --schema public --file "${data_file}"

cat <<EOF
Database logical export complete.

Files:
- ${schema_file}
- ${data_file}

Keep these files encrypted and off-repo. This export is for manual staging
restore/drills and emergency analysis. Production database restore remains a
manual approval process through Supabase.
EOF
