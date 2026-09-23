/**
 * RH-79 — the offline snapshot is a contract, and this suite is where it is
 * pinned.
 *
 * `src/lib/offlineSnapshot.ts` is pure by construction: no `caches`, no
 * `indexedDB`, no `window.`, no `navigator.`, and `savedAt` arrives as an
 * argument rather than being read from the clock. So this file needs no mock,
 * no fake timer and no DOM, and runs in the default `node` environment.
 *
 * The three things RH-80 will depend on and therefore cannot be allowed to
 * drift are asserted here rather than described:
 *   - a snapshot written under another `schemaVersion` reads back as absent;
 *   - `offlineTabToRepertoireTab` produces a `RepertoireTab`, `created_at`
 *     included, so `mergeTabs` orders offline tabs exactly as it orders online
 *     ones;
 *   - the captured repertoire ids are readable from `songs[].repertoireId`,
 *     which is the "was this captured?" predicate an offline `getTabs` uses.
 */
import { describe, it, expect } from 'vitest'
import {
  OFFLINE_SCHEMA_VERSION,
  buildOfflineSnapshot,
  offlineTabCacheKey,
  offlineTabToRepertoireTab,
  readValidSnapshot,
  utf8ByteLength,
  type OfflineSnapshot,
  type OfflineTabSnapshot,
} from '@/lib/offlineSnapshot'
import { mergeTabs } from '@/lib/tabLibrary'
import type { Repertoire, RepertoireTab } from '@/types/database'

function repertoire(id: string): Repertoire {
  return {
    id,
    user_id: null,
    band_id: 'band-1',
    song_id: `song-of-${id}`,
    personal_key: 'Em',
    status: 'polishing',
    tags: ['setlist'],
    last_practiced: null,
    lyrics: '# Tempo Perdido',
    song: {
      id: `song-of-${id}`,
      title: 'Tempo Perdido',
      artist: 'Legião Urbana',
      album: 'Dois',
      standard_key: 'Em',
      cover_url: null,
      duration_seconds: 302,
      links: [],
      created_at: '2025-02-01T00:00:00Z',
    },
  }
}

function tabRow(id: string, createdAt: string): RepertoireTab {
  return {
    id,
    repertoire_id: 'rep-1',
    title: `Chart ${id}`,
    file_url: `https://store.public.blob.vercel-storage.com/tabs/${id}.pdf`,
    created_at: createdAt,
  }
}

function buildOne(): OfflineSnapshot {
  return buildOfflineSnapshot({
    playlistId: 'pl-1',
    playlistName: 'Gig — Bar do Zé',
    bandId: 'band-1',
    savedAt: '2026-09-20T18:04:00.000Z',
    songs: [
      {
        entry: { repertoireId: 'rep-1', songId: 'song-of-rep-1', title: 'Tempo Perdido', artist: 'Legião Urbana' },
        repertoire: repertoire('rep-1'),
        personalRepertoire: { ...repertoire('personal-1'), band_id: null, user_id: 'user-1', song_id: 'song-of-rep-1', lyrics: 'my cues' },
        tabs: [
          { tab: tabRow('tab-old', '2026-01-01T00:00:00Z'), bytes: 100 },
          { tab: tabRow('tab-new', '2026-06-01T00:00:00Z'), bytes: 200 },
        ],
      },
      {
        entry: { repertoireId: 'rep-2', songId: 'song-of-rep-2', title: 'Faroeste', artist: null },
        repertoire: repertoire('rep-2'),
        personalRepertoire: null,
        tabs: [],
      },
    ],
  })
}

