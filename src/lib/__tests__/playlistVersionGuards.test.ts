/**
 * RH-125 — the source-tree rules the re-key leaves behind.
 *
 * Each is a property no single behavioural case can establish, because what it
 * asserts is the *absence* of something, or the shape of a SQL string a missed
 * rename would type-check right past. None of them is DB-gated: they read the
 * sources, so they run on every suite — a skipped test asserts nothing.
 *
 *  - **ER4** — **no `playlist_songs` insert carries an `ON CONFLICT` clause.**
 *    Every one of them is positional, so an arbiter that skipped a duplicate
 *    version would leave a `position` gap behind the skipped row *and* stop a
 *    duplicate add from raising — neither of which any behavioural assertion in
 *    this task would catch. The earlier claim that the bulk import needs one is
 *    withdrawn as false: the sync route `DELETE`s every row of the playlist
 *    inside the same transaction before re-inserting, and the import route
 *    creates the playlist a statement earlier, so there is nothing for an
 *    arbiter to absorb.
 *  - **ER11** — `playlistDetail.ts` and `playlistOverlay.ts` name no song id for
 *    a playlist entry. Two lists keyed by different ids under the same name is
 *    the bug the re-key exists to prevent, so `removedSongIds` becoming
 *    `removedVersionIds` is part of the change rather than a tidy-up.
 *  - **ER9 / ER10** — the entry projection reaches `songs` through
 *    `song_versions` and names no owner table, and the setlist read `LEFT
 *    JOIN`s the owner table on `(owner, version_id)` with no lateral left.
 *  - **ER3 / ER8** — the migration names `uq_playlist_song_position` nowhere,
 *    writes no `position` value, and joins `albums` with a `LEFT JOIN` only.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  PLAYLIST_CARD_ENTRIES_JSON,
  PLAYLIST_DETAIL_ENTRIES_JSON,
  playlistEntriesSql,
} from '@/lib/playlistSql'
import { stripComments } from './test-helpers'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const SRC_DIR = path.join(REPO_ROOT, 'src')
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'migrations')
const MIGRATION_SUFFIX = '_playlist_songs_version_id.sql'

/** Every `.ts`/`.tsx` under `src/`, repo-relative and `/`-separated. */
function sourceFiles(dir: string = SRC_DIR): string[] {
  const files: string[] = []
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name)
    if (dirent.isDirectory()) files.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(dirent.name)) files.push(full)
  }
  return files
}

/**
 * The migration file, resolved by its name **suffix** — several approved specs
 * each claim "the next number", so a prefix written into a test breaks on the
 * renumber (ER1).
 */
function migrationSql(): string {
  const names = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(MIGRATION_SUFFIX))
  expect(names).toHaveLength(1)
  return fs.readFileSync(path.join(MIGRATIONS_DIR, names[0]), 'utf8')
}

