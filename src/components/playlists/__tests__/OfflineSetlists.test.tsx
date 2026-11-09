// @vitest-environment jsdom
/**
 * RH-195 — the downloaded setlists `/offline` lists after a cold offline start.
 *
 * The page is rendered whole (`OfflinePage`), so what is asserted is what the
 * worker's precached `/offline` shows: the "You are offline" card, then
 * `OfflineSetlists` reading the device. `OFFLINE_STORE` — the default the page
 * cannot override, since a page takes no props — delegates to the real store
 * over `createFakePorts()`, re-created per test (RH-79's fakes), so every row
 * below comes from records the real store wrote.
 */
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import OfflinePage from '@/app/offline/page'
import { OfflineSetlists } from '@/components/playlists/OfflineSetlists'
import { logger } from '@/lib/logger'
import { createOfflineStore, type OfflineStore } from '@/lib/offlineStore'
import { readSongQueue } from '@/lib/songQueue'
import { createFakePorts, seedSetlistOf, seedSongInput } from '@/lib/__tests__/offlineStoreFakes'

const device = vi.hoisted(() => ({ store: null as unknown as OfflineStore }))

vi.mock('@/lib/offlineStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/offlineStore')>()),
  // Only the two reads `OfflineSetlists` makes; anything else would throw.
  OFFLINE_STORE: {
    listOfflineSetlists: () => device.store.listOfflineSetlists(),
    listOfflineSongs: () => device.store.listOfflineSongs(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

afterEach(cleanup)

beforeEach(() => {
  sessionStorage.clear()
  vi.mocked(logger.error).mockClear()
  device.store = createOfflineStore(createFakePorts())
})

/** Friday Gig: personal, its third song never stored. */
const FRIDAY = {
  playlistId: 'pl-friday',
  playlistName: 'Friday Gig',
  entries: [
    { versionId: 'v-tempo', title: 'Tempo Perdido' },
    { versionId: 'v-indios', title: 'Índios' },
    { versionId: 'v-pais', title: 'Pais e Filhos' },
  ],
  notStored: ['v-pais'],
}

/**
 * Ensaio: a band's, holding Tempo Perdido too — whose *personal* copy Friday
 * Gig stored. In the band's context it is not on the device.
 */
const ENSAIO = {
  playlistId: 'pl-ensaio',
  playlistName: 'Ensaio Quarta',
  bandId: 'band-1',
  entries: [
    { versionId: 'v-sera', title: 'Será' },
    { versionId: 'v-tempo', title: 'Tempo Perdido' },
  ],
  notStored: ['v-tempo'],
}

async function seedBoth() {
  await seedSetlistOf(device.store, FRIDAY)
  await seedSetlistOf(device.store, ENSAIO)
}

/** The `Downloaded playlists` region, once the device has been read. */
function downloaded() {
  return screen.findByRole('region', { name: 'Downloaded playlists' })
}

function rowsOf(playlistName: string) {
  return within(screen.getByRole('list', { name: playlistName })).getAllByRole('listitem')
}

describe('/offline with downloaded setlists (RH-195)', () => {
  it('lists every downloaded setlist under the offline card, its songs numbered in stored order with N of M songs', async () => {
    await seedBoth()
    render(<OfflinePage />)

    const region = await downloaded()
    expect(screen.getByTestId('offline-shell')).toBeDefined()
    expect(within(region).getByRole('heading', { name: 'Downloaded playlists' })).toBeDefined()
    // The card first, the setlists beneath it.
    expect(
      screen.getByTestId('offline-shell').compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    expect(within(region).getByText('Friday Gig')).toBeDefined()
    expect(within(region).getByText('2 of 3 songs')).toBeDefined()
    expect(rowsOf('Friday Gig').map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^1\.\s*Tempo Perdido/),
      expect.stringMatching(/^2\.\s*Índios/),
      expect.stringMatching(/^3\.\s*Pais e Filhos/),
    ])

    expect(within(region).getByText('Ensaio Quarta')).toBeDefined()
    expect(within(region).getByText('1 of 2 songs')).toBeDefined()
    expect(rowsOf('Ensaio Quarta').map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^1\.\s*Será/),
      expect.stringMatching(/^2\.\s*Tempo Perdido/),
    ])
  })

  it('links each stored song to its Fast View in the setlist owner context', async () => {
    await seedBoth()
    render(<OfflinePage />)
    await downloaded()

    const [tempo, indios] = rowsOf('Friday Gig')
    expect(within(tempo).getByRole('link', { name: /Tempo Perdido/ }).getAttribute('href')).toBe(
      '/songs/v-tempo/fast-view',
    )
    expect(within(indios).getByRole('link', { name: /Índios/ }).getAttribute('href')).toBe('/songs/v-indios/fast-view')

    const [sera] = rowsOf('Ensaio Quarta')
    expect(within(sera).getByRole('link', { name: /Será/ }).getAttribute('href')).toBe(
      '/songs/v-sera/fast-view?bandId=band-1',
    )
  })

  it('marks a song not on the device with Not on this device, a dashed row and no link', async () => {
    await seedBoth()
    render(<OfflinePage />)
    await downloaded()

    // Never downloaded at all.
    const pais = rowsOf('Friday Gig')[2]
    // Stored personally, but not in the band's context.
    const bandTempo = rowsOf('Ensaio Quarta')[1]
    for (const row of [pais, bandTempo]) {
      expect(within(row).queryByRole('link')).toBeNull()
      expect(within(row).getByRole('img', { name: 'Not on this device' })).toBeDefined()
      expect(within(row).getByText('Not on this device')).toBeDefined()
      expect(row.className).toContain('border-dashed')
    }
    expect(within(rowsOf('Friday Gig')[0]).queryByRole('img', { name: 'Not on this device' })).toBeNull()
  })
})

