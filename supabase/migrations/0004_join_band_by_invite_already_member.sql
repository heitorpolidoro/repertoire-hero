-- Migration 0004: join_band_by_invite reports whether the caller was
-- already a member, so the UI can distinguish a fresh join from a
-- silent no-op re-accept.

-- CREATE OR REPLACE cannot change a function's return type, so the
-- existing scalar-uuid version must be dropped first.
DROP FUNCTION IF EXISTS join_band_by_invite(text, uuid);

CREATE FUNCTION join_band_by_invite(
    p_invite_code text,
    p_user_id     uuid DEFAULT NULL
)
RETURNS TABLE(band_id uuid, already_member boolean)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
    v_band_id uuid;
    v_already_member boolean;
BEGIN
    IF p_user_id IS NULL THEN RAISE EXCEPTION 'p_user_id is required'; END IF;

    SELECT id INTO v_band_id FROM bands WHERE invite_code = p_invite_code;
    IF v_band_id IS NULL THEN
        RETURN QUERY SELECT NULL::uuid, NULL::boolean;
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM band_members bm
        WHERE bm.band_id = v_band_id AND bm.user_id = p_user_id
    ) INTO v_already_member;

    INSERT INTO band_members (band_id, user_id, role)
    VALUES (v_band_id, p_user_id, 'member')
    ON CONFLICT (band_id, user_id) DO NOTHING;

    RETURN QUERY SELECT v_band_id, v_already_member;
END;
$$;
