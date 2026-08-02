-- Add lyrics field to repertoire
ALTER TABLE repertoire ADD COLUMN IF NOT EXISTS lyrics text;

-- Create repertoire_tabs table for PDF uploads
CREATE TABLE IF NOT EXISTS repertoire_tabs (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    repertoire_id  uuid        NOT NULL REFERENCES repertoire(id) ON DELETE CASCADE,
    title          text        NOT NULL,
    file_url       text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repertoire_tabs_repertoire_id ON repertoire_tabs (repertoire_id);