describe('opening a stored song from /offline (RH-195)', () => {
  it('writes the whole personal setlist as the queue, labelled with its name, with /offline as origin', async () => {
    await seedBoth()
    render(<OfflinePage />)
    await downloaded()

    fireEvent.click(within(rowsOf('Friday Gig')[1]).getByRole('link', { name: /Índios/ }))

    expect(readSongQueue()).toEqual({
      // Every entry in stored order — the missing one included.
      entries: [
        { versionId: 'v-tempo', title: 'Tempo Perdido', artist: null },
        { versionId: 'v-indios', title: 'Índios', artist: null },
        { versionId: 'v-pais', title: 'Pais e Filhos', artist: null },
      ],
      owner: { type: 'personal' },
      originHref: '/offline',
      label: 'Friday Gig',
    })
  })

  it('records the band as the owner of a band setlist queue', async () => {
    await seedBoth()
    render(<OfflinePage />)
    await downloaded()

    fireEvent.click(within(rowsOf('Ensaio Quarta')[0]).getByRole('link', { name: /Será/ }))

    expect(readSongQueue()).toEqual({
      entries: [
        { versionId: 'v-sera', title: 'Será', artist: null },
        { versionId: 'v-tempo', title: 'Tempo Perdido', artist: null },
      ],
      owner: { type: 'band', bandId: 'band-1' },
      originHref: '/offline',
      label: 'Ensaio Quarta',
    })
  })
})

describe('/offline with nothing downloaded (RH-195)', () => {
  /** Renders, then waits until the device read has resolved and been applied. */
  async function renderRead(store: OfflineStore, ui: ReactElement) {
    const setlistsRead = vi.spyOn(store, 'listOfflineSetlists')
    render(ui)
    await waitFor(() => expect(setlistsRead).toHaveBeenCalled())
    await act(async () => {
      await setlistsRead.mock.results[0].value.catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('renders only the You are offline card and no setlist section', async () => {
    await renderRead(device.store, <OfflinePage />)

    expect(screen.getByTestId('offline-shell')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'You are offline' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Downloaded playlists' })).toBeNull()
    expect(screen.queryByText('Downloaded playlists')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('renders nothing for a device holding only individually downloaded songs', async () => {
    await device.store.saveOfflineSong({
      song: seedSongInput('v-1', 'tab-1', 'Alone'),
      bandId: null,
      savedAt: '2026-09-20T18:04:00.000Z',
      individualDownload: true,
    })

    await renderRead(device.store, <OfflinePage />)

    expect(screen.queryByRole('region', { name: 'Downloaded playlists' })).toBeNull()
    expect(screen.queryByText('Alone')).toBeNull()
  })

  it('logs a failed device read and renders nothing rather than breaking the offline page', async () => {
    const failure = new Error('IndexedDB unavailable')
    const store: OfflineStore = {
      ...createOfflineStore(createFakePorts()),
      listOfflineSetlists: () => Promise.reject(failure),
    }

    await renderRead(store, <OfflineSetlists store={store} />)

    expect(screen.queryByRole('region', { name: 'Downloaded playlists' })).toBeNull()
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/downloaded playlists/i), failure)
  })
})
