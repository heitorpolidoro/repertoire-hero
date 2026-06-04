#!/usr/bin/env bash
# =============================================================================
# scripts/seed-dev-users-better-auth.sh
#
# Creates dev users in Better Auth via the running dev server's sign-up API.
# Must be run AFTER `npm run dev` is started.
#
# Usage:
#   bash scripts/seed-dev-users-better-auth.sh [base_url]
#
# Default base URL: http://localhost:3000
# Password for all users: password
# =============================================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"

create_user() {
  local email="$1"
  local name="$2"
  local password="password"

  local response
  response=$(curl -s -X POST "${BASE_URL}/api/auth/sign-up/email" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\",\"name\":\"${name}\"}")

  if echo "$response" | grep -q '"id"'; then
    echo "  ✅ Created: ${name} <${email}>"
  elif echo "$response" | grep -q 'already exists\|email_taken\|ALREADY_EXISTS'; then
    echo "  ⏭️  Exists:  ${name} <${email}>"
  else
    echo "  ❌ Failed:  ${name} <${email}> — ${response}"
  fi
}

echo "🌱 Seeding dev users via Better Auth (${BASE_URL})..."
echo ""

create_user "heitor.polidoro@gmail.com" "Heitor Luis Polidoro"
create_user "fg_pereira@yahoo.com.br" "Fabrício Drummer"
create_user "com.spotify@exemple.com" "Com Spotify"
create_user "sem_spotify@exemple.com" "Sem Spotify"

echo ""
echo "Done. Password for all users: password"
echo ""
echo "Add to .env.local:"
echo "  NEXT_PUBLIC_DEV_USER_EMAIL=heitor.polidoro@gmail.com"
echo "  NEXT_PUBLIC_DEV_USER_PASSWORD=password"
