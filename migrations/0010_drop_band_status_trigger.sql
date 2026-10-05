-- ---------------------------------------------------------------------------
-- RH-96 — Drop the band status trigger; a band's status is authored directly.
--
-- `0001_initial_schema.sql` created `sync_band_repertoire_on_member_update`
-- and the `trg_sync_band_repertoire` trigger on `repertoire`, which recomputed
-- a band's status for a song as the MIN across every member's personal row —
-- the "weakest member wins" rule. That rule is removed: `repertoire.status` is
-- per-owner, and a band's value is authored by a band admin like any other row.
--
-- 0001 is applied history and is deliberately not edited, so a fresh database
-- creates both objects and then drops them here, ending in the same state as a
-- migrated one.
--
-- The band statuses the trigger last wrote are kept as-is. They are a starting
-- value a band admin can now change, not data to back-fill or clear (decided
-- in `docs/plans/repertoire-rework.md`).
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_sync_band_repertoire ON repertoire;

DROP FUNCTION IF EXISTS sync_band_repertoire_on_member_update();
