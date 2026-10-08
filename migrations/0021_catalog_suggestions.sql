-- Migration 0021: replace the moderation queue with `catalog_suggestions`.
--
-- RH-107. `migrations/0006` created `global_song_edits`: one row per submitted
-- correction, carrying a `jsonb` of several proposed fields at once. RH-121's
-- `migrations/0013` and RH-122's `migrations/0014` both recorded that the table
-- kept its name on purpose, because the plan replaces it wholesale with a
-- differently shaped table rather than renaming it. This is that part.
--
-- The new shape is one row per proposed (target_table, target_id,
-- target_column) triple, tied back to its submission by `group_id`. That is
-- what lets a reviewer answer one field at a time, lets a requester be told
-- what happened to each field, and makes `superseded` expressible: approving a
-- value for a column closes every other pending suggestion for the same
-- column.
--
-- WHY `target_column` AND NOT `column`. `column` is a reserved keyword
-- (`pg_get_keywords()` catcode `R`), so `CREATE TABLE t (column text)` is a
-- syntax error; `value` is unreserved (`U`) and needs no quoting.
--
-- WHY `value jsonb NOT NULL` CAN STILL PROPOSE SQL NULL. `jsonb_typeof('null')`
-- is `null` and `'null'::jsonb IS NULL` is false, so "set the album to nothing"
-- is a storable row and stays distinguishable from "no value proposed".
--
-- NO FOREIGN KEY ON THE TARGET. `target_id` is polymorphic, so it carries no
-- foreign key and the legacy `ON DELETE CASCADE` on `song_id` is lost. Two
-- consequences for whoever comes next:
--   * deleting a catalog row (admin-master only, and that screen does not exist
--     yet) leaves orphan suggestions. The queue's `JOIN songs` hides them from
--     the admin, exactly as it did before;
--   * any future merge path must re-point `target_id WHERE target_table =
--     'songs'`, the way `migrations/0014` does for the legacy table. Cleanup
--     belongs to RH-117 (merge/split/delete).
-- `requested_by` and `reviewed_by` keep the foreign keys `migrations/0006` gave
-- them: only the target is polymorphic, and RH-111 reads the requester.
--
-- ONE PERSISTED ROUTINE KEEPS A DANGLING REFERENCE, AND IT IS DEAD RATHER THAN
-- BROKEN. `migrate_catalog_to_versions()` (`migrations/0014`) is a
-- `CREATE OR REPLACE FUNCTION … LANGUAGE plpgsql`, so it survives in the
-- catalog of every migrated database, and its body holds
-- `UPDATE global_song_edits SET song_id = … `. A plpgsql body is not parsed
-- until the statement executes, so the `DROP TABLE` below neither fails nor
-- invalidates it, and the statement sits inside a duplicate-collapse loop that
-- `uq_songs_artist_title` makes unenterable. It is deliberately left alone —
-- an applied migration is history — and recorded here so that RH-117, which
-- owns merge/split, knows the statement needs re-pointing at
-- `catalog_suggestions` before that loop can ever run again.

CREATE TABLE IF NOT EXISTS catalog_suggestions (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id         uuid        NOT NULL,
    target_table     text        NOT NULL,
    target_id        uuid        NOT NULL,
    target_column    text        NOT NULL,
    value            jsonb       NOT NULL,
    reason           text,
    requested_by     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status           text        NOT NULL DEFAULT 'pending',
    reviewed_by      uuid        REFERENCES profiles(id),
    rejection_reason text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    -- The allowlist, mirrored in SQL. Defence in depth, not the primary gate:
    -- the primary gate is `CATALOG_SUGGESTION_COLUMNS` in
    -- `src/lib/catalogSuggestionPayload.ts`, because that is where a column
    -- name is interpolated into an identifier position. This constraint is
    -- what makes "a suggestion naming a column the catalog does not accept
    -- cannot exist" checkable without running the application.
    --
    -- Named explicitly even though `catalog_suggestions_check` is also what
    -- Postgres would generate: the status constraint below would otherwise be
    -- reported as `catalog_suggestions_check1`, which is indistinguishable
    -- from this one in an error message.
    CONSTRAINT catalog_suggestions_check CHECK (
        (target_table, target_column) IN (
            ('songs', 'title'),
            ('songs', 'artist'),
            ('songs', 'album'),
            ('songs', 'standard_key'),
            ('songs', 'cover_url'),
            ('songs', 'duration_seconds'),
            ('songs', 'links')
        )
    ),
    -- `superseded` is distinct from `rejected` on purpose: RH-111 has to tell
    -- the requester which of the two happened.
    CONSTRAINT catalog_suggestions_status_check CHECK (
        status IN ('pending', 'approved', 'rejected', 'superseded')
    )
);

