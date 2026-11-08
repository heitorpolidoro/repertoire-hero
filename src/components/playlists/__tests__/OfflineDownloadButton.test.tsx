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
import { createOfflineStore } from '@/lib/offlineStore'
import { songRecordId } from '@/lib/offlineSongRecord'
import { createFakePorts, type FakeOfflinePorts } from '@/lib/__tests__/offlineStoreFakes'
import type { OfflineDownloadActions } from '@/hooks/useOfflinePlaylist'
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
function makeActions(hold?: Promise<void>): OfflineDownloadActions {
  return {
    getPlaylistDetailsWithEntries: vi.fn(() => Promise.resolve({ name: 'Gig', entries: ENTRIES })),
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

function renderControl(
  actions: OfflineDownloadActions,
  ports: FakeOfflinePorts = createFakePorts(),
  offline?: boolean,
) {
  render(
    <OfflineDownloadButton
      playlistId="pl-1"
      playlistName="Gig — Bar do Zé"
      bandId="band-1"
      actions={actions}
      store={createOfflineStore(ports)}
      offline={offline}
    />,
  )
  return ports
}

describe('OfflineDownloadButton', () => {
  it('renders the idle state as an enabled control named "Make available offline"', async () => {
    renderControl(makeActions())

    const control = await screen.findByRole('button', { name: MAKE_AVAILABLE })
    expect(control.getAttribute('aria-busy')).toBeNull()
    expect(control.hasAttribute('disabled')).toBe(false)
    expect(control.getAttribute('aria-describedby')).toBeNull()
    expect(screen.queryByText(OFFLINE_HINT)).toBeNull()
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
    const store = createOfflineStore(createFakePorts({ failBlobPutOnCall: 2 }))
    const actions = makeActions()
    const control = (offline: boolean) => (
      <OfflineDownloadButton
        playlistId="pl-1"
        playlistName="Gig — Bar do Zé"
        bandId="band-1"
        actions={actions}
        store={store}
        offline={offline}
      />
    )
    const { rerender } = render(control(false))
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
    const store = createOfflineStore(createFakePorts())
    const actions = makeActions()
    const control = (offline: boolean) => (
      <OfflineDownloadButton
        playlistId="pl-1"
        playlistName="Gig — Bar do Zé"
        bandId="band-1"
        actions={actions}
        store={store}
        offline={offline}
      />
    )
    const { rerender } = render(control(false))
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
