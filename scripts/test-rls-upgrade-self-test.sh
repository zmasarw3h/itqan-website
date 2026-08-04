#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

if [[ ! -d "$repo_root/node_modules" ]]; then
  echo "Installed dependencies are required; run npm ci first." >&2
  exit 1
fi

temp_root="$(mktemp -d -t itqan-upgrade-harness-self-test.XXXXXX)"
future_root="$temp_root/post-slice4"
cleanup() {
  rm -rf "$temp_root"
}
trap cleanup EXIT INT TERM

git clone --quiet --no-hardlinks "$repo_root" "$future_root"
ln -s "$repo_root/node_modules" "$future_root/node_modules"
future_base="$(git -C "$future_root" rev-parse HEAD)"
slice4_migration="supabase/migrations/20260803013447_historical_report_populations.sql"

if ! git -C "$future_root" cat-file -e "${future_base}:${slice4_migration}" 2>/dev/null; then
  echo "Self-test requires a committed post-Slice-4 HEAD." >&2
  exit 1
fi

expect_failure() {
  local expected="$1"
  shift
  local output
  if output="$("$@" 2>&1)"; then
    echo "Expected failure containing '${expected}', but command succeeded." >&2
    exit 1
  fi
  if [[ "$output" != *"$expected"* ]]; then
    echo "Failure did not contain '${expected}':" >&2
    echo "$output" >&2
    exit 1
  fi
  echo "Verified fail-closed case: ${expected}"
}

expect_failure \
  "Explicitly configured UPGRADE_BASE_REF does not resolve" \
  env UPGRADE_BASE_REF=refs/heads/definitely-missing \
  bash "$future_root/scripts/test-rls-upgrade.sh"

expect_failure \
  "No forward migration exists" \
  env UPGRADE_BASE_REF="$future_base" \
  bash "$future_root/scripts/test-rls-upgrade.sh"

first_base_migration="$(git -C "$future_root" ls-tree -r --name-only "$future_base" supabase/migrations | grep -E '\.sql$' | sort | head -n 1)"
printf '\n-- upgrade harness edited-base probe\n' >> "$future_root/$first_base_migration"
expect_failure \
  "Base migration was modified" \
  env UPGRADE_BASE_REF="$future_base" \
  bash "$future_root/scripts/test-rls-upgrade.sh"
git -C "$future_root" checkout -- "$first_base_migration"

mv "$future_root/$first_base_migration" "$future_root/${first_base_migration}.renamed"
expect_failure \
  "Base migration was deleted or renamed" \
  env UPGRADE_BASE_REF="$future_base" \
  bash "$future_root/scripts/test-rls-upgrade.sh"
mv "$future_root/${first_base_migration}.renamed" "$future_root/$first_base_migration"

probe_migration="$future_root/supabase/migrations/20990101000000_upgrade_harness_future_slice_probe.sql"
printf '%s\n' \
  '-- Disposable post-Slice-4 forward migration used only by the upgrade harness self-test.' \
  'select 1;' > "$probe_migration"

echo "Running post-Slice-4 future-slice parity mode from ${future_base}."
(
  cd "$future_root"
  UPGRADE_BASE_REF="$future_base" bash scripts/test-rls-upgrade.sh
)

echo "Post-Slice-4 upgrade harness self-test passed."
