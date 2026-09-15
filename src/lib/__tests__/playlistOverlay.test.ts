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

function song(songId: string, position: number): PlaylistSong {
  return { id: `ps-${songId}`, playlist_id: 'pl-1', song_id: songId, position }
}

function entry(songId: string, overrides: Partial<Repertoire> = {}): Repertoire {
  return {
    id: `rep-${songId}`,
    user_id: 'u1',
    band_id: null,
    song_id: songId,
    personal_key: null,
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
      overlayOf({ type: 'remove-song', songId: 's2' }),
    )

    expect(view.songs.map((ps) => ps.song_id)).toEqual(['s1'])
  })

  it('restores a song that was removed and then put back', () => {
    const view = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf(
        { type: 'remove-song', songId: 's2' },
        { type: 'restore-song', songId: 's2' },
      ),
    )

    expect(view.songs.map((ps) => ps.song_id)).toEqual(['s1', 's2'])

    // A removal that succeeded is not permanent either: the same page session
    // can put the song back through the add-song picker, which reports the list
    // it reloaded, and the entry that hid the row has to go with it — otherwise
    // the add lands in the database and stays invisible until a full load, and
    // the second attempt is a silent no-op (`ON CONFLICT DO NOTHING`).
    const readded = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf(
        { type: 'remove-song', songId: 's2' },
        { type: 'songs-reported', songs: [song('s1', 1), song('s2', 2)] },
      ),
    )

    expect(readded.songs.map((ps) => ps.song_id)).toEqual(['s1', 's2'])

    // A Spotify pull rewrites the server list wholesale and reports no list of
    // its own, so it drops the whole removed set rather than part of it: a song
    // it re-imports must be visible for the same reason.
    const pulled = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf({ type: 'remove-song', songId: 's2' }, { type: 'songs-pulled' }),
    )

    expect(pulled.songs.map((ps) => ps.song_id)).toEqual(['s1', 's2'])

    // A report that does not carry the removed song leaves it hidden: that is
    // the optimistic window of a removal whose write has not landed yet.
    const stillRemoved = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf(
        { type: 'remove-song', songId: 's2' },
        { type: 'songs-reported', songs: [song('s1', 1), song('s3', 3)] },
      ),
    )

    expect(stillRemoved.songs.map((ps) => ps.song_id)).toEqual(['s1', 's3'])
  })

  it('appends a song the picker reported and the server does not carry yet', () => {
    const reported = [song('s1', 1), song('s2', 2), song('s3', 3)]
    const view = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf({ type: 'songs-reported', songs: reported }),
    )

    expect(view.songs.map((ps) => ps.song_id)).toEqual(['s1', 's2', 's3'])
  })

  it('appends no duplicate for a song the server already carries', () => {
    const view = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      // The picker reports the whole list it reloaded, matched by `song_id`.
      overlayOf({ type: 'songs-reported', songs: [song('s1', 1), song('s2', 2)] }),
    )

    expect(view.songs.map((ps) => ps.song_id)).toEqual(['s1', 's2'])
  })

  it('keeps the server order of the songs it does not touch', () => {
    const server = playlist({ songs: [song('s2', 1), song('s1', 2)] })
    const view = applyDetailOverlay(
      server,
      REPERTOIRE,
      overlayOf({ type: 'songs-reported', songs: [song('s3', 9), song('s1', 2)] }),
    )

    expect(view.songs.map((ps) => ps.song_id)).toEqual(['s2', 's1', 's3'])
  })

  it('overrides a repertoire entry by song id and leaves the rest of the map alone', () => {
    const edited = entry('s1', { status: 'learning', tags: ['solo'] })
    const view = applyDetailOverlay(
      playlist(),
      REPERTOIRE,
      overlayOf({ type: 'repertoire-entry', songId: 's1', entry: edited }),
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
      { type: 'remove-song', songId: 's2' },
      { type: 'songs-reported', songs: [song('s1', 1), song('s3', 3)] },
      { type: 'repertoire-entry', songId: 's1', entry: mastered },
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
