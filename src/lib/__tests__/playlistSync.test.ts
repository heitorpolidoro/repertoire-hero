/**
 * RH-70 — the client half of the Spotify playlist sync.
 *
 * These are the decisions `/playlists/[id]` used to make inline: which endpoint
 * to post to, what the body looks like, whether a local edit is worth pushing at
 * all, what to say when the response comes back not-ok, and how to label
 * `last_synced_at`.
 *
 * The module is deliberately request-shaped and issues nothing itself, so it is
 * safe for a `"use client"` file to import — the server half of the same feature
 * lives in `src/lib/spotifyPlaylistSync.ts`, which reaches Postgres.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  formatSyncedAgo,
  shouldAutoPush,
  syncEndpoint,
  syncErrorMessage,
  syncRequestInit,
} from '@/lib/playlistSync'
import type { Playlist } from '@/types/database'

afterEach(() => {
  vi.useRealTimers()
})

/** A playlist row as far as the sync gate is concerned. */
type SyncablePlaylist = Pick<Playlist, 'sync_with_spotify' | 'spotify_playlist_id'>

function playlist(overrides: Partial<SyncablePlaylist> = {}): SyncablePlaylist {
  return {
    sync_with_spotify: true,
    spotify_playlist_id: 'spotify-playlist-1',
    ...overrides,
  }
}

/** An ISO timestamp `minutes` minutes before the frozen clock. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

describe('syncEndpoint / syncRequestInit', () => {
  it('builds the sync endpoint for a playlist id', () => {
    expect(syncEndpoint('playlist-1')).toBe('/api/spotify/playlists/playlist-1/sync')
  })

  it('builds a POST request init carrying the direction as JSON', () => {
    const pull = syncRequestInit('pull')
    const push = syncRequestInit('push')

    expect(pull.method).toBe('POST')
    expect(pull.body).toBe(JSON.stringify({ direction: 'pull' }))
    expect(push.body).toBe(JSON.stringify({ direction: 'push' }))
  })

  it('sends the same headers for a pull and for a push', () => {
    expect(syncRequestInit('pull').headers).toEqual({ 'Content-Type': 'application/json' })
    expect(syncRequestInit('push').headers).toEqual(syncRequestInit('pull').headers)
  })
})

describe('shouldAutoPush', () => {
  it('pushes when the playlist auto-syncs and carries a Spotify id', () => {
    expect(shouldAutoPush(playlist())).toBe(true)
  })

  it('does not push when auto-sync is off', () => {
    expect(shouldAutoPush(playlist({ sync_with_spotify: false }))).toBe(false)
  })

  it('does not push when the playlist carries no Spotify id', () => {
    expect(shouldAutoPush(playlist({ spotify_playlist_id: null }))).toBe(false)
  })

  it('does not push when there is no playlist yet', () => {
    expect(shouldAutoPush(null)).toBe(false)
  })
})

describe('syncErrorMessage', () => {
  it('reads the error message out of a failed sync response body', () => {
    expect(syncErrorMessage({ error: 'Spotify token expired' }, 'Sync failed')).toBe(
      'Spotify token expired',
    )
  })

  it('falls back when the body carries no error string', () => {
    expect(syncErrorMessage({ error: '' }, 'Sync failed')).toBe('Sync failed')
    expect(syncErrorMessage({ error: 500 }, 'Sync failed')).toBe('Sync failed')
    expect(syncErrorMessage({ code: 500 }, 'Auto-sync to Spotify failed')).toBe(
      'Auto-sync to Spotify failed',
    )
  })

  it('falls back when the body is empty, null or not an object', () => {
    expect(syncErrorMessage({}, 'Sync failed')).toBe('Sync failed')
    expect(syncErrorMessage(null, 'Sync failed')).toBe('Sync failed')
    expect(syncErrorMessage(undefined, 'Sync failed')).toBe('Sync failed')
    expect(syncErrorMessage('boom', 'Sync failed')).toBe('Sync failed')
  })
})

describe('formatSyncedAgo', () => {
  it('formats a sync under a minute old as just now', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'))

    expect(formatSyncedAgo(minutesAgo(0))).toBe('just now')
    expect(formatSyncedAgo(new Date(Date.now() - 59_000).toISOString())).toBe('just now')
  })

  it('formats a sync in minutes, in hours and in days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'))

    expect(formatSyncedAgo(minutesAgo(1))).toBe('1m ago')
    expect(formatSyncedAgo(minutesAgo(59))).toBe('59m ago')
    expect(formatSyncedAgo(minutesAgo(60))).toBe('1h ago')
    expect(formatSyncedAgo(minutesAgo(60 * 23))).toBe('23h ago')
    expect(formatSyncedAgo(minutesAgo(60 * 24))).toBe('1d ago')
    expect(formatSyncedAgo(minutesAgo(60 * 24 * 9))).toBe('9d ago')
  })
})