describe('buildOfflineSnapshot', () => {
  // RH-83 ER10: the shape gained `personalRepertoire`, and a v1 snapshot cannot
  // tell "no personal version" from "not captured", so the number moved.
  it('is at schema version 2', () => {
    expect(OFFLINE_SCHEMA_VERSION).toBe(2)
  })

  it('captures the member own repertoire row per song, or null (ER10)', () => {
    const snapshot = buildOne()

    expect(snapshot.songs[0].personalRepertoire?.id).toBe('personal-1')
    expect(snapshot.songs[0].personalRepertoire?.lyrics).toBe('my cues')
    expect(snapshot.songs[1].personalRepertoire).toBeNull()
  })

  it('stamps the current schema version and the savedAt it was given', () => {
    const snapshot = buildOne()

    expect(snapshot.schemaVersion).toBe(OFFLINE_SCHEMA_VERSION)
    expect(snapshot.savedAt).toBe('2026-09-20T18:04:00.000Z')
    expect(snapshot.playlistId).toBe('pl-1')
    expect(snapshot.playlistName).toBe('Gig — Bar do Zé')
    expect(snapshot.bandId).toBe('band-1')
  })

  it('derives each song repertoireId from its entry and each tab cache key from the playlist', () => {
    const snapshot = buildOne()

    expect(snapshot.songs.map((song) => song.repertoireId)).toEqual(['rep-1', 'rep-2'])
    expect(snapshot.songs[0].tabs.map((tab) => tab.cacheKey)).toEqual([
      '/__offline-tab/pl-1/tab-old',
      '/__offline-tab/pl-1/tab-new',
    ])
  })

  it('carries a mandatory createdAt and the measured byte count on every tab', () => {
    const [tab] = buildOne().songs[0].tabs

    expect(tab.createdAt).toBe('2026-01-01T00:00:00Z')
    expect(tab.bytes).toBe(100)
    expect(tab.repertoireId).toBe('rep-1')
    expect(tab.fileUrl).toContain('blob.vercel-storage.com')
  })

  it('accepts a null bandId, which is what a personal playlist snapshot carries', () => {
    const snapshot = buildOfflineSnapshot({
      playlistId: 'pl-2',
      playlistName: 'Solo',
      bandId: null,
      savedAt: '2026-09-20T18:04:00.000Z',
      songs: [],
    })

    expect(snapshot.bandId).toBeNull()
    expect(snapshot.songs).toEqual([])
  })
})

describe('offlineTabCacheKey', () => {
  it('is stable and scoped by playlist, so one playlist removal is a prefix scan', () => {
    expect(offlineTabCacheKey('pl-1', 'tab-9')).toBe('/__offline-tab/pl-1/tab-9')
    expect(offlineTabCacheKey('pl-1', 'tab-9')).toBe(offlineTabCacheKey('pl-1', 'tab-9'))
    expect(offlineTabCacheKey('pl-2', 'tab-9').startsWith('/__offline-tab/pl-1/')).toBe(false)
  })
})

