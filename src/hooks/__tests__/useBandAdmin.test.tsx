// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, renderHook, waitFor, cleanup } from '@testing-library/react'

vi.mock('@/lib/auth-client', () => ({
  authClient: { useSession: vi.fn() },
}))

vi.mock('@/lib/imageCompressor', () => ({
  compressImageFile: vi.fn(),
}))

import {
  useBandAdmin,
  type BandAdminActions,
  type UseBandAdminOptions,
} from '../useBandAdmin'
import { authClient } from '@/lib/auth-client'
import { compressImageFile } from '@/lib/imageCompressor'
import { useBandContextStore } from '@/store/bandContextStore'
import { BANDS_PAGE_LOAD_POLICY, BAND_PROFILE_LOAD_POLICY } from '@/lib/bandAdminLoad'
import { DEFAULT_BAND_COLOR } from '@/lib/bandColors'
import type { Band, BandMember, Playlist } from '@/types/database'

// Typed handles on the only two modules this suite still replaces. The band
// actions are no longer among them: they arrive as injected spies (RH-47/F21).
const useSessionMock = authClient.useSession as unknown as Mock
const compressImageFileMock = compressImageFile as unknown as Mock

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

const changeEvent = (files: File[]) =>
  ({ target: { files } }) as unknown as React.ChangeEvent<HTMLInputElement>

type BandAdminActionSpies = { [K in keyof BandAdminActions]: Mock }

/**
 * A fresh set of injected action spies, pre-programmed with the default
 * behaviours the suite assumes. The hook takes these as a value (RH-47), so
 * there is no action module to mock any more.
 */
function makeActions(): BandAdminActionSpies {
  return {
    getBandWithMembers: vi.fn().mockResolvedValue(BAND),
    getBandPlaylists: vi.fn().mockResolvedValue(PLAYLISTS),
    updateBand: vi.fn().mockResolvedValue(undefined),
    deleteBand: vi.fn().mockResolvedValue(undefined),
    leaveBand: vi.fn().mockResolvedValue(undefined),
    removeBandMember: vi.fn().mockResolvedValue(undefined),
    createBandPlaylist: vi.fn().mockResolvedValue('pl-1'),
    uploadBandCover: vi.fn().mockResolvedValue({ coverUrl: null }),
  }
}

function setup(
  overrides: Partial<UseBandAdminOptions> = {},
  actions: BandAdminActionSpies = makeActions(),
) {
  const showToast = vi.fn()
  const onNotFound = vi.fn()
  const onGone = vi.fn()
  const onNavigateToPlaylist = vi.fn()
  const utils = renderHook(() =>
    useBandAdmin({
      bandId: BAND_ID,
      actions: actions as unknown as BandAdminActions,
      showToast,
      onNotFound,
      loadPolicy: BAND_PROFILE_LOAD_POLICY,
      onGone,
      onNavigateToPlaylist,
      ...overrides,
    }),
  )
  return { ...utils, actions, showToast, onNotFound, onGone, onNavigateToPlaylist }
}

/** Mount the hook and wait for the initial load to settle. */
async function setupLoaded(
  overrides: Partial<UseBandAdminOptions> = {},
  actions: BandAdminActionSpies = makeActions(),
) {
  const rendered = setup(overrides, actions)
  await waitFor(() => expect(rendered.result.current.loading).toBe(false))
  return rendered
}

/**
 * Mount loaded, open the edit modal and pick a cover file, with
 * `uploadBandCover` pre-programmed to the given outcome — the shared preamble of
 * every assertion about the upload leg of `saveEdit`.
 */
async function setupWithPickedCover(uploadResult: { coverUrl?: string; error?: string }) {
  compressImageFileMock.mockResolvedValue({ name: 'c.jpg' } as unknown as File)
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:preview', configurable: true })
  const actions = makeActions()
  actions.uploadBandCover.mockResolvedValue(uploadResult)

  const rendered = await setupLoaded({}, actions)

  act(() => rendered.result.current.startEdit())
  await act(async () => {
    await rendered.result.current.pickCoverFile(
      changeEvent([{ name: 'huge.jpg' } as unknown as File]),
    )
  })
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
  useSessionMock.mockReturnValue({
    data: { user: { id: USER_ID } },
  } as never)
  useBandContextStore.setState({ context: { type: 'user' } })
})

