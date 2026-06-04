/**
 * Integration test for songs.ts
 *
 * Verifies that all repertoire and global song operations work correctly
 * against a local running Supabase instance.
 *
 * The test is fully self-contained: it creates temporary users in beforeAll
 * and deletes all created resources in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { vi } from 'vitest'
import { createClient as createOriginalClient } from '@supabase/supabase-js'
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
} from '../songs'
import type { SongStatus } from '@/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const skip = !SERVICE_ROLE_KEY || !ANON_KEY

// Create a single shared client instance that we control and sign in with
const mockTestClient = createOriginalClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Mock '@/lib/supabase/client' to return our shared client
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockTestClient,
}))

describe.skipIf(skip)('songs service integration tests', () => {
  const admin = createOriginalClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Unique suffix so parallel runs don't collide
  const suffix = Date.now()
  const TEST_USER = {
    email: `test-songs-${suffix}@example.com`,
    password: 'password123',
  }

  let userId: string
  const createdGlobalSongIds = new Set<string>()

  beforeAll(async () => {
    // 1. Create a temporary test user
    const { data: { user }, error: userError } = await admin.auth.admin.createUser({
      email: TEST_USER.email,
      password: TEST_USER.password,
      email_confirm: true,
    })
    expect(userError).toBeNull()
    userId = user!.id

    // 2. Sign in the mockTestClient as this user
    const { error: signInError } = await mockTestClient.auth.signInWithPassword(TEST_USER)
    expect(signInError).toBeNull()
  })

  afterAll(async () => {
    // Sign out client
    await mockTestClient.auth.signOut()

    if (userId) {
      // 1. Delete repertoire entries for our test user
      await admin.from('repertoire').delete().eq('user_id', userId)

      // 2. Delete global songs contributed by this user or created during the tests
      if (createdGlobalSongIds.size > 0) {
        await admin.from('global_songs').delete().in('id', Array.from(createdGlobalSongIds))
      }

      // 3. Delete the test user
      await admin.auth.admin.deleteUser(userId)
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

  it('updateSong updates both global song details and repertoire details', async () => {
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

    // Call updateSong
    await updateSong({ userId: userId }, entry, updateData)

    // Fetch the updated entry to verify all changes
    const updated = await getSongEntry({ userId: userId }, entry.id)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('mastered')
    expect(updated!.tags).toEqual(['updated-tag'])
    expect(updated!.personal_key).toBe('B')

    expect(updated!.song).toBeDefined()
    expect(updated!.song!.title).toBe(updateData.title)
    expect(updated!.song!.artist).toBe(updateData.artist)
    expect(updated!.song!.album).toBe(updateData.album)
    expect(updated!.song!.standard_key).toBe(updateData.key)
    expect(updated!.song!.cover_url).toBe(updateData.cover_url)
    expect(updated!.song!.duration_seconds).toBe(updateData.duration_seconds)
    expect(updated!.song!.links).toEqual(updateData.links)
  })
})
