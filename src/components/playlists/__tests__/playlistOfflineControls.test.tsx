// @vitest-environment jsdom
/**
 * RH-201 — the playlist's offline controls, relocated: the actions are a group
 * of the header's "More actions" menu (after "Add songs", before "Rename
 * playlist"), a compact icon after the playlist name says the state, and the
 * inline alert keeps the slot the RH-79 block used to occupy.
 *
 * Same state coverage as the RH-79/RH-188/RH-193 `OfflineDownloadButton`
 * suite it replaces: idle, idle with stored songs, offline-disabled,
 * downloading, downloaded complete/partial, retryable download error,
 * non-retryable removal error. The real hook runs over the real store and fake
 * ports, so the downloaded state shows a size and a date actually written.
 *
 * Copy is English per AGENTS.md F25 (i18n is landing-page only).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  HookedOfflineControl,
  OfflineControls,
  closeOfflineMenu,
  findOfflineMenuItem,
  offlineMenuItem,
} from './offlineControlHarness'
import { createOfflineStore } from '@/lib/offlineStore'
import { songRecordId } from '@/lib/offlineSongRecord'
import { createFakePorts, type FakeOfflinePorts } from '@/lib/__tests__/offlineStoreFakes'
import type { OfflineDownloadActions, OfflinePlaylistController } from '@/hooks/useOfflinePlaylist'
import type { ResolvedSongEntry, SongFile } from '@/types/database'

afterEach(cleanup)

const MAKE_AVAILABLE = 'Make available offline'
const OFFLINE_HINT = 'Connect to the internet to download this playlist.'
const OFFLINE_ACTIONS = [/^Make available offline$/, /missing song/, /^Refresh offline copy$/, /^Remove offline copy$/]

const ENTRIES = [
  { repertoireId: 'rep-1', versionId: 'v-rep-1', songId: 'song-1', title: 'Tempo Perdido', artist: 'Legião Urbana' },
  { repertoireId: 'rep-2', versionId: 'v-rep-2', songId: 'song-2', title: 'Faroeste Caboclo', artist: null },
]

function resolvedEntry(versionId: string): ResolvedSongEntry {
  const ownerRowId = versionId.replace(/^v-/, '')
  return {
    ownerRowId,
    song_id: `song-${ownerRowId}`,
    version_id: versionId,
    key: null,
    tuning: null,
    map: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
  }
}

function tabRow(songId: string): SongFile {
  return {
    id: `tab-${songId}`,
    user_id: 'user-1',
    song_id: songId,
    title: 'Chart',
    file_url: `https://store.public.blob.vercel-storage.com/tabs/${songId}.pdf`,
    created_at: '2026-05-01T00:00:00Z',
  }
}

/** `hold` stalls the read of the second song, so the busy state can be observed. */
function makeActions(hold?: Promise<void>, entries: typeof ENTRIES = ENTRIES): OfflineDownloadActions {
  return {
    getPlaylistDetailsWithEntries: vi.fn(() => Promise.resolve({ name: 'Gig', entries })),
    getResolvedEntryForVersion: vi.fn((versionId: string) => Promise.resolve(resolvedEntry(versionId))),
    getTabs: vi.fn(async (songId: string) => {
      if (hold && songId === 'song-rep-2') await hold
      return [tabRow(songId)]
    }),
    getPersonalEntryForSong: vi.fn(() => Promise.resolve(null)),
    getCustomFieldValues: vi.fn(() => Promise.resolve([])),
  }
}

const LIVE_IDS = ENTRIES.map((entry) => entry.versionId)

/** Renders online over one store; `control(offline)` re-renders the same hook with the network flipped. */
function renderSwitchable(
  actions: OfflineDownloadActions,
  ports: FakeOfflinePorts = createFakePorts(),
  versionIds: string[] = LIVE_IDS,
  initiallyOffline = false,
) {
  const store = createOfflineStore(ports)
  const control = (offline: boolean) => (
    <HookedOfflineControl
      playlistId="pl-1"
      playlistName="Gig — Bar do Zé"
      bandId="band-1"
      versionIds={versionIds}
      actions={actions}
      store={store}
      offline={offline}
    />
  )
  return { ...render(control(initiallyOffline)), control, ports }
}

function controllerStub(overrides: Partial<OfflinePlaylistController> = {}): OfflinePlaylistController {
  return {
    status: 'idle',
    progress: { done: 0, total: 0 },
    summary: null,
    downloaded: false,
    storedVersionIds: new Set(),
    stored: 0,
    total: 0,
    bytes: 0,
    downloadedAgo: null,
    error: null,
    errorRetryable: false,
    download: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    removeSong: vi.fn(async () => {}),
    dismissError: vi.fn(),
    ...overrides,
  }
}

