-- Add avatar, instruments, and primary instrument to profiles.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url        text,
  ADD COLUMN IF NOT EXISTS instruments       text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS primary_instrument text;
