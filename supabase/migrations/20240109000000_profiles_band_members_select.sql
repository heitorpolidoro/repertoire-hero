-- Allow band members to read the profiles of other members in shared bands.
-- Without this, PostgREST returns null for profile fields of other users
-- because the SELECT policy on profiles only allows reading one's own row.

DROP POLICY IF EXISTS "profiles: band members can read co-member profiles" ON profiles;
CREATE POLICY "profiles: band members can read co-member profiles"
    ON profiles FOR SELECT
    USING (
      id = ANY(
        SELECT user_id FROM band_members
        WHERE band_id = ANY(get_my_band_ids())
      )
    );
