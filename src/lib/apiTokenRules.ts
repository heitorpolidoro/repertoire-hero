/**
 * RH-187: Pure rules, validation, generation and hashing for Personal Access Tokens.
 */
import crypto from 'node:crypto'

export const API_TOKEN_PREFIX = 'rh_pat_'
export const API_TOKEN_MAX_ACTIVE = 10

export const API_TOKEN_SCOPES = ['read', 'write:songs', 'write:tabs'] as const
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number]

export const API_TOKEN_EXPIRY_OPTIONS = [30, 90, 365, null] as const
export type ApiTokenExpiryOption = (typeof API_TOKEN_EXPIRY_OPTIONS)[number]

export const MSG_TOKEN_NAME_REQUIRED = 'Give the token a name.'
export const MSG_TOKEN_NAME_TOO_LONG = 'Token names are at most 50 characters.'
export const MSG_TOKEN_SCOPE_REQUIRED = 'Pick at least one scope.'
export const MSG_TOKEN_MAX_ACTIVE = 'You can have at most 10 active tokens. Revoke one first.'
export const MSG_TOKEN_EXPIRY_INVALID = 'Invalid expiry duration.'

const TOKEN_PATTERN = /^rh_pat_[A-Za-z0-9_-]{43}$/

/**
 * Generates a new cryptographically random personal access token.
 * Format: `rh_pat_` + 32 random bytes in base64url (43 characters).
 */
export function generateApiToken(): string {
  const bytes = crypto.randomBytes(32)
  return `${API_TOKEN_PREFIX}${bytes.toString('base64url')}`
}

/**
 * Computes the SHA-256 hex digest of the given token.
 */
export function hashApiToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Extracts the first 12 characters as a display prefix (e.g. `rh_pat_AbC1`).
 */
export function extractApiTokenPrefix(token: string): string {
  return token.slice(0, 12)
}

/**
 * Parses an Authorization header value.
 * Accepts only `Bearer rh_pat_...` where the token matches the pattern.
 */
export function parseBearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim())
  if (!match) return null
  const token = match[1]
  if (!TOKEN_PATTERN.test(token)) return null
  return token
}

export type ValidationResult =
  | { valid: true; name: string; scopes: ApiTokenScope[] }
  | { valid: false; error: string }

/**
 * Validates token creation parameters.
 */
export function validateApiTokenCreation(params: {
  name: string
  scopes: readonly ApiTokenScope[]
  activeTokenCount: number
  expiryDays?: unknown
}): ValidationResult {
  const trimmedName = params.name.trim()
  if (!trimmedName) {
    return { valid: false, error: MSG_TOKEN_NAME_REQUIRED }
  }
  if (trimmedName.length > 50) {
    return { valid: false, error: MSG_TOKEN_NAME_TOO_LONG }
  }

  const validScopes = params.scopes.filter((s) => API_TOKEN_SCOPES.includes(s))
  if (validScopes.length === 0 || validScopes.length !== params.scopes.length) {
    return { valid: false, error: MSG_TOKEN_SCOPE_REQUIRED }
  }

  if (params.activeTokenCount >= API_TOKEN_MAX_ACTIVE) {
    return { valid: false, error: MSG_TOKEN_MAX_ACTIVE }
  }

  const allowedExpiry: readonly unknown[] = API_TOKEN_EXPIRY_OPTIONS
  if (params.expiryDays !== undefined && !allowedExpiry.includes(params.expiryDays)) {
    return { valid: false, error: MSG_TOKEN_EXPIRY_INVALID }
  }

  return {
    valid: true,
    name: trimmedName,
    scopes: [...validScopes],
  }
}
