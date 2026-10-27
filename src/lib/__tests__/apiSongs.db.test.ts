import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { query } from '@/lib/db'
import { createApiToken, revokeApiToken } from '../apiTokens'
import { createCustomField } from '../customFields'
import { createTestUser, deleteTestUser } from './test-helpers'
import { GET as getSongs } from '@/app/api/v1/songs/route'
import { GET as getSongVersion } from '@/app/api/v1/songs/[versionId]/route'
import { PUT as putTuning } from '@/app/api/v1/songs/[versionId]/tuning/route'
import { PUT as putCustomField } from '@/app/api/v1/songs/[versionId]/custom-fields/[fieldName]/route'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

describe.skipIf(!RUN_DB_TESTS)('apiSongs (real database)', () => {
  const suffix = Date.now()
  let userA: string
  let userB: string
  let tokenA: string
  let tokenIdA: string
  let songIdA: string
  let v1A: string
  let v2A: string
  let songIdB: string
  let v1B: string

  const req = (
    url: string,
    options: { method?: string; token?: string; body?: unknown } = {},
  ) => {
    const headers: Record<string, string> = {}
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`
    }
    if (options.body) {
      headers['Content-Type'] = 'application/json'
    }
    return new NextRequest(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  }

  beforeAll(async () => {
    userA = await createTestUser({ email: `rh187-songs-a-${suffix}@example.com`, name: 'User A' })
    userB = await createTestUser({ email: `rh187-songs-b-${suffix}@example.com`, name: 'User B' })

    const tok = await createApiToken(userA, {
      name: 'Agent A',
      scopes: ['read', 'write:songs', 'write:tabs'],
    })
    tokenA = tok.plaintext
    tokenIdA = tok.token.id

    // Create Song A in catalog with 2 versions
    songIdA = randomUUID()
    await query(
      'INSERT INTO songs (id, title, artist) VALUES ($1, $2, $3)',
      [songIdA, `Song Alpha ${suffix}`, `Artist A ${suffix}`],
    )
    v1A = randomUUID()
    v2A = randomUUID()
    await query(
      'INSERT INTO song_versions (id, song_id, label, tuning) VALUES ($1, $2, $3, $4)',
      [v1A, songIdA, 'Original Version', 'E'],
    )
    await query(
      'INSERT INTO song_versions (id, song_id, label, tuning) VALUES ($1, $2, $3, $4)',
      [v2A, songIdA, 'Acoustic Version', null],
    )

    // User A holds v1A in repertoire
    await query(
      'INSERT INTO user_songs (user_id, version_id, status) VALUES ($1, $2, $3)',
      [userA, v1A, 'learning'],
    )
    // User B also holds v1A in repertoire with independent tuning
    await query(
      'INSERT INTO user_songs (user_id, version_id, status, tuning) VALUES ($1, $2, $3, $4)',
      [userB, v1A, 'learning', 'Open G'],
    )

    // Create Song B for User B
    songIdB = randomUUID()
    await query(
      'INSERT INTO songs (id, title, artist) VALUES ($1, $2, $3)',
      [songIdB, `Song Beta ${suffix}`, `Artist B ${suffix}`],
    )
    v1B = randomUUID()
    await query(
      'INSERT INTO song_versions (id, song_id, label) VALUES ($1, $2, $3)',
      [v1B, songIdB, 'Single'],
    )
    await query(
      'INSERT INTO user_songs (user_id, version_id, status) VALUES ($1, $2, $3)',
      [userB, v1B, 'mastered'],
    )

    // Create custom field Preset for user A
    await createCustomField(userA, 'Preset')
  })

  afterAll(async () => {
    if (userA) await deleteTestUser(userA)
    if (userB) await deleteTestUser(userB)
    if (songIdA) await query('DELETE FROM songs WHERE id = $1', [songIdA])
    if (songIdB) await query('DELETE FROM songs WHERE id = $1', [songIdB])
  })

  it('GET /api/v1/songs?q= returns the matching songs of token user and none of another user', async () => {
    // Search for Alpha (user A's song)
    const request = req(`http://localhost:3000/api/v1/songs?q=alpha`, { token: tokenA })
    const res = await getSongs(request, { params: Promise.resolve({}) as any })
    expect(res.status).toBe(200)

    const list = await res.json()
    expect(Array.isArray(list)).toBe(true)
    const itemA = list.find((s: any) => s.versionId === v1A)
    expect(itemA).toBeDefined()
    expect(itemA.versionLabel).toBe('Original Version')
    expect(list.some((s: any) => s.versionId === v1B)).toBe(false)

    // Search for Beta (user B's song) - user A should see nothing
    const reqB = req(`http://localhost:3000/api/v1/songs?q=beta`, { token: tokenA })
    const resB = await getSongs(reqB, { params: Promise.resolve({}) as any })
    expect(resB.status).toBe(200)
    const listB = await resB.json()
    expect(listB).toEqual([])
  })

  it('PUT /api/v1/songs/{versionId}/tuning writes user_songs.tuning and leaves song_versions.tuning unchanged', async () => {
    const request = req(`http://localhost:3000/api/v1/songs/${v1A}/tuning`, {
      method: 'PUT',
      token: tokenA,
      body: { tuning: 'Drop D' },
    })

    const res = await putTuning(request, { params: Promise.resolve({ versionId: v1A }) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ tuning: 'Drop D' })

    // Verify user_songs.tuning was updated
    const userRow = await query<{ tuning: string | null }>(
      'SELECT tuning FROM user_songs WHERE user_id = $1 AND version_id = $2',
      [userA, v1A],
    )
    expect(userRow.rows[0].tuning).toBe('Drop D')

    // Verify song_versions.tuning is untouched (still 'E')
    const versionRow = await query<{ tuning: string | null }>(
      'SELECT tuning FROM song_versions WHERE id = $1',
      [v1A],
    )
    expect(versionRow.rows[0].tuning).toBe('E')

    // Verify user B's hold on v1A is untouched (still 'Open G')
    const userBRow = await query<{ tuning: string | null }>(
      'SELECT tuning FROM user_songs WHERE user_id = $1 AND version_id = $2',
      [userB, v1A],
    )
    expect(userBRow.rows[0].tuning).toBe('Open G')
  })

  it('PUT /api/v1/songs/{versionId}/tuning returns 404 on unheld version and writes nothing', async () => {
    const request = req(`http://localhost:3000/api/v1/songs/${v2A}/tuning`, {
      method: 'PUT',
      token: tokenA,
      body: { tuning: 'Drop D' },
    })

    const res = await putTuning(request, { params: Promise.resolve({ versionId: v2A }) })
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data).toEqual({ error: 'This song is not in your repertoire' })

    // No row created
    const userRow = await query(
      'SELECT 1 FROM user_songs WHERE user_id = $1 AND version_id = $2',
      [userA, v2A],
    )
    expect(userRow.rows).toHaveLength(0)
  })

  it('PUT /api/v1/songs/{versionId}/custom-fields/preset stores value on unheld version and leaves repertoire untouched', async () => {
    const request = req(
      `http://localhost:3000/api/v1/songs/${v2A}/custom-fields/preset`,
      {
        method: 'PUT',
        token: tokenA,
        body: { value: 'Lead 3B' },
      },
    )

    const res = await putCustomField(request, {
      params: Promise.resolve({ versionId: v2A, fieldName: 'preset' }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ field: 'Preset', value: 'Lead 3B' })

    // No user_songs row created for v2A
    const userRow = await query(
      'SELECT 1 FROM user_songs WHERE user_id = $1 AND version_id = $2',
      [userA, v2A],
    )
    expect(userRow.rows).toHaveLength(0)

    // GET /api/v1/songs/{versionId} now returns inRepertoire: false and the preset value
    const getReq = req(`http://localhost:3000/api/v1/songs/${v2A}`, { token: tokenA })
    const getRes = await getSongVersion(getReq, {
      params: Promise.resolve({ versionId: v2A }),
    })
    expect(getRes.status).toBe(200)
    const detail = await getRes.json()
    expect(detail.inRepertoire).toBe(false)
    expect(detail.status).toBeNull()
    expect(detail.customFields).toContainEqual({ name: 'Preset', value: 'Lead 3B' })
  })

  it('PUT /api/v1/songs/{versionId}/custom-fields/nonexistent returns 404', async () => {
    const request = req(
      `http://localhost:3000/api/v1/songs/${v1A}/custom-fields/nonexistent`,
      {
        method: 'PUT',
        token: tokenA,
        body: { value: 'Something' },
      },
    )

    const res = await putCustomField(request, {
      params: Promise.resolve({ versionId: v1A, fieldName: 'nonexistent' }),
    })
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data).toEqual({ error: 'Custom field not found' })
  })

  it('answers 404 Song version not found for random UUID on GET and both PUTs', async () => {
    const randomId = randomUUID()

    const getRes = await getSongVersion(
      req(`http://localhost:3000/api/v1/songs/${randomId}`, { token: tokenA }),
      { params: Promise.resolve({ versionId: randomId }) },
    )
    expect(getRes.status).toBe(404)
    expect(await getRes.json()).toEqual({ error: 'Song version not found' })

    const putTuningRes = await putTuning(
      req(`http://localhost:3000/api/v1/songs/${randomId}/tuning`, {
        method: 'PUT',
        token: tokenA,
        body: { tuning: 'Drop D' },
      }),
      { params: Promise.resolve({ versionId: randomId }) },
    )
    expect(putTuningRes.status).toBe(404)
    expect(await putTuningRes.json()).toEqual({ error: 'Song version not found' })

    const putFieldRes = await putCustomField(
      req(`http://localhost:3000/api/v1/songs/${randomId}/custom-fields/preset`, {
        method: 'PUT',
        token: tokenA,
        body: { value: 'Val' },
      }),
      { params: Promise.resolve({ versionId: randomId, fieldName: 'preset' }) },
    )
    expect(putFieldRes.status).toBe(404)
    expect(await putFieldRes.json()).toEqual({ error: 'Song version not found' })
  })

  it('GET /api/v1/songs answers 401 for a token after it is revoked, though it answered 200 before', async () => {
    // Answered 200 before
    const beforeRes = await getSongs(
      req(`http://localhost:3000/api/v1/songs`, { token: tokenA }),
      { params: Promise.resolve({}) as any },
    )
    expect(beforeRes.status).toBe(200)

    // Revoke token
    const revoked = await revokeApiToken(userA, tokenIdA)
    expect(revoked).toBe(true)

    // Answers 401 after
    const afterRes = await getSongs(
      req(`http://localhost:3000/api/v1/songs`, { token: tokenA }),
      { params: Promise.resolve({}) as any },
    )
    expect(afterRes.status).toBe(401)
    expect(await afterRes.json()).toEqual({ error: 'Missing or invalid API token' })
  })
})
