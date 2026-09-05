// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor, cleanup } from '@testing-library/react'

vi.mock('@/app/actions/bands', () => ({
  getBandWithMembersAction: vi.fn(),
  updateBandAction: vi.fn(),
  deleteBandAction: vi.fn(),
  leaveBandAction: vi.fn(),
  removeBandMemberAction: vi.fn(),
  getBandPlaylistsAction: vi.fn(),
  createBandPlaylistAction: vi.fn(),
  uploadBandCoverAction: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: vi.fn() },
}))

vi.mock('@/lib/imageCompressor', () => ({
  compressImageFile: vi.fn(),
}))

import { useBandAdmin, type UseBandAdminOptions } from '../useBandAdmin'
import {
  getBandWithMembersAction,
  updateBandAction,
  deleteBandAction,
  leaveBandAction,
  removeBandMemberAction,
  getBandPlaylistsAction,
  createBandPlaylistAction,
  uploadBandCoverAction,
} from '@/app/actions/bands'
import { authClient } from '@/lib/auth-client'
import { compressImageFile } from '@/lib/imageCompressor'
import { useBandContextStore } from '@/store/bandContextStore'
import { BANDS_PAGE_LOAD_POLICY, BAND_PROFILE_LOAD_POLICY } from '@/lib/bandAdminLoad'
import { DEFAULT_BAND_COLOR } from '@/lib/bandColors'
import type { Band, BandMember, Playlist } from '@/types/database'

afterEach(cleanup)

const USER_ID = 'user-1'
const BAND_ID = 'band-1'

const member = (id: string, userId: string, role: 'admin' | 'member', fullName: string | null): BandMember => ({
  id,
  band_id: BAND_ID,
  user_id: userId,
  role,
  joined_at: '2026-01-01T00:00:00.000Z',
  profile: {
    id: userId,
    full_name: fullName,
    avatar_url: null,
    email: `${userId}@example.com`,
    primary_instrument: 'Guitar',
  },
})

const ME = member('m-1', USER_ID, 'admin', 'Me')
const ANA = member('m-2', 'user-2', 'member', 'Ana')

const BAND: Band = {
  id: BAND_ID,
  name: 'The Band',
  description: 'Loud',
  cover_url: null,
  color: '#1d4ed8',
  invite_code: 'INV123',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  members: [ME, ANA],
}

const PLAYLISTS = [{ id: 'pl-1', name: 'Setlist' }] as unknown as Playlist[]

const formEvent = () => ({ preventDefault: vi.fn() }) as unknown as React.FormEvent

function setup(overrides: Partial<UseBandAdminOptions> = {}) {
  const showToast = vi.fn()
  const onNotFound = vi.fn()
  const onGone = vi.fn()
  const onNavigateToPlaylist = vi.fn()
  const utils = renderHook(() =>
    useBandAdmin({
      bandId: BAND_ID,
      showToast,
      onNotFound,
      loadPolicy: BAND_PROFILE_LOAD_POLICY,
      onGone,
      onNavigateToPlaylist,
      ...overrides,
    }),
  )
  return { ...utils, showToast, onNotFound, onGone, onNavigateToPlaylist }
}

/** Mount the hook and wait for the initial load to settle. */
async function setupLoaded(overrides: Partial<UseBandAdminOptions> = {}) {
  const rendered = setup(overrides)
  await waitFor(() => expect(rendered.result.current.loading).toBe(false))
  return rendered
}

/**
 * `BANDS_PAGE_LOAD_POLICY.catchLoadErrors === false` means a failed load rejects
 * *unhandled*, by design. Vitest's own `unhandledRejection` listener would turn
 * that documented behaviour into a suite failure, so it is swapped out for the
 * duration of the assertion and restored afterwards.
 */
async function captureUnhandledRejection(run: () => void): Promise<unknown> {
  const previous = process.listeners('unhandledRejection')
  process.removeAllListeners('unhandledRejection')
  let captured: unknown
  const handler = (reason: unknown) => {
    captured = reason
  }
  process.on('unhandledRejection', handler)
  try {
    run()
    for (let i = 0; i < 60 && captured === undefined; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    return captured
  } finally {
    process.off('unhandledRejection', handler)
    for (const listener of previous) process.on('unhandledRejection', listener as never)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authClient.useSession).mockReturnValue({
    data: { user: { id: USER_ID } },
  } as never)
  vi.mocked(getBandWithMembersAction).mockResolvedValue(BAND)
  vi.mocked(getBandPlaylistsAction).mockResolvedValue(PLAYLISTS)
  vi.mocked(updateBandAction).mockResolvedValue(undefined)
  useBandContextStore.setState({ context: { type: 'user' } })
})

