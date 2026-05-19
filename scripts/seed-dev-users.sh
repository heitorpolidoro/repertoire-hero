#!/usr/bin/env bash
# =============================================================================
# scripts/seed-dev-users.sh
#
# Creates dev users in the local Supabase instance via the GoTrue admin API.
# Must be run AFTER `supabase start`.
#
# Usage:
#   npm run dev:seed-users
#   # or directly:
#   bash scripts/seed-dev-users.sh
#
# All users are created with password: "password"
# =============================================================================

set -euo pipefail

SUPABASE_URL="http://127.0.0.1:54321"
# Well-known local service_role JWT (same for every local Supabase project)
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

create_user() {
  local email="$1"
  local full_name="$2"

  local response
  response=$(curl -s -X POST "${SUPABASE_URL}/auth/v1/admin/users" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"email\": \"${email}\",
      \"password\": \"password\",
      \"email_confirm\": true,
      \"user_metadata\": {\"full_name\": \"${full_name}\"}
    }")

  if echo "$response" | grep -q '"id"'; then
    echo "  ✅ Created: ${full_name} <${email}>"
  elif echo "$response" | grep -q '"email_exists"'; then
    echo "  ⏭️  Exists:  ${full_name} <${email}>"
  else
    echo "  ❌ Failed:  ${full_name} <${email}> — ${response}"
  fi
}

echo "🌱 Seeding dev users into local Supabase..."
echo ""

create_user "user-a@example.com" "User A"
create_user "user-b@example.com" "User B"

echo ""
echo "Done. Password for all users: password"
