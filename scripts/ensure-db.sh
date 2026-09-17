#!/usr/bin/env bash
# Prepare the `repertoire_hero` database on poli-runner's shared Postgres.
#
# In standalone mode nothing needs this: the bundled `postgres` service creates its
# own `postgres` database and docker/init-migrations.sh applies the migrations and the
# seed catalogue on first boot. A server this repo does not own — poli-runner's shared
# `poli-postgres`, which hosts many apps and therefore cannot use the `postgres`
# database — never runs that entrypoint, so the database and its schema have to be
# provisioned from outside before the app container starts.
#
# Idempotent: creating an existing database is skipped, and scripts/migrate.mjs keeps
# its own `_migrations` ledger so re-running applies nothing new.
#
# Tolerant by design: when `poli-postgres` is not running this exits 0 with a notice,
# so `poli-runner start repertoire_hero --no-deps` still falls through to the bundled
# standalone database instead of failing the start.
set -euo pipefail

CONTAINER="${POLI_POSTGRES_CONTAINER:-poli-postgres}"
DB_NAME="${POLI_POSTGRES_DB:-repertoire_hero}"
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54321/${DB_NAME}"

if ! docker exec "$CONTAINER" pg_isready -U postgres -q 2>/dev/null; then
  echo "==> ${CONTAINER} is not running — skipping shared-database setup."
  echo "    docker compose will fall back to the bundled standalone Postgres."
  exit 0
fi

if docker exec "$CONTAINER" psql -U postgres -tAc \
     "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -qx 1; then
  echo "==> Database ${DB_NAME} already exists on ${CONTAINER}."
else
  echo "==> Creating database ${DB_NAME} on ${CONTAINER}..."
  docker exec "$CONTAINER" createdb -U postgres "$DB_NAME"
fi

# migrate.mjs lets an explicit process-environment value win over .env.local, so this
# migrates the shared database even on a machine whose .env.local names another one.
echo "==> Applying migrations to ${DB_NAME}..."
DATABASE_URL="$DATABASE_URL" node "$(dirname "$0")/migrate.mjs"
