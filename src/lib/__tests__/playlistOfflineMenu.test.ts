/**
 * RH-201 — the playlist page's offline actions live in the header's "More
 * actions" menu, and a compact icon after the title says the state. Both are
 * decided here, from the controller's state and the device's network state,
 * so the header stays presentational and under its complexity budget.
 */
import { describe, it, expect } from 'vitest'
import {
  playlistOfflineIndicator,
  playlistOfflineMenu,
  type PlaylistOfflineState,
} from '@/lib/playlistOfflineMenu'

const OFFLINE_HINT = 'Connect to the internet to download this playlist.'

function state(overrides: Partial<PlaylistOfflineState> = {}): PlaylistOfflineState {
  return {
    status: 'idle',
    progress: { done: 0, total: 0 },
    stored: 0,
    total: 12,
    bytes: 0,
    downloadedAgo: null,
    ...overrides,
  }
}

const downloaded = (overrides: Partial<PlaylistOfflineState> = {}) =>
  state({ status: 'downloaded', stored: 12, total: 12, bytes: 18_400_000, downloadedAgo: '2 days ago', ...overrides })

describe('playlistOfflineMenu', () => {
  it('offers an enabled "Make available offline" with no sub-line on an idle playlist', () => {
    expect(playlistOfflineMenu(state(), false)).toEqual([
      { kind: 'item', label: 'Make available offline', command: 'download', disabled: false },
    ])
  })

  it('says how many songs are already stored on an idle playlist that holds some', () => {
    expect(playlistOfflineMenu(state({ stored: 3 }), false)).toEqual([
      {
        kind: 'item',
        label: 'Make available offline',
        command: 'download',
        disabled: false,
        description: '3 of 12 songs are already on this device.',
      },
    ])
  })

  it('disables "Make available offline" offline and explains why', () => {
    expect(playlistOfflineMenu(state({ stored: 3 }), true)).toEqual([
      {
        kind: 'item',
        label: 'Make available offline',
        command: 'download',
        disabled: true,
        description: OFFLINE_HINT,
      },
    ])
  })

  it('lists no offline entry while downloading', () => {
    expect(playlistOfflineMenu(state({ status: 'downloading', progress: { done: 5, total: 12 } }), false)).toEqual([])
  })

  it('lists the summary, Refresh and Remove on a complete copy', () => {
    expect(playlistOfflineMenu(downloaded(), false)).toEqual([
      { kind: 'summary', text: 'Available offline · 12 of 12 songs · 18.4 MB · downloaded 2 days ago' },
      { kind: 'item', label: 'Refresh offline copy', command: 'refresh', disabled: false },
      { kind: 'item', label: 'Remove offline copy', command: 'remove', disabled: false, danger: true },
    ])
  })

  it('adds "Download N missing songs" before Refresh when some songs are missing', () => {
    const labels = playlistOfflineMenu(downloaded({ stored: 10 }), false).map((entry) =>
      entry.kind === 'item' ? entry.label : entry.text,
    )
    expect(labels).toEqual([
      'Available offline · 10 of 12 songs · 18.4 MB · downloaded 2 days ago',
      'Download 2 missing songs',
      'Refresh offline copy',
      'Remove offline copy',
    ])
  })

  it('singularises one missing song and points it at the download command', () => {
    expect(playlistOfflineMenu(downloaded({ stored: 11 }), false)[1]).toEqual({
      kind: 'item',
      label: 'Download 1 missing song',
      command: 'download',
      disabled: false,
    })
  })

  it('disables the two download items offline and keeps Remove enabled', () => {
    const items = playlistOfflineMenu(downloaded({ stored: 10 }), true).filter((entry) => entry.kind === 'item')
    expect(items.map((item) => [item.label, item.disabled])).toEqual([
      ['Download 2 missing songs', true],
      ['Refresh offline copy', true],
      ['Remove offline copy', false],
    ])
  })

  it('reads an unknown download date as "unknown"', () => {
    expect(playlistOfflineMenu(downloaded({ downloadedAgo: null }), false)[0]).toEqual({
      kind: 'summary',
      text: 'Available offline · 12 of 12 songs · 18.4 MB · downloaded unknown',
    })
  })
})

describe('playlistOfflineIndicator', () => {
  it('renders nothing on an idle playlist, even with stored songs', () => {
    expect(playlistOfflineIndicator(state())).toBeNull()
    expect(playlistOfflineIndicator(state({ stored: 3 }))).toBeNull()
  })

  it('names the progress while downloading', () => {
    expect(playlistOfflineIndicator(state({ status: 'downloading', progress: { done: 5, total: 12 } }))).toEqual({
      kind: 'downloading',
      label: 'Downloading 5 / 12 songs',
    })
  })

  it('names a downloaded playlist "Available offline", complete or partial, with the count as its tooltip', () => {
    expect(playlistOfflineIndicator(downloaded())).toEqual({
      kind: 'downloaded',
      label: 'Available offline',
      title: '12 of 12 songs on this device',
    })
    expect(playlistOfflineIndicator(downloaded({ stored: 10 }))).toEqual({
      kind: 'downloaded',
      label: 'Available offline',
      title: '10 of 12 songs on this device',
    })
  })
})
