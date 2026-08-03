#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

if ! docker info >/dev/null 2>&1; then
  echo "Rollout compatibility suite requires a running Docker daemon." >&2
  exit 1
fi

cleanup() {
  npx supabase stop --no-backup >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

npx supabase stop --no-backup >/dev/null 2>&1 || true
npx supabase start
eval "$(npx supabase status -o env)"

case "${API_URL:-}" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "Refusing to run compatibility tests against a non-local Supabase URL: ${API_URL:-missing}" >&2
    exit 1
    ;;
esac

RLS_SUPABASE_URL="$API_URL" \
RLS_SUPABASE_ANON_KEY="$ANON_KEY" \
RLS_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
npx --no-install tsx scripts/test-historical-report-rollout-compatibility.ts