describe('useBandAdmin surface', () => {
  it('exposes 19 members, none of them a state setter', async () => {
    const { result } = await setupLoaded()

    const keys = Object.keys(result.current).sort()
    expect(keys).toEqual([
      'band',
      'cancelEdit',
      'currentUserId',
      'dismissError',
      'editDraft',
      'error',
      'invite',
      'isAdmin',
      'isMember',
      'loading',
      'newPlaylist',
      'pending',
      'pickCoverFile',
      'playlists',
      'reportError',
      'saveEdit',
      'saving',
      'startEdit',
      'updateDraft',
    ])
    expect(keys).toHaveLength(19)
    expect(keys.filter((key) => key.startsWith('set'))).toEqual([])
  })

  it('groups the invite widget into url, copied, copy and applyNewCode', async () => {
    const { result } = await setupLoaded()

    const keys = Object.keys(result.current.invite).sort()
    expect(keys).toEqual(['applyNewCode', 'copied', 'copy', 'url'])
    expect(keys.filter((key) => key.startsWith('set'))).toEqual([])
  })

  it('groups the destructive confirmation into action, busy, requestDelete, requestLeave, requestRemove, confirm and dismiss', async () => {
    const { result } = await setupLoaded()

    const keys = Object.keys(result.current.pending).sort()
    expect(keys).toEqual([
      'action',
      'busy',
      'confirm',
      'dismiss',
      'requestDelete',
      'requestLeave',
      'requestRemove',
    ])
    expect(keys.filter((key) => key.startsWith('set'))).toEqual([])
  })

  it('groups the new playlist form into open, name, creating, toggle, changeName, close and submit', async () => {
    const { result } = await setupLoaded()

    const keys = Object.keys(result.current.newPlaylist).sort()
    expect(keys).toEqual([
      'changeName',
      'close',
      'creating',
      'name',
      'open',
      'submit',
      'toggle',
    ])
    expect(keys.filter((key) => key.startsWith('set'))).toEqual([])
  })
})

describe('useBandAdmin load policies', () => {
  it('loads the band and its playlists, then clears loading', async () => {
    const { result, actions } = await setupLoaded()

    expect(actions.getBandWithMembers).toHaveBeenCalledWith(BAND_ID)
    expect(actions.getBandPlaylists).toHaveBeenCalledWith(BAND_ID)
    expect(result.current.band).toEqual(BAND)
    expect(result.current.playlists).toEqual(PLAYLISTS)
    expect(result.current.error).toBeNull()
  })

  it.each([
    ['BAND_PROFILE_LOAD_POLICY clears loading on not-found', BAND_PROFILE_LOAD_POLICY, false],
    ['BANDS_PAGE_LOAD_POLICY keeps loading on not-found', BANDS_PAGE_LOAD_POLICY, true],
  ])('%s', async (_label, loadPolicy, stillLoading) => {
    const actions = makeActions()
    actions.getBandWithMembers.mockResolvedValue(null)

    const { result, onNotFound } = setup({ loadPolicy }, actions)

    await waitFor(() => expect(onNotFound).toHaveBeenCalledTimes(1))
    expect(result.current.band).toBeNull()
    expect(result.current.loading).toBe(stillLoading)
  })

  it.each([
    ['an Error contributes its own message', new Error('Access denied'), 'Access denied'],
    ['a non-Error falls back to the configured message', 'nope', 'Could not load band'],
  ])('BAND_PROFILE_LOAD_POLICY surfaces a load failure as a banner: %s', async (_l, thrown, expected) => {
    const actions = makeActions()
    actions.getBandPlaylists.mockRejectedValue(thrown)

    const { result } = setup({ messages: { load: 'Could not load band' } }, actions)

    await waitFor(() => expect(result.current.error).toBe(expected))
    expect(result.current.loading).toBe(false)
  })

  it('BANDS_PAGE_LOAD_POLICY lets the load failure reject unhandled instead of showing a banner', async () => {
    const actions = makeActions()
    actions.getBandWithMembers.mockRejectedValue(new Error('network down'))

    let rendered: ReturnType<typeof setup> | undefined
    const reason = await captureUnhandledRejection(() => {
      rendered = setup({ loadPolicy: BANDS_PAGE_LOAD_POLICY }, actions)
    })

    expect((reason as Error).message).toBe('network down')
    expect(rendered!.result.current.error).toBeNull()
    expect(rendered!.result.current.loading).toBe(true)
  })
})

