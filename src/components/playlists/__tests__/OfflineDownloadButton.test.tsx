// @vitest-environment jsdom
/**
 * RH-79 — the "Available offline" control, in its three states.
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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OfflineDownloadButton } from '../OfflineDownloadButton'
import { createOfflineStore } from '@/lib/offlineStore'
import { createFakePorts, type FakeOfflinePorts } from '@/lib/__tests__/offlineStoreFakes'
import type { OfflineDownloadActions } from '@/hooks/useOfflinePlaylist'
import type { Repertoire, RepertoireTab } from '@/types/database'

afterEach(cleanup)

const ENTRIES = [
  { repertoireId: 'rep-1', songId: 'song-1', title: 'Tempo Perdido', artist: 'Legião Urbana' },
  { repertoireId: 'rep-2', songId: 'song-2', title: 'Faroeste Caboclo', artist: null },
]

function repertoire(id: string): Repertoire {
  return {
    id,
    user_id: null,
    band_id: 'band-1',
    song_id: `song-${id}`,
    personal_key: null,
    status: 'learning',
    tags: [],
    last_practiced: null,
    lyrics: null,
  }
}

function tabRow(repertoireId: string): RepertoireTab {
  return {
    id: `tab-${repertoireId}`,
    repertoire_id: repertoireId,
    title: 'Chart',
    file_url: `https://store.public.blob.vercel-storage.com/tabs/${repertoireId}.pdf`,
    created_at: '2026-05-01T00:00:00Z',
  }
}

/** `hold` stalls the read of the second song, so the busy state can be observed. */
function makeActions(hold?: Promise<void>): OfflineDownloadActions {
  return {
    getPlaylistDetailsWithEntries: vi.fn(() => Promise.resolve({ name: 'Gig', entries: ENTRIES })),
    getSongEntry: vi.fn((repertoireId: string) => Promise.resolve(repertoire(repertoireId))),
    getTabs: vi.fn(async (repertoireId: string) => {
      if (hold && repertoireId === 'rep-2') await hold
      return [tabRow(repertoireId)]
    }),
    // RH-83: the download captures the member's own row in band context.
    getPersonalEntryForSong: vi.fn(() => Promise.resolve(null)),
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
  it('renders the idle state as a control named "Available offline"', async () => {
    renderControl(makeActions())

    const control = await screen.findByRole('button', { name: /available offline/i })
    expect(control.getAttribute('aria-busy')).toBeNull()
  })

  it('renders the in-progress state as a busy control with an x / y song counter', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    renderControl(makeActions(held))

    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))

    const busy = await screen.findByRole('button', { name: /downloading/i })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    // The counter is against the playlist's real song total, read before the
    // first byte is fetched.
    expect(screen.getByText(/0 \/ 2 songs/)).toBeDefined()

    release()
    await screen.findByRole('button', { name: /remove offline copy/i })
  })

  it('renders the downloaded state with a size, a date and both affordances', async () => {
    const ports = renderControl(makeActions())

    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))

    await screen.findByRole('button', { name: /remove offline copy/i })
    expect(screen.getByRole('button', { name: /refresh offline copy/i })).toBeDefined()
    expect(screen.getByText(/downloaded today/i)).toBeDefined()
    expect(screen.getByText(/KB|MB/)).toBeDefined()
    expect(ports.records.rows.has('pl-1')).toBe(true)
  })

  it('removes the offline copy and returns to the idle control', async () => {
    const ports = renderControl(makeActions())
    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))
    fireEvent.click(await screen.findByRole('button', { name: /remove offline copy/i }))

    await waitFor(() => expect(ports.records.rows.size).toBe(0))
    expect(await screen.findByRole('button', { name: /available offline/i })).toBeDefined()
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
  })

  it('reports a quota failure as an inline alert, never as a browser dialog', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const ports = createFakePorts({ failBlobPutOnCall: 2 })
    renderControl(makeActions(), ports)

    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/not enough storage/i)
    expect(alertSpy).not.toHaveBeenCalled()
    // The rollback, seen from the UI: still offerable, nothing stored.
    expect(screen.getByRole('button', { name: /available offline/i })).toBeDefined()
    expect(ports.records.rows.size).toBe(0)
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
    alertSpy.mockRestore()
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
  it('disables the idle "Available offline" control when offline', async () => {
    renderControl(makeActions(), createFakePorts(), true)

    const control = await screen.findByRole('button', { name: /available offline/i })
    expect(control.hasAttribute('disabled')).toBe(true)
  })

  it('leaves the idle "Available offline" control enabled when online', async () => {
    renderControl(makeActions(), createFakePorts(), false)

    const control = await screen.findByRole('button', { name: /available offline/i })
    expect(control.hasAttribute('disabled')).toBe(false)
  })

  it('starts no download from a click on the disabled idle control', async () => {
    const actions = makeActions()
    renderControl(actions, createFakePorts(), true)

    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))

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
    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))
    await screen.findByRole('button', { name: /remove offline copy/i })

    rerender(control(true))

    expect(screen.getByRole('button', { name: /refresh offline copy/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /remove offline copy/i }).hasAttribute('disabled')).toBe(false)
  })

  it('leaves "Refresh offline copy" enabled when online', async () => {
    renderControl(makeActions())
    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))

    const refresh = await screen.findByRole('button', { name: /refresh offline copy/i })
    expect(refresh.hasAttribute('disabled')).toBe(false)
  })
})
