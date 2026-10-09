/**
 * RH-105 — the integration close-out of the catalog restructure (RH-121…RH-126),
 * against real Postgres.
 *
 * This suite verifies the **seams** between the six children, which each
 * verified its own table and its own call paths in isolation:
 *
 *  - **ER5** — one add, driven through the real production paths, reaches all
 *    five re-keyed relations plus the catalog and the album: `songs`, `albums`,
 *    `song_versions`, `user_songs`, `playlist_songs` and `song_files`. Every id
 *    in the chain is read back from the row the previous step created, never
 *    written as a literal, so the test cannot pass by addressing something the
 *    flow did not produce.
 *  - **ER6 (a) and (c)** — the two key spaces meet: `song_files` is keyed by
 *    `song_id` (RH-123) while every owner and playlist relation is keyed by
 *    `version_id` (RH-124, RH-125). The *finding* recorded with this suite is
 *    that no runtime read can discriminate that, because no `song_files` read
 *    path in non-test source consults `user_songs` or any version — moving an
 *    actor's hold between two versions of the same song provably cannot change
 *    a `listTabs` result. So the schema half is asserted here and the source
 *    half in `catalogRestructureCoherence.test.ts` (ER6b), with the live
 *    round-trip kept because it is what proves the real path works.
 *  - **ER7** — one-owner holds on the seven repertoire mutators RH-126 did not
 *    touch. RH-124 proved they require band admin; nothing proved they are
 *    also single-owner.
 *
 * Every `band_songs` and `user_songs` count below is **scoped** to an id this
 * suite created. An unscoped global count over either table races with the
 * other DB suites in the same `RUN_DB_TESTS=1` process — `vitest.config.ts`
 * fixes no `fileParallelism` — which is the defect RH-105 repaired in
 * `oneOwnerPerWrite.db.test.ts` (ER14).
 *
 * Gated on `RUN_DB_TESTS` like every other DB-backed suite: `npm run
 * test:coverage` sets none, so this file only runs under an explicit
 * `RUN_DB_TESTS=1` invocation.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The only mocked seams: the session, the blob store, the logger and Next's
// cache revalidation. Every row below is written by the real code path.
vi.mock('@/lib/auth-session', () => ({ getRequiredUserId: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn() }))

import {
  addSongAction,
  createAndAddSongAction,
  removeSongAction,
  updateLyricsAction,
  updateSongAction,
  updateSongStatusAction,
  updateSongTagsAction,
} from '@/app/actions/repertoire'
import { uploadTabAction } from '@/app/actions/tabs'
import { getRequiredUserId } from '@/lib/auth-session'
import { createBand } from '@/lib/bands'
import { query } from '@/lib/db'
import { addSongToPlaylist } from '@/lib/playlists'
import { listTabs } from '@/lib/tabs'
import { put } from '@vercel/blob'
import { createTestUser, deleteTestUser } from './test-helpers'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

const suffix = Date.now()

/** One artist per concern, so every count below can be scoped by artist. */
const COMPOSED_ARTIST = `RH-105 Composed Artist ${suffix}`
const KEYSPACE_ARTIST = `RH-105 Keyspace Artist ${suffix}`
const MUTATOR_ARTIST = `RH-105 Mutator Artist ${suffix}`
const ALL_ARTISTS = [COMPOSED_ARTIST, KEYSPACE_ARTIST, MUTATOR_ARTIST]

/** A minimal PDF, which `sniffUploadContentType` accepts on its magic bytes. */
const PDF_BYTES = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n'

