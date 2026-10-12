-- RH-111: tell the requester what happened to a correction.
--
-- A decided row (approved, rejected or superseded) is "unseen" until its
-- requester acknowledges it. NULL means unseen; the timestamp records when the
-- requester dismissed the notice. Pending rows are never part of a notice, so
-- the column simply stays NULL on them.
ALTER TABLE catalog_suggestions
    ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

-- The signed-in home's read: one requester's decided, still-unseen rows.
CREATE INDEX IF NOT EXISTS idx_catalog_suggestions_unseen_outcomes
    ON catalog_suggestions (requested_by)
    WHERE acknowledged_at IS NULL AND status <> 'pending';
