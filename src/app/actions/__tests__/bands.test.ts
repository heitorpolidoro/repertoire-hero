import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({
  getRequiredUserId: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}))

vi.mock('@/lib/bands', () => ({
  getBands: vi.fn(),
  getBandWithMembers: vi.fn(),
  createBand: vi.fn(),
  updateBand: vi.fn(),
  deleteBand: vi.fn(),
  leaveBand: vi.fn(),
  removeBandMember: vi.fn(),
  getBandPlaylists: vi.fn(),
  createBandPlaylist: vi.fn(),
  regenerateBandInviteCode: vi.fn(),
}))

import {
  getBandsAction,
  getBandWithMembersAction,
  createBandAction,
  updateBandAction,
  deleteBandAction,
  leaveBandAction,
  removeBandMemberAction,
  getBandPlaylistsAction,
  createBandPlaylistAction,
  regenerateBandInviteCodeAction,
  uploadBandCoverAction,
} from '../bands'
import { getRequiredUserId } from '@/lib/auth-session'
import { put } from '@vercel/blob'
import {
  getBands,
  getBandWithMembers,
  createBand,
  updateBand,
  deleteBand,
  leaveBand,
  removeBandMember,
  getBandPlaylists,
  createBandPlaylist,
  regenerateBandInviteCode,
} from '@/lib/bands'

const USER_ID = 'user-1'
const BAND_ID = 'band-1'
const MEMBER_ID = 'member-1'

/**
 * Each action is either "session-bound" (it resolves the signed-in user id and
 * threads it into `@/lib/bands`) or a bare pass-through. The table pins which,
 * and the exact argument order the lib call receives.
 */
const DELEGATIONS: Array<{
  label: string
  lib: () => ReturnType<typeof vi.fn>
  run: () => Promise<unknown>
  args: unknown[]
  sessionBound: boolean
}> = [
  {
    label: 'getBandsAction',
    lib: () => vi.mocked(getBands),
    run: () => getBandsAction(),
    args: [USER_ID],
    sessionBound: true,
  },
  {
    label: 'createBandAction',
    lib: () => vi.mocked(createBand),
    run: () => createBandAction('The Band', 'desc', 'https://cdn/x.jpg', '#1d4ed8'),
    args: [USER_ID, 'The Band', 'desc', 'https://cdn/x.jpg', '#1d4ed8'],
    sessionBound: true,
  },
  {
    label: 'leaveBandAction',
    lib: () => vi.mocked(leaveBand),
    run: () => leaveBandAction(BAND_ID),
    args: [BAND_ID, USER_ID],
    sessionBound: true,
  },
  {
    label: 'regenerateBandInviteCodeAction',
    lib: () => vi.mocked(regenerateBandInviteCode),
    run: () => regenerateBandInviteCodeAction(BAND_ID),
    args: [BAND_ID, USER_ID],
    sessionBound: true,
  },
  {
    label: 'getBandWithMembersAction',
    lib: () => vi.mocked(getBandWithMembers),
    run: () => getBandWithMembersAction(BAND_ID),
    args: [BAND_ID],
    sessionBound: false,
  },
  {
    label: 'updateBandAction',
    lib: () => vi.mocked(updateBand),
    run: () => updateBandAction(BAND_ID, { name: 'Renamed' }),
    args: [BAND_ID, { name: 'Renamed' }],
    sessionBound: false,
  },
  {
    label: 'deleteBandAction',
    lib: () => vi.mocked(deleteBand),
    run: () => deleteBandAction(BAND_ID),
    args: [BAND_ID],
    sessionBound: false,
  },
  {
    label: 'removeBandMemberAction',
    lib: () => vi.mocked(removeBandMember),
    run: () => removeBandMemberAction(MEMBER_ID),
    args: [MEMBER_ID],
    sessionBound: false,
  },
  {
    label: 'getBandPlaylistsAction',
    lib: () => vi.mocked(getBandPlaylists),
    run: () => getBandPlaylistsAction(BAND_ID),
    args: [BAND_ID],
    sessionBound: false,
  },
  {
    label: 'createBandPlaylistAction',
    lib: () => vi.mocked(createBandPlaylist),
    run: () => createBandPlaylistAction(BAND_ID, 'Setlist'),
    args: [BAND_ID, 'Setlist'],
    sessionBound: false,
  },
]

