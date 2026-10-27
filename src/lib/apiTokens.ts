/**
 * RH-187: Data access for Personal Access Tokens.
 *
 * Tokens are user-owned, stored hashed with SHA-256, and can be listed, revoked,
 * and resolved by active hash.
 */
import { query } from '@/lib/db'
import {
  generateApiToken,
  hashApiToken,
  extractApiTokenPrefix,
  validateApiTokenCreation,
  type ApiTokenScope,
  type ApiTokenExpiryOption,
} from '@/lib/apiTokenRules'

export interface ApiTokenRecord {
  id: string
  userId: string
  name: string
  tokenPrefix: string
  scopes: ApiTokenScope[]
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}

interface DbTokenRow {
  id: string
  user_id: string
  name: string
  token_prefix: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

function mapTokenRow(row: DbTokenRow): ApiTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: row.scopes as ApiTokenScope[],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }
}

/**
 * Lists active (unrevoked and unexpired) tokens for the user.
 */
export async function listActiveApiTokens(userId: string): Promise<ApiTokenRecord[]> {
  const result = await query<DbTokenRow>(
    `SELECT id, user_id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at
     FROM api_tokens
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC`,
    [userId],
  )
  return result.rows.map(mapTokenRow)
}

/**
 * Creates a new personal access token for the given user.
 * Plaintext token is returned once and never persisted.
 */
export async function createApiToken(
  userId: string,
  input: {
    name: string
    scopes: readonly ApiTokenScope[]
    expiryDays?: ApiTokenExpiryOption
  },
): Promise<{ token: ApiTokenRecord; plaintext: string }> {
  const countResult = await query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM api_tokens
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())`,
    [userId],
  )
  const activeCount = countResult.rows[0]?.count ?? 0

  const validation = validateApiTokenCreation({
    name: input.name,
    scopes: input.scopes,
    activeTokenCount: activeCount,
    expiryDays: input.expiryDays,
  })
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  const plaintext = generateApiToken()
  const tokenHash = hashApiToken(plaintext)
  const tokenPrefix = extractApiTokenPrefix(plaintext)

  const expiryDays = input.expiryDays !== undefined ? input.expiryDays : 90
  const expiresAt =
    expiryDays === null
      ? null
      : new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()

  const insertResult = await query<DbTokenRow>(
    `INSERT INTO api_tokens (user_id, name, token_prefix, token_hash, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at`,
    [userId, validation.name, tokenPrefix, tokenHash, validation.scopes, expiresAt],
  )

  return {
    token: mapTokenRow(insertResult.rows[0]),
    plaintext,
  }
}

/**
 * Revokes a user's token. Returns true if a row was updated, false otherwise.
 */
export async function revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
  const result = await query(
    `UPDATE api_tokens
     SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenId, userId],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Resolves an active token by its plaintext value.
 * Returns null if token is unknown, revoked, or expired.
 */
export async function resolveActiveApiToken(plaintext: string): Promise<ApiTokenRecord | null> {
  const tokenHash = hashApiToken(plaintext)
  const result = await query<DbTokenRow>(
    `SELECT id, user_id, name, token_prefix, scopes, created_at, last_used_at, expires_at, revoked_at
     FROM api_tokens
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())`,
    [tokenHash],
  )
  if (result.rows.length === 0) return null
  return mapTokenRow(result.rows[0])
}

/**
 * Updates last_used_at on an api token.
 */
export async function touchApiTokenLastUsed(tokenId: string): Promise<void> {
  await query(
    `UPDATE api_tokens
     SET last_used_at = now()
     WHERE id = $1`,
    [tokenId],
  )
}