describe('useBandAdmin derived state and the shared banner', () => {
  it.each([
    ['the signed-in user is an admin member', USER_ID, true, true],
    ['the signed-in user is a plain member', 'user-2', false, true],
    ['the signed-in user is not a member at all', 'stranger', false, false],
  ])('isAdmin is %s → %s', async (_label, sessionUserId, admin, isMember) => {
    useSessionMock.mockReturnValue({ data: { user: { id: sessionUserId } } } as never)

    const { result } = await setupLoaded()

    expect(result.current.currentUserId).toBe(sessionUserId)
    expect(result.current.isAdmin).toBe(admin)
    expect(result.current.isMember).toBe(isMember)
  })

  it('has no current user and no admin rights without a session', async () => {
    useSessionMock.mockReturnValue({ data: null } as never)

    const { result } = await setupLoaded()

    expect(result.current.currentUserId).toBeNull()
    expect(result.current.isMember).toBe(false)
    expect(result.current.isAdmin).toBe(false)
  })

  it('reportError shows a message in the shared banner and dismissError clears it', async () => {
    const { result } = await setupLoaded()

    act(() => result.current.reportError('Failed to regenerate invite link'))
    expect(result.current.error).toBe('Failed to regenerate invite link')

    act(() => result.current.dismissError())
    expect(result.current.error).toBeNull()
  })
})

