// @vitest-environment jsdom
/**
 * RH-79, RH-194 — the `/settings` offline storage section.
 *
 * Seeded through the real store over fake ports, so every size shown is the
 * size of a record that was actually written, and what a removal keeps is
 * asserted against both the fake record port and the fake cache.
 *
 * The seed mirrors the RH-194 mockup: `Friday Gig` lists four songs and holds
 * three of them; `Ensaio quarta` (downloaded yesterday) shares `Tempo Perdido`
 * with it; `Pais e Filhos` is in `Friday Gig` and was also downloaded
 * individually; `Gita` was downloaded individually only.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { OfflineStorageSection } from '../OfflineStorageSection'
import { formatOfflineBytes } from '@/lib/offlineFormat'
import { isSongRecord } from '@/lib/offlineRecords'
import { songRecordId } from '@/lib/offlineSongRecord'
import { createOfflineStore, type OfflineStore } from '@/lib/offlineStore'
import {
  createFakePorts,
  seedSetlistOf,
  seedSongInput,
  type FakeOfflinePorts,
} from '@/lib/__tests__/offlineStoreFakes'

afterEach(cleanup)

const TODAY = new Date().toISOString()
const YESTERDAY = new Date(Date.now() - 36 * 3_600_000).toISOString()

const TEMPO = songRecordId('v-tempo', null)
const PAIS = songRecordId('v-pais', null)
const FAROESTE = songRecordId('v-faroeste', null)
const GITA = songRecordId('v-gita', null)

async function saveIndividually(store: OfflineStore, versionId: string, title: string): Promise<void> {
  await store.saveOfflineSong({
    song: seedSongInput(versionId, `tab-${versionId}`, title),
    bandId: null,
    savedAt: TODAY,
    individualDownload: true,
  })
}

async function seeded(): Promise<FakeOfflinePorts> {
  const ports = createFakePorts()
  const store = createOfflineStore(ports)
  await seedSetlistOf(store, {
    playlistId: 'pl-friday',
    playlistName: 'Friday Gig',
    savedAt: TODAY,
    entries: [
      { versionId: 'v-tempo', title: 'Tempo Perdido' },
      { versionId: 'v-pais', title: 'Pais e Filhos' },
      { versionId: 'v-faroeste', title: 'Faroeste Caboclo' },
      { versionId: 'v-eduardo', title: 'Eduardo e Mônica' },
    ],
    notStored: ['v-eduardo'],
  })
  await seedSetlistOf(store, {
    playlistId: 'pl-ensaio',
    playlistName: 'Ensaio quarta',
    savedAt: YESTERDAY,
    entries: [{ versionId: 'v-tempo', title: 'Tempo Perdido' }],
  })
  await saveIndividually(store, 'v-pais', 'Pais e Filhos')
  await saveIndividually(store, 'v-gita', 'Gita')
  return ports
}

function bytesOf(ports: FakeOfflinePorts, ...recordIds: string[]): number {
  const songs = [...ports.records.rows.values()].filter(isSongRecord)
  return songs.filter((song) => recordIds.includes(song.playlistId)).reduce((sum, song) => sum + song.bytes, 0)
}

function section(name: 'Playlists' | 'Songs'): HTMLElement {
  return screen.getByRole('list', { name })
}

/** The row whose name reads exactly `name`, within one section. */
function row(name: 'Playlists' | 'Songs', title: string): HTMLElement {
  return within(section(name)).getByText(title, { selector: 'p' }).closest('li') as HTMLElement
}

async function renderSeeded(): Promise<FakeOfflinePorts> {
  const ports = await seeded()
  render(<OfflineStorageSection store={createOfflineStore(ports)} />)
  await waitFor(() => expect(screen.getByRole('list', { name: 'Playlists' })).toBeDefined())
  await within(section('Playlists')).findByText('Friday Gig')
  return ports
}

