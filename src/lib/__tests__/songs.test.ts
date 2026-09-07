/**
 * Integration test for songs.ts
 *
 * Verifies that all repertoire and global song operations work correctly
 * against a local running Supabase instance.
 *
 * The test is fully self-contained: it creates temporary users in beforeAll
 * and deletes all created resources in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createAdminTestClient, createTestUser, deleteTestUser } from './test-helpers'

// RH-45 — `applySongLinkUpdate` auto-labels a blank link label through
// `fetchUrlTitle`; the network is never touched from a test.
vi.mock('@/lib/linkFetcher', () => ({ fetchUrlTitle: vi.fn() }))

import {
  getRepertoire,
  addSongToRepertoire,
  updateSongStatus,
  updateSongTags,
  updatePersonalKey,
  removeSongFromRepertoire,
  searchGlobalSongs,
  getSongEntry,
  updateSong,
  createAndAddSong,
  updateLyrics,
  applySongLinkUpdate,
  getPersonalEntryForSong,
} from '../songs'
import { createBand } from '../bands'
import { fetchUrlTitle } from '@/lib/linkFetcher'
import { query } from '@/lib/db'
import type { SongLink, SongStatus } from '@/types/database'

/** An id that is syntactically valid but matches nothing. */
const MISSING_ID = '00000000-0000-0000-0000-000000000000'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const skip = !SERVICE_ROLE_KEY

const admin = createAdminTestClient()

