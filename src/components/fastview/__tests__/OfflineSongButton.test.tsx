// @vitest-environment jsdom
/**
 * RH-116 — the single-song "Available offline" control, over the real store
 * and fake ports.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OfflineSongButton } from '../OfflineSongButton'
import { createOfflineStore } from '@/lib/offlineStore'
import type { OfflineCaptureActions } from '@/lib/offlineCapture'
import { songRecordId } from '@/lib/offlineSongRecord'
import { createFakePorts, type FakeOfflinePorts } from '@/lib/__tests__/offlineStoreFakes'

afterEach(cleanup)

function makeActions(): OfflineCaptureActions {
  return {
    getResolvedEntryForVersion: vi.fn(() =>
      Promise.resolve({
        ownerRowId: null,
        song_id: 'song-7',
        version_id: 'v-7',
        key: null,
        tuning: null,
        map: null,
        status: null,
        tags: [],
        last_practiced: null,
        lyrics: null,
      }),
    ),
    getTabs: vi.fn(() => Promise.resolve([])),
    getPersonalEntryForSong: vi.fn(() => Promise.resolve(null)),
    getCustomFieldValues: vi.fn(() => Promise.resolve([])),
  }
}

function renderControl(
  ports: FakeOfflinePorts = createFakePorts(),
  offline?: boolean,
  actions: OfflineCaptureActions = makeActions(),
) {
  const store = createOfflineStore(ports)
  const view = (isOffline?: boolean) => (
    <OfflineSongButton versionId="v-7" bandId={null} actions={actions} store={store} offline={isOffline} />
  )
  const utils = render(view(offline))
  return { ports, rerenderWith: (isOffline: boolean) => utils.rerender(view(isOffline)) }
}

describe('OfflineSongButton', () => {
  it('downloads one song and shows the downloaded state with both affordances', async () => {
    const { ports } = renderControl()

    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))

    await screen.findByRole('button', { name: /remove offline copy/i })
    expect(screen.getByRole('button', { name: /refresh offline copy/i })).toBeDefined()
    expect(screen.getByText(/downloaded today/i)).toBeDefined()
    expect(ports.records.rows.has(songRecordId('v-7', null))).toBe(true)
  })

  it('shows the downloaded state on mount from a stored record', async () => {
    const ports = createFakePorts()
    const first = renderControl(ports)
    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))
    await screen.findByRole('button', { name: /remove offline copy/i })
    cleanup()

    renderControl(first.ports)

    expect(await screen.findByRole('button', { name: /remove offline copy/i })).toBeDefined()
  })

  it('shows the busy state with a 1 / 1 counter while downloading', async () => {
    const actions = makeActions()
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    actions.getTabs = vi.fn(async () => {
      await held
      return []
    })
    renderControl(createFakePorts(), false, actions)

    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))

    const busy = await screen.findByRole('button', { name: /downloading/i })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText(/0 \/ 1 songs/)).toBeDefined()
    release()
    await screen.findByRole('button', { name: /remove offline copy/i })
  })

  it('removes the copy and returns to the idle control', async () => {
    const { ports } = renderControl()
    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))
    fireEvent.click(await screen.findByRole('button', { name: /remove offline copy/i }))

    await waitFor(() => expect(ports.records.rows.size).toBe(0))
    expect(await screen.findByRole('button', { name: /available offline/i })).toBeDefined()
  })

  it('shows a failure as an inline alert, dismissible, and keeps the idle control', async () => {
    const ports = createFakePorts()
    const actions = makeActions()
    actions.getResolvedEntryForVersion = vi.fn(() => Promise.resolve(null))
    renderControl(ports, false, actions)

    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/could not be read/i)
    expect(ports.records.rows.size).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: /dismiss offline download error/i }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('OfflineSongButton, offline (ER7)', () => {
  it('disables the idle control and explains why', async () => {
    const actions = makeActions()
    renderControl(createFakePorts(), true, actions)

    const control = await screen.findByRole('button', { name: /available offline/i })
    expect(control.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/connect to download/i)).toBeDefined()
    fireEvent.click(control)
    expect(actions.getResolvedEntryForVersion).not.toHaveBeenCalled()
  })

  it('disables refresh and keeps remove enabled once the device goes offline', async () => {
    const { rerenderWith } = renderControl(createFakePorts(), false)
    fireEvent.click(await screen.findByRole('button', { name: /available offline/i }))
    await screen.findByRole('button', { name: /remove offline copy/i })

    rerenderWith(true)

    expect(screen.getByRole('button', { name: /refresh offline copy/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /remove offline copy/i }).hasAttribute('disabled')).toBe(false)
  })
})
