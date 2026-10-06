/**
 * RH-71 — the optimistic overlay of `/playlists/[id]`.
 *
 * The route is a Server Component now, so the island's props are the source of
 * truth and every local edit is re-applied over them at render time. Three
 * properties make that safe, and all three are asserted here: the selector
 * never mutates what the server sent, an overlay entry the next server render
 * already reflects is a no-op, and the one entry that is not inert on its own —
 * a removal, which hides a row the props may carry again — is released as soon
 * as the song is back in a list this tab was told about.
 *
 * No React, no fetch, no database: the whole module is a reducer and a pure
 * selector, so this file needs no `// @vitest-environment` line and no mock.
 */

import { describe, it, expect } from 'vitest'
import {
  EMPTY_PLAYLIST_OVERLAY,
  applyDetailOverlay,
  playlistOverlayReducer,
  type PlaylistDetailOverlay,
  type PlaylistOverlayAction,
} from '@/lib/playlistOverlay'
import type { Playlist, PlaylistSong, Repertoire } from '@/types/database'

/**
 * One playlist entry, keyed by the **version** it names (RH-125). `song_id` is
 * derived rather than equal, so a list keyed by the song id cannot pass for one
 * keyed by the version.
 */
function song(versionId: string, position: number): PlaylistSong {
  return { id: `ps-${versionId}`, playlist_id: 'pl-1', version_id: versionId, position }
}

function entry(versionId: string, overrides: Partial<Repertoire> = {}): Repertoire {
  return {
    id: `rep-${versionId}`,
    user_id: 'u1',
    band_id: null,
    song_id: `song-of-${versionId}`,
    version_id: versionId,
    key: null,
    tuning: null,
    map: null,
    status: 'unknown',
    tags: [],
    last_practiced: null,
    lyrics: null,
    ...overrides,
  }
}

function playlist(overrides: Partial<Playlist> = {}): Playlist {
  return {
    id: 'pl-1',
    user_id: 'u1',
    band_id: null,
    name: 'Setlist',
    description: null,
    cover_url: null,
    spotify_playlist_id: null,
    sync_with_spotify: false,
    last_synced_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    tags: ['rock'],
    songs: [song('s1', 1), song('s2', 2)],
    ...overrides,
  }
}

const REPERTOIRE = [entry('s1'), entry('s2', { status: 'mastered' })]

/** Folds a list of actions onto the empty overlay, the way the hook does. */
function overlayOf(...actions: PlaylistOverlayAction[]): PlaylistDetailOverlay {
  return actions.reduce(playlistOverlayReducer, EMPTY_PLAYLIST_OVERLAY)
}