async function storeSongs(ports: FakeOfflinePorts, entries: typeof ENTRIES) {
  const store = createOfflineStore(ports)
  for (const entry of entries) {
    await store.saveOfflineSong({
      song: { entry, repertoire: resolvedEntry(entry.versionId), personalRepertoire: null, tabs: [], customFields: [] },
      bandId: 'band-1',
      savedAt: '2026-11-07T10:00:00.000Z',
      individualDownload: true,
    })
  }
}

function liveEntries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    repertoireId: `rep-${index + 1}`,
    versionId: `v-rep-${index + 1}`,
    songId: `song-${index + 1}`,
    title: `Song ${index + 1}`,
    artist: null,
  }))
}

/** Starts the download from the menu and waits for the stored state's icon. */
async function downloadFromMenu() {
  fireEvent.click(await findOfflineMenuItem(MAKE_AVAILABLE))
  await screen.findByRole('img', { name: 'Available offline' })
}

function menuLabels(): string[] {
  return screen
    .getAllByRole('menuitem')
    .map((item) => item.getAttribute('aria-label') ?? item.textContent ?? '')
}

/** No offline action is reachable outside the "More actions" menu. */
function expectNoOfflineControlOutsideMenu() {
  for (const name of OFFLINE_ACTIONS) expect(screen.queryByRole('button', { name })).toBeNull()
}

