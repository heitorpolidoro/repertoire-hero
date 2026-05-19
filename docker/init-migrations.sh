#!/bin/bash
# Applies migrations and seed data on first database initialization.
# Runs automatically via docker-entrypoint-initdb.d (only on fresh volumes).
set -e

echo "==> Applying migrations..."
for f in $(ls /docker-entrypoint-initdb.d/migrations/*.sql | sort); do
  echo "    -> $(basename "$f")"
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
done

echo "==> Applying seed data..."
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "/docker-entrypoint-initdb.d/seed.sql" || true

echo "==> Database initialization complete!"
