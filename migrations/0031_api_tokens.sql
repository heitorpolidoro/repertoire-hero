-- RH-187: Personal access tokens for AI agents.
--
-- Tokens authenticate REST requests under /api/v1. Plaintext tokens (rh_pat_...)
-- are revealed once upon creation and only the SHA-256 hash is persisted.
-- Tokens can be revoked or expire.

CREATE TABLE api_tokens (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name          text        NOT NULL,
    token_prefix  text        NOT NULL,
    token_hash    text        NOT NULL UNIQUE,
    scopes        text[]      NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at  timestamptz,
    expires_at    timestamptz,
    revoked_at    timestamptz
);

CREATE INDEX idx_api_tokens_user_id ON api_tokens (user_id);