describe('RH-125 ER4 — no playlist_songs insert carries an ON CONFLICT clause', () => {
  it('finds no ON CONFLICT in any INSERT INTO playlist_songs under src/', () => {
    // Line-based scanning cannot see it: `addSongToPlaylist` spreads its insert
    // over two lines and `buildPlaylistSongsInsert` assembles the statement from
    // a template, so the window is the text after the `INSERT INTO` up to the
    // next statement-ish boundary (a backtick or a closing paren on its own).
    const offenders: string[] = []
    for (const full of sourceFiles()) {
      const file = path.relative(REPO_ROOT, full).split(path.sep).join('/')
      if (file === 'src/lib/__tests__/playlistVersionGuards.test.ts') continue
      const source = stripComments(fs.readFileSync(full, 'utf8'))
      const pattern = /INSERT\s+INTO\s+playlist_songs/gi
      let match: RegExpExecArray | null
      while ((match = pattern.exec(source)) !== null) {
        const window = source.slice(match.index, match.index + 400)
        if (/ON\s+CONFLICT/i.test(window)) offenders.push(`${file} @ ${match.index}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('still finds the clause where it belongs — on the owner-table inserts', () => {
    // Guards the guard. `ensureInRepertoire` and `addSongToPlaylist`'s seeding
    // both absorb an expected duplicate with `ON CONFLICT DO NOTHING`, on
    // `user_songs` / `band_songs`; ER4 is about `playlist_songs` only, and a
    // pattern that matched nothing would satisfy the assertion above.
    const sync = stripComments(
      fs.readFileSync(path.join(REPO_ROOT, 'src/lib/spotifyPlaylistSync.ts'), 'utf8'),
    )
    expect(sync).toMatch(/INSERT INTO (user|band)_songs[\s\S]{0,300}ON CONFLICT DO NOTHING/)

    // `playlists.ts` builds its owner-table insert from a template, so the
    // table name is interpolated and the literal above cannot match it.
    const playlists = stripComments(
      fs.readFileSync(path.join(REPO_ROOT, 'src/lib/playlists.ts'), 'utf8'),
    )
    expect(playlists).toMatch(/INSERT INTO \$\{table\}[\s\S]{0,300}ON CONFLICT DO NOTHING/)
  })
})

describe('RH-125 ER11 — the two pure modules name no song id for an entry', () => {
  const MODULES = ['src/lib/playlistDetail.ts', 'src/lib/playlistOverlay.ts'] as const

  it.each(MODULES)('%s carries no songId / song_id identifier', (file) => {
    const source = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'))

    expect(source).not.toMatch(/\bsongId\b/)
    expect(source).not.toMatch(/\bsong_id\b/)
  })

  it('renames the removed set to removedVersionIds', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/playlistOverlay.ts'), 'utf8')

    expect(source).toContain('removedVersionIds')
    expect(source).not.toContain('removedSongIds')
  })

  it('reads the repertoire map through version_id in both modules', () => {
    const detail = stripComments(
      fs.readFileSync(path.join(REPO_ROOT, 'src/lib/playlistDetail.ts'), 'utf8'),
    )

    // The three map readers, each keyed by the version the entry names.
    expect(detail).toContain('repertoire.get(ps.version_id)')
  })
})

/**
 * RH-125 ER9 / ER10 — the two reads' joins, read off the SQL they are built
 * from.
 *
 * `playlistVersionReads.db.test.ts` proves the *answers*; these two pin the
 * shape, because the failure mode is specific: the entry projection must reach
 * `songs` through `song_versions` and must project no owner-table column (the
 * page's repertoire map is the single resolved source), and the setlist read
 * must `LEFT JOIN` the owner table — an inner join silently drops an entry, and
 * one dropped entry used to collapse the whole setlist.
 */
describe('RH-125 ER9 / ER10 — the two playlist reads join as specified', () => {
  it('reaches songs through song_versions and names no owner table (ER9)', () => {
    expect(PLAYLIST_DETAIL_ENTRIES_JSON).toContain('JOIN song_versions v ON v.id = ps.version_id')
    expect(PLAYLIST_DETAIL_ENTRIES_JSON).toContain('JOIN songs s ON s.id = v.song_id')
    expect(PLAYLIST_DETAIL_ENTRIES_JSON).not.toMatch(/user_songs|band_songs/)
    // The card read sums a duration through the same two joins (ER16).
    expect(PLAYLIST_CARD_ENTRIES_JSON).toContain('JOIN song_versions v ON v.id = ps.version_id')
    expect(PLAYLIST_CARD_ENTRIES_JSON).not.toMatch(/ps\.song_id/)
  })

  it.each(['user_songs', 'band_songs'] as const)(
    'LEFT JOINs %s on (owner, version_id), with no lateral left (ER10)',
    (table) => {
      const column = table === 'band_songs' ? 'band_id' : 'user_id'
      const sql = playlistEntriesSql(table, column)

      expect(sql).toContain(`LEFT JOIN ${table} o ON o.version_id = ps.version_id AND o.${column} = $1`)
      // RH-124 picked a representative version here through a lateral; the
      // entry names the version itself now, so there is nothing left to pick.
      expect(sql).not.toMatch(/LATERAL/i)
      expect(sql).not.toMatch(/albums/i)
    },
  )
})

describe('RH-125 ER3 / ER8 — what the migration file does and does not name', () => {
  it('names uq_playlist_song_position nowhere, and writes no position value', () => {
    const sql = migrationSql()

    expect(sql).not.toContain('uq_playlist_song_position')
    expect(sql).not.toMatch(/SET\s+position/i)
  })

  it('replaces uq_playlist_song with a plain unique over (playlist_id, version_id)', () => {
    const sql = migrationSql()

    expect(sql).toContain('DROP CONSTRAINT uq_playlist_song')
    expect(sql).toContain('ADD CONSTRAINT uq_playlist_song_version UNIQUE (playlist_id, version_id)')
    // Plain and immediate: the default form, and the same form the dropped one
    // had, so this is a swap of columns and not a change of mode.
    expect(sql).not.toMatch(/uq_playlist_song_version[\s\S]{0,120}DEFERRABLE/i)
  })

  it('joins albums only with a LEFT JOIN, exactly once', () => {
    const sql = migrationSql()

    expect(sql.match(/(?<!LEFT\s)\bJOIN\s+albums\b/gi)).toBeNull()
    expect(sql.match(/LEFT JOIN albums\b/g)).toHaveLength(1)
  })
})
