import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import { GET as getSongs } from '@/app/api/v1/songs/route'
import {
  createApiToken,
  listActiveApiTokens,
  revokeApiToken,
  resolveActiveApiToken,
  touchApiTokenLastUsed,
} from '../apiTokens'
import { MSG_TOKEN_MAX_ACTIVE } from '../apiTokenRules'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('apiTokens (real database)', () => {
  const suffix = Date.now()
  let userA: string
  let userB: string

  beforeAll(async () => {
    userA = await createTestUser({ email: `rh187-user-a-${suffix}@example.com`, name: 'User A' })
    userB = await createTestUser({ email: `rh187-user-b-${suffix}@example.com`, name: 'User B' })
  })

  afterAll(async () => {
    if (userA) await deleteTestUser(userA)
    if (userB) await deleteTestUser(userB)
  })

  it('stores only the SHA-256 hash: no column contains the plaintext token', async () => {
    const { token, plaintext } = await createApiToken(userA, {
      name: 'Agent Token',
      scopes: ['read', 'write:songs'],
    })

    expect(plaintext).toMatch(/^rh_pat_[A-Za-z0-9_-]{43}$/)
    expect(token.name).toBe('Agent Token')
    expect(token.tokenPrefix).toBe(plaintext.slice(0, 12))
    expect(token.scopes).toEqual(['read', 'write:songs'])

    const dbRow = await query<Record<string, unknown>>(
      'SELECT * FROM api_tokens WHERE id = $1',
      [token.id],
    )
    expect(dbRow.rows).toHaveLength(1)
    const row = dbRow.rows[0]

    for (const [col, val] of Object.entries(row)) {
      if (typeof val === 'string') {
        expect(
          val.includes(plaintext),
          `Column ${col} contains the plaintext token: ${val}`,
        ).toBe(false)
      }
    }
  })

  it('resolves an active token and refuses it once revoked', async () => {
    const { token, plaintext } = await createApiToken(userA, {
      name: 'Revocable Token',
      scopes: ['read'],
    })

    const resolvedBefore = await resolveActiveApiToken(plaintext)
    expect(resolvedBefore).not.toBeNull()
    expect(resolvedBefore?.id).toBe(token.id)
    expect(resolvedBefore?.userId).toBe(userA)

    const revoked = await revokeApiToken(userA, token.id)
    expect(revoked).toBe(true)

    const resolvedAfter = await resolveActiveApiToken(plaintext)
    expect(resolvedAfter).toBeNull()
  })

  it('refuses an expired token', async () => {
    const { token, plaintext } = await createApiToken(userA, {
      name: 'Expiring Token',
      scopes: ['read'],
    })

    // Manually push expires_at into the past
    await query('UPDATE api_tokens SET expires_at = now() - interval \'1 day\' WHERE id = $1', [
      token.id,
    ])

    const resolved = await resolveActiveApiToken(plaintext)
    expect(resolved).toBeNull()
  })

  it('prevents user B from revoking user A token', async () => {
    const { token, plaintext } = await createApiToken(userA, {
      name: 'User A Protected Token',
      scopes: ['read'],
    })

    const revoked = await revokeApiToken(userB, token.id)
    expect(revoked).toBe(false)

    // Token remains active
    const resolved = await resolveActiveApiToken(plaintext)
    expect(resolved).not.toBeNull()
    expect(resolved?.id).toBe(token.id)
  })

  it('refuses the 11th active token for a user', async () => {
    const createdTokens: string[] = []

    // Ensure user B starts fresh
    await query('DELETE FROM api_tokens WHERE user_id = $1', [userB])

    for (let i = 1; i <= 10; i++) {
      const { token } = await createApiToken(userB, {
        name: `Token ${i}`,
        scopes: ['read'],
      })
      createdTokens.push(token.id)
    }

    await expect(
      createApiToken(userB, {
        name: 'Eleventh Token',
        scopes: ['read'],
      }),
    ).rejects.toThrow(MSG_TOKEN_MAX_ACTIVE)

    // If one is revoked, a 10th active token can be created
    await revokeApiToken(userB, createdTokens[0])

    const { token: newActive } = await createApiToken(userB, {
      name: 'New Tenth Token',
      scopes: ['read'],
    })
    expect(newActive).toBeDefined()
  })

  it('lists only active tokens in descending creation order', async () => {
    await query('DELETE FROM api_tokens WHERE user_id = $1', [userA])

    const { token: t1 } = await createApiToken(userA, { name: 'Token 1', scopes: ['read'] })
    const { token: t2 } = await createApiToken(userA, { name: 'Token 2', scopes: ['write:songs'] })
    const { token: t3 } = await createApiToken(userA, { name: 'Token 3', scopes: ['write:tabs'] })

    await revokeApiToken(userA, t2.id)

    const list = await listActiveApiTokens(userA)
    const ids = list.map((t) => t.id)
    expect(ids).toContain(t3.id)
    expect(ids).toContain(t1.id)
    expect(ids).not.toContain(t2.id)
    expect(ids[0]).toBe(t3.id)
    expect(ids[1]).toBe(t1.id)
  })

  it('touches last_used_at on an api token', async () => {
    const { token } = await createApiToken(userA, { name: 'Touch Token', scopes: ['read'] })
    expect(token.lastUsedAt).toBeNull()

    await touchApiTokenLastUsed(token.id)

    const dbRow = await query<{ last_used_at: string | null }>(
      'SELECT last_used_at FROM api_tokens WHERE id = $1',
      [token.id],
    )
    expect(dbRow.rows[0].last_used_at).not.toBeNull()
  })

  it('GET /api/v1/songs answers 401 for a token after it is revoked, though it answered 200 with that token before', async () => {
    const { token, plaintext } = await createApiToken(userA, {
      name: 'Revoke test token',
      scopes: ['read'],
    })
    const reqBefore = new NextRequest('http://localhost:3000/api/v1/songs', {
      headers: { Authorization: `Bearer ${plaintext}` },
    })
    const resBefore = await getSongs(reqBefore, { params: Promise.resolve({}) as any })
    expect(resBefore.status).toBe(200)

    await revokeApiToken(userA, token.id)

    const reqAfter = new NextRequest('http://localhost:3000/api/v1/songs', {
      headers: { Authorization: `Bearer ${plaintext}` },
    })
    const resAfter = await getSongs(reqAfter, { params: Promise.resolve({}) as any })
    expect(resAfter.status).toBe(401)
    expect(await resAfter.json()).toEqual({ error: 'Missing or invalid API token' })
  })
})
