-- Fix bands.created_by FK: auth.users → profiles
-- (GoTrue no longer used; profiles now points to Better Auth "user" table)

ALTER TABLE bands
  DROP CONSTRAINT IF EXISTS bands_created_by_fkey;

ALTER TABLE bands
  ADD CONSTRAINT bands_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE;
