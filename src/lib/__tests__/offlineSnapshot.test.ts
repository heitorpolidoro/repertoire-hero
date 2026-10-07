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
 *   - the captured version ids are readable from `songs[].versionId`, which is
 *     the "was this captured?" predicate the offline entry reader uses.
 *
 * RH-123 re-keyed the file entries by `songId` and took the version to 3; the
 * v2-rejection case below is what makes that bump observable. RH-124 takes it
 * to 4, because the captured `Repertoire` is now a **resolved** row off
 * `user_songs` / `band_songs` — no `personal_key`, a `version_id`, a `key` — and
 * the v3-rejection case is what makes *that* bump observable.
 *
 * RH-132 takes it to 6 and is the first bump that **upgrades** instead of
 * discarding: a song is keyed by `versionId` and carries a `ResolvedSongEntry`,
 * both of which a v5 record can be reshaped into losslessly. The upgrade cases
 * at the end of this file are what make that observable.
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
import { upgradeSnapshotV5ToV6, type OfflineSnapshotV5 } from '@/lib/offlineSnapshotV5'
import type { Repertoire, ResolvedSongEntry, SongFile } from '@/types/database'

function song(id: string) {
  return {
    id: `song-of-${id}`,
    title: 'Tempo Perdido',
    artist: 'Legião Urbana',
    album: 'Dois',
    standard_key: 'Em',
    cover_url: null,
    duration_seconds: 302,
    links: [],
    created_at: '2025-02-01T00:00:00Z',
  }
}

/** The captured `(owner, version)` pair — a `ResolvedSongEntry` since RH-132. */
function repertoire(id: string): ResolvedSongEntry {
  return {
    ownerRowId: id,
    song_id: `song-of-${id}`,
    version_id: `version-of-${id}`,
    key: 'Em',
    tuning: null,
    map: null,
    status: 'polishing',
    tags: ['setlist'],
    last_practiced: null,
    lyrics: '# Tempo Perdido',
    song: song(id),
  }
}

