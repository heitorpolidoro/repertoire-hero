-- ---------------------------------------------------------------------------
-- RH-103 — `uq_playlist_song_position` becomes DEFERRABLE INITIALLY IMMEDIATE.
--
-- Reordering a playlist rewrites every row's `position` in one statement, and a
-- permutation is briefly invalid midway: `(1,2,3)` -> `(3,2,1)` passes through a
-- state where two rows hold the same number. A plain `UNIQUE` checks row by row
-- and rejects that; declaring the constraint deferrable moves the check to the
-- end of the *statement*, so the permutation is accepted with no transaction
-- wrapper and no `SET CONSTRAINTS DEFERRED` anywhere in the application.
--
-- `INITIALLY IMMEDIATE` — not `INITIALLY DEFERRED` — is what keeps the rest of
-- the constraint's job intact:
--
--   * a genuinely duplicate final state is still rejected, by the same
--     statement that produced it rather than at a distant COMMIT;
--   * two concurrent `addSongToPlaylist` calls, which both compute
--     `MAX(position) + 1` and therefore both aim at the same number, are still
--     serialised, and the loser still fails with `duplicate key value violates
--     unique constraint "uq_playlist_song_position"` naming this constraint.
--     Each `INSERT` is its own statement, so end-of-statement is still before
--     the second session is let through. That property is the reason the
--     constraint exists (RH-36 / F18) and is pinned by the concurrent-insert
--     case in `src/lib/__tests__/transactionAtomicity.db.test.ts`.
--
-- The one capability lost is `ON CONFLICT (playlist_id, position)`, which
-- Postgres refuses to arbitrate against a deferrable constraint. Nothing in the
-- tree used it: the only `ON CONFLICT DO NOTHING` on `playlist_songs` arbitrates
-- implicitly and is satisfied by `uq_playlist_song (playlist_id, song_id)`,
-- which `0001_initial_schema.sql` declares and which stays **immediate** here —
-- the Spotify bulk import (`buildPlaylistSongsInsert`,
-- `src/lib/spotifyPlaylistSync.ts`) depends on it.
--
-- Re-running this file is a no-op: both branches below are predicated on
-- `pg_constraint`, so a second application finds the constraint already
-- deferrable, drops nothing and adds nothing. A constraint cannot be altered
-- from immediate to deferrable in place, hence drop-then-add rather than
-- `ALTER CONSTRAINT`.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    -- Only an existing *non*-deferrable constraint is dropped; on a re-run this
    -- matches nothing and the already-correct constraint is left alone.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_playlist_song_position'
          AND NOT condeferrable
    ) THEN
        ALTER TABLE playlist_songs DROP CONSTRAINT uq_playlist_song_position;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_playlist_song_position'
    ) THEN
        ALTER TABLE playlist_songs
            ADD CONSTRAINT uq_playlist_song_position
            UNIQUE (playlist_id, position) DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
END
$$;