describe('OfflineStorageSection, Playlists and Songs (RH-194)', () => {
  it('lists downloaded playlists with their N of M songs count, summed size and download date (ER2)', async () => {
    const ports = await renderSeeded()

    const friday = row('Playlists', 'Friday Gig')
    const fridayBytes = formatOfflineBytes(bytesOf(ports, TEMPO, PAIS, FAROESTE))
    expect(friday.textContent).toContain(`3 of 4 songs · ${fridayBytes} · downloaded today`)

    const ensaio = row('Playlists', 'Ensaio quarta')
    expect(ensaio.textContent).toContain(`1 of 1 songs · ${formatOfflineBytes(bytesOf(ports, TEMPO))} · downloaded yesterday`)
    expect(within(section('Playlists')).getAllByRole('listitem')).toHaveLength(2)
  })

  it('lists stored songs with size, download date and where they came from, with no Song badge (ER3)', async () => {
    const ports = await renderSeeded()

    const songs = within(section('Songs'))
    expect(songs.getAllByRole('listitem')).toHaveLength(4)
    // A song's date is its own latest download: Ensaio quarta saved it again yesterday.
    expect(row('Songs', 'Tempo Perdido').textContent).toContain(
      `${formatOfflineBytes(bytesOf(ports, TEMPO))} · downloaded yesterday · In Friday Gig, In Ensaio quarta`,
    )
    expect(row('Songs', 'Pais e Filhos').textContent).toContain('In Friday Gig, Downloaded individually')
    expect(row('Songs', 'Faroeste Caboclo').textContent).toContain('· In Friday Gig')
    expect(row('Songs', 'Gita').textContent).toContain(
      `${formatOfflineBytes(bytesOf(ports, GITA))} · downloaded today · Downloaded individually`,
    )
    // A song not on the device is counted by its playlist, never listed.
    expect(songs.queryByText('Eduardo e Mônica')).toBeNull()
    expect(screen.queryByText('Song')).toBeNull()
  })

  it('totals each stored song once, though two playlists share one', async () => {
    const ports = await renderSeeded()

    expect(screen.getByTestId('offline-total').textContent).toBe(
      formatOfflineBytes(bytesOf(ports, TEMPO, PAIS, FAROESTE, GITA)),
    )
  })

  it('removes a playlist and keeps songs held by another playlist or downloaded individually (ER4)', async () => {
    const ports = await renderSeeded()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Friday Gig from this device' }))

    await waitFor(() => expect(within(section('Playlists')).queryByText('Friday Gig')).toBeNull())
    expect(ports.records.rows.has('pl-friday')).toBe(false)
    expect(ports.records.rows.has('pl-ensaio')).toBe(true)
    // Only Faroeste Caboclo was Friday Gig's alone.
    expect(ports.records.rows.has(FAROESTE)).toBe(false)
    expect(ports.blobs.keysFor(FAROESTE)).toEqual([])
    expect(within(section('Songs')).queryByText('Faroeste Caboclo')).toBeNull()
    expect(row('Songs', 'Tempo Perdido').textContent).toContain('In Ensaio quarta')
    expect(row('Songs', 'Pais e Filhos').textContent).toContain('· Downloaded individually')
    expect(row('Songs', 'Gita')).toBeDefined()
    expect(ports.blobs.keysFor(TEMPO)).toEqual([`/__offline-tab/${TEMPO}/tab-v-tempo`])
  })

  it('removes a song and updates the counts of the playlists holding it (ER5)', async () => {
    const ports = await renderSeeded()
    const remaining = formatOfflineBytes(bytesOf(ports, PAIS, FAROESTE))

    fireEvent.click(screen.getByRole('button', { name: 'Remove Tempo Perdido from this device' }))

    await waitFor(() => expect(within(section('Songs')).queryByText('Tempo Perdido')).toBeNull())
    expect(ports.records.rows.has(TEMPO)).toBe(false)
    expect(ports.blobs.keysFor(TEMPO)).toEqual([])
    expect(row('Playlists', 'Friday Gig').textContent).toContain(`2 of 4 songs · ${remaining} ·`)
    expect(row('Playlists', 'Ensaio quarta').textContent).toContain('0 of 1 songs · 0 B ·')
    expect(screen.getByTestId('offline-total').textContent).toBe(
      formatOfflineBytes(bytesOf(ports, PAIS, FAROESTE, GITA)),
    )
  })

  it('renders only the Songs section when no playlist is downloaded', async () => {
    const ports = createFakePorts()
    await saveIndividually(createOfflineStore(ports), 'v-solo', 'Only Solo')
    render(<OfflineStorageSection store={createOfflineStore(ports)} />)

    await within(await screen.findByRole('list', { name: 'Songs' })).findByText('Only Solo')
    expect(screen.queryByRole('list', { name: 'Playlists' })).toBeNull()
    expect(screen.queryByText(/nothing is stored on this device/i)).toBeNull()
  })

  it('displays "Nothing is stored on this device." and 0 B when no playlists and no songs are stored (ER6)', async () => {
    render(<OfflineStorageSection store={createOfflineStore(createFakePorts())} />)

    expect(await screen.findByText('Nothing is stored on this device.')).toBeDefined()
    expect(screen.getByTestId('offline-total').textContent).toBe('0 B')
    expect(screen.queryByRole('list', { name: 'Playlists' })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Songs' })).toBeNull()
  })

  it('omits the quota line when the browser offers no estimate', async () => {
    render(<OfflineStorageSection store={createOfflineStore(createFakePorts())} />)

    await screen.findByText(/nothing is stored on this device/i)
    // jsdom implements no `navigator.storage`: no placeholder, no spinner.
    expect(screen.queryByTestId('offline-quota')).toBeNull()
  })
})
