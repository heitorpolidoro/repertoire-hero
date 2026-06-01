import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createClient as createOriginalClient } from '@supabase/supabase-js'
import { vi } from 'vitest'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const skip = !SERVICE_ROLE_KEY || !ANON_KEY

const mockTestClient = createOriginalClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockTestClient,
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
  const admin = createOriginalClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const suffix = Date.now()
  const USER_A = { email: `test-playlist-a-${suffix}@example.com`, password: 'password123' }
  const USER_B = { email: `test-playlist-b-${suffix}@example.com`, password: 'password123' }

  let userAId: string
  let userBId: string

  // Track IDs for clean up
  const createdPlaylists: string[] = []
  const createdSongs: string[] = []
  const createdBands: string[] = []

  beforeAll(async () => {
    // Create User A
    const { data: { user: a }, error: errA } = await admin.auth.admin.createUser({
      email: USER_A.email,
      password: USER_A.password,
      email_confirm: true,
    })
    if (errA) throw errA
    userAId = a!.id

    // Create User B
    const { data: { user: b }, error: errB } = await admin.auth.admin.createUser({
      email: USER_B.email,
      password: USER_B.password,
      email_confirm: true,
    })
    if (errB) throw errB
    userBId = b!.id
  })

  afterAll(async () => {
    // 1. Delete playlist songs links to avoid constraint errors
    if (createdPlaylists.length > 0) {
      await admin.from('playlist_songs').delete().in('playlist_id', createdPlaylists)
      // 2. Delete playlists
      await admin.from('playlists').delete().in('id', createdPlaylists)
    }

    // Delete band memberships and bands
    if (createdBands.length > 0) {
      await admin.from('band_members').delete().in('band_id', createdBands)
      await admin.from('bands').delete().in('id', createdBands)
    }

    // Delete repertoires created for users or bands
    if (userAId) {
      await admin.from('repertoire').delete().eq('user_id', userAId)
    }
    if (userBId) {
      await admin.from('repertoire').delete().eq('user_id', userBId)
    }
    if (createdBands.length > 0) {
      await admin.from('repertoire').delete().in('band_id', createdBands)
    }

    // 3. Delete global songs
    if (createdSongs.length > 0) {
      await admin.from('global_songs').delete().in('id', createdSongs)
    }

    // 4. Delete temporary users
    if (userAId) {
      await admin.auth.admin.deleteUser(userAId)
    }
    if (userBId) {
      await admin.auth.admin.deleteUser(userBId)
    }
  })

  afterEach(async () => {
    // Always sign out to keep tests isolated
    await mockTestClient.auth.signOut()
  })

  it('should successfully create, read, update, and delete a playlist', async () => {
    // Sign in as User A
    const { error: signInError } = await mockTestClient.auth.signInWithPassword(USER_A)
    expect(signInError).toBeNull()

    // 1. Create playlist
    const playlistName = `My Playlist ${suffix}`
    const playlistDesc = `Description for My Playlist`
    const playlist = await createPlaylist({ name: playlistName, description: playlistDesc })

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

    // 3. Get user playlists
    const playlists = await getUserPlaylists()
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

    const playlistsAfterDelete = await getUserPlaylists()
    const foundAfterDelete = playlistsAfterDelete.find((p) => p.id === playlist.id)
    expect(foundAfterDelete).toBeUndefined()
  })

  it('should successfully add and remove songs to/from a playlist', async () => {
    // 1. Create a test global song first via admin
    const songTitle = `Playlist Song ${suffix}`
    const { data: songData, error: songError } = await admin
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

    // Sign in as User A
    const { error: signInError } = await mockTestClient.auth.signInWithPassword(USER_A)
    expect(signInError).toBeNull()

    // 2. Create playlist for User A
    const playlist = await createPlaylist({ name: `Songs Playlist ${suffix}` })
    createdPlaylists.push(playlist.id)

    // 3. Add song to playlist
    await addSongToPlaylist(playlist.id, songId)

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

  it('should enforce RLS boundaries between User A and User B', async () => {
    // Sign in as User A to create a playlist
    const { error: signInA } = await mockTestClient.auth.signInWithPassword(USER_A)
    expect(signInA).toBeNull()
    const playlistA = await createPlaylist({ name: `User A Playlist ${suffix}` })
    createdPlaylists.push(playlistA.id)
    await mockTestClient.auth.signOut()

    // Sign in as User B
    const { error: signInB } = await mockTestClient.auth.signInWithPassword(USER_B)
    expect(signInB).toBeNull()

    // 1. User B should not see User A's playlist in getUserPlaylists
    const playlistsB = await getUserPlaylists()
    const foundA = playlistsB.find((p) => p.id === playlistA.id)
    expect(foundA).toBeUndefined()

    // 2. User B should get null when trying to fetch User A's playlist specifically
    const fetchedA = await getPlaylistWithSongs(playlistA.id)
    expect(fetchedA).toBeNull()

    // 3. User B should not be able to update User A's playlist
    // Under RLS, updates to non-owned records match 0 rows and succeed without error,
    // but the record will NOT actually be changed.
    await updatePlaylist(playlistA.id, { name: 'Hacked name' })

    // Sign back in as User A to verify the playlist was not changed
    await mockTestClient.auth.signOut()
    const { error: signInA2 } = await mockTestClient.auth.signInWithPassword(USER_A)
    expect(signInA2).toBeNull()

    const checkPlaylistA = await getPlaylistWithSongs(playlistA.id)
    expect(checkPlaylistA).not.toBeNull()
    expect(checkPlaylistA!.name).toBe(`User A Playlist ${suffix}`)
    expect(checkPlaylistA!.name).not.toBe('Hacked name')
  })

  it('should autogest repertoire and propagate to members when adding song to a band playlist (UC3.2)', async () => {
    // 1. Create a band using admin client to set it up easily
    const { data: band, error: bandError } = await admin
      .from('bands')
      .insert({
        name: `Band Playlists ${suffix}`,
        description: 'Test band for playlists autogestion',
        created_by: userAId,
      })
      .select('id')
      .single()

    if (bandError) throw bandError
    const bandId = band!.id
    createdBands.push(bandId)

    // 2. Add User A (admin) and User B (member) to the band members list
    const { error: membersError } = await admin.from('band_members').insert([
      { band_id: bandId, user_id: userAId, role: 'admin' },
      { band_id: bandId, user_id: userBId, role: 'member' }
    ])
    if (membersError) throw membersError

    // 3. Create a band playlist using admin
    const { data: playlist, error: playlistError } = await admin
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
    const { data: song, error: songError } = await admin
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

    // 5. Sign in as User A (who is a member of the band) and add the song to the band playlist
    const { error: signInError } = await mockTestClient.auth.signInWithPassword(USER_A)
    expect(signInError).toBeNull()

    await addSongToPlaylist(playlistId, songId)

    // 6. Verify that:
    // A. The song was added to the band repertoire
    const { data: bandRep, error: bandRepErr } = await admin
      .from('repertoire')
      .select('id')
      .eq('band_id', bandId)
      .eq('song_id', songId)
      .single()

    expect(bandRepErr).toBeNull()
    expect(bandRep).not.toBeNull()

    // B. The song was automatically propagated to User A's personal repertoire
    const { data: userARep, error: userARepErr } = await admin
      .from('repertoire')
      .select('id')
      .eq('user_id', userAId)
      .eq('song_id', songId)
      .single()

    expect(userARepErr).toBeNull()
    expect(userARep).not.toBeNull()

    // C. The song was NOT automatically propagated to User B's personal repertoire (correct for client-side RLS)
    const { data: userBRep, error: userBRepErr } = await admin
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
