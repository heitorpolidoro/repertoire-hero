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
import { songRecordId } from '@/lib/offlineSongRecord'
import { createOfflineStore } from '@/lib/offlineStore'
import {
  createFakePorts,
  seedSetlist,
  seedSongInput,
  type FakeOfflinePorts,
} from '@/lib/__tests__/offlineStoreFakes'

afterEach(cleanup)

async function seeded(): Promise<FakeOfflinePorts> {
  const ports = createFakePorts()
  const store = createOfflineStore(ports)
  await seedSetlist(store, 'pl-1', 'Gig — Bar do Zé', 'tab-a')
  await seedSetlist(store, 'pl-2', 'Ensaio quarta', 'tab-b')
  return ports
}

describe('OfflineStorageSection, song records (ER8)', () => {
  it('lists a stored song by title with a Song label, and removes it alone', async () => {
    const ports = await seeded()
    const songId = songRecordId('version-1', null)
    await createOfflineStore(ports).saveOfflineSong({
      song: seedSongInput('version-1', 'tab-s', 'Tempo Perdido'),
      bandId: null,
      savedAt: new Date().toISOString(),
      individualDownload: true,
    })
    render(<OfflineStorageSection store={createOfflineStore(ports)} />)

    expect(await screen.findByText('Tempo Perdido')).toBeDefined()
    expect(screen.getAllByText('Song')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /remove tempo perdido from this device/i }))

    await waitFor(() => expect(screen.queryByText('Tempo Perdido')).toBeNull())
    expect(ports.records.rows.has(songId)).toBe(false)
    expect(ports.blobs.keysFor(songId)).toEqual([])
    expect(ports.records.rows.has('pl-1')).toBe(true)
  })
})

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
    expect(ports.blobs.keysFor(songRecordId('v-pl-2', null))).toEqual([
      `/__offline-tab/${songRecordId('v-pl-2', null)}/tab-b`,
    ])
    expect(ports.blobs.keysFor(songRecordId('v-pl-1', null))).toEqual([])
  })

  it('says so plainly when this device stores nothing', async () => {
    render(<OfflineStorageSection store={createOfflineStore(createFakePorts())} />)

    expect(await screen.findByText(/nothing is stored on this device/i)).toBeDefined()
    expect(screen.getByTestId('offline-total').textContent).toBe('0 B')
  })

  it('omits the quota line when the browser offers no estimate', async () => {
    render(<OfflineStorageSection store={createOfflineStore(createFakePorts())} />)

    await screen.findByText(/nothing is stored on this device/i)
    // jsdom implements no `navigator.storage`: no placeholder, no spinner.
    expect(screen.queryByTestId('offline-quota')).toBeNull()
  })
})