describe('the offline group of "More actions" (RH-201)', () => {
  it('lists an enabled "Make available offline" after "Add songs" and before "Rename playlist"', async () => {
    renderSwitchable(makeActions())

    const item = await findOfflineMenuItem(MAKE_AVAILABLE)
    expect(item.getAttribute('aria-disabled')).toBeNull()
    expect(item.getAttribute('aria-describedby')).toBeNull()
    expect(menuLabels()).toEqual(['Add songs', MAKE_AVAILABLE, 'Rename playlist', 'Delete playlist'])
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    expect(screen.queryByText(/already on this device/)).toBeNull()
  })

  it('renders no offline control on the page outside the menu and no icon while idle', async () => {
    renderSwitchable(makeActions())

    await findOfflineMenuItem(MAKE_AVAILABLE)
    closeOfflineMenu()
    expectNoOfflineControlOutsideMenu()
    expect(screen.queryByRole('img', { name: /offline|downloading/i })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('starts the download from the item, closes the menu, and ends in the stored state', async () => {
    const { ports } = renderSwitchable(makeActions())

    fireEvent.click(await findOfflineMenuItem(MAKE_AVAILABLE))

    expect(screen.queryByRole('menu')).toBeNull()
    await screen.findByRole('img', { name: 'Available offline' })
    expect(ports.records.rows.has('pl-1')).toBe(true)
  })

  it('shows a spinner named with the progress while downloading, and no offline item in the menu', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    renderSwitchable(makeActions(held))

    fireEvent.click(await findOfflineMenuItem(MAKE_AVAILABLE))

    const busy = await screen.findByRole('img', { name: 'Downloading 1 / 2 songs' })
    expect(busy.getAttribute('title')).toBe('Downloading 1 / 2 songs')
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(menuLabels()).toEqual(['Add songs', 'Rename playlist', 'Delete playlist'])
    expect(screen.queryByRole('separator')).toBeNull()
    closeOfflineMenu()
    expectNoOfflineControlOutsideMenu()

    release()
    await screen.findByRole('img', { name: 'Available offline' })
  })

  it('shows one "Available offline" icon after the title and the summary, Refresh and Remove in the menu', async () => {
    renderSwitchable(makeActions())
    await downloadFromMenu()

    const icons = screen.getAllByRole('img', { name: 'Available offline' })
    expect(icons).toHaveLength(1)
    expect(icons[0].getAttribute('title')).toBe('2 of 2 songs on this device')
    const heading = screen.getByRole('heading', { name: 'Gig' })
    expect(heading.compareDocumentPosition(icons[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expectNoOfflineControlOutsideMenu()

    offlineMenuItem('Refresh offline copy')
    expect(menuLabels()).toEqual(['Add songs', 'Refresh offline copy', 'Remove offline copy', 'Rename playlist', 'Delete playlist'])
    const summary = screen.getByText(/^Available offline · 2 of 2 songs · .* · downloaded today$/)
    expect(summary.textContent).toMatch(/KB|MB/)
    expect(within(summary).queryByRole('menuitem')).toBeNull()
  })

  it('removes the offline copy from the menu and returns to idle', async () => {
    const { ports } = renderSwitchable(makeActions())
    await downloadFromMenu()

    fireEvent.click(offlineMenuItem('Remove offline copy'))

    await waitFor(() => expect(ports.records.rows.size).toBe(0))
    expect(await findOfflineMenuItem(MAKE_AVAILABLE)).toBeDefined()
    expect(screen.queryByRole('img', { name: 'Available offline' })).toBeNull()
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
  })
})

describe('the offline group, offline (RH-99 ER5, RH-188)', () => {
  it('marks "Make available offline" aria-disabled with the hint as its description', async () => {
    renderSwitchable(makeActions(), createFakePorts(), LIVE_IDS, true)

    const item = await findOfflineMenuItem(MAKE_AVAILABLE)
    expect(item.getAttribute('aria-disabled')).toBe('true')
    const hintId = item.getAttribute('aria-describedby')
    expect(document.getElementById(hintId!)?.textContent).toBe(OFFLINE_HINT)
    expect(screen.getByRole('menuitem', { name: MAKE_AVAILABLE, description: OFFLINE_HINT })).toBe(item)
  })

  it('starts no download from the disabled item and leaves the menu open', async () => {
    const actions = makeActions()
    renderSwitchable(actions, createFakePorts(), LIVE_IDS, true)

    fireEvent.click(await findOfflineMenuItem(MAKE_AVAILABLE))

    expect(screen.getByRole('menu')).toBeDefined()
    await waitFor(() => expect(actions.getPlaylistDetailsWithEntries).not.toHaveBeenCalled())
  })

  it('disables "Download N missing songs" and "Refresh offline copy", keeps "Remove offline copy" enabled', async () => {
    const actions = makeActions(undefined, liveEntries(5))
    const { rerender, control } = renderSwitchable(actions, createFakePorts(), liveEntries(6).map((e) => e.versionId))
    await downloadFromMenu()

    rerender(control(true))

    expect(offlineMenuItem('Download 1 missing song').getAttribute('aria-disabled')).toBe('true')
    expect(offlineMenuItem('Refresh offline copy').getAttribute('aria-disabled')).toBe('true')
    const remove = offlineMenuItem('Remove offline copy')
    expect(remove.getAttribute('aria-disabled')).toBeNull()

    fireEvent.click(offlineMenuItem('Refresh offline copy'))
    expect(screen.getByRole('menu')).toBeDefined()
    expect(actions.getPlaylistDetailsWithEntries).toHaveBeenCalledTimes(1)
  })

  it('disables "Try again" in the failure alert when offline', async () => {
    const actions = makeActions()
    const { rerender, control } = renderSwitchable(actions, createFakePorts({ failBlobPutOnCall: 2 }))
    fireEvent.click(await findOfflineMenuItem(MAKE_AVAILABLE))
    const alert = await screen.findByRole('alert')

    rerender(control(true))

    const retry = within(alert).getByRole('button', { name: 'Try again' })
    expect(retry.hasAttribute('disabled')).toBe(true)
    fireEvent.click(retry)
    await waitFor(() => expect(actions.getPlaylistDetailsWithEntries).toHaveBeenCalledTimes(1))
  })
})

describe('the live count (RH-193)', () => {
  function renderLive(serverCount: number, liveCount: number, ports = createFakePorts()) {
    const actions = makeActions(undefined, liveEntries(serverCount))
    const versionIds = liveEntries(liveCount).map((entry) => entry.versionId)
    return { ...renderSwitchable(actions, ports, versionIds), actions }
  }

  it('lists "Download 1 missing song" before Refresh at 5 of 6, and fetches only the missing one', async () => {
    const { actions } = renderLive(5, 6)
    await downloadFromMenu()

    expect(offlineMenuItem('Download 1 missing song').getAttribute('aria-disabled')).toBeNull()
    expect(menuLabels()).toEqual([
      'Add songs',
      'Download 1 missing song',
      'Refresh offline copy',
      'Remove offline copy',
      'Rename playlist',
      'Delete playlist',
    ])
    expect(screen.getByText(/^Available offline · 5 of 6 songs/)).toBeDefined()
    expect(screen.getByRole('img', { name: 'Available offline' }).getAttribute('title')).toBe('5 of 6 songs on this device')

    vi.mocked(actions.getPlaylistDetailsWithEntries).mockResolvedValue({ name: 'Gig', entries: liveEntries(6) })
    vi.mocked(actions.getResolvedEntryForVersion).mockClear()
    fireEvent.click(offlineMenuItem('Download 1 missing song'))

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Available offline' }).getAttribute('title')).toBe('6 of 6 songs on this device'),
    )
    expect(vi.mocked(actions.getResolvedEntryForVersion).mock.calls.map(([id]) => id)).toEqual(['v-rep-6'])
    offlineMenuItem('Refresh offline copy')
    expect(screen.queryByRole('menuitem', { name: /missing song/ })).toBeNull()
  })

  it('pluralises the missing-only download', async () => {
    renderLive(3, 5)
    await downloadFromMenu()

    expect(offlineMenuItem('Download 2 missing songs')).toBeDefined()
  })

  it('says how many songs are already stored under the idle item', async () => {
    const ports = createFakePorts()
    await storeSongs(ports, liveEntries(5).slice(0, 2))

    renderLive(5, 5, ports)

    const item = await findOfflineMenuItem(MAKE_AVAILABLE)
    await waitFor(() => expect(item.textContent).toContain('2 of 5 songs are already on this device.'))
    expect(screen.queryByRole('img', { name: /offline/i })).toBeNull()
  })
})

describe('the inline offline error banner, RH-193', () => {
  it('reports a quota failure as an inline alert with "Try again", never a browser dialog', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const ports = createFakePorts({ failBlobPutOnCall: 2 })
    const actions = makeActions()
    renderSwitchable(actions, ports)

    fireEvent.click(await findOfflineMenuItem(MAKE_AVAILABLE))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Not enough storage. 1 of 2 songs could not be downloaded.')
    expect(alert.textContent).not.toMatch(/tap to try again/i)
    expect(alertSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('img', { name: 'Available offline' })).toBeDefined()
    expect(ports.records.rows.has(songRecordId('v-rep-1', 'band-1'))).toBe(true)
    expect(ports.records.rows.has(songRecordId('v-rep-2', 'band-1'))).toBe(false)

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(actions.getPlaylistDetailsWithEntries).toHaveBeenCalledTimes(2)
    alertSpy.mockRestore()
  })

  it('shows a failed song removal with the dismiss button and no "Try again"', () => {
    const dismissError = vi.fn()
    render(
      <OfflineControls
        controller={controllerStub({
          status: 'downloaded',
          downloaded: true,
          stored: 5,
          total: 5,
          error: 'Could not remove Tempo Perdido from this device.',
          errorRetryable: false,
          dismissError,
        })}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Could not remove Tempo Perdido from this device.')
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss offline download error' }))
    expect(dismissError).toHaveBeenCalledTimes(1)
  })

  it('shows a failed "Remove offline copy" without "Try again"', async () => {
    const { ports } = renderSwitchable(makeActions())
    await downloadFromMenu()
    ports.blobs.delete = () => Promise.reject(new Error('cache vanished'))

    fireEvent.click(offlineMenuItem('Remove offline copy'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not remove this playlist from this device.')
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('img', { name: 'Available offline' })).toBeDefined()
  })

  it('renders nothing in the alert slot without an error', () => {
    render(<OfflineControls controller={controllerStub()} />)

    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('the header icon, by controller state', () => {
  it('names the progress and updates it as the run advances', () => {
    const { rerender } = render(
      <OfflineControls controller={controllerStub({ status: 'downloading', progress: { done: 5, total: 12 } })} />,
    )
    expect(screen.getByRole('img', { name: 'Downloading 5 / 12 songs' })).toBeDefined()

    rerender(<OfflineControls controller={controllerStub({ status: 'downloading', progress: { done: 6, total: 12 } })} />)
    expect(screen.getByRole('img', { name: 'Downloading 6 / 12 songs' })).toBeDefined()
  })

  it('is hidden while the rename input is shown, like the action group', () => {
    const controller = controllerStub({ status: 'downloaded', stored: 2, total: 2 })
    const { rerender } = render(<OfflineControls controller={controller} />)
    expect(screen.getByRole('img', { name: 'Available offline' })).toBeDefined()

    rerender(<OfflineControls controller={controller} panel={{ kind: 'rename', draft: 'Gig' }} />)

    expect(screen.getByRole('textbox', { name: 'Playlist name' })).toBeDefined()
    expect(screen.queryByRole('img', { name: 'Available offline' })).toBeNull()
  })

  it('runs the bound controller command and closes the menu', () => {
    const controller = controllerStub({ status: 'downloaded', stored: 1, total: 2 })
    render(<OfflineControls controller={controller} />)

    fireEvent.click(offlineMenuItem('Download 1 missing song'))
    expect(controller.download).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(offlineMenuItem('Refresh offline copy'))
    expect(controller.refresh).toHaveBeenCalledTimes(1)

    fireEvent.click(offlineMenuItem('Remove offline copy'))
    expect(controller.remove).toHaveBeenCalledTimes(1)
  })
})
