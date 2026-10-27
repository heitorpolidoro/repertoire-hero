import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/apiTokens', () => ({
  resolveActiveApiToken: vi.fn(),
  touchApiTokenLastUsed: vi.fn(),
}))

vi.mock('@/lib/ownerSongs', () => ({
  getRepertoire: vi.fn(),
  getResolvedEntryForVersion: vi.fn(),
  updateSongOverrides: vi.fn(),
}))

vi.mock('@/lib/customFields', () => ({
  listCustomFields: vi.fn(),
  getCustomFieldValues: vi.fn(),
  setCustomFieldValue: vi.fn(),
}))

vi.mock('@/lib/tabUpload', () => ({
  uploadTabForUser: vi.fn(),
}))

vi.mock('@/lib/apiSongs', () => ({
  findSongVersion: vi.fn(),
  filterApiRepertoire: vi.fn(),
}))

import { resolveActiveApiToken } from '@/lib/apiTokens'
import { generateApiToken } from '@/lib/apiTokenRules'
import { updateSongOverrides } from '@/lib/ownerSongs'
import { setCustomFieldValue } from '@/lib/customFields'
import { uploadTabForUser } from '@/lib/tabUpload'
import { GET as getSongs } from '@/app/api/v1/songs/route'
import { GET as getSongVersion } from '@/app/api/v1/songs/[versionId]/route'
import { GET as getCustomFields } from '@/app/api/v1/custom-fields/route'
import { PUT as putTuning } from '@/app/api/v1/songs/[versionId]/tuning/route'
import { PUT as putCustomField } from '@/app/api/v1/songs/[versionId]/custom-fields/[fieldName]/route'
import { POST as postTabs } from '@/app/api/v1/tabs/route'

