// @vitest-environment jsdom
/**
 * RH-79 — the playlist's offline control, in its three states. Since RH-188
 * the idle state is the explicit action "Make available offline"; "Available
 * offline" is only ever the downloaded state's status text.
 *
 * The control receives the real store over fake ports through its optional
 * `store` prop, so what the "downloaded" state shows is a size and a date that
 * were actually written, and the error state is produced by a real rollback
 * rather than by a stubbed rejection.
 *
 * The literal is English per AGENTS.md F25 (i18n is landing-page only); the
 * design writes it "Disponível offline", and this is the same control.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { OfflineDownloadButton } from '../OfflineDownloadButton'
import { HookedOfflineControl } from './offlineControlHarness'
import { createOfflineStore } from '@/lib/offlineStore'
import { songRecordId } from '@/lib/offlineSongRecord'
import { createFakePorts, type FakeOfflinePorts } from '@/lib/__tests__/offlineStoreFakes'
import type { OfflineDownloadActions, OfflinePlaylistController } from '@/hooks/useOfflinePlaylist'
import type { ResolvedSongEntry, SongFile } from '@/types/database'

afterEach(cleanup)

/** The idle control's accessible name (RH-188), matched exactly. */
const MAKE_AVAILABLE = 'Make available offline'
const OFFLINE_HINT = 'Connect to the internet to download this playlist.'

const ENTRIES = [
  { repertoireId: 'rep-1', versionId: 'v-rep-1', songId: 'song-1', title: 'Tempo Perdido', artist: 'Legião Urbana' },
  { repertoireId: 'rep-2', versionId: 'v-rep-2', songId: 'song-2', title: 'Faroeste Caboclo', artist: null },
]

/** The captured `(owner, version)` pair, read by version id since RH-132. */
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
    getResolvedEntryForVersion: vi.fn((versionId: string) =>
      Promise.resolve(resolvedEntry(versionId)),
    ),
    // Keyed by song id since RH-123: the resolved entry for `v-rep-2` carries
    // `song_id: 'song-rep-2'`, which is what `gatherSongs` passes.
    getTabs: vi.fn(async (songId: string) => {
      if (hold && songId === 'song-rep-2') await hold
      return [tabRow(songId)]
    }),
    // RH-83: the download captures the member's own row in band context.
    getPersonalEntryForSong: vi.fn(() => Promise.resolve(null)),
    // RH-186: and the reader's own custom field values on each version.
    getCustomFieldValues: vi.fn(() => Promise.resolve([])),
  }
}

/** The page's live list: the same two songs the server read returns, unless a test says otherwise. */
const LIVE_IDS = ENTRIES.map((entry) => entry.versionId)

function renderControl(
  actions: OfflineDownloadActions,
  ports: FakeOfflinePorts = createFakePorts(),
  offline?: boolean,
) {
  render(
    <HookedOfflineControl
      playlistId="pl-1"
      playlistName="Gig — Bar do Zé"
      bandId="band-1"
      versionIds={LIVE_IDS}
      actions={actions}
      store={createOfflineStore(ports)}
      offline={offline}
    />,
  )
  return ports
}

/**
 * Renders online over one store, and returns `control(offline)` to re-render
 * the same hook with the connection dropped or back, as the page's signal does.
 */
function renderSwitchable(
  actions: OfflineDownloadActions,
  ports: FakeOfflinePorts = createFakePorts(),
  versionIds: string[] = LIVE_IDS,
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
  return { ...render(control(false)), control }
}

/** A plain controller, for the states that need no store behind them. */
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

/** `count` songs of the live list, stored on their own (no list) in band-1's context. */
async function storeSongs(ports: FakeOfflinePorts, entries: typeof ENTRIES) {
  const store = createOfflineStore(ports)
  for (const entry of entries) {
    await store.saveOfflineSong({
      song: {
        entry,
        repertoire: resolvedEntry(entry.versionId),
        personalRepertoire: null,
        tabs: [],
        customFields: [],
      },
      bandId: 'band-1',
      savedAt: '2026-11-07T10:00:00.000Z',
      individualDownload: true,
    })
  }
}

/** Live entries the server read does not know yet: songs added online after the download. */
function liveEntries(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    repertoireId: `rep-${index + 1}`,
    versionId: `v-rep-${index + 1}`,
    songId: `song-${index + 1}`,
    title: `Song ${index + 1}`,
    artist: null,
  }))
}

