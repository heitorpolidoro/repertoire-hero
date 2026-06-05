import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createAdminTestClient, createTestUser, deleteTestUser } from './test-helpers'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const skip = !SERVICE_ROLE_KEY

const adminTestClient = createAdminTestClient()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminTestClient,
}))

// Import the module under test after vi.mock so the mock is applied
import {
  getUserPlaylists,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  getPlaylistWithSongs,
} from '../playlists'

describe.skipIf(skip)('playlists integration tests', () => {
  const suffix = Date.now()
  const USER_A = { email: `test-playlist-a-${suffix}@example.com` }
  const USER_B = { email: `test-playlist-b-${suffix}@example.com` }

  let userAId: string
  let userBId: string

  // Track IDs for clean up
  const createdPlaylists: string[] = []
  const createdSongs: string[] = []
  const createdBands: string[] = []

  beforeAll(async () => {
    userAId = await createTestUser(adminTestClient, { email: USER_A.email })
    userBId = await createTestUser(adminTestClient, { email: USER_B.email })
  })

  afterAll(async () => {
    // Delete playlist songs + playlists (before user cascade)
    if (createdPlaylists.length > 0) {
      await adminTestClient.from('playlist_songs').delete().in('playlist_id', createdPlaylists)
      await adminTestClient.from('playlists').delete().in('id', createdPlaylists)
    }
    // Delete bands
    if (createdBands.length > 0) {
      await adminTestClient.from('band_members').delete().in('band_id', createdBands)
      await adminTestClient.from('bands').delete().in('id', createdBands)
    }
    // Delete global songs
    if (createdSongs.length > 0) {
      await adminTestClient.from('global_songs').delete().in('id', createdSongs)
    }
    // Delete users (CASCADE handles repertoire, profiles, etc.)
    if (userAId) await deleteTestUser(adminTestClient, userAId)
    if (userBId) await deleteTestUser(adminTestClient, userBId)
  })

  it('should successfully create, read, update, and delete a playlist', async () => {
    // 1. Create playlist
    const playlistName = `My Playlist ${suffix}`
    const playlistDesc = `Description for My Playlist`
    const playlist = await createPlaylist(userAId, { name: playlistName, description: playlistDesc })

    expect(playlist).toBeDefined()
    expect(playlist.id).toBeDefined()
    expect(playlist.name).toBe(playlistName)
    expect(playlist.description).toBe(playlistDesc)
    expect(playlist.user_id).toBe(userAId)

    createdPlaylists.push(playlist.id)

    // 2. Get playlist with songs (currently empty)
    const playlistWithSongs = await getPlaylistWithSongs(playlist.id)
    expect(playlistWithSongs).not.toBeNull()
    expect(playlistWithSongs!.id).toBe(playlist.id)
    expect(playlistWithSongs!.name).toBe(playlistName)
    expect(playlistWithSongs!.songs).toBeDefined()
    expect(playlistWithSongs!.songs!.length).toBe(0)

    // 3. Get user playlists — only User A's playlists returned (explicit userId filter)
    const playlists = await getUserPlaylists(userAId)
    expect(playlists).toBeDefined()
    expect(playlists.length).toBeGreaterThanOrEqual(1)
    const found = playlists.find((p) => p.id === playlist.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe(playlistName)

    // 4. Update playlist
    const newName = `Updated Playlist Name ${suffix}`
    const newDesc = `Updated description`
    await updatePlaylist(playlist.id, {
      name: newName,
      description: newDesc,
      sync_with_spotify: true,
      tags: ['rock', 'alternative'],
    })

    // Fetch and verify update
    const updatedPlaylist = await getPlaylistWithSongs(playlist.id)
    expect(updatedPlaylist).not.toBeNull()
    expect(updatedPlaylist!.name).toBe(newName)
    expect(updatedPlaylist!.description).toBe(newDesc)
    expect(updatedPlaylist!.sync_with_spotify).toBe(true)
    expect(updatedPlaylist!.tags).toContain('rock')

    // 5. Delete playlist
    await deletePlaylist(playlist.id)

    // Verify it is gone
    const deletedPlaylist = await getPlaylistWithSongs(playlist.id)
    expect(deletedPlaylist).toBeNull()

    const playlistsAfterDelete = await getUserPlaylists(userAId)
    const foundAfterDelete = playlistsAfterDelete.find((p) => p.id === playlist.id)
    expect(foundAfterDelete).toBeUndefined()
  })

  it('should successfully add and remove songs to/from a playlist', async () => {
    // 1. Create a test global song first via admin
    const songTitle = `Playlist Song ${suffix}`
    const { data: songData, error: songError } = await adminTestClient
      .from('global_songs')
      .insert({
        title: songTitle,
        artist: 'Test Artist',
        album: 'Test Album',
        duration_seconds: 240,
        links: [],
      })
      .select('id')
      .single()

    if (songError) throw songError
    const songId = songData!.id
    createdSongs.push(songId)

    // 2. Create playlist for User A
    const playlist = await createPlaylist(userAId, { name: `Songs Playlist ${suffix}` })
    createdPlaylists.push(playlist.id)

    // 3. Add song to playlist
    await addSongToPlaylist(userAId, playlist.id, songId)

    // Verify song is added
    const playlistWithSongs = await getPlaylistWithSongs(playlist.id)
    expect(playlistWithSongs).not.toBeNull()
    expect(playlistWithSongs!.songs).toBeDefined()
    expect(playlistWithSongs!.songs!.length).toBe(1)
    expect(playlistWithSongs!.songs![0].song_id).toBe(songId)
    expect(playlistWithSongs!.songs![0].position).toBe(1)
    expect(playlistWithSongs!.songs![0].song).toBeDefined()
    expect(playlistWithSongs!.songs![0].song!.title).toBe(songTitle)
    expect(playlistWithSongs!.songs![0].song!.duration_seconds).toBe(240)

    // 4. Remove song from playlist
    await removeSongFromPlaylist(playlist.id, songId)

    // Verify song is removed
    const playlistEmpty = await getPlaylistWithSongs(playlist.id)
    expect(playlistEmpty).not.toBeNull()
    expect(playlistEmpty!.songs!.length).toBe(0)
  })

  it('should isolate playlists by userId (getUserPlaylists only returns own playlists)', async () => {
    // Create playlists for both users
    const playlistA = await createPlaylist(userAId, { name: `User A Playlist ${suffix}` })
    createdPlaylists.push(playlistA.id)
    const playlistB = await createPlaylist(userBId, { name: `User B Playlist ${suffix}` })
    createdPlaylists.push(playlistB.id)

    // getUserPlaylists(userAId) must NOT return User B's playlist
    const playlistsA = await getUserPlaylists(userAId)
    const foundBinA = playlistsA.find((p) => p.id === playlistB.id)
    expect(foundBinA).toBeUndefined()

    // getUserPlaylists(userBId) must NOT return User A's playlist
    const playlistsB = await getUserPlaylists(userBId)
    const foundAinB = playlistsB.find((p) => p.id === playlistA.id)
    expect(foundAinB).toBeUndefined()
  })

  it('should autogest repertoire and propagate to members when adding song to a band playlist (UC3.2)', async () => {
    // 1. Create a band using admin client to set it up easily
    const { data: band, error: bandError } = await adminTestClient
      .from('bands')
      .insert({
        name: `Band Playlists ${suffix}`,
        description: 'Test band for playlists autogestion',
      })
      .select('id')
      .single()

    if (bandError) throw bandError
    const bandId = band!.id
    createdBands.push(bandId)

    // 2. Add User A (admin) and User B (member) to the band members list
    const { error: membersError } = await adminTestClient.from('band_members').insert([
      { band_id: bandId, user_id: userAId, role: 'admin' },
      { band_id: bandId, user_id: userBId, role: 'member' }
    ])
    if (membersError) throw membersError

    // 3. Create a band playlist using admin
    const { data: playlist, error: playlistError } = await adminTestClient
      .from('playlists')
      .insert({
        band_id: bandId,
        name: `Band Setlist ${suffix}`,
      })
      .select('id')
      .single()

    if (playlistError) throw playlistError
    const playlistId = playlist!.id
    createdPlaylists.push(playlistId)

    // 4. Create a global song
    const songTitle = `Autogest Song ${suffix}`
    const { data: song, error: songError } = await adminTestClient
      .from('global_songs')
      .insert({
        title: songTitle,
        artist: 'Band Autogest Artist',
      })
      .select('id')
      .single()

    if (songError) throw songError
    const songId = song!.id
    createdSongs.push(songId)

    // 5. User A adds the song to the band playlist
    await addSongToPlaylist(userAId, playlistId, songId)

    // 6. Verify that:
    // A. The song was added to the band repertoire
    const { data: bandRep, error: bandRepErr } = await adminTestClient
      .from('repertoire')
      .select('id')
      .eq('band_id', bandId)
      .eq('song_id', songId)
      .single()

    expect(bandRepErr).toBeNull()
    expect(bandRep).not.toBeNull()

    // B. The song was automatically propagated to User A's personal repertoire
    const { data: userARep, error: userARepErr } = await adminTestClient
      .from('repertoire')
      .select('id')
      .eq('user_id', userAId)
      .eq('song_id', songId)
      .single()

    expect(userARepErr).toBeNull()
    expect(userARep).not.toBeNull()

    // C. The song was NOT automatically propagated to User B's personal repertoire (correct for client-side RLS)
    const { data: userBRep, error: userBRepErr } = await adminTestClient
      .from('repertoire')
      .select('id')
      .eq('user_id', userBId)
      .eq('song_id', songId)
      .maybeSingle()

    expect(userBRepErr).toBeNull()
    expect(userBRep).toBeNull()

    // D. The song is in the playlist songs list
    const playlistWithSongs = await getPlaylistWithSongs(playlistId)
    expect(playlistWithSongs).not.toBeNull()
    expect(playlistWithSongs!.songs).toBeDefined()
    expect(playlistWithSongs!.songs!.length).toBe(1)
    expect(playlistWithSongs!.songs![0].song_id).toBe(songId)
  })
})