describe('apiAuth (route-level)', () => {
  const readToken = generateApiToken()
  const writeSongsToken = generateApiToken()
  const writeTabsToken = generateApiToken()
  const unknownToken = generateApiToken()

  const dummyVersionId = '11111111-1111-1111-1111-111111111111'

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(resolveActiveApiToken).mockImplementation(async (token: string) => {
      if (token === readToken) {
        return {
          id: 'tok-read',
          userId: 'user-1',
          name: 'Read Token',
          tokenPrefix: readToken.slice(0, 12),
          scopes: ['read'],
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          expiresAt: null,
          revokedAt: null,
        }
      }
      if (token === writeSongsToken) {
        return {
          id: 'tok-write-songs',
          userId: 'user-1',
          name: 'Write Songs Token',
          tokenPrefix: writeSongsToken.slice(0, 12),
          scopes: ['write:songs'],
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          expiresAt: null,
          revokedAt: null,
        }
      }
      if (token === writeTabsToken) {
        return {
          id: 'tok-write-tabs',
          userId: 'user-1',
          name: 'Write Tabs Token',
          tokenPrefix: writeTabsToken.slice(0, 12),
          scopes: ['write:tabs'],
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          expiresAt: null,
          revokedAt: null,
        }
      }
      return null
    })
  })

  const routes: Array<{
    name: string
    invoke: (headers: Record<string, string>) => Promise<Response>
    writeScope?: 'write:songs' | 'write:tabs'
  }> = [
    {
      name: 'GET /api/v1/songs',
      invoke: (headers) =>
        getSongs(
          new NextRequest('http://localhost:3000/api/v1/songs', { headers }),
          { params: Promise.resolve({}) as any },
        ),
    },
    {
      name: 'GET /api/v1/songs/[versionId]',
      invoke: (headers) =>
        getSongVersion(
          new NextRequest(`http://localhost:3000/api/v1/songs/${dummyVersionId}`, { headers }),
          { params: Promise.resolve({ versionId: dummyVersionId }) },
        ),
    },
    {
      name: 'GET /api/v1/custom-fields',
      invoke: (headers) =>
        getCustomFields(
          new NextRequest('http://localhost:3000/api/v1/custom-fields', { headers }),
          { params: Promise.resolve({}) as any },
        ),
    },
    {
      name: 'PUT /api/v1/songs/[versionId]/tuning',
      writeScope: 'write:songs',
      invoke: (headers) =>
        putTuning(
          new NextRequest(`http://localhost:3000/api/v1/songs/${dummyVersionId}/tuning`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ tuning: 'Drop D' }),
          }),
          { params: Promise.resolve({ versionId: dummyVersionId }) },
        ),
    },
    {
      name: 'PUT /api/v1/songs/[versionId]/custom-fields/[fieldName]',
      writeScope: 'write:songs',
      invoke: (headers) =>
        putCustomField(
          new NextRequest(
            `http://localhost:3000/api/v1/songs/${dummyVersionId}/custom-fields/preset`,
            {
              method: 'PUT',
              headers,
              body: JSON.stringify({ value: 'Lead 3B' }),
            },
          ),
          { params: Promise.resolve({ versionId: dummyVersionId, fieldName: 'preset' }) },
        ),
    },
    {
      name: 'POST /api/v1/tabs',
      writeScope: 'write:tabs',
      invoke: (headers) => {
        const fd = new FormData()
        fd.append('versionId', dummyVersionId)
        fd.append('title', 'Tab')
        fd.append('file', new File(['%PDF'], 'tab.pdf', { type: 'application/pdf' }))
        return postTabs(
          new NextRequest('http://localhost:3000/api/v1/tabs', {
            method: 'POST',
            headers,
            body: fd,
          }),
          { params: Promise.resolve({}) as any },
        )
      },
    },
  ]

  function assertNothingWritten() {
    expect(updateSongOverrides).not.toHaveBeenCalled()
    expect(setCustomFieldValue).not.toHaveBeenCalled()
    expect(uploadTabForUser).not.toHaveBeenCalled()
  }

  for (const { name, invoke, writeScope } of routes) {
    describe(name, () => {
      it('answers 401 when no Authorization header is present', async () => {
        const res = await invoke({})
        expect(res.status).toBe(401)
        expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
        const body = await res.json()
        expect(body).toEqual({ error: 'Missing or invalid API token' })
        assertNothingWritten()
      })

      it('answers 401 when request carries only a session cookie', async () => {
        const res = await invoke({
          Cookie: 'better-auth.session_token=valid-session-cookie-value',
        })
        expect(res.status).toBe(401)
        expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
        const body = await res.json()
        expect(body).toEqual({ error: 'Missing or invalid API token' })
        assertNothingWritten()
      })

      it('answers 401 on Basic auth scheme', async () => {
        const res = await invoke({
          Authorization: 'Basic dXNlcjpwYXNz',
        })
        expect(res.status).toBe(401)
        expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
        const body = await res.json()
        expect(body).toEqual({ error: 'Missing or invalid API token' })
        assertNothingWritten()
      })

      it('answers 401 on malformed Bearer token', async () => {
        const res = await invoke({
          Authorization: 'Bearer not_a_valid_token',
        })
        expect(res.status).toBe(401)
        expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
        const body = await res.json()
        expect(body).toEqual({ error: 'Missing or invalid API token' })
        assertNothingWritten()
      })

      it('answers 401 on unknown or revoked token', async () => {
        const res = await invoke({
          Authorization: `Bearer ${unknownToken}`,
        })
        expect(res.status).toBe(401)
        expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
        const body = await res.json()
        expect(body).toEqual({ error: 'Missing or invalid API token' })
        assertNothingWritten()
      })

      if (writeScope) {
        it(`answers 403 when token lacks ${writeScope} scope`, async () => {
          const res = await invoke({
            Authorization: `Bearer ${readToken}`,
          })
          expect(res.status).toBe(403)
          const body = await res.json()
          expect(body).toEqual({ error: `This token lacks the ${writeScope} scope` })
          assertNothingWritten()
        })
      }
    })
  }
})
