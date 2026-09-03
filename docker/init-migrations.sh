#!/bin/bash
# Applies migrations and seed data on first database initialization.
# Runs automatically via docker-entrypoint-initdb.d (only on fresh volumes).
#
# Migrations come from the top-level `migrations/` directory (the single source
# of truth), bind-mounted by docker-compose.yml. Every applied file is recorded
# in the same `_migrations` ledger that scripts/migrate.mjs uses, so a later
# `npm run db:migrate` skips what this script already applied.
#
# `set -e` only aborts on a failing migration because every psql call below runs
# with `-v ON_ERROR_STOP=1`: without it psql exits 0 even when every statement in
# a file errors, and the ledger would then record a migration that never applied.
set -e

PSQL=(psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB")

echo "==> Creating migrations ledger..."
"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);"

echo "==> Applying migrations..."
for f in $(find /docker-entrypoint-initdb.d/migrations/ -maxdepth 1 -name "*.sql" | sort); do
  echo "    -> $(basename "$f")"
  # ON_ERROR_STOP + set -e: the ledger insert below is unreachable unless this
  # migration applied cleanly.
  "${PSQL[@]}" -f "$f"
  # Read from stdin (`-f -`) rather than `-c`: psql only interpolates `:'name'`
  # for file/stdin input, and binding the basename beats splicing it into SQL.
  "${PSQL[@]}" -v name="$(basename "$f")" -f - \
    <<< "INSERT INTO _migrations (name) VALUES (:'name') ON CONFLICT (name) DO NOTHING;"
done

# Seed data is deliberately tolerant: it may legitimately fail on re-run and
# must not break initialization. It is not recorded in _migrations.
echo "==> Applying seed data..."
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "/docker-entrypoint-initdb.d/seed.sql" || true

echo "==> Database initialization complete!"