describe('useBandAdmin load policies', () => {
  it('loads the band and its playlists, then clears loading', async () => {
    const { result } = await setupLoaded()

    expect(getBandWithMembersAction).toHaveBeenCalledWith(BAND_ID)
    expect(getBandPlaylistsAction).toHaveBeenCalledWith(BAND_ID)
    expect(result.current.band).toEqual(BAND)
    expect(result.current.playlists).toEqual(PLAYLISTS)
    expect(result.current.error).toBeNull()
  })

  it.each([
    ['BAND_PROFILE_LOAD_POLICY clears loading on not-found', BAND_PROFILE_LOAD_POLICY, false],
    ['BANDS_PAGE_LOAD_POLICY keeps loading on not-found', BANDS_PAGE_LOAD_POLICY, true],
  ])('%s', async (_label, loadPolicy, stillLoading) => {
    vi.mocked(getBandWithMembersAction).mockResolvedValue(null)

    const { result, onNotFound } = setup({ loadPolicy })

    await waitFor(() => expect(onNotFound).toHaveBeenCalledTimes(1))
    expect(result.current.band).toBeNull()
    expect(result.current.loading).toBe(stillLoading)
  })

  it.each([
    ['an Error contributes its own message', new Error('Access denied'), 'Access denied'],
    ['a non-Error falls back to the configured message', 'nope', 'Could not load band'],
  ])('BAND_PROFILE_LOAD_POLICY surfaces a load failure as a banner: %s', async (_l, thrown, expected) => {
    vi.mocked(getBandPlaylistsAction).mockRejectedValue(thrown)

    const { result } = setup({ messages: { load: 'Could not load band' } })

    await waitFor(() => expect(result.current.error).toBe(expected))
    expect(result.current.loading).toBe(false)
  })

  it('BANDS_PAGE_LOAD_POLICY lets the load failure reject unhandled instead of showing a banner', async () => {
    vi.mocked(getBandWithMembersAction).mockRejectedValue(new Error('network down'))

    let rendered: ReturnType<typeof setup> | undefined
    const reason = await captureUnhandledRejection(() => {
      rendered = setup({ loadPolicy: BANDS_PAGE_LOAD_POLICY })
    })

    expect((reason as Error).message).toBe('network down')
    expect(rendered!.result.current.error).toBeNull()
    expect(rendered!.result.current.loading).toBe(true)
  })
})