describe('readValidSnapshot', () => {
  it('round-trips a built snapshot through JSON', () => {
    const snapshot = buildOne()
    const parsed = readValidSnapshot(JSON.parse(JSON.stringify(snapshot)))

    expect(parsed).toEqual(snapshot)
  })

  it('reads a snapshot written under another schema version back as absent', () => {
    const future = { ...buildOne(), schemaVersion: OFFLINE_SCHEMA_VERSION + 1 }

    expect(readValidSnapshot(future)).toBeNull()
  })

  it('rejects a malformed value', () => {
    expect(readValidSnapshot(null)).toBeNull()
    expect(readValidSnapshot('snapshot')).toBeNull()
    expect(readValidSnapshot({})).toBeNull()
    expect(readValidSnapshot({ ...buildOne(), songs: 'nope' })).toBeNull()
    expect(readValidSnapshot({ ...buildOne(), playlistName: 7 })).toBeNull()
    expect(readValidSnapshot({ ...buildOne(), bandId: 7 })).toBeNull()
  })

  it('rejects a song whose entry or repertoire is missing', () => {
    const snapshot = buildOne()
    const songs = [{ ...snapshot.songs[0], repertoire: null }]

    expect(readValidSnapshot({ ...snapshot, songs })).toBeNull()
    expect(readValidSnapshot({ ...snapshot, songs: [{ ...snapshot.songs[0], entry: 3 }] })).toBeNull()
    expect(readValidSnapshot({ ...snapshot, songs: [{ ...snapshot.songs[0], repertoireId: 3 }] })).toBeNull()
    expect(readValidSnapshot({ ...snapshot, songs: [{ ...snapshot.songs[0], tabs: {} }] })).toBeNull()
    expect(readValidSnapshot({ ...snapshot, songs: ['nope'] })).toBeNull()
    expect(readValidSnapshot({ ...snapshot, songs: [{ ...snapshot.songs[0], tabs: ['nope'] }] })).toBeNull()
  })

  it('rejects a song whose personalRepertoire is neither a row nor null (ER10)', () => {
    const snapshot = buildOne()

    expect(readValidSnapshot({ ...snapshot, songs: [{ ...snapshot.songs[0], personalRepertoire: 7 }] })).toBeNull()
    // Absent is not null: a v1 song carried no such field and must not validate.
    const withoutField: Record<string, unknown> = { ...snapshot.songs[0] }
    delete withoutField.personalRepertoire
    expect(readValidSnapshot({ ...snapshot, songs: [withoutField] })).toBeNull()
  })

  it('rejects a tab that carries no createdAt — the field mergeTabs sorts on', () => {
    const snapshot = buildOne()
    const [first, ...rest] = snapshot.songs[0].tabs
    const withoutCreatedAt: Record<string, unknown> = { ...first }
    delete withoutCreatedAt.createdAt
    const songs = [{ ...snapshot.songs[0], tabs: [withoutCreatedAt, ...rest] }, snapshot.songs[1]]

    expect(readValidSnapshot({ ...snapshot, songs })).toBeNull()
  })

  it('rejects a tab whose bytes are not a number', () => {
    const snapshot = buildOne()
    const songs = [{ ...snapshot.songs[0], tabs: [{ ...snapshot.songs[0].tabs[0], bytes: '100' }] }]

    expect(readValidSnapshot({ ...snapshot, songs })).toBeNull()
  })
})

describe('offlineTabToRepertoireTab', () => {
  it('maps every field RepertoireTab requires, annotations excluded', () => {
    const snapshot = buildOne()
    const mapped: RepertoireTab = offlineTabToRepertoireTab(snapshot.songs[0].tabs[0])

    expect(mapped).toEqual({
      id: 'tab-old',
      repertoire_id: 'rep-1',
      title: 'Chart tab-old',
      file_url: 'https://store.public.blob.vercel-storage.com/tabs/tab-old.pdf',
      created_at: '2026-01-01T00:00:00Z',
    })
    expect('annotations' in mapped).toBe(false)
  })

  it('reproduces the online tab order: mergeTabs puts the newest created_at first', () => {
    const tabs: OfflineTabSnapshot[] = buildOne().songs[0].tabs
    const merged = mergeTabs(tabs.map(offlineTabToRepertoireTab), [], 'band')

    expect(merged.map((tab) => tab.id)).toEqual(['tab-new', 'tab-old'])
    expect(merged[0].origin).toBe('band')
  })
})

describe('utf8ByteLength', () => {
  it('counts the UTF-8 bytes of a string, not its UTF-16 code units', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('é')).toBe(2)
    expect(utf8ByteLength('€')).toBe(3)
    expect(utf8ByteLength('🎸')).toBe(4)
    expect(utf8ByteLength('')).toBe(0)
  })
})

describe('the captured repertoire ids are the "was this captured?" predicate', () => {
  it('distinguishes a tab-less captured song from a song that was never captured', () => {
    const captured = new Set(buildOne().songs.map((song) => song.repertoireId))

    expect(captured.has('rep-2')).toBe(true)
    expect(captured.has('personal-rep-9')).toBe(false)
  })
})
