import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/apiTokens', () => ({
  resolveActiveApiToken: vi.fn(),
  touchApiTokenLastUsed: vi.fn(),
}))

vi.mock('@/lib/apiSongs', () => ({
  findSongVersion: vi.fn(),
}))

vi.mock('@/lib/ownerSongs', () => ({
  getPersonalEntryForSong: vi.fn(),
  addSongToRepertoire: vi.fn(),
}))

vi.mock('@/lib/tabs', () => ({
  createTab: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}))

import { resolveActiveApiToken } from '@/lib/apiTokens'
import { findSongVersion } from '@/lib/apiSongs'
import { getPersonalEntryForSong, addSongToRepertoire } from '@/lib/ownerSongs'
import { createTab } from '@/lib/tabs'
import { put } from '@vercel/blob'
import { generateApiToken } from '@/lib/apiTokenRules'
import { UNSUPPORTED_UPLOAD_MESSAGE } from '@/lib/fileIngest'
import { POST } from '../route'
import type { Repertoire, SongFile } from '@/types/database'

describe('POST /api/v1/tabs (route-level)', () => {
  const validToken = generateApiToken()
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(resolveActiveApiToken).mockImplementation(async (token: string) => {
      if (token === validToken) {
        return {
          id: 'tok-1',
          userId: 'user-tabs-1',
          name: 'Tabs Agent',
          tokenPrefix: validToken.slice(0, 12),
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

  it('uploads a PDF tab, creates song_files and repertoire rows, and returns 201 with expected body shape', async () => {
    vi.mocked(findSongVersion).mockResolvedValue({
      versionId: '11111111-1111-1111-1111-111111111111',
      songId: 'song-123',
    })
    vi.mocked(getPersonalEntryForSong).mockResolvedValue(null)
    vi.mocked(addSongToRepertoire).mockResolvedValue({
      id: 'rep-row-1',
      user_id: 'user-tabs-1',
      song_id: 'song-123',
      status: 'unknown',
    } as Repertoire)
    vi.mocked(put).mockResolvedValue({
      url: 'https://blob.example.com/solo.pdf',
    } as any)
    vi.mocked(createTab).mockResolvedValue({
      id: 'file-456',
      title: 'Solo Tab',
      content_type: 'application/pdf',
      file_url: 'https://blob.example.com/solo.pdf',
    } as unknown as SongFile)

    const formData = new FormData()
    formData.append('versionId', '11111111-1111-1111-1111-111111111111')
    formData.append('title', 'Solo Tab')
    formData.append(
      'file',
      new File([pdfBytes], 'solo.pdf', { type: 'application/pdf' }),
    )

    const req = new NextRequest('http://localhost:3000/api/v1/tabs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
      body: formData,
    })

    const res = await POST(req, { params: Promise.resolve({}) as any })
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body).toEqual({
      id: 'file-456',
      title: 'Solo Tab',
      contentType: 'application/pdf',
      createdInRepertoire: true,
    })

    expect(findSongVersion).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111')
    expect(createTab).toHaveBeenCalledWith({
      userId: 'user-tabs-1',
      songId: 'song-123',
      title: 'Solo Tab',
      fileUrl: 'https://blob.example.com/solo.pdf',
      contentType: 'application/pdf',
    })
  })

  it('answers 404 Song version not found when versionId does not exist', async () => {
    vi.mocked(findSongVersion).mockResolvedValue(null)

    const formData = new FormData()
    formData.append('versionId', '22222222-2222-2222-2222-222222222222')
    formData.append('title', 'Unknown Version Tab')
    formData.append(
      'file',
      new File([pdfBytes], 'chart.pdf', { type: 'application/pdf' }),
    )

    const req = new NextRequest('http://localhost:3000/api/v1/tabs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
      body: formData,
    })

    const res = await POST(req, { params: Promise.resolve({}) as any })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Song version not found' })
    expect(createTab).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it('answers 400 Missing required fields when versionId, title or file is missing or not a File', async () => {
    // Missing file
    const form1 = new FormData()
    form1.append('versionId', '11111111-1111-1111-1111-111111111111')
    form1.append('title', 'Title Only')
    const req1 = new NextRequest('http://localhost:3000/api/v1/tabs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
      body: form1,
    })
    const res1 = await POST(req1, { params: Promise.resolve({}) as any })
    expect(res1.status).toBe(400)
    expect(await res1.json()).toEqual({ error: 'Missing required fields' })

    // Missing versionId
    const form2 = new FormData()
    form2.append('title', 'No Version')
    form2.append('file', new File([pdfBytes], 'tab.pdf', { type: 'application/pdf' }))
    const req2 = new NextRequest('http://localhost:3000/api/v1/tabs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
      body: form2,
    })
    const res2 = await POST(req2, { params: Promise.resolve({}) as any })
    expect(res2.status).toBe(400)
    expect(await res2.json()).toEqual({ error: 'Missing required fields' })

    // File passed as plain text field
    const form3 = new FormData()
    form3.append('versionId', '11111111-1111-1111-1111-111111111111')
    form3.append('title', 'Text File')
    form3.append('file', 'not-a-file-object')
    const req3 = new NextRequest('http://localhost:3000/api/v1/tabs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
      body: form3,
    })
    const res3 = await POST(req3, { params: Promise.resolve({}) as any })
    expect(res3.status).toBe(400)
    expect(await res3.json()).toEqual({ error: 'Missing required fields' })
  })

  it('maps lib errors to 400 with the error message (unsupported type, size limit)', async () => {
    vi.mocked(findSongVersion).mockResolvedValue({
      versionId: '11111111-1111-1111-1111-111111111111',
      songId: 'song-123',
    })

    const textBytes = Buffer.from('plain text content not supported')
    const formData = new FormData()
    formData.append('versionId', '11111111-1111-1111-1111-111111111111')
    formData.append('title', 'Bad Type Tab')
    formData.append('file', new File([textBytes], 'doc.txt', { type: 'text/plain' }))

    const req = new NextRequest('http://localhost:3000/api/v1/tabs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
      body: formData,
    })

    const res = await POST(req, { params: Promise.resolve({}) as any })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: UNSUPPORTED_UPLOAD_MESSAGE })
  })

  it('answers 400 Invalid form data when body cannot be parsed as multipart', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/tabs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validToken}`,
        'Content-Type': 'multipart/form-data; boundary=invalid',
      },
      body: 'broken-multipart',
    })

    const res = await POST(req, { params: Promise.resolve({}) as any })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid form data' })
  })
})