describe('useBandAdmin derived state', () => {
  it.each([
    ['the signed-in user is an admin member', USER_ID, true],
    ['the signed-in user is a plain member', 'user-2', false],
    ['the signed-in user is not a member at all', 'stranger', false],
  ])('isAdmin is %s → %s', async (_label, sessionUserId, expected) => {
    vi.mocked(authClient.useSession).mockReturnValue({ data: { user: { id: sessionUserId } } } as never)

    const { result } = await setupLoaded()

    expect(result.current.currentUserId).toBe(sessionUserId)
    expect(result.current.isAdmin).toBe(expected)
  })

  it('has no current user and no admin rights without a session', async () => {
    vi.mocked(authClient.useSession).mockReturnValue({ data: null } as never)

    const { result } = await setupLoaded()

    expect(result.current.currentUserId).toBeNull()
    expect(result.current.currentMember).toBeUndefined()
    expect(result.current.isAdmin).toBe(false)
  })

  it('builds the invite URL from the page origin and the band invite code', async () => {
    const { result } = await setupLoaded()

    expect(result.current.inviteUrl).toBe(`${window.location.origin}/join/INV123`)
  })

  it('copies the invite URL and flags the copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const { result } = await setupLoaded()
    await act(() => result.current.handleCopyInvite())

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/INV123`)
    expect(result.current.copied).toBe(true)
  })
})

describe('useBandAdmin edit modal', () => {
  it('openEdit seeds the form from the loaded band', async () => {
    const { result } = await setupLoaded()

    act(() => result.current.openEdit())

    expect(result.current.editing).toBe(true)
    expect(result.current.editName).toBe('The Band')
    expect(result.current.editDesc).toBe('Loud')
    expect(result.current.editColor).toBe('#1d4ed8')
    expect(result.current.editCoverPreview).toBeNull()
  })

  it('falls back to the default colour when the band has none', async () => {
    vi.mocked(getBandWithMembersAction).mockResolvedValue({ ...BAND, color: null, description: null })

    const { result } = await setupLoaded()
    act(() => result.current.openEdit())

    expect(result.current.editColor).toBe(DEFAULT_BAND_COLOR)
    expect(result.current.editDesc).toBe('')
  })

  it('compresses a picked cover file and previews it', async () => {
    const compressed = { name: 'small.jpg' } as unknown as File
    vi.mocked(compressImageFile).mockResolvedValue(compressed)
    const createObjectURL = vi.fn(() => 'blob:preview')
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })

    const { result } = await setupLoaded()
    const original = { name: 'huge.jpg' } as unknown as File

    await act(async () => {
      await result.current.handleEditCoverChange({
        target: { files: [original] },
      } as unknown as React.ChangeEvent<HTMLInputElement>)
    })

    expect(compressImageFile).toHaveBeenCalledWith(original)
    expect(createObjectURL).toHaveBeenCalledWith(compressed)
    expect(result.current.editCoverPreview).toBe('blob:preview')
  })

  it('ignores a cover change event with no file', async () => {
    const { result } = await setupLoaded()

    await act(async () => {
      await result.current.handleEditCoverChange({
        target: { files: [] },
      } as unknown as React.ChangeEvent<HTMLInputElement>)
    })

    expect(compressImageFile).not.toHaveBeenCalled()
  })

  it('saves the edit, patches local state and syncs the active band context', async () => {
    useBandContextStore.getState().setBandContext(BAND_ID, 'The Band', '#1d4ed8')

    const { result } = await setupLoaded()

    act(() => result.current.openEdit())
    act(() => result.current.setEditName('  Renamed  '))
    act(() => result.current.setEditColor('#047857'))
    await act(async () => {
      await result.current.handleSaveEdit(formEvent())
    })

    expect(updateBandAction).toHaveBeenCalledWith(BAND_ID, {
      name: 'Renamed',
      description: 'Loud',
      cover_url: null,
      color: '#047857',
    })
    expect(result.current.band?.name).toBe('Renamed')
    expect(result.current.editing).toBe(false)
    expect(result.current.saving).toBe(false)
    expect(useBandContextStore.getState().context).toEqual({
      type: 'band',
      id: BAND_ID,
      name: 'Renamed',
      color: '#047857',
    })
  })

  it('refuses to save an empty name', async () => {
    const { result } = await setupLoaded()

    act(() => result.current.openEdit())
    act(() => result.current.setEditName('   '))
    await act(async () => {
      await result.current.handleSaveEdit(formEvent())
    })

    expect(updateBandAction).not.toHaveBeenCalled()
    expect(result.current.editing).toBe(true)
  })

  it('surfaces an upload error without closing the modal or saving', async () => {
    vi.mocked(compressImageFile).mockResolvedValue({ name: 'c.jpg' } as unknown as File)
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:preview', configurable: true })
    vi.mocked(uploadBandCoverAction).mockResolvedValue({ error: 'Image size exceeds 5MB limit' })

    const { result } = await setupLoaded()

    act(() => result.current.openEdit())
    await act(async () => {
      await result.current.handleEditCoverChange({
        target: { files: [{ name: 'huge.jpg' } as unknown as File] },
      } as unknown as React.ChangeEvent<HTMLInputElement>)
    })
    await act(async () => {
      await result.current.handleSaveEdit(formEvent())
    })

    expect(uploadBandCoverAction).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBe('Image size exceeds 5MB limit')
    expect(result.current.editing).toBe(true)
    expect(result.current.saving).toBe(false)
    expect(updateBandAction).not.toHaveBeenCalled()
  })

  it('reports a failed save through the error banner using the configured fallback', async () => {
    vi.mocked(updateBandAction).mockRejectedValue('not an error')

    const { result } = await setupLoaded({ messages: { save: 'Could not save the band' } })

    act(() => result.current.openEdit())
    await act(async () => {
      await result.current.handleSaveEdit(formEvent())
    })

    expect(result.current.error).toBe('Could not save the band')
    expect(result.current.editing).toBe(true)
  })
})

describe('useBandAdmin destructive actions', () => {
  it('stages a removeMember confirmation, then drops the member and toasts on confirm', async () => {
    vi.mocked(removeBandMemberAction).mockResolvedValue(undefined)

    const { result, showToast } = await setupLoaded()

    act(() => result.current.handleRemoveMember(ANA))
    expect(result.current.pendingAction).toEqual({ kind: 'removeMember', member: ANA })

    await act(async () => {
      await result.current.confirmPendingAction()
    })

    expect(removeBandMemberAction).toHaveBeenCalledWith(ANA.id)
    expect(result.current.band?.members).toEqual([ME])
    expect(result.current.pendingAction).toBeNull()
    expect(result.current.actionBusy).toBe(false)
    expect(showToast).toHaveBeenCalledWith('Ana removed from the band.', 'success')
  })

  it('keeps the confirmation open and shows the error when the removal fails', async () => {
    vi.mocked(removeBandMemberAction).mockRejectedValue(new Error('Only admins can remove members'))

    const { result, showToast } = await setupLoaded()

    act(() => result.current.handleRemoveMember(ANA))
    await act(async () => {
      await result.current.confirmPendingAction()
    })

    expect(result.current.error).toBe('Only admins can remove members')
    expect(result.current.pendingAction).not.toBeNull()
    expect(result.current.band?.members).toHaveLength(2)
    expect(showToast).not.toHaveBeenCalled()
  })

  it.each([
    ['deleteBand', 'handleDelete', deleteBandAction, 'Failed to delete band'],
    ['leaveBand', 'handleLeave', leaveBandAction, 'Failed to leave band'],
  ] as const)('%s navigates away on success and banners a bare failure', async (kind, trigger, action, fallback) => {
    vi.mocked(action).mockResolvedValueOnce(undefined)

    const { result, onGone } = await setupLoaded()

    act(() => (result.current[trigger] as () => void)())
    expect(result.current.pendingAction).toEqual({ kind })

    await act(async () => {
      await result.current.confirmPendingAction()
    })

    expect(action).toHaveBeenCalledWith(BAND_ID)
    expect(onGone).toHaveBeenCalledTimes(1)
    expect(result.current.pendingAction).toBeNull()

    vi.mocked(action).mockRejectedValueOnce('boom')
    act(() => (result.current[trigger] as () => void)())
    await act(async () => {
      await result.current.confirmPendingAction()
    })

    expect(result.current.error).toBe(fallback)
  })

  it('does nothing when confirmPendingAction runs with nothing pending', async () => {
    const { result } = await setupLoaded()

    await act(async () => {
      await result.current.confirmPendingAction()
    })

    expect(deleteBandAction).not.toHaveBeenCalled()
    expect(result.current.actionBusy).toBe(false)
  })

  it('refuses to stage a leave without a session user', async () => {
    vi.mocked(authClient.useSession).mockReturnValue({ data: null } as never)

    const { result } = await setupLoaded()

    act(() => result.current.handleLeave())

    expect(result.current.pendingAction).toBeNull()
  })
})

describe('useBandAdmin playlist creation', () => {
  it('creates the playlist and navigates to it', async () => {
    vi.mocked(createBandPlaylistAction).mockResolvedValue('pl-9')

    const { result, onNavigateToPlaylist } = await setupLoaded()

    act(() => result.current.setNewPlaylistName('  Encore  '))
    await act(async () => {
      await result.current.handleCreatePlaylist(formEvent())
    })

    expect(createBandPlaylistAction).toHaveBeenCalledWith(BAND_ID, 'Encore')
    expect(onNavigateToPlaylist).toHaveBeenCalledWith('pl-9')
  })

  it('clears the busy flag and banners the failure when creation fails', async () => {
    vi.mocked(createBandPlaylistAction).mockRejectedValue(new Error('Failed to create playlist: db down'))

    const { result, onNavigateToPlaylist } = await setupLoaded()

    act(() => result.current.setNewPlaylistName('Encore'))
    await act(async () => {
      await result.current.handleCreatePlaylist(formEvent())
    })

    expect(result.current.error).toBe('Failed to create playlist: db down')
    expect(result.current.creatingPlaylist).toBe(false)
    expect(onNavigateToPlaylist).not.toHaveBeenCalled()
  })

  it('ignores a submit with a blank playlist name', async () => {
    const { result } = await setupLoaded()

    act(() => result.current.setNewPlaylistName('   '))
    await act(async () => {
      await result.current.handleCreatePlaylist(formEvent())
    })

    expect(createBandPlaylistAction).not.toHaveBeenCalled()
  })
})