describe('OfflineDownloadButton', () => {
  it('renders the idle state as an enabled control named "Make available offline"', async () => {
    renderControl(makeActions())

    const control = await screen.findByRole('button', { name: MAKE_AVAILABLE })
    expect(control.getAttribute('aria-busy')).toBeNull()
    expect(control.hasAttribute('disabled')).toBe(false)
    expect(control.getAttribute('aria-describedby')).toBeNull()
    expect(screen.queryByText(OFFLINE_HINT)).toBeNull()
    // RH-193: nothing of the playlist is stored, so the idle state is RH-188's.
    expect(screen.queryByText(/already on this device/)).toBeNull()
  })

  it('renders the in-progress state as a busy control with an x / y song counter', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    renderControl(makeActions(held))

    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))

    const busy = await screen.findByRole('button', { name: /downloading/i })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    // The counter is against the songs this run fetches; the first one is
    // stored while the second is held (RH-192: one song at a time).
    expect(await screen.findByText(/1 \/ 2 songs/)).toBeDefined()

    release()
    await screen.findByRole('button', { name: /remove offline copy/i })
  })

  it('renders the downloaded state with a size, a date and both affordances', async () => {
    const ports = renderControl(makeActions())

    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))

    await screen.findByRole('button', { name: /remove offline copy/i })
    expect(screen.getByRole('button', { name: /refresh offline copy/i })).toBeDefined()
    expect(screen.getByText(/downloaded today/i)).toBeDefined()
    expect(screen.getByText(/KB|MB/)).toBeDefined()
    expect(ports.records.rows.has('pl-1')).toBe(true)
  })

  it('removes the offline copy and returns to the idle control', async () => {
    const ports = renderControl(makeActions())
    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))
    fireEvent.click(await screen.findByRole('button', { name: /remove offline copy/i }))

    await waitFor(() => expect(ports.records.rows.size).toBe(0))
    expect(await screen.findByRole('button', { name: MAKE_AVAILABLE })).toBeDefined()
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
  })

  it('reports a quota failure as an inline alert, never as a browser dialog', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const ports = createFakePorts({ failBlobPutOnCall: 2 })
    renderControl(makeActions(), ports)

    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Not enough storage. 1 of 2 songs could not be downloaded.')
    expect(alertSpy).not.toHaveBeenCalled()
    // RH-192: the song that fit stays stored, and the list with it.
    expect(screen.getByText('Available offline')).toBeDefined()
    expect(ports.records.rows.has('pl-1')).toBe(true)
    expect(ports.records.rows.has(songRecordId('v-rep-1', 'band-1'))).toBe(true)
    expect(ports.records.rows.has(songRecordId('v-rep-2', 'band-1'))).toBe(false)
    alertSpy.mockRestore()
  })

  it('offers "Try again" in the failure alert, which restarts the download', async () => {
    const ports = createFakePorts({ failBlobPutOnCall: 2 })
    const actions = makeActions()
    renderControl(actions, ports)

    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))

    const alert = await screen.findByRole('alert')
    const retry = within(alert).getByRole('button', { name: 'Try again' })
    expect(retry.hasAttribute('disabled')).toBe(false)
    expect(actions.getPlaylistDetailsWithEntries).toHaveBeenCalledTimes(1)

    fireEvent.click(retry)

    await screen.findByRole('button', { name: /remove offline copy/i })
    expect(actions.getPlaylistDetailsWithEntries).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Available offline')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(ports.records.rows.has('pl-1')).toBe(true)
  })

  it('no longer tells the user to "tap" a message to retry', async () => {
    renderControl(makeActions(), createFakePorts({ failBlobPutOnCall: 2 }))

    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/tap to try again/i)
  })
})

/**
 * RH-99 ER5 — offline, a download cannot complete, so the two controls that
 * start one are *disabled*, not left to fail. `Remove offline copy` stays
 * enabled on purpose: deleting from IndexedDB and Cache Storage is a purely
 * local write that completes with no network and means exactly what it says.
 *
 * The signal is a prop: `PlaylistDetailView` is the route's single
 * `useOfflineStatus()` caller, so this component stays presentational.
 */
describe('OfflineDownloadButton, offline (RH-99 ER5)', () => {
  it('disables the idle "Make available offline" control when offline', async () => {
    renderControl(makeActions(), createFakePorts(), true)

    const control = await screen.findByRole('button', { name: MAKE_AVAILABLE })
    expect(control.hasAttribute('disabled')).toBe(true)
  })

  it('explains under the disabled idle control why it is disabled (RH-188)', async () => {
    renderControl(makeActions(), createFakePorts(), true)

    const control = await screen.findByRole('button', {
      name: MAKE_AVAILABLE,
      description: OFFLINE_HINT,
    })
    const hintId = control.getAttribute('aria-describedby')
    expect(hintId).toBeTruthy()
    expect(document.getElementById(hintId!)?.textContent).toBe(OFFLINE_HINT)
  })

  it('disables "Try again" in the failure alert when offline (RH-188)', async () => {
    // The failure happens online; then the connection drops.
    const actions = makeActions()
    const { rerender, control } = renderSwitchable(actions, createFakePorts({ failBlobPutOnCall: 2 }))
    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))
    const alert = await screen.findByRole('alert')

    rerender(control(true))

    const retry = within(alert).getByRole('button', { name: 'Try again' })
    expect(retry.hasAttribute('disabled')).toBe(true)
    fireEvent.click(retry)
    await waitFor(() => expect(actions.getPlaylistDetailsWithEntries).toHaveBeenCalledTimes(1))
  })

  it('leaves the idle "Make available offline" control enabled when online', async () => {
    renderControl(makeActions(), createFakePorts(), false)

    const control = await screen.findByRole('button', { name: MAKE_AVAILABLE })
    expect(control.hasAttribute('disabled')).toBe(false)
  })

  it('starts no download from a click on the disabled idle control', async () => {
    const actions = makeActions()
    renderControl(actions, createFakePorts(), true)

    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))

    await waitFor(() => expect(actions.getPlaylistDetailsWithEntries).not.toHaveBeenCalled())
  })

  it('disables "Refresh offline copy" and keeps "Remove offline copy" enabled when offline', async () => {
    // The copy is written while online, then the connection drops: the control
    // is re-rendered with `offline`, exactly as the page's signal would do it.
    const { rerender, control } = renderSwitchable(makeActions())
    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))
    await screen.findByRole('button', { name: /remove offline copy/i })

    rerender(control(true))

    expect(screen.getByRole('button', { name: /refresh offline copy/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /remove offline copy/i }).hasAttribute('disabled')).toBe(false)
  })

  it('leaves "Refresh offline copy" enabled when online', async () => {
    renderControl(makeActions())
    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))

    const refresh = await screen.findByRole('button', { name: /refresh offline copy/i })
    expect(refresh.hasAttribute('disabled')).toBe(false)
  })
})