/** `uploadBandCoverAction` only ever calls `formData.get('file')`. */
function formDataWith(file: unknown): FormData {
  return { get: vi.fn(() => file) } as unknown as FormData
}

function fakeFile(overrides: Partial<{ name: string; type: string; size: number }> = {}) {
  return {
    name: overrides.name ?? 'my cover!.jpg',
    type: overrides.type ?? 'image/jpeg',
    size: overrides.size ?? 1024,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }
}

beforeEach(() => {
  vi.mocked(getRequiredUserId).mockReset()
  vi.mocked(getRequiredUserId).mockResolvedValue(USER_ID)
  vi.mocked(put).mockReset()
  for (const delegation of DELEGATIONS) delegation.lib().mockReset()
})

describe('band action delegation', () => {
  it.each(DELEGATIONS)(
    '$label forwards to @/lib/bands and returns its result',
    async ({ lib, run, args, sessionBound }) => {
      const delegate = lib()
      delegate.mockResolvedValue('lib-result')

      await expect(run()).resolves.toBe('lib-result')

      expect(delegate).toHaveBeenCalledWith(...args)
      expect(vi.mocked(getRequiredUserId).mock.calls.length > 0).toBe(sessionBound)
    },
  )

  it.each(DELEGATIONS)('$label lets an L1 rejection propagate (convention A2)', async ({ lib, run }) => {
    lib().mockRejectedValue(new Error('Failed to fetch bands: boom'))

    await expect(run()).rejects.toThrow('Failed to fetch bands: boom')
  })
})

describe('uploadBandCoverAction', () => {
  it('uploads to Vercel Blob under a per-user path and returns { coverUrl }', async () => {
    vi.mocked(put).mockResolvedValue({ url: 'https://blob.example/cover.jpg' } as never)

    const result = await uploadBandCoverAction(formDataWith(fakeFile()))

    expect(result).toEqual({ coverUrl: 'https://blob.example/cover.jpg' })

    const [filePath, body, options] = vi.mocked(put).mock.calls[0]
    // Unsafe characters in the original filename are replaced with underscores.
    expect(filePath).toMatch(new RegExp(`^band-covers/${USER_ID}/\\d+-my_cover_\\.jpg$`))
    expect(Buffer.isBuffer(body)).toBe(true)
    expect(options).toEqual({ access: 'public', contentType: 'image/jpeg' })
  })

  it.each([
    ['no file is present in the form data', null, 'No image file provided'],
    [
      'the file is not an image',
      fakeFile({ type: 'application/pdf' }),
      'Only image files (JPEG, PNG, WebP, GIF) are allowed',
    ],
    [
      'the file is larger than 5MB',
      fakeFile({ size: 5 * 1024 * 1024 + 1 }),
      'Image size exceeds 5MB limit',
    ],
  ])('returns an { error } envelope when %s', async (_label, file, message) => {
    const result = await uploadBandCoverAction(formDataWith(file))

    expect(result).toEqual({ error: message })
    expect(put).not.toHaveBeenCalled()
  })

  it.each([
    ['carries the message of a thrown Error', new Error('blob quota exceeded'), 'blob quota exceeded'],
    ['falls back for an Error with an empty message', new Error(''), 'Failed to upload band cover image'],
    ['falls back for a non-Error throw', 'just a string', 'Failed to upload band cover image'],
  ])('%s (convention A1)', async (_label, thrown, message) => {
    vi.mocked(put).mockRejectedValue(thrown)

    await expect(uploadBandCoverAction(formDataWith(fakeFile()))).resolves.toEqual({ error: message })
  })
})