describe('useBandAdmin invite link', () => {
  it('builds the invite URL from the page origin and the band invite code', async () => {
    const { result } = await setupLoaded()

    expect(result.current.invite.url).toBe(`${window.location.origin}/join/INV123`)
  })

  it('copies the invite URL and flags the copied state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const { result } = await setupLoaded()
    await act(() => result.current.invite.copy())

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/INV123`)
    expect(result.current.invite.copied).toBe(true)
  })

  it('applies a regenerated invite code to the band and clears the copied flag', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const { result } = await setupLoaded()
    await act(() => result.current.invite.copy())
    expect(result.current.invite.copied).toBe(true)

    act(() => result.current.invite.applyNewCode('NEWCODE'))

    expect(result.current.band?.invite_code).toBe('NEWCODE')
    expect(result.current.invite.url).toBe(`${window.location.origin}/join/NEWCODE`)
    expect(result.current.invite.copied).toBe(false)
  })
})

describe('useBandAdmin edit modal', () => {
  it('startEdit seeds the draft from the loaded band', async () => {
    const { result } = await setupLoaded()
    expect(result.current.editDraft).toBeNull()

    act(() => result.current.startEdit())

    expect(result.current.editDraft).toEqual({
      name: 'The Band',
      description: 'Loud',
      coverPreview: null,
      color: '#1d4ed8',
    })
  })

  it('falls back to the default colour when the band has none', async () => {
    const actions = makeActions()
    actions.getBandWithMembers.mockResolvedValue({ ...BAND, color: null, description: null })

    const { result } = await setupLoaded({}, actions)
    act(() => result.current.startEdit())

    expect(result.current.editDraft?.color).toBe(DEFAULT_BAND_COLOR)
    expect(result.current.editDraft?.description).toBe('')
  })

  it('updateDraft patches one draft field and leaves the others alone', async () => {
    const { result } = await setupLoaded()

    act(() => result.current.startEdit())
    act(() => result.current.updateDraft({ name: 'Renamed' }))

    expect(result.current.editDraft).toEqual({
      name: 'Renamed',
      description: 'Loud',
      coverPreview: null,
      color: '#1d4ed8',
    })
  })

  it('updateDraft does nothing while the modal is closed', async () => {
    const { result } = await setupLoaded()

    act(() => result.current.updateDraft({ name: 'Renamed' }))

    expect(result.current.editDraft).toBeNull()
  })

  it('pickCoverFile compresses the chosen file and previews it in the draft', async () => {
    const compressed = { name: 'small.jpg' } as unknown as File
    compressImageFileMock.mockResolvedValue(compressed)
    const createObjectURL = vi.fn(() => 'blob:preview')
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })

    const { result } = await setupLoaded()
    const original = { name: 'huge.jpg' } as unknown as File

    act(() => result.current.startEdit())
    await act(async () => {
      await result.current.pickCoverFile(changeEvent([original]))
    })

    expect(compressImageFile).toHaveBeenCalledWith(original)
    expect(createObjectURL).toHaveBeenCalledWith(compressed)
    expect(result.current.editDraft?.coverPreview).toBe('blob:preview')
  })

  it('ignores a cover change event with no file', async () => {
    const { result } = await setupLoaded()

    act(() => result.current.startEdit())
    await act(async () => {
      await result.current.pickCoverFile(changeEvent([]))
    })

    expect(compressImageFile).not.toHaveBeenCalled()
  })

  it('saveEdit sends the trimmed draft, patches the band and syncs the active band context', async () => {
    useBandContextStore.getState().setBandContext(BAND_ID, 'The Band', '#1d4ed8')

    const { result, actions } = await setupLoaded()

    act(() => result.current.startEdit())
    act(() => result.current.updateDraft({ name: '  Renamed  ', color: '#047857' }))
    await act(async () => {
      await result.current.saveEdit(formEvent())
    })

    expect(actions.updateBand).toHaveBeenCalledWith(BAND_ID, {
      name: 'Renamed',
      description: 'Loud',
      cover_url: null,
      color: '#047857',
    })
    expect(result.current.band?.name).toBe('Renamed')
    expect(result.current.editDraft).toBeNull()
    expect(result.current.saving).toBe(false)
    expect(useBandContextStore.getState().context).toEqual({
      type: 'band',
      id: BAND_ID,
      name: 'Renamed',
      color: '#047857',
    })
  })

  it('leaves another band as the active context untouched when saving this one', async () => {
    useBandContextStore.getState().setBandContext('other-band', 'Other', '#111111')

    const { result } = await setupLoaded()

    act(() => result.current.startEdit())
    await act(async () => {
      await result.current.saveEdit(formEvent())
    })

    expect(useBandContextStore.getState().context).toEqual({
      type: 'band',
      id: 'other-band',
      name: 'Other',
      color: '#111111',
    })
  })

  it('saveEdit refuses a blank name and leaves the draft open', async () => {
    const { result, actions } = await setupLoaded()

    act(() => result.current.startEdit())
    act(() => result.current.updateDraft({ name: '   ' }))
    await act(async () => {
      await result.current.saveEdit(formEvent())
    })

    expect(actions.updateBand).not.toHaveBeenCalled()
    expect(result.current.editDraft?.name).toBe('   ')
  })

  it('saveEdit surfaces a cover upload failure without calling updateBand', async () => {
    const { result, actions } = await setupWithPickedCover({
      error: 'Image size exceeds 5MB limit',
    })

    await act(async () => {
      await result.current.saveEdit(formEvent())
    })

    expect(actions.uploadBandCover).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBe('Image size exceeds 5MB limit')
    expect(result.current.editDraft).not.toBeNull()
    expect(result.current.saving).toBe(false)
    expect(actions.updateBand).not.toHaveBeenCalled()
  })

  it('saves the uploaded cover URL when the upload succeeds', async () => {
    const { result, actions } = await setupWithPickedCover({
      coverUrl: 'https://blob.example/c.jpg',
    })

    await act(async () => {
      await result.current.saveEdit(formEvent())
    })

    expect(actions.updateBand).toHaveBeenCalledWith(
      BAND_ID,
      expect.objectContaining({ cover_url: 'https://blob.example/c.jpg' }),
    )
    expect(result.current.band?.cover_url).toBe('https://blob.example/c.jpg')
  })

  it('reports a failed save through the error banner using the configured fallback', async () => {
    const actions = makeActions()
    actions.updateBand.mockRejectedValue('not an error')

    const { result } = await setupLoaded({ messages: { save: 'Could not save the band' } }, actions)

    act(() => result.current.startEdit())
    await act(async () => {
      await result.current.saveEdit(formEvent())
    })

    expect(result.current.error).toBe('Could not save the band')
    expect(result.current.editDraft).not.toBeNull()
  })

  it('cancelEdit closes the draft without calling updateBand', async () => {
    const { result, actions } = await setupLoaded()

    act(() => result.current.startEdit())
    expect(result.current.editDraft).not.toBeNull()

    act(() => result.current.cancelEdit())

    expect(result.current.editDraft).toBeNull()
    expect(actions.updateBand).not.toHaveBeenCalled()
  })
})

describe('useBandAdmin destructive actions', () => {
  it('requestRemove stages the confirmation, then drops the member and toasts on confirm', async () => {
    const { result, showToast, actions } = await setupLoaded()

    act(() => result.current.pending.requestRemove(ANA))
    expect(result.current.pending.action).toEqual({ kind: 'removeMember', member: ANA })

    await act(async () => {
      await result.current.pending.confirm()
    })

    expect(actions.removeBandMember).toHaveBeenCalledWith(ANA.id)
    expect(result.current.band?.members).toEqual([ME])
    expect(result.current.pending.action).toBeNull()
    expect(result.current.pending.busy).toBe(false)
    expect(showToast).toHaveBeenCalledWith('Ana removed from the band.', 'success')
  })

  it('keeps the confirmation open and shows the error when the removal fails', async () => {
    const actions = makeActions()
    actions.removeBandMember.mockRejectedValue(new Error('Only admins can remove members'))

    const { result, showToast } = await setupLoaded({}, actions)

    act(() => result.current.pending.requestRemove(ANA))
    await act(async () => {
      await result.current.pending.confirm()
    })

    expect(result.current.error).toBe('Only admins can remove members')
    expect(result.current.pending.action).not.toBeNull()
    expect(result.current.band?.members).toHaveLength(2)
    expect(showToast).not.toHaveBeenCalled()
  })

  it.each([
    ['requestDelete navigates away through onGone and banners a bare failure', 'deleteBand', 'requestDelete', 'Failed to delete band'],
    ['requestLeave navigates away through onGone and banners a bare failure', 'leaveBand', 'requestLeave', 'Failed to leave band'],
  ] as const)('%s', async (_label, kind, trigger, fallback) => {
    const { result, onGone, actions } = await setupLoaded()
    const action = actions[kind]
    action.mockResolvedValueOnce(undefined)

    act(() => result.current.pending[trigger]())
    expect(result.current.pending.action).toEqual({ kind })

    await act(async () => {
      await result.current.pending.confirm()
    })

    expect(action).toHaveBeenCalledWith(BAND_ID)
    expect(onGone).toHaveBeenCalledTimes(1)
    expect(result.current.pending.action).toBeNull()

    action.mockRejectedValueOnce('boom')
    act(() => result.current.pending[trigger]())
    await act(async () => {
      await result.current.pending.confirm()
    })

    expect(result.current.error).toBe(fallback)
  })

  it('does nothing when confirm runs with nothing pending', async () => {
    const { result, actions } = await setupLoaded()

    await act(async () => {
      await result.current.pending.confirm()
    })

    expect(actions.deleteBand).not.toHaveBeenCalled()
    expect(result.current.pending.busy).toBe(false)
  })

  it('requestLeave does nothing without a session user', async () => {
    useSessionMock.mockReturnValue({ data: null } as never)

    const { result } = await setupLoaded()

    act(() => result.current.pending.requestLeave())

    expect(result.current.pending.action).toBeNull()
  })

  it('dismiss clears the staged confirmation without calling any action', async () => {
    const { result, actions } = await setupLoaded()

    act(() => result.current.pending.requestDelete())
    expect(result.current.pending.action).toEqual({ kind: 'deleteBand' })

    act(() => result.current.pending.dismiss())

    expect(result.current.pending.action).toBeNull()
    expect(actions.deleteBand).not.toHaveBeenCalled()
  })
})

describe('useBandAdmin new playlist form', () => {
  it('toggle opens and closes the form, and close always closes it', async () => {
    const { result } = await setupLoaded()
    expect(result.current.newPlaylist.open).toBe(false)

    act(() => result.current.newPlaylist.toggle())
    expect(result.current.newPlaylist.open).toBe(true)

    act(() => result.current.newPlaylist.toggle())
    expect(result.current.newPlaylist.open).toBe(false)

    act(() => result.current.newPlaylist.toggle())
    act(() => result.current.newPlaylist.close())
    expect(result.current.newPlaylist.open).toBe(false)
  })

  it('submit creates the band playlist and navigates to it', async () => {
    const actions = makeActions()
    actions.createBandPlaylist.mockResolvedValue('pl-9')

    const { result, onNavigateToPlaylist } = await setupLoaded({}, actions)

    act(() => result.current.newPlaylist.changeName('  Encore  '))
    expect(result.current.newPlaylist.name).toBe('  Encore  ')

    await act(async () => {
      await result.current.newPlaylist.submit(formEvent())
    })

    expect(actions.createBandPlaylist).toHaveBeenCalledWith(BAND_ID, 'Encore')
    expect(onNavigateToPlaylist).toHaveBeenCalledWith('pl-9')
  })

  it('submit banners the failure and clears the creating flag', async () => {
    const actions = makeActions()
    actions.createBandPlaylist.mockRejectedValue(new Error('Failed to create playlist: db down'))

    const { result, onNavigateToPlaylist } = await setupLoaded({}, actions)

    act(() => result.current.newPlaylist.changeName('Encore'))
    await act(async () => {
      await result.current.newPlaylist.submit(formEvent())
    })

    expect(result.current.error).toBe('Failed to create playlist: db down')
    expect(result.current.newPlaylist.creating).toBe(false)
    expect(onNavigateToPlaylist).not.toHaveBeenCalled()
  })

  it('ignores a submit with a blank playlist name', async () => {
    const { result, actions } = await setupLoaded()

    act(() => result.current.newPlaylist.changeName('   '))
    await act(async () => {
      await result.current.newPlaylist.submit(formEvent())
    })

    expect(actions.createBandPlaylist).not.toHaveBeenCalled()
  })
})