describe.skipIf(skip)('songs service integration tests', () => {
  // Unique suffix so parallel runs don't collide
  const suffix = Date.now()
  const TEST_USER = { email: `test-songs-${suffix}@example.com` }

  let userId: string
  // RH-45 — the band half of the `RepertoireOwner` fork `updateLyrics` takes.
  let bandId: string
  const createdGlobalSongIds = new Set<string>()

  beforeAll(async () => {
    userId = await createTestUser(admin, { email: TEST_USER.email })
    bandId = await createBand(userId, `Songs Band ${suffix}`, null, null)
  })

  beforeEach(() => {
    vi.mocked(fetchUrlTitle).mockReset()
  })

  afterAll(async () => {
    if (bandId) await query('DELETE FROM bands WHERE id = $1', [bandId])
    if (userId) {
      // Global songs first (contributor_id FK), then deleteTestUser cascades the rest
      if (createdGlobalSongIds.size > 0) {
        await admin.from('global_songs').delete().in('id', Array.from(createdGlobalSongIds))
      }
      await deleteTestUser(admin, userId)
    }
  })

  it('createAndAddSong creates a new global song and adds to user repertoire', async () => {
    const songData = {
      title: `Song A_${suffix}`,
      artist: 'Artist A',
      album: `Album A_${suffix}`,
      standard_key: 'C',
      cover_url: 'https://example.com/cover.jpg',
      duration_seconds: 180,
      links: [{ label: 'YouTube', url: 'https://youtube.com/watch?v=123' }],
    }

    const entry = await createAndAddSong({ userId: userId }, songData)
    expect(entry).toBeDefined()
    expect(entry.user_id).toBe(userId)
    expect(entry.status).toBe('unknown')
    expect(entry.song).toBeDefined()
    expect(entry.song!.title).toBe(songData.title)
    expect(entry.song!.artist).toBe(songData.artist)
    expect(entry.song!.album).toBe(songData.album)
    expect(entry.song!.standard_key).toBe(songData.standard_key)
    expect(entry.song!.cover_url).toBe(songData.cover_url)
    expect(entry.song!.duration_seconds).toBe(songData.duration_seconds)
    expect(entry.song!.links).toEqual(songData.links)

    // Track the created song ID for cleanup
    createdGlobalSongIds.add(entry.song_id)
  })

  it('createAndAddSong reuses existing global song if matching title and album', async () => {
    const songData = {
      title: `Song B_${suffix}`,
      artist: 'Artist B',
      album: `Album B_${suffix}`,
    }

    // First creation
    const entry1 = await createAndAddSong({ userId: userId }, songData)
    createdGlobalSongIds.add(entry1.song_id)

    // Remove from repertoire (but keep the global song in database)
    await removeSongFromRepertoire({ userId: userId }, entry1.id)

    // Create again with same title/album
    const entry2 = await createAndAddSong({ userId: userId }, songData)
    expect(entry2.song_id).toBe(entry1.song_id) // Reused!

    // Track new repertoire entry id if we need to clean up, but the afterAll deletes by user_id
  })

  it('createAndAddSong throws if the song is already present in the user repertoire', async () => {
    const songData = {
      title: `Song C_${suffix}`,
      artist: 'Artist C',
    }

    const entry = await createAndAddSong({ userId: userId }, songData)
    createdGlobalSongIds.add(entry.song_id)

    await expect(createAndAddSong({ userId: userId }, songData)).rejects.toThrow('Song already in your repertoire')
  })

  it('getRepertoire retrieves the user repertoire with song details', async () => {
    const repertoire = await getRepertoire({ userId: userId })
    expect(repertoire).toBeInstanceOf(Array)
    // There should be at least the entry from the previous test (Song C)
    const hasSongC = repertoire.some(entry => entry.song?.title === `Song C_${suffix}`)
    expect(hasSongC).toBe(true)
  })

  it('addSongToRepertoire adds an existing global song to user repertoire', async () => {
    // Create global song using admin client to act as an already existing global song
    const { data: globalSong, error } = await admin
      .from('global_songs')
      .insert({
        title: `Global Song D_${suffix}`,
        artist: 'Artist D',
        contributor_id: userId,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    const songId = globalSong!.id
    createdGlobalSongIds.add(songId)

    const entry = await addSongToRepertoire({ userId: userId }, songId)
    expect(entry).toBeDefined()
    expect(entry.song_id).toBe(songId)
    expect(entry.user_id).toBe(userId)
    expect(entry.status).toBe('unknown')
  })

  it('updateSongStatus updates the song status', async () => {
    const songData = {
      title: `Song E_${suffix}`,
      artist: 'Artist E',
    }
    const entry = await createAndAddSong({ userId: userId }, songData)
    createdGlobalSongIds.add(entry.song_id)

    expect(entry.status).toBe('unknown')

    await updateSongStatus({ userId: userId }, entry.id, 'learning')

    // Fetch again to verify
    const updated = await getSongEntry({ userId: userId }, entry.id)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('learning')
  })

  it('updateSongTags updates the song tags', async () => {
    const songData = {
      title: `Song F_${suffix}`,
      artist: 'Artist F',
    }
    const entry = await createAndAddSong({ userId: userId }, songData)
    createdGlobalSongIds.add(entry.song_id)

    expect(entry.tags).toEqual([])

    const newTags = ['rock', 'live', 'favorites']
    await updateSongTags({ userId: userId }, entry.id, newTags)

    const updated = await getSongEntry({ userId: userId }, entry.id)
    expect(updated).not.toBeNull()
    expect(updated!.tags).toEqual(newTags)
  })

  it('updatePersonalKey updates the personal key', async () => {
    const songData = {
      title: `Song G_${suffix}`,
      artist: 'Artist G',
    }
    const entry = await createAndAddSong({ userId: userId }, songData)
    createdGlobalSongIds.add(entry.song_id)

    expect(entry.personal_key).toBeNull()

    await updatePersonalKey({ userId: userId }, entry.id, 'G#')

    const updated = await getSongEntry({ userId: userId }, entry.id)
    expect(updated).not.toBeNull()
    expect(updated!.personal_key).toBe('G#')
  })

  it('removeSongFromRepertoire deletes the repertoire entry', async () => {
    const songData = {
      title: `Song H_${suffix}`,
      artist: 'Artist H',
    }
    const entry = await createAndAddSong({ userId: userId }, songData)
    createdGlobalSongIds.add(entry.song_id)

    // Verify it exists first
    const before = await getSongEntry({ userId: userId }, entry.id)
    expect(before).not.toBeNull()

    await removeSongFromRepertoire({ userId: userId }, entry.id)

    // Verify it is gone
    const after = await getSongEntry({ userId: userId }, entry.id)
    expect(after).toBeNull()
  })

  it('searchGlobalSongs searches by title or artist', async () => {
    // Add two test songs
    const song1 = await createAndAddSong({ userId: userId }, { title: `SearchTitle_${suffix}`, artist: 'SomeArtist' })
    const song2 = await createAndAddSong({ userId: userId }, { title: 'SomeTitle', artist: `SearchArtist_${suffix}` })
    createdGlobalSongIds.add(song1.song_id)
    createdGlobalSongIds.add(song2.song_id)

    // Search by title
    const results1 = await searchGlobalSongs(`SearchTitle_${suffix}`)
    expect(results1.length).toBe(1)
    expect(results1[0].id).toBe(song1.song_id)

    // Search by artist
    const results2 = await searchGlobalSongs(`SearchArtist_${suffix}`)
    expect(results2.length).toBe(1)
    expect(results2[0].id).toBe(song2.song_id)

    // Search with empty/whitespace query
    const resultsEmpty = await searchGlobalSongs('   ')
    expect(resultsEmpty).toEqual([])
  })

  it('getSongEntry retrieves a single entry or returns null if not found', async () => {
    const songData = {
      title: `Song I_${suffix}`,
      artist: 'Artist I',
    }
    const entry = await createAndAddSong({ userId: userId }, songData)
    createdGlobalSongIds.add(entry.song_id)

    const retrieved = await getSongEntry({ userId: userId }, entry.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(entry.id)
    expect(retrieved!.song?.title).toBe(songData.title)

    // Non-existent ID
    const nonExistent = await getSongEntry({ userId: userId }, '00000000-0000-0000-0000-000000000000')
    expect(nonExistent).toBeNull()
  })

  it('updateSong always overwrites repertoire-scoped fields (status, tags, personal_key)', async () => {
    const songData = {
      title: `Original Title_${suffix}`,
      artist: 'Original Artist',
      album: 'Original Album',
      standard_key: 'A',
    }
    const entry = await createAndAddSong({ userId: userId }, songData)
    createdGlobalSongIds.add(entry.song_id)

    const updateData = {
      title: `Updated Title_${suffix}`,
      artist: 'Updated Artist',
      album: 'Updated Album',
      key: 'B',
      status: 'mastered' as SongStatus,
      tags: ['updated-tag'],
      links: [{ label: 'Spotify', url: 'https://spotify.com/track/123' }],
      cover_url: 'https://example.com/updated-cover.jpg',
      duration_seconds: 220,
    }

    await updateSong({ userId: userId }, entry, updateData)

    const updated = await getSongEntry({ userId: userId }, entry.id)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('mastered')
    expect(updated!.tags).toEqual(['updated-tag'])
    expect(updated!.personal_key).toBe('B')
  })

  it('updateSong does not overwrite already-set global song fields (fill-if-empty)', async () => {
    // global_songs is a shared catalog: fields that already have a value
    // must survive an edit from any repertoire owner, so a stray/incorrect
    // edit from one user's repertoire can't clobber good data for everyone
    // else who has the same song. Correcting an already-set field (e.g. a
    // typo in the title) is a separate, not-yet-built mechanism.
    const songData = {
      title: `Preserve Original Title_${suffix}`,
      artist: 'Preserve Original Artist',
      album: 'Preserve Original Album',
      standard_key: 'A',
    }
    const entry = await createAndAddSong({ userId: userId }, songData)
    createdGlobalSongIds.add(entry.song_id)

    const updateData = {
      title: `Updated Title_${suffix}`,
      artist: 'Updated Artist',
      album: 'Updated Album',
      key: 'B',
      status: 'mastered' as SongStatus,
      tags: ['updated-tag'],
      links: [{ label: 'Spotify', url: 'https://spotify.com/track/123' }],
      cover_url: 'https://example.com/updated-cover.jpg',
      duration_seconds: 220,
    }

    await updateSong({ userId: userId }, entry, updateData)

    const updated = await getSongEntry({ userId: userId }, entry.id)
    expect(updated!.song).toBeDefined()
    // Already-set fields: unchanged, despite different values submitted.
    expect(updated!.song!.title).toBe(songData.title)
    expect(updated!.song!.artist).toBe(songData.artist)
    expect(updated!.song!.album).toBe(songData.album)
    expect(updated!.song!.standard_key).toBe(songData.standard_key)
  })

  it('updateSong fills in empty global song fields (fill-if-empty)', async () => {
    const songData = {
      title: `Blank Fields Title_${suffix}`,
      artist: 'Blank Fields Artist',
      // album/standard_key/cover_url/duration_seconds/links all start empty
    }
    const entry = await createAndAddSong({ userId: userId }, songData)
    createdGlobalSongIds.add(entry.song_id)

    const updateData = {
      title: songData.title,
      artist: songData.artist,
      album: 'Filled Album',
      key: 'B',
      status: 'unknown' as SongStatus,
      tags: [],
      links: [{ label: 'Spotify', url: 'https://spotify.com/track/123' }],
      cover_url: 'https://example.com/updated-cover.jpg',
      duration_seconds: 220,
    }

    await updateSong({ userId: userId }, entry, updateData)

    const updated = await getSongEntry({ userId: userId }, entry.id)
    expect(updated!.song).toBeDefined()
    // Previously-empty fields: now filled with the submitted values.
    expect(updated!.song!.album).toBe(updateData.album)
    expect(updated!.song!.standard_key).toBe(updateData.key)
    expect(updated!.song!.cover_url).toBe(updateData.cover_url)
    expect(updated!.song!.duration_seconds).toBe(updateData.duration_seconds)
    expect(updated!.song!.links).toEqual(updateData.links)
  })

  // -------------------------------------------------------------------------
  // RH-45 — the three statements moved out of src/app/actions/repertoire.ts.
  // -------------------------------------------------------------------------

  describe('updateLyrics', () => {
    it('writes the lyrics of a personal entry', async () => {
      const entry = await createAndAddSong(
        { userId },
        { title: `Lyrics Personal_${suffix}`, artist: 'Lyrics Artist' },
      )
      createdGlobalSongIds.add(entry.song_id)

      await updateLyrics({ userId }, entry.id, 'verse one\nverse two')

      const updated = await getSongEntry({ userId }, entry.id)
      expect(updated!.lyrics).toBe('verse one\nverse two')
    })

    it('writes the lyrics of a band entry through the band_id branch', async () => {
      const personalEntry = await createAndAddSong(
        { userId },
        { title: `Lyrics Band_${suffix}`, artist: 'Lyrics Artist' },
      )
      createdGlobalSongIds.add(personalEntry.song_id)

      const bandEntry = await addSongToRepertoire({ bandId }, personalEntry.song_id)

      await updateLyrics({ bandId }, bandEntry.id, 'band lyrics')

      const updated = await getSongEntry({ bandId }, bandEntry.id)
      expect(updated!.lyrics).toBe('band lyrics')
      // The personal entry for the same song is untouched: the fork is real.
      const personal = await getSongEntry({ userId }, personalEntry.id)
      expect(personal!.lyrics).toBeNull()
    })

    it('silently no-ops on an id the owner does not match, as it always has', async () => {
      await expect(updateLyrics({ userId }, MISSING_ID, 'nobody sees this')).resolves.toBeUndefined()
    })
  })

  describe('getPersonalEntryForSong', () => {
    it('returns the personal entry joined with its catalog song', async () => {
      const entry = await createAndAddSong(
        { userId },
        { title: `Personal Entry_${suffix}`, artist: 'Entry Artist' },
      )
      createdGlobalSongIds.add(entry.song_id)

      const found = await getPersonalEntryForSong(entry.song_id, userId)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(entry.id)
      expect(found!.song!.title).toBe(`Personal Entry_${suffix}`)
    })

    it('returns null when the user holds no personal entry for the song', async () => {
      await expect(getPersonalEntryForSong(MISSING_ID, userId)).resolves.toBeNull()
    })
  })

  describe('applySongLinkUpdate', () => {
    const ORIGINAL: SongLink = { label: 'Chords', url: 'https://tabs.example/rh45' }
    const ADDED: SongLink = { label: 'Video', url: 'https://youtu.be/rh45' }

    /** A catalog song carrying `ORIGINAL`, tracked for cleanup. */
    const songWithOriginalLink = async (label: string): Promise<string> => {
      const entry = await createAndAddSong(
        { userId },
        { title: `${label}_${suffix}`, artist: 'Links Artist', links: [ORIGINAL] },
      )
      createdGlobalSongIds.add(entry.song_id)
      return entry.song_id
    }

    const catalogLinks = async (songId: string): Promise<SongLink[]> => {
      const res = await query('SELECT links FROM global_songs WHERE id = $1', [songId])
      return res.rows[0].links as SongLink[]
    }

    const pendingEdits = async (songId: string) => {
      const res = await query(
        "SELECT proposed_data FROM global_song_edits WHERE song_id = $1 AND status = 'pending'",
        [songId],
      )
      return res.rows
    }

    it('writes an additive change straight to the shared catalog', async () => {
      const songId = await songWithOriginalLink('Links Additive')

      await expect(applySongLinkUpdate(userId, songId, [ORIGINAL, ADDED])).resolves.toEqual({
        success: true,
      })

      expect(await catalogLinks(songId)).toEqual([ORIGINAL, ADDED])
      expect(await pendingEdits(songId)).toEqual([])
    })

    it('routes a removed link to the moderation queue and leaves the catalog alone', async () => {
      const songId = await songWithOriginalLink('Links Removal')

      await expect(applySongLinkUpdate(userId, songId, [])).resolves.toEqual({
        success: true,
        pending: true,
      })

      expect(await catalogLinks(songId)).toEqual([ORIGINAL])
      expect(await pendingEdits(songId)).toEqual([{ proposed_data: { links: [] } }])
    })

    it('routes a rewritten url to the moderation queue too', async () => {
      const songId = await songWithOriginalLink('Links Rewrite')
      const rewritten: SongLink = { label: 'Chords', url: 'https://tabs.example/rh45-moved' }

      await expect(applySongLinkUpdate(userId, songId, [rewritten])).resolves.toEqual({
        success: true,
        pending: true,
      })

      expect(await catalogLinks(songId)).toEqual([ORIGINAL])
      expect(await pendingEdits(songId)).toEqual([{ proposed_data: { links: [rewritten] } }])
    })

    it('throws Song entry not found when the id matches no catalog row', async () => {
      await expect(applySongLinkUpdate(userId, MISSING_ID, [ADDED])).rejects.toThrow(
        'Song entry not found',
      )
    })

    it.each([
      ['a blank label', '', 'Fetched Title', 'Fetched Title'],
      ['a whitespace-only label', '   ', 'Fetched Title', 'Fetched Title'],
      ['a blank label the fetcher cannot resolve', '', '', ADDED.url],
    ])('auto-labels %s through fetchUrlTitle', async (label, submitted, fetched, expected) => {
      const songId = await songWithOriginalLink(`Links Autolabel ${label}`)
      vi.mocked(fetchUrlTitle).mockResolvedValue(fetched)

      await applySongLinkUpdate(userId, songId, [ORIGINAL, { label: submitted, url: ADDED.url }])

      expect(fetchUrlTitle).toHaveBeenCalledWith(ADDED.url)
      expect(await catalogLinks(songId)).toEqual([ORIGINAL, { label: expected, url: ADDED.url }])
    })

    it('leaves an already-labelled link alone instead of fetching a title for it', async () => {
      const songId = await songWithOriginalLink('Links Labelled')

      await applySongLinkUpdate(userId, songId, [ORIGINAL, ADDED])

      expect(fetchUrlTitle).not.toHaveBeenCalled()
    })
  })
})