/**
 * RH-193 — the count is over the page's live entries, so a song added online
 * after the download reads one short and gets a missing-only download.
 */
describe('OfflineDownloadButton, the live count (RH-193)', () => {
  function renderLive(serverCount: number, liveCount: number, ports = createFakePorts()) {
    const actions = makeActions(undefined, liveEntries(serverCount))
    const versionIds = liveEntries(liveCount).map((entry) => entry.versionId)
    return { ...renderSwitchable(actions, ports, versionIds), actions }
  }

  it('shows Download 1 missing song at 5 of 6 songs stored, disabled offline', async () => {
    const { actions, rerender, control } = renderLive(5, 6)
    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))

    expect(await screen.findByText(/^5 of 6 songs · .* · downloaded today$/)).toBeDefined()
    const missing = screen.getByRole('button', { name: 'Download 1 missing song' })
    expect(missing.hasAttribute('disabled')).toBe(false)

    rerender(control(true))
    expect(screen.getByRole('button', { name: 'Download 1 missing song' }).hasAttribute('disabled')).toBe(true)

    // Online again, the server now knows the sixth song: only it is fetched.
    rerender(control(false))
    vi.mocked(actions.getPlaylistDetailsWithEntries).mockResolvedValue({ name: 'Gig', entries: liveEntries(6) })
    vi.mocked(actions.getResolvedEntryForVersion).mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Download 1 missing song' }))

    expect(await screen.findByText(/^6 of 6 songs/)).toBeDefined()
    expect(vi.mocked(actions.getResolvedEntryForVersion).mock.calls.map(([id]) => id)).toEqual(['v-rep-6'])
    expect(screen.queryByRole('button', { name: /missing song/ })).toBeNull()
  })

  it('pluralises the missing-only download', async () => {
    renderLive(3, 5)
    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))

    expect(await screen.findByText(/^3 of 5 songs/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Download 2 missing songs' })).toBeDefined()
  })

  it('shows no missing-only download when every live song is stored', async () => {
    renderLive(2, 2)
    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))

    expect(await screen.findByText(/^2 of 2 songs/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /missing song/ })).toBeNull()
  })

  it('says 2 of 5 songs are already on this device. in the idle state when no list is stored', async () => {
    const ports = createFakePorts()
    await storeSongs(ports, liveEntries(5).slice(0, 2))

    renderLive(5, 5, ports)

    expect(await screen.findByText('2 of 5 songs are already on this device.')).toBeDefined()
    expect(screen.getByRole('button', { name: MAKE_AVAILABLE })).toBeDefined()
    expect(screen.queryByText('Available offline')).toBeNull()
  })

  it('puts the already-stored line under the offline hint when both show', async () => {
    const ports = createFakePorts()
    await storeSongs(ports, liveEntries(5).slice(0, 2))
    const { rerender, control } = renderLive(5, 5, ports)
    await screen.findByText('2 of 5 songs are already on this device.')

    rerender(control(true))

    const hint = screen.getByText(OFFLINE_HINT)
    const already = screen.getByText('2 of 5 songs are already on this device.')
    expect(hint.compareDocumentPosition(already) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('OfflineDownloadButton, removal failures (RH-193)', () => {
  it('shows a failed song removal with the dismiss button and no Try again', () => {
    const dismissError = vi.fn()
    render(
      <OfflineDownloadButton
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

  it('shows a failed Remove offline copy without Try again', async () => {
    const ports = renderControl(makeActions())
    fireEvent.click(await screen.findByRole('button', { name: MAKE_AVAILABLE }))
    await screen.findByRole('button', { name: /remove offline copy/i })
    ports.blobs.delete = () => Promise.reject(new Error('cache vanished'))

    fireEvent.click(screen.getByRole('button', { name: /remove offline copy/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not remove this playlist from this device.')
    expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByText('Available offline')).toBeDefined()
  })
})
