#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Local RLS suite requires a running Docker daemon (Docker Desktop or Colima)." >&2
  exit 1
fi

cleanup() {
  npx supabase stop --no-backup >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

npx supabase stop --no-backup >/dev/null 2>&1 || true
npx supabase start
npx supabase db reset --local --no-seed
npx supabase db lint --local --schema public --level warning --fail-on error

docker exec -i supabase_db_itqan-lite-phase-1-rls \
  psql --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
  < scripts/test-rls-grants.sql

eval "$(npx supabase status -o env)"

case "${API_URL:-}" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "Refusing to run RLS tests against a non-local Supabase URL: ${API_URL:-missing}" >&2
    exit 1
    ;;
esac

RLS_SUPABASE_URL="$API_URL" \
RLS_SUPABASE_ANON_KEY="$ANON_KEY" \
RLS_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
npx tsx scripts/test-rls.ts