describe('playlistOverlay (RH-71)', () => {
  it('starts from an empty overlay that changes nothing', () => {
    const server = playlist()
    const view = applyDetailOverlay(server, REPERTOIRE, EMPTY_PLAYLIST_OVERLAY)

    expect(view.playlist).toEqual(server)
    expect(view.songs).toEqual(server.songs)
    expect([...view.repertoireMap.keys()]).toEqual(['s1', 's2'])
  })

  it('applies a renamed playlist over the server row', () => {
    const server = playlist()
    const view = applyDetailOverlay(
      server,
      REPERTOIRE,
      overlayOf({ type: 'rename', name: 'Gig night' }),
    )

    expect(view.playlist.name).toBe('Gig night')
    // The props themselves are never written through.
    expect(server.name).toBe('Setlist')
  })

  it('applies replacement playlist tags over the server row', () => {
    const server = playlist()
    const view = applyDetailOverlay(
      server,
      REPERTOIRE,
      overlayOf({ type: 'playlist-tags', tags: ['rock', 'live'] }),
    )

    expect(view.playlist.tags).toEqual(['rock', 'live'])
    expect(server.tags).toEqual(['rock'])
  })

  it('hides a removed song and leaves the others in place', () => {
    const view = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf({ type: 'remove-song', versionId: 's2' }),
    )

    expect(view.songs.map((ps) => ps.version_id)).toEqual(['s1'])
  })

  it('restores a song that was removed and then put back', () => {
    const view = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf(
        { type: 'remove-song', versionId: 's2' },
        { type: 'restore-song', versionId: 's2' },
      ),
    )

    expect(view.songs.map((ps) => ps.version_id)).toEqual(['s1', 's2'])

    // A removal that succeeded is not permanent either: the same page session
    // can put the song back through the add-song picker, which reports the list
    // it reloaded, and the entry that hid the row has to go with it — otherwise
    // the add lands in the database and stays invisible until a full load, and
    // the second attempt raises on `uq_playlist_song_version` (RH-125 §2).
    const readded = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf(
        { type: 'remove-song', versionId: 's2' },
        { type: 'songs-reported', songs: [song('s1', 1), song('s2', 2)] },
      ),
    )

    expect(readded.songs.map((ps) => ps.version_id)).toEqual(['s1', 's2'])

    // A Spotify pull rewrites the server list wholesale and reports no list of
    // its own, so it drops the whole removed set rather than part of it: a song
    // it re-imports must be visible for the same reason.
    const pulled = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf({ type: 'remove-song', versionId: 's2' }, { type: 'songs-pulled' }),
    )

    expect(pulled.songs.map((ps) => ps.version_id)).toEqual(['s1', 's2'])

    // A report that does not carry the removed song leaves it hidden: that is
    // the optimistic window of a removal whose write has not landed yet.
    const stillRemoved = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf(
        { type: 'remove-song', versionId: 's2' },
        { type: 'songs-reported', songs: [song('s1', 1), song('s3', 3)] },
      ),
    )

    expect(stillRemoved.songs.map((ps) => ps.version_id)).toEqual(['s1', 's3'])
  })

  it('appends a song the picker reported and the server does not carry yet', () => {
    const reported = [song('s1', 1), song('s2', 2), song('s3', 3)]
    const view = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf({ type: 'songs-reported', songs: reported }),
    )

    expect(view.songs.map((ps) => ps.version_id)).toEqual(['s1', 's2', 's3'])
  })

  it('appends no duplicate for a song the server already carries', () => {
    const view = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      // The picker reports the whole list it reloaded, matched by `version_id`.
      overlayOf({ type: 'songs-reported', songs: [song('s1', 1), song('s2', 2)] }),
    )

    expect(view.songs.map((ps) => ps.version_id)).toEqual(['s1', 's2'])
  })

  it('keeps the server order of the songs it does not touch', () => {
    const server = playlist({ songs: [song('s2', 1), song('s1', 2)] })
    const view = applyDetailOverlay(
      server,
      REPERTOIRE,
      overlayOf({ type: 'songs-reported', songs: [song('s3', 9), song('s1', 2)] }),
    )

    expect(view.songs.map((ps) => ps.version_id)).toEqual(['s2', 's1', 's3'])
  })

  it('overrides a repertoire entry by version id and leaves the rest of the map alone', () => {
    const edited = entry('s1', { status: 'learning', tags: ['solo'] })
    const view = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf({ type: 'repertoire-entry', versionId: 's1', entry: edited }),
    )

    expect(view.repertoireMap.get('s1')).toEqual(edited)
    expect(view.repertoireMap.get('s2')).toEqual(REPERTOIRE[1])
    expect(REPERTOIRE[0].status).toBe('unknown')
  })

  it('builds the repertoire map from the server rows when no entry is overridden', () => {
    const view = applyDetailOverlay(playlist(), REPERTOIRE, EMPTY_PLAYLIST_OVERLAY)

    expect(view.repertoireMap.size).toBe(2)
    expect(view.repertoireMap.get('s2')?.status).toBe('mastered')
  })

  it('is idempotent once the server render already carries the same edits', () => {
    const mastered = entry('s1', { status: 'mastered' })
    const settled = playlist({
      name: 'Gig night',
      tags: ['live'],
      songs: [song('s1', 1), song('s3', 3)],
    })
    const overlay = overlayOf(
      { type: 'rename', name: 'Gig night' },
      { type: 'playlist-tags', tags: ['live'] },
      { type: 'remove-song', versionId: 's2' },
      { type: 'songs-reported', songs: [song('s1', 1), song('s3', 3)] },
      { type: 'repertoire-entry', versionId: 's1', entry: mastered },
    )

    expect(applyDetailOverlay(settled, [mastered], overlay)).toEqual(
      applyDetailOverlay(settled, [mastered], EMPTY_PLAYLIST_OVERLAY),
    )
  })

  it('returns the same overlay object for an action it does not handle', () => {
    const unknown = { type: 'not-an-action' } as unknown as PlaylistOverlayAction

    expect(playlistOverlayReducer(EMPTY_PLAYLIST_OVERLAY, unknown)).toBe(
      EMPTY_PLAYLIST_OVERLAY,
    )
  })
})