/** The member's own row, still a `Repertoire` (RH-132 ER14). */
function personalRow(id: string): Repertoire {
  return {
    id,
    user_id: 'user-1',
    band_id: null,
    song_id: 'song-of-rep-1',
    version_id: `version-of-${id}`,
    key: 'Em',
    tuning: null,
    map: null,
    status: 'polishing',
    tags: ['setlist'],
    last_practiced: null,
    lyrics: 'my cues',
    song: song(id),
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
        entry: { repertoireId: 'rep-1', versionId: 'version-of-rep-1', songId: 'song-of-rep-1', title: 'Tempo Perdido', artist: 'Legião Urbana' },
        repertoire: repertoire('rep-1'),
        personalRepertoire: personalRow('personal-1'),
        tabs: [
          { tab: tabRow('tab-old', '2026-01-01T00:00:00Z'), bytes: 100 },
          { tab: tabRow('tab-new', '2026-06-01T00:00:00Z'), bytes: 200 },
        ],
      },
      {
        entry: { repertoireId: 'rep-2', versionId: 'version-of-rep-2', songId: 'song-of-rep-2', title: 'Faroeste', artist: null },
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
  // `user_songs` / `band_songs`, in place of a `repertoire` row); RH-125 ER17
  // to 5, because the stored `entry` gained a required `versionId` and its
  // `repertoireId` became nullable.
  it('is at schema version 6, one above what RH-125 left', () => {
    expect(OFFLINE_SCHEMA_VERSION).toBe(6)
  })

  /**
   * ER17 — nothing captured is a `repertoire` row any more. There is no id to
   * compare against (the table is gone), so what the assertion can state is the
   * shape: the captured row carries the owner-row id the entry carries, a
   * `version_id`, and the **resolved** `key` — and no `personal_key`, the
   * column that only ever existed on the dropped table.
   */
  it('captures the resolved pair, keyed by the version (ER17, RH-132)', () => {
    const [first] = buildOne().songs

    expect(first.versionId).toBe(first.entry.versionId)
    expect(first.versionId).toBe('version-of-rep-1')
    expect(first.repertoire.ownerRowId).toBe('rep-1')
    expect(first.repertoire.version_id).toBe('version-of-rep-1')
    expect(first.repertoire.key).toBe('Em')
    expect(first.repertoire.lyrics).toBe('# Tempo Perdido')
    expect('personal_key' in first.repertoire).toBe(false)
    expect(first.personalRepertoire && 'personal_key' in first.personalRepertoire).toBe(false)
    // The owner-row key is gone from the song level: it is not an address.
    expect(first).not.toHaveProperty('repertoireId')
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

  it('derives each song versionId from its entry and each tab cache key from the playlist', () => {
    const snapshot = buildOne()

    expect(snapshot.songs.map((row) => row.versionId)).toEqual([
      'version-of-rep-1',
      'version-of-rep-2',
    ])
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
    for (const captured of buildOne().songs) {
      for (const tab of captured.tabs) {
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
      songs: current.songs.map((row) => ({
        ...row,
        tabs: row.tabs.map((tab) => ({
          id: tab.id,
          repertoireId: row.versionId,
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
   * RH-125 ER17 — a snapshot written under the previous version is rejected,
   * and one written under the new value is accepted.
   *
   * The shape still validates (`isSongSnapshot` checks structure, not the
   * entry's fields), which is exactly why the version number has to do the
   * work: a v4 record carries `entry.versionId === undefined` under a type that
   * says `string`, and `isRecord` would wave it through.
   */
  it('accepts a snapshot written under the new schema version (ER17)', () => {
    const current = buildOne()

    expect(current.schemaVersion).toBe(6)
    expect(readValidSnapshot(current)).toEqual(current)
  })

  /**
   * RH-132 ER5a — the v6 validator itself requires `versionId`.
   *
   * Tagged `schemaVersion: 6` on purpose, so the v5 upgrade path does **not**
   * run: a v5-tagged fixture would be upgraded and then accepted, which proves
   * the opposite of what this pins. `isSongSnapshot` stays module-private and
   * is asserted through `readValidSnapshot`, its only caller.
   */
  it('refuses a v6 song keyed by repertoireId, and accepts the same one keyed by versionId (ER5a)', () => {
    const current = buildOne()
    const keyedByOwnerRow: Record<string, unknown> = { ...current.songs[0] }
    delete keyedByOwnerRow.versionId
    keyedByOwnerRow.repertoireId = 'rep-1'

    expect(
      readValidSnapshot({ ...current, schemaVersion: 6, songs: [keyedByOwnerRow] }),
    ).toBeNull()

    // The otherwise identical value, carrying `versionId`, is accepted.
    const keyedByVersion = { ...keyedByOwnerRow, versionId: 'version-of-rep-1' }
    const read = readValidSnapshot({ ...current, schemaVersion: 6, songs: [keyedByVersion] })
    expect(read).not.toBeNull()
    expect(read!.songs[0].versionId).toBe('version-of-rep-1')
  })

  it('rejects a v4 snapshot, whose entry carries no versionId (ER17)', () => {
    const current = buildOne()
    const v4Entry: Record<string, unknown> = { ...current.songs[0].entry }
    delete v4Entry.versionId

    expect(readValidSnapshot({ ...current, schemaVersion: 4 })).toBeNull()
    expect(
      readValidSnapshot({
        ...current,
        schemaVersion: 4,
        songs: [{ ...current.songs[0], entry: v4Entry }],
      }),
    ).toBeNull()
  })

  it('rejects a v3 snapshot too, for the version RH-124 bumped (ER17)', () => {
    const current = buildOne()
    const v3 = { ...current, schemaVersion: 3 }

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
    expect(readValidSnapshot({ ...snapshot, songs: [{ ...snapshot.songs[0], versionId: 3 }] })).toBeNull()
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
      // RH-128: absent on the row, so `application/pdf` — the honest reading
      // of every file stored before RH-127's ingest existed.
      content_type: 'application/pdf',
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

/**
 * RH-128 ER7 — the content type has to survive the round trip, or the branch
 * is made differently offline and a downloaded photograph renders as a broken
 * PDF.
 *
 * `OFFLINE_SCHEMA_VERSION` deliberately does **not** move for this. Every
 * snapshot already on disk predates image upload and is a PDF, so reading an
 * absent `contentType` as `application/pdf` is a fact rather than a guess —
 * and bumping the version would throw away a musician's downloaded setlist to
 * learn nothing.
 */
describe('the content type round trip (RH-128 ER7)', () => {
  it('carries an image tab\'s content type from the row to the SongFile', () => {
    const snapshot = buildOfflineSnapshot({
      playlistId: 'pl-1',
      playlistName: 'Gig',
      bandId: null,
      savedAt: '2026-09-20T18:04:00.000Z',
      songs: [
        {
          entry: { repertoireId: 'rep-1', versionId: 'version-of-rep-1', songId: 'song-of-rep-1', title: 'Tempo Perdido', artist: null },
          repertoire: repertoire('rep-1'),
          personalRepertoire: null,
          tabs: [
            { tab: { ...tabRow('tab-img', '2026-01-01T00:00:00Z'), content_type: 'image/jpeg' }, bytes: 100 },
          ],
        },
      ],
    })

    expect(snapshot.songs[0].tabs[0].contentType).toBe('image/jpeg')

    const read = readValidSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(read).not.toBeNull()
    expect(offlineTabToSongFile(read!.songs[0].tabs[0]).content_type).toBe('image/jpeg')
  })

  it('validates a snapshot written before this task and reads it back as a PDF', () => {
    const snapshot = buildOne()
    const withoutContentType = { ...snapshot.songs[0].tabs[0] }
    delete withoutContentType.contentType
    const songs = [
      { ...snapshot.songs[0], tabs: [withoutContentType, ...snapshot.songs[0].tabs.slice(1)] },
      snapshot.songs[1],
    ]

    const read = readValidSnapshot({ ...snapshot, songs })

    expect(read).not.toBeNull()
    expect('contentType' in read!.songs[0].tabs[0]).toBe(false)
    expect(offlineTabToSongFile(read!.songs[0].tabs[0]).content_type).toBe('application/pdf')
    expect(OFFLINE_SCHEMA_VERSION).toBe(6)
  })

  it('rejects a snapshot whose tab content type is not a string', () => {
    const snapshot = buildOne()
    const songs = [
      { ...snapshot.songs[0], tabs: [{ ...snapshot.songs[0].tabs[0], contentType: 7 }] },
      snapshot.songs[1],
    ]

    expect(readValidSnapshot({ ...snapshot, songs })).toBeNull()
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

describe('the captured version ids are the "was this captured?" predicate', () => {
  it('distinguishes a tab-less captured song from a song that was never captured', () => {
    const captured = new Set(buildOne().songs.map((row) => row.versionId))

    expect(captured.has('version-of-rep-2')).toBe(true)
    expect(captured.has('version-of-rep-9')).toBe(false)
  })
})

/**
 * RH-132 ER6 — a v5 record is UPGRADED, not discarded.
 *
 * This is the first `OFFLINE_SCHEMA_VERSION` bump that is a pure reshape of
 * data already in the record, so discarding would cost a musician every
 * downloaded playlist and its cached PDF bytes on first launch — recoverable
 * only with a network connection. The upgrade is pure: no database, no network,
 * no fake timers, no `window`.
 */
describe('the v5 to v6 upgrade (RH-132 ER6)', () => {
  /** A v5 record, in exactly the shape that was being written before RH-132. */
  function buildV5(): OfflineSnapshotV5 {
    const current = buildOne()
    return {
      schemaVersion: 5,
      playlistId: current.playlistId,
      playlistName: current.playlistName,
      bandId: current.bandId,
      savedAt: current.savedAt,
      songs: current.songs.map((row) => ({
        repertoireId: row.repertoire.ownerRowId as string,
        entry: row.entry,
        repertoire: {
          id: row.repertoire.ownerRowId as string,
          user_id: null,
          band_id: 'band-1',
          song_id: row.repertoire.song_id,
          version_id: row.repertoire.version_id,
          key: row.repertoire.key,
          tuning: row.repertoire.tuning,
          map: row.repertoire.map,
          status: 'polishing',
          tags: row.repertoire.tags,
          last_practiced: row.repertoire.last_practiced,
          lyrics: row.repertoire.lyrics,
          song: row.repertoire.song,
        },
        personalRepertoire: row.personalRepertoire,
        tabs: row.tabs,
      })),
    }
  }

  it('maps every field of a v5 song losslessly (ER6a)', () => {
    const v5 = buildV5()

    const upgraded = upgradeSnapshotV5ToV6(v5)

    expect(upgraded.schemaVersion).toBe(6)
    // The target version and the module's own constant cannot drift apart:
    // `offlineSnapshotV5.ts` declares the 6 rather than importing it, to avoid
    // closing a module cycle for one integer.
    expect(upgraded.schemaVersion).toBe(OFFLINE_SCHEMA_VERSION)
    expect(upgraded.songs).toHaveLength(v5.songs.length)

    upgraded.songs.forEach((row, index) => {
      const before = v5.songs[index]
      expect(row.versionId).toBe(before.entry.versionId)
      expect(row.repertoire.ownerRowId).toBe(before.repertoire.id)
      for (const field of [
        'version_id',
        'song_id',
        'status',
        'key',
        'tuning',
        'lyrics',
        'map',
        'tags',
        'last_practiced',
        'song',
      ] as const) {
        expect(row.repertoire[field]).toEqual(before.repertoire[field])
      }
      // `personalRepertoire` and every tab, including each cacheKey, unchanged.
      expect(row.personalRepertoire).toEqual(before.personalRepertoire)
      expect(row.tabs).toEqual(before.tabs)
      expect(row.tabs.map((tab) => tab.cacheKey)).toEqual(
        before.tabs.map((tab) => tab.cacheKey),
      )
      expect(row.entry).toEqual(before.entry)
    })
  })

  it('leaves the three Repertoire-only fields behind, and nothing else', () => {
    const [row] = upgradeSnapshotV5ToV6(buildV5()).songs

    for (const gone of ['id', 'user_id', 'band_id']) {
      expect(row.repertoire).not.toHaveProperty(gone)
    }
    expect(row).not.toHaveProperty('repertoireId')
  })

  it('readValidSnapshot upgrades a well-formed v5 value instead of refusing it (ER6b)', () => {
    const read = readValidSnapshot(JSON.parse(JSON.stringify(buildV5())))

    expect(read).not.toBeNull()
    expect(read!.schemaVersion).toBe(OFFLINE_SCHEMA_VERSION)
    expect(read!.songs.map((row) => row.versionId)).toEqual([
      'version-of-rep-1',
      'version-of-rep-2',
    ])
    expect(read!.songs[0].repertoire.ownerRowId).toBe('rep-1')
    expect(read!.songs[0].personalRepertoire?.lyrics).toBe('my cues')
  })

  it('readValidSnapshot still refuses a malformed v5 value (ER6b)', () => {
    const v5 = buildV5()

    // Malformed at the snapshot level: the upgrade reshapes it, and the v6
    // pass that runs afterwards is what rejects it.
    expect(readValidSnapshot({ ...v5, playlistName: 7 })).toBeNull()
    expect(readValidSnapshot({ ...v5, bandId: 7 })).toBeNull()
    expect(readValidSnapshot({ ...v5, songs: 'nope' })).toBeNull()
    // Malformed at the tab level, which only the v6 pass inspects.
    expect(
      readValidSnapshot({
        ...v5,
        songs: [{ ...v5.songs[0], tabs: [{ ...v5.songs[0].tabs[0], bytes: '100' }] }],
      }),
    ).toBeNull()
  })

  it('readValidSnapshot refuses a v5 song whose entry carries no versionId (ER6b)', () => {
    const v5 = buildV5()
    const entry: Record<string, unknown> = { ...v5.songs[0].entry }
    delete entry.versionId

    // A pre-RH-125 record mislabelled v5: upgrading it would key a song by
    // `undefined`, so it is refused rather than reshaped.
    expect(readValidSnapshot({ ...v5, songs: [{ ...v5.songs[0], entry }] })).toBeNull()
  })

  it('readValidSnapshot refuses a v5 song whose repertoire carries no id (ER6b)', () => {
    const v5 = buildV5()
    const repertoireRow: Record<string, unknown> = { ...v5.songs[0].repertoire }
    delete repertoireRow.id

    expect(
      readValidSnapshot({ ...v5, songs: [{ ...v5.songs[0], repertoire: repertoireRow }] }),
    ).toBeNull()
  })

  it('refuses a v5 song that is not a record, or carries no repertoireId (ER6b)', () => {
    const v5 = buildV5()

    // Not a record at all, and a record missing the key v5 was addressed by:
    // both reach `readValidSnapshot` as "no usable offline copy" rather than
    // being reshaped into a v6 song with `undefined` holes in it.
    expect(readValidSnapshot({ ...v5, songs: ['nope'] })).toBeNull()
    const withoutKey: Record<string, unknown> = { ...v5.songs[0] }
    delete withoutKey.repertoireId
    expect(readValidSnapshot({ ...v5, songs: [withoutKey] })).toBeNull()
  })

  it('refuses a v5 song whose personalRepertoire is absent or not a row (ER6b)', () => {
    const v5 = buildV5()

    // Absent is not null, on the v6 validator's own reasoning: a v1 song
    // carried no such field, and reading it as "no personal version" is the
    // wrong answer the whole personalRepertoire field exists to avoid.
    const withoutPersonal: Record<string, unknown> = { ...v5.songs[0] }
    delete withoutPersonal.personalRepertoire
    expect(readValidSnapshot({ ...v5, songs: [withoutPersonal] })).toBeNull()
    expect(
      readValidSnapshot({ ...v5, songs: [{ ...v5.songs[0], personalRepertoire: 7 }] }),
    ).toBeNull()
    // Explicitly null is legitimate, and upgrades.
    expect(
      readValidSnapshot({ ...v5, songs: [{ ...v5.songs[0], personalRepertoire: null }] }),
    ).not.toBeNull()
  })

  it('refuses a v5 song whose tabs are not an array (ER6b)', () => {
    const v5 = buildV5()

    expect(readValidSnapshot({ ...v5, songs: [{ ...v5.songs[0], tabs: {} }] })).toBeNull()
  })

  it('is pure: the same input upgrades to the same output, twice', () => {
    const v5 = buildV5()

    expect(upgradeSnapshotV5ToV6(v5)).toEqual(upgradeSnapshotV5ToV6(v5))
    // And the input is not mutated.
    expect(v5.songs[0]).toHaveProperty('repertoireId')
    expect(v5.songs[0].repertoire).toHaveProperty('id')
  })
})
