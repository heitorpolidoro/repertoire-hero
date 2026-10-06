// @vitest-environment jsdom
/**
 * RH-79 — the `/settings` offline storage section.
 *
 * Seeded through the real store over fake ports, so the total shown is the sum
 * of records that were actually written, and "removing one leaves the other
 * intact" is asserted against both the fake record port and the fake cache.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OfflineStorageSection } from '../OfflineStorageSection'
import { createOfflineStore, type SaveOfflinePlaylistInput } from '@/lib/offlineStore'
import { createFakePorts, type FakeOfflinePorts } from '@/lib/__tests__/offlineStoreFakes'
import type { Repertoire } from '@/types/database'

afterEach(cleanup)

const REPERTOIRE: Repertoire = {
  id: 'rep-1',
  user_id: 'user-1',
  band_id: null,
  song_id: 'song-1',
  version_id: 'version-1',
  key: null,
  tuning: null,
  map: null,
  status: 'learning',
  tags: [],
  last_practiced: null,
  lyrics: null,
}

function saveInput(playlistId: string, playlistName: string, tabId: string): SaveOfflinePlaylistInput {
  return {
    playlistId,
    playlistName,
    bandId: null,
    savedAt: new Date().toISOString(),
    songs: [
      {
        entry: { repertoireId: 'rep-1', songId: 'song-1', title: 'Song', artist: null },
        repertoire: REPERTOIRE,
        tabs: [
          {
            id: tabId,
            repertoire_id: 'rep-1',
            title: 'Chart',
            file_url: `https://store.public.blob.vercel-storage.com/tabs/${tabId}.pdf`,
            created_at: '2026-05-01T00:00:00Z',
          },
        ],
      },
    ],
  }
}

async function seeded(): Promise<FakeOfflinePorts> {
  const ports = createFakePorts()
  const store = createOfflineStore(ports)
  await store.saveOfflinePlaylist(saveInput('pl-1', 'Gig — Bar do Zé', 'tab-a'))
  await store.saveOfflinePlaylist(saveInput('pl-2', 'Ensaio quarta', 'tab-b'))
  return ports
}

describe('OfflineStorageSection', () => {
  it('lists every stored playlist and totals the records own bytes', async () => {
    const ports = await seeded()
    render(<OfflineStorageSection store={createOfflineStore(ports)} />)

    expect(await screen.findByText('Gig — Bar do Zé')).toBeDefined()
    expect(screen.getByText('Ensaio quarta')).toBeDefined()

    const stored = [...ports.records.rows.values()]
    const total = stored.reduce((sum, row) => sum + row.bytes, 0)
    // The sum of the rows, spelled the same way each row is.
    expect(screen.getByTestId('offline-total').textContent).toBe(`${Math.round(total / 1_000)} KB`)
  })

  it('removes one playlist and leaves the other record and its cached keys intact', async () => {
    const ports = await seeded()
    render(<OfflineStorageSection store={createOfflineStore(ports)} />)
    await screen.findByText('Gig — Bar do Zé')

    fireEvent.click(screen.getByRole('button', { name: /remove gig — bar do zé from this device/i }))

    await waitFor(() => expect(screen.queryByText('Gig — Bar do Zé')).toBeNull())
    expect(screen.getByText('Ensaio quarta')).toBeDefined()
    expect(ports.records.rows.has('pl-2')).toBe(true)
    expect(ports.records.rows.has('pl-1')).toBe(false)
    expect(ports.blobs.keysFor('pl-2')).toEqual(['/__offline-tab/pl-2/tab-b'])
    expect(ports.blobs.keysFor('pl-1')).toEqual([])
  })

  it('says so plainly when this device stores nothing', async () => {
    render(<OfflineStorageSection store={createOfflineStore(createFakePorts())} />)

    expect(await screen.findByText(/no playlist is stored on this device/i)).toBeDefined()
    expect(screen.getByTestId('offline-total').textContent).toBe('0 B')
  })

  it('omits the quota line when the browser offers no estimate', async () => {
    render(<OfflineStorageSection store={createOfflineStore(createFakePorts())} />)

    await screen.findByText(/no playlist is stored on this device/i)
    // jsdom implements no `navigator.storage`: no placeholder, no spinner.
    expect(screen.queryByTestId('offline-quota')).toBeNull()
  })
})