describe('playlistOverlay song positions (RH-103)', () => {
  /** The server order, sorted the way `PlaylistSongList` sorts it. */
  const order = (songs: PlaylistSong[]) =>
    [...songs].sort((a, b) => a.position - b.position).map((ps) => ps.id)

  const SERVER = playlist({ songs: [song('s1', 1), song('s2', 2), song('s3', 3)] })

  it('lays the recorded positions over the server rows, giving the moved order', () => {
    const view = applyDetailOverlay(
      SERVER,
      REPERTOIRE,
      overlayOf({
        type: 'song-positions',
        positions: { 'ps-s3': 1, 'ps-s1': 2, 'ps-s2': 3 },
      }),
    )

    expect(order(view.songs)).toEqual(['ps-s3', 'ps-s1', 'ps-s2'])
    // The props themselves are never written through.
    expect(order(SERVER.songs!)).toEqual(['ps-s1', 'ps-s2', 'ps-s3'])
  })

  it('gives the server order back after the revert entry a failed write records', () => {
    const moved = { 'ps-s3': 1, 'ps-s1': 2, 'ps-s2': 3 }
    const captured = { 'ps-s1': 1, 'ps-s2': 2, 'ps-s3': 3 }

    const view = applyDetailOverlay(
      SERVER,
      REPERTOIRE,
      overlayOf(
        { type: 'song-positions', positions: moved },
        { type: 'song-positions', positions: captured },
      ),
    )

    expect(order(view.songs)).toEqual(['ps-s1', 'ps-s2', 'ps-s3'])
    expect(view.songs).toEqual(SERVER.songs)
  })

  it('is inert once the refresh lands, because the server rows already carry those positions', () => {
    const settled = playlist({ songs: [song('s3', 1), song('s1', 2), song('s2', 3)] })
    const overlay = overlayOf({
      type: 'song-positions',
      positions: { 'ps-s3': 1, 'ps-s1': 2, 'ps-s2': 3 },
    })

    expect(applyDetailOverlay(settled, REPERTOIRE, overlay)).toEqual(
      applyDetailOverlay(settled, REPERTOIRE, EMPTY_PLAYLIST_OVERLAY),
    )
  })

  it('leaves a row the overlay says nothing about at its server position', () => {
    const view = applyDetailOverlay(
      SERVER,
      REPERTOIRE,
      overlayOf({ type: 'song-positions', positions: { 'ps-s3': 0 } }),
    )

    expect(order(view.songs)).toEqual(['ps-s3', 'ps-s1', 'ps-s2'])
    expect(view.songs.find((ps) => ps.id === 'ps-s2')?.position).toBe(2)
  })
})

/**
 * RH-125 ER11 — the overlay is keyed by version id, and the field is named for
 * it.
 *
 * `removedSongIds` became `removedVersionIds`: two lists keyed by different ids
 * under the same name is the bug the re-key exists to prevent, so the rename is
 * part of the change rather than a tidy-up, and it is asserted rather than
 * described.
 */
describe('playlistOverlay keyed by version id (RH-125 ER11)', () => {
  it('names the removed set removedVersionIds and records version ids in it', () => {
    const overlay = overlayOf({ type: 'remove-song', versionId: 's2' })

    expect(overlay.removedVersionIds).toEqual(['s2'])
    expect(Object.keys(EMPTY_PLAYLIST_OVERLAY)).toContain('removedVersionIds')
    expect(Object.keys(EMPTY_PLAYLIST_OVERLAY)).not.toContain('removedSongIds')
  })

  it('builds the repertoire map from version_id, so a song-keyed lookup misses', () => {
    const view = applyDetailOverlay(playlist(), REPERTOIRE, EMPTY_PLAYLIST_OVERLAY)

    expect([...view.repertoireMap.keys()]).toEqual(['s1', 's2'])
    // The same rows' song ids are *not* keys: `song-of-s1` is what `entry()`
    // derives, and nothing in the map answers to it.
    expect(view.repertoireMap.get('song-of-s1')).toBeUndefined()
  })

  it('hides exactly the entry whose version was removed, not its sibling take', () => {
    // Two versions of one song, as RH-125 allows in one playlist. Removing one
    // must not hide the other — which a song-keyed removal would.
    const server = playlist({ songs: [song('studio', 1), song('live', 2)] })
    const view = applyDetailOverlay(
      server,
      REPERTOIRE,
      overlayOf({ type: 'remove-song', versionId: 'studio' }),
    )

    expect(view.songs.map((ps) => ps.version_id)).toEqual(['live'])
  })
})
