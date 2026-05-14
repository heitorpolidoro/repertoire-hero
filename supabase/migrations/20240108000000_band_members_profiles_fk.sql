-- Fix: band_members.user_id must reference public.profiles(id) so that
-- PostgREST can resolve the band_members → profiles relationship for
-- nested selects (e.g. profile:profiles(...)). The existing FK to
-- auth.users is replaced; profiles.id already mirrors auth.users.id.

ALTER TABLE band_members
  DROP CONSTRAINT IF EXISTS band_members_user_id_fkey;

ALTER TABLE band_members
  ADD CONSTRAINT band_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
