-- RH-186: per-user custom fields on songs, starting with a pedalboard Preset.
--
-- A definition (`custom_fields`) and a value (`custom_field_values`) are two
-- tables, so a field can become shared later without migrating any value.
-- Definitions are user-owned for now (`owner_user_id NOT NULL`). A value always
-- belongs to one musician (its own `user_id`) and is keyed by the recording
-- (`version_id`), never by a `user_songs` / `band_songs` row: a value can be
-- set on a version nobody holds, and setting one creates no repertoire row.

CREATE TABLE custom_fields (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name          text        NOT NULL,
    type          text        NOT NULL DEFAULT 'text' CHECK (type IN ('text')),
    position      integer     NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- One name per owner, ignoring case: "preset" collides with "Preset".
CREATE UNIQUE INDEX uq_custom_fields_owner_name ON custom_fields (owner_user_id, lower(name));

CREATE TABLE custom_field_values (
    field_id   uuid        NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    version_id uuid        NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
    value      text        NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (field_id, user_id, version_id),
    -- Blank means absent: a cleared value is a deleted row, never an empty string.
    CONSTRAINT custom_field_values_value_not_blank CHECK (btrim(value) <> '')
);

CREATE INDEX idx_custom_field_values_user_version ON custom_field_values (user_id, version_id);
