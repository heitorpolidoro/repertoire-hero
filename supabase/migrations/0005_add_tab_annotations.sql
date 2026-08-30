-- Migration 0005: freehand drawing-layer annotations on tab PDFs.
-- One JSONB column on repertoire_tabs, keyed by page number, storing
-- vector stroke data (not a rasterized image — see spec RH-5).

ALTER TABLE repertoire_tabs
    ADD COLUMN IF NOT EXISTS annotations jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN repertoire_tabs.annotations IS
    'Freehand drawing-layer strokes, keyed by page number as a string, e.g. {"1": [ {stroke...}, ... ], "2": [...] }. Coordinates are normalized 0..1 relative to page width/height so they render correctly at any zoom/viewport.';
