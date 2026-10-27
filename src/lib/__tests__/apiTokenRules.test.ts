import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import {
  API_TOKEN_PREFIX,
  API_TOKEN_SCOPES,
  API_TOKEN_EXPIRY_OPTIONS,
  API_TOKEN_MAX_ACTIVE,
  generateApiToken,
  hashApiToken,
  extractApiTokenPrefix,
  parseBearerToken,
  validateApiTokenCreation,
  MSG_TOKEN_NAME_REQUIRED,
  MSG_TOKEN_NAME_TOO_LONG,
  MSG_TOKEN_SCOPE_REQUIRED,
  MSG_TOKEN_MAX_ACTIVE,
  type ApiTokenScope,
} from '../apiTokenRules'

describe('apiTokenRules', () => {
  it('generates tokens matching ^rh_pat_[A-Za-z0-9_-]{43}$', () => {
    const token = generateApiToken()
    expect(token).toMatch(/^rh_pat_[A-Za-z0-9_-]{43}$/)
    expect(token.length).toBe(50)
  })

  it('hashes a token with SHA-256 to a 64-char hex string', () => {
    const token = generateApiToken()
    const hash = hashApiToken(token)
    const expected = crypto.createHash('sha256').update(token).digest('hex')
    expect(hash).toBe(expected)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('extracts the first 12 characters as display prefix', () => {
    const token = 'rh_pat_AbC1234567890abcdefghijklmnopqrstuvwxyz1234'
    expect(extractApiTokenPrefix(token)).toBe('rh_pat_AbC12')
    expect(extractApiTokenPrefix(token).length).toBe(12)
  })

  describe('parseBearerToken', () => {
    it('accepts only Bearer rh_pat_...', () => {
      const valid = generateApiToken()
      expect(parseBearerToken(`Bearer ${valid}`)).toBe(valid)
      expect(parseBearerToken(`bearer ${valid}`)).toBe(valid)
    })

    it('rejects missing or non-Bearer headers', () => {
      expect(parseBearerToken(null)).toBeNull()
      expect(parseBearerToken('')).toBeNull()
      expect(parseBearerToken('Basic dXNlcjpwYXNz')).toBeNull()
      expect(parseBearerToken('Bearer')).toBeNull()
      expect(parseBearerToken('Bearer   ')).toBeNull()
      expect(parseBearerToken('Token abc')).toBeNull()
    })

    it('rejects tokens that do not start with rh_pat_ or have invalid characters/length', () => {
      expect(parseBearerToken('Bearer not_a_pat')).toBeNull()
      expect(parseBearerToken('Bearer rh_pat_short')).toBeNull()
      expect(parseBearerToken(`Bearer rh_pat_${'a'.repeat(42)}`)).toBeNull()
      expect(parseBearerToken(`Bearer rh_pat_${'a'.repeat(44)}`)).toBeNull()
      expect(parseBearerToken(`Bearer rh_pat_${'a'.repeat(41)}!`)).toBeNull()
    })
  })

  describe('validateApiTokenCreation', () => {
    it('validates a correct creation payload', () => {
      const result = validateApiTokenCreation({
        name: ' Claude Code ',
        scopes: ['read', 'write:songs'],
        activeTokenCount: 2,
      })
      expect(result).toEqual({
        valid: true,
        name: 'Claude Code',
        scopes: ['read', 'write:songs'],
      })
    })

    it('refuses empty or whitespace-only name', () => {
      expect(
        validateApiTokenCreation({
          name: '',
          scopes: ['read'],
          activeTokenCount: 0,
        }),
      ).toEqual({
        valid: false,
        error: MSG_TOKEN_NAME_REQUIRED,
      })

      expect(
        validateApiTokenCreation({
          name: '   ',
          scopes: ['read'],
          activeTokenCount: 0,
        }),
      ).toEqual({
        valid: false,
        error: MSG_TOKEN_NAME_REQUIRED,
      })
    })

    it('refuses names longer than 50 characters', () => {
      expect(
        validateApiTokenCreation({
          name: 'a'.repeat(51),
          scopes: ['read'],
          activeTokenCount: 0,
        }),
      ).toEqual({
        valid: false,
        error: MSG_TOKEN_NAME_TOO_LONG,
      })
    })

    it('refuses empty scopes or invalid scopes', () => {
      expect(
        validateApiTokenCreation({
          name: 'Test',
          scopes: [],
          activeTokenCount: 0,
        }),
      ).toEqual({
        valid: false,
        error: MSG_TOKEN_SCOPE_REQUIRED,
      })

      expect(
        validateApiTokenCreation({
          name: 'Test',
          scopes: ['invalid' as ApiTokenScope],
          activeTokenCount: 0,
        }),
      ).toEqual({
        valid: false,
        error: MSG_TOKEN_SCOPE_REQUIRED,
      })
    })

    it('refuses creation when user holds 10 active tokens', () => {
      expect(
        validateApiTokenCreation({
          name: 'Eleventh Token',
          scopes: ['read'],
          activeTokenCount: 10,
        }),
      ).toEqual({
        valid: false,
        error: MSG_TOKEN_MAX_ACTIVE,
      })
    })

    it('refuses invalid expiry duration', () => {
      expect(
        validateApiTokenCreation({
          name: 'Test',
          scopes: ['read'],
          activeTokenCount: 0,
          expiryDays: 45 as any,
        }),
      ).toEqual({
        valid: false,
        error: 'Invalid expiry duration.',
      })
    })
  })

  it('defines the 3 scopes, expiry options, and max active tokens', () => {
    expect(API_TOKEN_SCOPES).toEqual(['read', 'write:songs', 'write:tabs'])
    expect(API_TOKEN_MAX_ACTIVE).toBe(10)
    expect(API_TOKEN_PREFIX).toBe('rh_pat_')
    expect(API_TOKEN_EXPIRY_OPTIONS).toEqual([30, 90, 365, null])
  })
})
