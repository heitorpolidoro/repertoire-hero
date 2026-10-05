-- ---------------------------------------------------------------------------
-- RH-101 — Add `global_songs.updated_at`.
--
-- `global_songs` was the only mutable application table carrying `created_at`
-- without `updated_at`; `bands`, `playlists`, `spotify_tokens` and
-- `global_song_edits` all have both. A later consumer (the RH-28 offline
-- snapshot) needs a monotonic "last changed" value to compare a cached row
-- against, and today it has nothing.
--
-- The shape is the stricter of the two already in the schema —
-- `timestamptz NOT NULL DEFAULT now()`, as on `bands`/`playlists`/
-- `spotify_tokens`, not `global_song_edits`' nullable variant: a null here
-- would read as "never changed" to such a comparison.
--
-- The column is kept current by the writing statement spelling
-- `updated_at = now()` in its `SET` list, which is how all four existing
-- tables do it. There is deliberately no `BEFORE UPDATE` trigger: triggers in
-- this schema are reserved for cross-row invariants application code cannot
-- hold (`sync_profile_email_on_user_update`), and a second mechanism on one
-- table out of five would leave a reader of `src/lib/bands.ts` unable to tell
-- which tables maintain their own timestamp. The forgotten-clause risk a
-- trigger would cover is covered statically instead, by
-- `src/lib/__tests__/catalogTimestampGuard.test.ts`.
--
-- Existing rows are backfilled from their own `created_at`, not from the
-- migration's clock, so a song never edited since creation reports its creation
-- time rather than a timestamp implying an edit that never happened.
--
-- All three statements are idempotent, because `docker/init-migrations.sh` and
-- `scripts/migrate.mjs` may both apply this file and because a migration here
-- is expected to be re-appliable by hand. The backfill in particular is
-- predicated on `updated_at IS NULL`: the unqualified form also succeeds on a
-- re-run, but would reset every row's real `updated_at` back to its
-- `created_at`, destroying exactly the data this migration exists to produce.
-- ---------------------------------------------------------------------------

ALTER TABLE global_songs ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Only rows that have never carried a value — on a second application this
-- matches nothing and the statement is a no-op.
UPDATE global_songs SET updated_at = created_at WHERE updated_at IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'global_songs'
          AND column_name = 'updated_at'
          AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE global_songs ALTER COLUMN updated_at SET NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'global_songs'
          AND column_name = 'updated_at'
          AND column_default IS NULL
    ) THEN
        ALTER TABLE global_songs ALTER COLUMN updated_at SET DEFAULT now();
    END IF;
END
$$;

COMMENT ON COLUMN global_songs.updated_at IS
    'Last time any catalog column on this row changed. Maintained by the '
    'writing statement (`updated_at = now()` in its SET list), not by a '
    'trigger — see src/lib/__tests__/catalogTimestampGuard.test.ts.';
