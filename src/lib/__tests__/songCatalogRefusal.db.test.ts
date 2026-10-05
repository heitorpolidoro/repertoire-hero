/**
 * RH-97 ER1-ER5 — `updateSong` stops discarding shared edits silently.
 *
 * Every claim here is a claim about what Postgres ends up holding *and* about
 * what the caller is told, so a mocked `pg` could not prove either half: the
 * old implementation passed every value into the UPDATE and let a `CASE WHEN`
 * drop it, which is exactly the step a mock would skip.
 *
 * Each test builds its own `global_songs` row so the fixtures cannot interfere:
 * the whole point of the feature is that a populated column behaves differently
 * from an empty one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { addSongToRepertoire, updateSong, type SongUpdateInput } from '@/lib/songs'
import type { Repertoire, SongLink } from '@/types/database'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const YOUTUBE: SongLink = { label: 'YouTube', url: 'https://youtu.be/rh97' }
const CHORDS: SongLink = { label: 'Chords', url: 'https://chords.test/rh97' }

describe.skipIf(!RUN_DB_TESTS)('updateSong reports what the catalog refused (real database)', () => {
  const suffix = Date.now()
  let userId: string
  const createdSongIds: string[] = []

  /** A catalog row with exactly the columns the test wants populated, plus a repertoire entry for it. */
  const makeEntry = async (
    columns: Partial<{
      title: string
      artist: string
      album: string | null
      standard_key: string | null
      cover_url: string | null
      duration_seconds: number | null
      links: SongLink[]
    }>,
  ): Promise<Repertoire> => {
    const row = {
      title: `RH-97 Song ${suffix}-${createdSongIds.length}`,
      artist: 'RH-97 Artist',
      album: null,
      standard_key: null,
      cover_url: null,
      duration_seconds: null,
      // `global_songs.links` is NOT NULL DEFAULT '[]', so "empty" means `[]`.
      links: [] as SongLink[],
      ...columns,
    }
    const res = await query<{ id: string }>(
      `INSERT INTO global_songs (title, artist, album, standard_key, cover_url, duration_seconds, links)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
      [
        row.title,
        row.artist,
        row.album,
        row.standard_key,
        row.cover_url,
        row.duration_seconds,
        JSON.stringify(row.links),
      ],
    )
    createdSongIds.push(res.rows[0].id)
    return addSongToRepertoire({ userId }, res.rows[0].id)
  }

  const catalogRow = async (songId: string) => {
    const res = await query<{
      title: string
      artist: string
      album: string | null
      standard_key: string | null
      cover_url: string | null
      duration_seconds: number | null
      links: SongLink[]
    }>(
      'SELECT title, artist, album, standard_key, cover_url, duration_seconds, links FROM global_songs WHERE id = $1',
      [songId],
    )
    return res.rows[0]
  }

  const repertoireRow = async (repertoireId: string) => {
    const res = await query<{ status: string; tags: string[]; personal_key: string | null }>(
      'SELECT status, tags, personal_key FROM repertoire WHERE id = $1',
      [repertoireId],
    )
    return res.rows[0]
  }

  /**
   * The form's payload for an entry, overridden per test. Every shared value
   * defaults to the one the catalog already holds, which is what the read-only
   * form sends back, so a test only states the field it is changing.
   */
  const input = (entry: Repertoire, overrides: Partial<SongUpdateInput> = {}): SongUpdateInput => {
    const song = entry.song!
    return {
      title: song.title,
      artist: song.artist,
      album: song.album,
      key: song.standard_key,
      status: 'learning',
      tags: ['rh97'],
      links: song.links,
      cover_url: song.cover_url,
      duration_seconds: song.duration_seconds,
      ...overrides,
    }
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh97-owner-${suffix}@example.com` })
  })

  afterAll(async () => {
    if (userId) await deleteTestUser(userId)
    for (const songId of createdSongIds) {
      await query('DELETE FROM global_songs WHERE id = $1', [songId])
    }
  })

  it('leaves a populated artist alone and returns the refusal (ER1)', async () => {
    const entry = await makeEntry({ artist: 'Michael Jackson' })

    const result = await updateSong(
      { userId },
      entry,
      input(entry, { artist: 'Micheal Jackson' }),
    )

    expect((await catalogRow(entry.song_id)).artist).toBe('Michael Jackson')
    expect(result.refused).toEqual([
      { column: 'artist', current: 'Michael Jackson', proposed: 'Micheal Jackson' },
    ])
  })

  it('fills an album the catalog does not have, and refuses nothing (ER2)', async () => {
    const entry = await makeEntry({ album: null })

    const result = await updateSong({ userId }, entry, input(entry, { album: 'Bad' }))

    expect((await catalogRow(entry.song_id)).album).toBe('Bad')
    expect(result.refused).toEqual([])
  })

  it('reports no refusal when the shared values are the stored ones, and writes the owner-local row (ER3)', async () => {
    const entry = await makeEntry({
      artist: 'Michael Jackson',
      album: 'Bad',
      cover_url: 'https://example.com/bad.jpg',
      duration_seconds: 257,
      links: [YOUTUBE, CHORDS],
    })

    const result = await updateSong(
      { userId },
      entry,
      input(entry, {
        // Same values, retyped with stray whitespace and in the stored link order.
        artist: '  Michael Jackson  ',
        album: 'Bad ',
        cover_url: 'https://example.com/bad.jpg',
        duration_seconds: 257,
        links: [{ ...YOUTUBE }, { ...CHORDS }],
        status: 'polishing',
        tags: ['rock', 'live'],
        key: 'Am',
      }),
    )

    expect(result.refused).toEqual([])
    expect(await repertoireRow(entry.id)).toEqual({
      status: 'polishing',
      tags: ['rock', 'live'],
      personal_key: 'Am',
    })
  })

  it('refuses a links list that would replace a populated one, and fills an empty one (ER4)', async () => {
    const populated = await makeEntry({ links: [YOUTUBE] })
    const refusal = await updateSong(
      { userId },
      populated,
      input(populated, { links: [YOUTUBE, CHORDS] }),
    )

    expect((await catalogRow(populated.song_id)).links).toEqual([YOUTUBE])
    expect(refusal.refused).toEqual([
      { column: 'links', current: [YOUTUBE], proposed: [YOUTUBE, CHORDS] },
    ])

    const empty = await makeEntry({ links: [] })
    const accepted = await updateSong(
      { userId },
      empty,
      input(empty, { links: [YOUTUBE, CHORDS] }),
    )

    expect((await catalogRow(empty.song_id)).links).toEqual([YOUTUBE, CHORDS])
    expect(accepted.refused).toEqual([])
  })

  it('never reports standard_key refused — the key was saved personally (ER5)', async () => {
    const entry = await makeEntry({ standard_key: 'G' })

    const result = await updateSong({ userId }, entry, input(entry, { key: 'Am' }))

    expect((await catalogRow(entry.song_id)).standard_key).toBe('G')
    expect((await repertoireRow(entry.id)).personal_key).toBe('Am')
    expect(result.refused).toEqual([])
  })
})