-- The queue read, which is ordered and `pending`-only.
CREATE INDEX IF NOT EXISTS idx_catalog_suggestions_pending
    ON catalog_suggestions (created_at) WHERE status = 'pending';

-- The grouped review screen and any future merge re-pointing.
CREATE INDEX IF NOT EXISTS idx_catalog_suggestions_target
    ON catalog_suggestions (target_table, target_id);

-- RH-111's "what happened to my suggestions" read.
CREATE INDEX IF NOT EXISTS idx_catalog_suggestions_requested_by
    ON catalog_suggestions (requested_by);

COMMENT ON TABLE catalog_suggestions IS
    'Moderation queue for proposed catalog corrections: one row per proposed (target_table, target_id, target_column), tied to its submission by group_id';

-- The conversion. One legacy row fans out into one suggestion row per
-- allowlisted key of its `proposed_data`, keeping the legacy row's id as the
-- `group_id` so the conversion stays traceable row by row.
--
-- Three guards, each of which the migration fails without:
--
--   * the non-object guard. `proposed_data` is `jsonb NOT NULL` with no shape
--     constraint, so a directly written `'[1,2]'` is legal, and
--     `jsonb_each` on it is a hard `22023`. Both guards are kept: the
--     `WHERE` term, so the intent reads at the row level, and a `CASE` inside
--     the call's own argument, because a `WHERE` term cannot be *relied upon*
--     to run before a `LATERAL` function call. On PG 16.15 the `WHERE`-only
--     form was measured converting a `'[1,2]'` row cleanly — `EXPLAIN` puts
--     the filter on the `Seq Scan`, below the nested loop — so the `CASE` is
--     insurance against a plan shape, not the only thing standing between
--     this migration and a `22023`.
--   * `COALESCE` on both timestamps. Both legacy columns are nullable
--     (`migrations/0006:14-15`) and both new ones are `NOT NULL`: a legacy row
--     with a NULL `created_at` is a `23502` otherwise.
--   * the key filter. `reason` is a non-column key the correction modal sends
--     alongside the proposed columns, and it must land in the `reason`
--     *column*, never as a `target_column` — a `target_column = 'reason'` row
--     would be a non-column name reaching an identifier position. Every other
--     non-column key is dropped.
--
-- Two consequences, stated rather than hidden. A legacy row whose
-- `proposed_data` holds no allowlisted key at all produces zero suggestion
-- rows and is lost; it cannot be produced through the application, because the
-- payload narrower refuses a payload proposing no known column. And a stored
-- value the narrower would refuse today is carried across verbatim and still
-- fails at approval with its row left `pending` — the backfill does not
-- validate, exactly as the legacy table did not.
INSERT INTO catalog_suggestions (
    group_id, target_table, target_id, target_column, value, reason,
    requested_by, status, reviewed_by, rejection_reason, created_at, updated_at
)
SELECT e.id,
       'songs',
       e.song_id,
       kv.key,
       kv.value,
       e.proposed_data ->> 'reason',
       e.requested_by,
       e.status,
       e.reviewed_by,
       e.rejection_reason,
       COALESCE(e.created_at, now()),
       COALESCE(e.updated_at, now())
  FROM global_song_edits e
  CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(e.proposed_data) = 'object'
           THEN e.proposed_data
           ELSE '{}'::jsonb
      END
  ) AS kv(key, value)
 WHERE jsonb_typeof(e.proposed_data) = 'object'
   AND kv.key IN (
       'title', 'artist', 'album', 'standard_key', 'cover_url',
       'duration_seconds', 'links'
   );

DROP TABLE global_song_edits;
