-- Fix foreign-key constraints after replacing Supabase GoTrue with Better Auth.
--
-- Before: profiles.id → auth.users(id), global_songs.contributor_id → auth.users(id)
-- After:  profiles.id → "user"(id) [Better Auth table],
--         global_songs.contributor_id → profiles(id)
--
-- Better Auth is configured with generateId: () => crypto.randomUUID() so all
-- new user IDs are standard UUIDs, compatible with the existing uuid columns.
--
-- On a fresh local DB the IF EXISTS guards make statements idempotent no-ops.

-- ──────────────────────────────────────────────
-- 1. profiles: re-point FK from auth.users → "user" (Better Auth)
-- ──────────────────────────────────────────────
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Better Auth's "user" table lives in the public schema.
-- ON DELETE CASCADE: removing a Better Auth user removes the profile too.
ALTER TABLE profiles
  ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES "user"(id) ON DELETE CASCADE;

-- ──────────────────────────────────────────────
-- 2. global_songs: re-point contributor_id from auth.users → profiles
-- ──────────────────────────────────────────────
ALTER TABLE global_songs
  DROP CONSTRAINT IF EXISTS global_songs_contributor_id_fkey;

ALTER TABLE global_songs
  ADD CONSTRAINT global_songs_contributor_id_fkey
    FOREIGN KEY (contributor_id) REFERENCES profiles(id) ON DELETE SET NULL;
