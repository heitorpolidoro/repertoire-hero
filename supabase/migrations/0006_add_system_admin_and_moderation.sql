-- Migration 0006: Add system admin role and moderation queue table

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS is_system_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS global_song_edits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id uuid NOT NULL REFERENCES global_songs(id) ON DELETE CASCADE,
    requested_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    proposed_data jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by uuid REFERENCES profiles(id),
    rejection_reason text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

COMMENT ON COLUMN profiles.is_system_admin IS 'Flag indicating if user has system administrator privileges for global song moderation';
COMMENT ON TABLE global_song_edits IS 'Moderation queue for user-submitted edits to global songs';