describe.skipIf(!RUN_DB_TESTS)('the restructured catalog composes end to end (real database)', () => {
  let actorId: string
  let otherId: string
  let bandId: string
  let personalPlaylistId: string

  const asUser = (userId: string) => {
    vi.mocked(getRequiredUserId).mockResolvedValue(userId)
  }

  const count = async (sql: string, params: unknown[] = []): Promise<number> => {
    const res = await query<{ count: number }>(sql, params as never)
    return res.rows[0].count
  }

  /** A catalog row written by hand, for the paths that take a song id. */
  const newSong = async (title: string, artist: string): Promise<string> => {
    const res = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [title, artist],
    )
    return res.rows[0].id
  }

  const uploadForm = (songId: string, title: string): FormData => {
    const formData = new FormData()
    formData.set('songId', songId)
    formData.set('title', title)
    formData.set(
      'file',
      new File([new Uint8Array(Buffer.from(PDF_BYTES))], 'chart.pdf', { type: 'application/pdf' }),
    )
    return formData
  }

  beforeAll(async () => {
    actorId = await createTestUser({ email: `rh105-actor-${suffix}@example.com` })
    otherId = await createTestUser({ email: `rh105-other-${suffix}@example.com` })

    // `createBand` makes its caller the admin; the second user joins as a plain
    // member, so a fan-out onto a member is visible rather than being
    // indistinguishable from the actor's own row.
    bandId = await createBand(actorId, `RH-105 Band ${suffix}`, null, null)
    await query("INSERT INTO band_members (band_id, user_id, role) VALUES ($1, $2, 'member')", [
      bandId,
      otherId,
    ])

    const playlist = await query<{ id: string }>(
      'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
      [actorId, `RH-105 Personal Setlist ${suffix}`],
    )
    personalPlaylistId = playlist.rows[0].id
  })

  beforeEach(() => {
    vi.mocked(put).mockResolvedValue({
      url: 'https://blob.example.test/rh105/chart.pdf',
      downloadUrl: 'https://blob.example.test/rh105/chart.pdf',
      pathname: 'rh105/chart.pdf',
      contentType: 'application/pdf',
      contentDisposition: 'inline; filename="chart.pdf"',
    } as Awaited<ReturnType<typeof put>>)
  })

  afterAll(async () => {
    vi.restoreAllMocks()

    if (personalPlaylistId) await query('DELETE FROM playlists WHERE id = $1', [personalPlaylistId])
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    for (const user of [actorId, otherId]) {
      if (user) await deleteTestUser(user)
    }
    // Songs first: `song_versions` cascades from them, and `albums` is only
    // reachable once no version points at it.
    await query('DELETE FROM songs WHERE artist = ANY($1)', [ALL_ARTISTS])
    await query('DELETE FROM albums WHERE artist = ANY($1)', [ALL_ARTISTS])
  })

  // -------------------------------------------------------------------------
  // ER5 — the composed flow through all five re-keys.
  // -------------------------------------------------------------------------

  it('one add reaches songs, albums, song_versions, user_songs, playlist_songs and song_files', async () => {
    asUser(actorId)

    // Step 1-3 of `docs/use-cases.md` § *Add a song to the repertoire*, plus
    // step 4's owner row, in one real call.
    const entry = await createAndAddSongAction({
      title: `RH-105 Composed Song ${suffix}`,
      artist: COMPOSED_ARTIST,
      album: `RH-105 Composed Album ${suffix}`,
    })

    // Every id from here on is read back from the row the previous step made.
    const { song_id: songId, version_id: versionId } = entry

    await addSongToPlaylist(personalPlaylistId, actorId, versionId)

    const upload = await uploadTabAction(uploadForm(songId, 'RH-105 Composed Chart'))
    expect(upload.error).toBeUndefined()
    expect(upload.data?.song_id).toBe(songId)

    expect(await count('SELECT count(*)::int AS count FROM songs WHERE artist = $1', [COMPOSED_ARTIST])).toBe(1)
    expect(await count('SELECT count(*)::int AS count FROM albums WHERE artist = $1', [COMPOSED_ARTIST])).toBe(1)
    expect(
      await count('SELECT count(*)::int AS count FROM song_versions WHERE song_id = $1', [songId]),
    ).toBe(1)
    expect(
      await count('SELECT count(*)::int AS count FROM user_songs WHERE version_id = $1', [versionId]),
    ).toBe(1)
    expect(
      await count(
        'SELECT count(*)::int AS count FROM playlist_songs WHERE playlist_id = $1 AND version_id = $2',
        [personalPlaylistId, versionId],
      ),
    ).toBe(1)
    expect(await count('SELECT count(*)::int AS count FROM song_files WHERE song_id = $1', [songId])).toBe(1)

    // Scoped to the version the flow created: an unscoped `band_songs` count
    // races with the other suites in this process (ER14).
    expect(
      await count('SELECT count(*)::int AS count FROM band_songs WHERE version_id = $1', [versionId]),
    ).toBe(0)
  })

  // -------------------------------------------------------------------------
  // ER6 (a) and (c) — the two key spaces, and the live round-trip.
  // -------------------------------------------------------------------------

  it('song_files carries no version column and tabs.ts keys on song, not version', async () => {
    // (a) The schema half. This is one of the two assertions that can
    // discriminate a version-keyed `song_files` at all: such a table would
    // change `listTabs`'s *signature*, not its *result*, so no runtime fixture
    // can tell the difference (the other half is ER6b, over `tabs.ts`'s text).
    const COLUMN_SQL =
      "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'song_files' AND column_name"
    expect(await count(`${COLUMN_SQL} = 'version_id'`)).toBe(0)
    // Positive control: the identical query over the two columns the table
    // really has. Without it a zero could mean "the query reached nothing".
    expect(await count(`${COLUMN_SQL} = ANY(ARRAY['song_id','user_id'])`)).toBe(2)

    // (c) The live path. A two-version song, the actor holding one version, one
    // file uploaded through the real action.
    asUser(actorId)
    const held = await createAndAddSongAction({
      title: `RH-105 Keyspace Song ${suffix}`,
      artist: KEYSPACE_ARTIST,
      album: `RH-105 Keyspace Album A ${suffix}`,
    })
    const songId = held.song_id
    // A second version of the same song, written directly. It cannot come from
    // `createAndAddSongAction`: that path inserts its owner row against the
    // song's *representative* version (`addRowSql`), not against the version it
    // just upserted, so a second call for the same song refuses with "Song
    // already in your repertoire" rather than producing a second hold.
    const secondVersion = await query<{ id: string }>(
      "INSERT INTO song_versions (song_id, label) VALUES ($1, $2) RETURNING id",
      [songId, `RH-105 Keyspace Label B ${suffix}`],
    )
    expect(secondVersion.rows[0].id).not.toBe(held.version_id)

    const upload = await uploadTabAction(uploadForm(songId, 'RH-105 Keyspace Chart'))
    expect(upload.error).toBeUndefined()
    const fileId = upload.data?.id

    const mine = await listTabs(actorId, songId)
    expect(mine.map((f) => f.id)).toEqual([fileId])

    // The two controls, which are the only part of the original fixture that
    // discriminated anything: the read is scoped by owner and by song, so it
    // cannot pass by returning everything.
    expect(await listTabs(otherId, songId)).toEqual([])
    const otherSongId = await newSong(`RH-105 Keyspace Other ${suffix}`, KEYSPACE_ARTIST)
    expect(await listTabs(actorId, otherSongId)).toEqual([])
  })

  // -------------------------------------------------------------------------
  // ER7 — one-owner on the seven repertoire mutators.
  // -------------------------------------------------------------------------

  /**
   * The seven `resolveWriteOwner` callers of `src/app/actions/repertoire.ts`,
   * driven in the one order that works: `removeSongAction` deletes the row the
   * four mutators before it address, so it has to come last.
   *
   * `bandId` is the band's id in the band phase and `undefined` in the personal
   * phase — that is the only difference between the two. Both versions the
   * phase touched are returned, because `createAndAddSongAction` resolves a
   * version of its own that would otherwise go unmeasured.
   */
  const driveSevenMutators = async (phase: {
    label: string
    bandId?: string
  }): Promise<{ versionA: string; versionB: string }> => {
    const { label, bandId: ctx } = phase
    const title = `RH-105 Mutator ${label} ${suffix}`
    const songId = await newSong(title, MUTATOR_ARTIST)

    // 1 — takes a **song** id, not a version id; the phase's version is read
    // back from the entry the call returns.
    const entry = await addSongAction(songId, ctx)
    const rowId = entry.id
    const versionA = entry.version_id

    // 2, 3 — the per-field owner-row writes.
    await updateSongStatusAction(rowId, 'learning', ctx)
    await updateSongTagsAction(rowId, [`rh105-${label}`], ctx)

    // 4 — takes the **whole entry** from step 1, and a *complete*
    // `SongUpdateInput`. A partial object is not merely sloppy: measured at
    // `1843aa9`, `{ key: 'C' }` throws
    // `Failed to update song: "undefined" is not valid JSON` and rolls the
    // whole call back, because `links` is a required member and `undefined`
    // reaches `fillSongLinks` through `applyCatalogFill`'s links path.
    await updateSongAction(
      entry,
      {
        title,
        artist: MUTATOR_ARTIST,
        album: null,
        key: 'C',
        status: 'learning',
        tags: [`rh105-${label}`],
        links: [],
      },
      ctx,
    )

    // 5
    await updateLyricsAction(rowId, `RH-105 ${label} lyrics`, ctx)

    // 6 — a new row on a version the action resolves itself.
    const created = await createAndAddSongAction(
      {
        title: `RH-105 Mutator ${label} Created ${suffix}`,
        artist: MUTATOR_ARTIST,
        album: `RH-105 Mutator Album ${suffix}`,
      },
      ctx,
    )
    const versionB = created.version_id

    // 7 — deletes the row steps 2-5 addressed.
    await removeSongAction(rowId, ctx)

    return { versionA, versionB }
  }

  it('no repertoire mutator in band context writes a member row', async () => {
    asUser(actorId)

    const band = await driveSevenMutators({ label: 'Band', bandId })
    const bandVersions = [band.versionA, band.versionB]

    // Counted over both versions and over every user — not over the second
    // member alone — so neither the actor's own row nor a row on the version
    // `createAndAddSongAction` invented can go unmeasured.
    expect(
      await count('SELECT count(*)::int AS count FROM user_songs WHERE version_id = ANY($1)', [
        bandVersions,
      ]),
    ).toBe(0)
    // Control, proving the counter is wired to writes that really happened.
    expect(
      await count('SELECT count(*)::int AS count FROM band_songs WHERE version_id = $1', [band.versionB]),
    ).toBe(1)
    expect(
      await count('SELECT count(*)::int AS count FROM band_songs WHERE version_id = $1', [band.versionA]),
    ).toBe(0)

    const personal = await driveSevenMutators({ label: 'Personal' })
    const personalVersions = [personal.versionA, personal.versionB]

    // Step 7 removed the `versionA` row; the `versionB` row remains.
    expect(
      await count('SELECT count(*)::int AS count FROM user_songs WHERE version_id = ANY($1)', [
        personalVersions,
      ]),
    ).toBe(1)
    expect(
      await count('SELECT count(*)::int AS count FROM band_songs WHERE version_id = ANY($1)', [
        personalVersions,
      ]),
    ).toBe(0)
  })
})
