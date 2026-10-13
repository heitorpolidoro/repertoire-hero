-- Migration 0025 (RH-164): record the scope string Spotify granted with the token.
--
-- Fast View needs to tell whether a connected user holds the Web Playback
-- scopes. Rows written before this migration have no recorded scope and count
-- as "lacks the scopes", which prompts a re-consent.

ALTER TABLE spotify_tokens
    ADD COLUMN IF NOT EXISTS scope text;

COMMENT ON COLUMN spotify_tokens.scope IS
    'Space-separated scope string returned by Spotify at consent (RH-164). NULL for rows that predate it.';
