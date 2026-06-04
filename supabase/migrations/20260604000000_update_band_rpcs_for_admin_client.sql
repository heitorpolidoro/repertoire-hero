-- Update create_band and join_band_by_invite to accept explicit p_user_id
-- instead of relying on auth.uid(), since the admin client is now used
-- (service role bypasses auth context).

CREATE OR REPLACE FUNCTION create_band(
  p_name        text,
  p_description text    DEFAULT NULL,
  p_cover_url   text    DEFAULT NULL,
  p_user_id     uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_band_id uuid;
  v_user_id uuid;
BEGIN
  -- Prefer explicit p_user_id; fall back to auth.uid() for backward compatibility
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  INSERT INTO bands (name, description, cover_url, created_by)
  VALUES (p_name, p_description, p_cover_url, v_user_id)
  RETURNING id INTO v_band_id;
  INSERT INTO band_members (band_id, user_id, role) VALUES (v_band_id, v_user_id, 'admin');
  RETURN v_band_id;
END;
$$;

CREATE OR REPLACE FUNCTION join_band_by_invite(
  p_invite_code text,
  p_user_id     uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_band_id uuid;
  v_user_id uuid;
BEGIN
  -- Prefer explicit p_user_id; fall back to auth.uid() for backward compatibility
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_band_id FROM bands WHERE invite_code = p_invite_code;
  IF v_band_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO band_members (band_id, user_id, role)
  VALUES (v_band_id, v_user_id, 'member')
  ON CONFLICT (band_id, user_id) DO NOTHING;
  RETURN v_band_id;
END;
$$;

-- Grant execute on updated signatures (service_role already has full access)
GRANT EXECUTE ON FUNCTION create_band(text, text, text, uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION join_band_by_invite(text, uuid)            TO authenticated;
