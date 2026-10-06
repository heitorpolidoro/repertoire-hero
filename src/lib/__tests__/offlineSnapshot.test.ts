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
 *   - `offlineTabToSongFile` produces a `SongFile`, `created_at` included, so
 *     the offline file list orders exactly as the online one does;
 *   - the captured repertoire ids are readable from `songs[].repertoireId`,
 *     which is the "was this captured?" predicate the offline `getSongEntry`
 *     reader uses.
 *
 * RH-123 re-keyed the file entries by `songId` and took the version to 3; the
 * v2-rejection case below is what makes that bump observable. RH-124 takes it
 * to 4, because the captured `Repertoire` is now a **resolved** row off
 * `user_songs` / `band_songs` — no `personal_key`, a `version_id`, a `key` — and
 * the v3-rejection case is what makes *that* bump observable.
 */
import { describe, it, expect } from 'vitest'
import {
  OFFLINE_SCHEMA_VERSION,
  buildOfflineSnapshot,
  offlineTabCacheKey,
  offlineTabToSongFile,
  readValidSnapshot,
  utf8ByteLength,
  type OfflineSnapshot,
  type OfflineTabSnapshot,
} from '@/lib/offlineSnapshot'
import type { Repertoire, SongFile } from '@/types/database'

function repertoire(id: string): Repertoire {
  return {
    id,
    user_id: null,
    band_id: 'band-1',
    song_id: `song-of-${id}`,
    version_id: `version-of-${id}`,
    key: 'Em',
    tuning: null,
    map: null,
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

function tabRow(id: string, createdAt: string): SongFile {
  return {
    id,
    user_id: 'user-1',
    song_id: 'song-of-rep-1',
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
  // RH-83 ER10 took it to 2 (`personalRepertoire`); RH-123 ER9 to 3 (a file
  // entry keyed by `songId`); RH-124 ER17 to 4 (a resolved owner row, off
  // `user_songs` / `band_songs`, in place of a `repertoire` row).
  it('is at schema version 4, one above what RH-123 left', () => {
    expect(OFFLINE_SCHEMA_VERSION).toBe(4)
  })

  /**
   * ER17 — nothing captured is a `repertoire` row any more. There is no id to
   * compare against (the table is gone), so what the assertion can state is the
   * shape: the captured row carries the owner-row id the entry carries, a
   * `version_id`, and the **resolved** `key` — and no `personal_key`, the
   * column that only ever existed on the dropped table.
   */
  it('captures the owner row, resolved, and never a repertoire row (ER17)', () => {
    const [song] = buildOne().songs

    expect(song.repertoireId).toBe(song.repertoire.id)
    expect(song.repertoire.version_id).toBe('version-of-rep-1')
    expect(song.repertoire.key).toBe('Em')
    expect(song.repertoire.lyrics).toBe('# Tempo Perdido')
    expect('personal_key' in song.repertoire).toBe(false)
    expect(song.personalRepertoire && 'personal_key' in song.personalRepertoire).toBe(false)
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
    expect(tab.songId).toBe('song-of-rep-1')
    expect(tab.userId).toBe('user-1')
    expect(tab.fileUrl).toContain('blob.vercel-storage.com')
  })

  // ER9: a repertoire row id is exactly what a file entry must not carry — it
  // is the ownership the new model denies.
  it('carries no repertoire row id on any captured file entry', () => {
    for (const song of buildOne().songs) {
      for (const tab of song.tabs) {
        expect(tab).not.toHaveProperty('repertoireId')
        expect(tab).not.toHaveProperty('repertoire_id')
      }
    }
  })

  // RH-121: `OFFLINE_SCHEMA_VERSION` deliberately did NOT move when the catalog
  // lost its contributor column. The key was never a declared snapshot field
  // and `isSongSnapshot` does not inspect the embedded song object, so an
  // already-downloaded playlist stays valid — bumping the version would have
  // invalidated every user's download for a change no screen can see. What has
  // to hold instead is that the key is gone from what gets written, which is
  // decided one layer up by `SONG_JSON` in `src/lib/songs.ts`. Matched by
  // pattern rather than by name: the full identifier may not appear under
  // `src/` at all (ER5), and a test that spelled it would defeat that grep.
  it('serializes no contributor key anywhere in the payload', () => {
    const serialized = JSON.stringify(buildOne())

    expect(serialized).not.toMatch(/contributor/i)
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

  // ER9. A v2 snapshot's *song* is still found — `findSongBySongId` matches on
  // `repertoire.song_id`, which v2 already carries — and its whole tab array is
  // returned; what breaks is each mapped file arriving with
  // `song_id: undefined`. The list is not empty, it is wrong, which is why the
  // version moved rather than the reader being made tolerant.
  it('rejects a v2-shaped snapshot, whose file entries carry repertoireId', () => {
    const current = buildOne()
    const v2 = {
      ...current,
      schemaVersion: 2,
      songs: current.songs.map((song) => ({
        ...song,
        tabs: song.tabs.map((tab) => ({
          id: tab.id,
          repertoireId: song.repertoireId,
          title: tab.title,
          fileUrl: tab.fileUrl,
          createdAt: tab.createdAt,
          cacheKey: tab.cacheKey,
          bytes: tab.bytes,
        })),
      })),
    }

    expect(readValidSnapshot(v2)).toBeNull()
    // And not only because of the version number: the shape itself no longer
    // validates, so a hand-edited version field would not resurrect it.
    expect(readValidSnapshot({ ...v2, schemaVersion: OFFLINE_SCHEMA_VERSION })).toBeNull()
  })

  /**
   * ER17 — a snapshot written under the previous version is rejected. The shape
   * still validates (`isSongSnapshot` checks structure, not the row's columns),
   * which is exactly why the version number has to do the work: without the
   * bump a v3 record would be read back and Fast View would show an empty key
   * line offline against a filled one online.
   */
  it('rejects a snapshot written under the previous schema version (ER17)', () => {
    const current = buildOne()
    const v3 = { ...current, schemaVersion: OFFLINE_SCHEMA_VERSION - 1 }

    expect(readValidSnapshot(v3)).toBeNull()
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

  it('rejects a tab that carries no createdAt — the field the file list sorts on', () => {
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

describe('offlineTabToSongFile', () => {
  it('maps every field SongFile requires, annotations excluded (ER9)', () => {
    const snapshot = buildOne()
    const mapped: SongFile = offlineTabToSongFile(snapshot.songs[0].tabs[0])

    expect(mapped).toEqual({
      id: 'tab-old',
      user_id: 'user-1',
      song_id: 'song-of-rep-1',
      title: 'Chart tab-old',
      file_url: 'https://store.public.blob.vercel-storage.com/tabs/tab-old.pdf',
      created_at: '2026-01-01T00:00:00Z',
    })
    expect('annotations' in mapped).toBe(false)
    expect(mapped).not.toHaveProperty('repertoire_id')
  })

  it('carries created_at through, which is what the offline list sorts on', () => {
    const tabs: OfflineTabSnapshot[] = buildOne().songs[0].tabs
    const mapped = tabs.map(offlineTabToSongFile)

    expect(mapped.map((tab) => tab.created_at)).toEqual([
      '2026-01-01T00:00:00Z',
      '2026-06-01T00:00:00Z',
    ])
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
