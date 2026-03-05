#!/bin/bash
# Remove test data left behind by interrupted test runs.
# Resources created by tests are tagged with displayName starting "__test__".
#
# Usage:
#   ./scripts/test-cleanup.sh
#   API_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... ./scripts/test-cleanup.sh

set -euo pipefail

BASE="${API_URL:-http://localhost:3000}"
EMAIL="${ADMIN_EMAIL:-admin@example.com}"
PASSWORD="${ADMIN_PASSWORD:-changeme}"

echo "==> Logging in to ${BASE}..."

LOGIN_RESPONSE=$(curl -si -X POST "${BASE}/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")

COOKIE=$(echo "$LOGIN_RESPONSE" | grep -i 'set-cookie' | grep -o 'agnus_session=[^;]*' || true)

if [[ -z "$COOKIE" ]]; then
  echo "ERROR: Login failed. Check API_URL / ADMIN_EMAIL / ADMIN_PASSWORD."
  exit 1
fi

echo "==> Logged in."

# ── Clean up test VCS installations ──────────────────────────────────────────

echo "==> Fetching VCS installations..."
INSTALLATIONS=$(curl -s "${BASE}/api/vcs-installations" -H "cookie: ${COOKIE}")
TEST_IDS=$(echo "$INSTALLATIONS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for inst in data.get('installations', []):
    name = inst.get('displayName') or ''
    if name.startswith('__test__'):
        print(inst['id'])
" 2>/dev/null || true)

if [[ -z "$TEST_IDS" ]]; then
  echo "  No test installations found."
else
  while IFS= read -r id; do
    echo "  Deleting installation ${id}..."
    curl -s -X DELETE "${BASE}/api/vcs-installations/${id}" -H "cookie: ${COOKIE}" > /dev/null
  done <<< "$TEST_IDS"
  echo "  Done."
fi

# ── Clean up test repos ───────────────────────────────────────────────────────

echo "==> Fetching repos..."
REPOS=$(curl -s "${BASE}/api/repos" -H "cookie: ${COOKIE}")
TEST_REPO_IDS=$(echo "$REPOS" | python3 -c "
import sys, json
repos = json.load(sys.stdin)
for r in repos:
    url = r.get('repoUrl') or r.get('repo_url') or ''
    if '__test__' in url or 'test-cleanup' in url:
        print(r.get('repoId') or r.get('repo_id', ''))
" 2>/dev/null || true)

if [[ -z "$TEST_REPO_IDS" ]]; then
  echo "  No test repos found."
else
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    echo "  Deleting repo ${id}..."
    curl -s -X DELETE "${BASE}/api/repos/${id}" -H "cookie: ${COOKIE}" > /dev/null
  done <<< "$TEST_REPO_IDS"
  echo "  Done."
fi

echo "==> Cleanup complete."
