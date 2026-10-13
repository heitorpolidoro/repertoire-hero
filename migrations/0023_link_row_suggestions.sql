-- Migration 0023: a links correction targets one `song_links` row, not the array.
--
-- RH-138. Until now any non-additive links edit queued the whole array as one
-- ('songs','links') suggestion and approving it ran a replace-set over
-- `song_links`. From here a correction names one row by its stable
-- `song_links.id` (RH-136) and one thing about it: its `url`, its `label`, or
-- its removal.
--
-- For `target_table = 'song_links'`, `target_id` is a `song_links.id`. Like every
-- `target_id` it carries no foreign key, so a deleted link leaves orphan
-- suggestions that the queue's join hides. `removed` carries the JSON value
-- `true`.
--
-- `('songs','links')` STAYS IN THE CHECK. Approved and rejected rows of that
-- kind are history, and `ADD CONSTRAINT` validates every existing row, so
-- dropping the pair would fail this migration on any database that ever
-- decided one. What makes the pair unwritable is the TypeScript allowlist
-- (`CATALOG_SUGGESTION_COLUMNS` in `src/lib/catalogSuggestionPayload.ts`),
-- which no longer carries `links`.
--
-- EVERY PENDING ('songs','links') ROW IS SUPERSEDED. A whole-array proposal
-- cannot be mapped to rows without guessing which old url became which new
-- one, so it is closed rather than converted: `superseded` (nobody refused the
-- value), reviewer NULL, no `rejection_reason`.

ALTER TABLE catalog_suggestions DROP CONSTRAINT IF EXISTS catalog_suggestions_check;

ALTER TABLE catalog_suggestions ADD CONSTRAINT catalog_suggestions_check CHECK (
    (target_table, target_column) IN (
        ('songs', 'title'),
        ('songs', 'artist'),
        ('songs', 'album'),
        ('songs', 'standard_key'),
        ('songs', 'cover_url'),
        ('songs', 'duration_seconds'),
        ('songs', 'links'),
        ('song_links', 'url'),
        ('song_links', 'label'),
        ('song_links', 'removed')
    )
);

UPDATE catalog_suggestions
   SET status = 'superseded', updated_at = now()
 WHERE target_table = 'songs'
   AND target_column = 'links'
   AND status = 'pending';
