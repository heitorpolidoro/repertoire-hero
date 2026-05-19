import { createClient } from '@/lib/supabase/client'
import { logger } from '@/lib/logger'
import type { GlobalSong, SongLink, SongStatus, UserRepertoire } from '@/types/database'

// Fetch all songs in the user's repertoire, joining global song details
export async function getUserRepertoire(): Promise<UserRepertoire[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('user_repertoire')
    .select('*, song:global_songs(*)')
    .order('id', { ascending: false })

  if (error) {
    logger.error('Failed to fetch user repertoire', new Error(error.message), { code: error.code })
    throw new Error(`Failed to fetch user repertoire: ${error.message}`)
  }

  return data as UserRepertoire[]
}

// Add a song to the user's repertoire
export async function addSongToRepertoire(songId: string): Promise<UserRepertoire> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Cannot add song: user is not authenticated')

  const { data, error } = await supabase
    .from('user_repertoire')
    .insert({ song_id: songId, user_id: user.id, status: 'unknown' as SongStatus })
    .select('*, song:global_songs(*)')
    .single()

  if (error) {
    logger.error('Failed to add song to repertoire', new Error(error.message), { code: error.code })
    throw new Error(`Failed to add song to repertoire: ${error.message}`)
  }

  return data as UserRepertoire
}

// Update the status of a song in the user's repertoire
export async function updateSongStatus(
  repertoireId: string,
  status: SongStatus
): Promise<void> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('user_repertoire')
    .update({ status })
    .eq('id', repertoireId)
    .select('id')

  if (error) {
    logger.error('Failed to update song status', new Error(error.message), { code: error.code, repertoireId, status })
    throw new Error(`Failed to update song status: ${error.message}`)
  }
  if (!data || data.length === 0) {
    logger.error('Repertoire entry not found or access denied', undefined, { repertoireId })
    throw new Error('Repertoire entry not found or access denied')
  }
}

// Update tags for a song in the user's repertoire
export async function updateSongTags(
  repertoireId: string,
  tags: string[]
): Promise<void> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('user_repertoire')
    .update({ tags })
    .eq('id', repertoireId)
    .select('id')

  if (error) {
    logger.error('Failed to update song tags', new Error(error.message), { code: error.code, repertoireId })
    throw new Error(`Failed to update song tags: ${error.message}`)
  }
  if (!data || data.length === 0) {
    logger.error('Repertoire entry not found or access denied', undefined, { repertoireId })
    throw new Error('Repertoire entry not found or access denied')
  }
}

// Update the personal key for a song in the user's repertoire
export async function updatePersonalKey(
  repertoireId: string,
  personalKey: string
): Promise<void> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('user_repertoire')
    .update({ personal_key: personalKey })
    .eq('id', repertoireId)
    .select('id')

  if (error) {
    logger.error('Failed to update personal key', new Error(error.message), { code: error.code, repertoireId })
    throw new Error(`Failed to update personal key: ${error.message}`)
  }
  if (!data || data.length === 0) {
    logger.error('Repertoire entry not found or access denied', undefined, { repertoireId })
    throw new Error('Repertoire entry not found or access denied')
  }
}

// Remove a song from the user's repertoire
export async function removeSongFromRepertoire(repertoireId: string): Promise<void> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('user_repertoire')
    .delete()
    .eq('id', repertoireId)
    .select('id')

  if (error) {
    logger.error('Failed to remove song from repertoire', new Error(error.message), { code: error.code, repertoireId })
    throw new Error(`Failed to remove song from repertoire: ${error.message}`)
  }
  if (!data || data.length === 0) {
    logger.error('Repertoire entry not found or access denied', undefined, { repertoireId })
    throw new Error('Repertoire entry not found or access denied')
  }
}

// Search global_songs by title or artist
export async function searchGlobalSongs(query: string): Promise<GlobalSong[]> {
  const supabase = createClient()

  const trimmed = query.trim()

  if (!trimmed) {
    return []
  }

  const { data, error } = await supabase
    .from('global_songs')
    .select('*')
    .or(`title.ilike.%${trimmed}%,artist.ilike.%${trimmed}%`)
    .order('title', { ascending: true })
    .limit(20)

  if (error) {
    logger.error('Failed to search global songs', new Error(error.message), { code: error.code, query: trimmed })
    throw new Error(`Failed to search global songs: ${error.message}`)
  }

  return data as GlobalSong[]
}

// Fetch a single repertoire entry by its id (joining global song data)
export async function getSongEntry(repertoireId: string): Promise<UserRepertoire | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('user_repertoire')
    .select('*, song:global_songs(*)')
    .eq('id', repertoireId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // row not found
    logger.error('Failed to fetch song entry', new Error(error.message), { code: error.code, repertoireId })
    throw new Error(`Failed to fetch song entry: ${error.message}`)
  }

  return data as UserRepertoire
}

// Update a repertoire entry and the underlying global song in one operation
export async function updateSong(
  entry: UserRepertoire,
  data: {
    title: string
    artist: string
    album?: string | null
    key: string | null
    status: SongStatus
    tags: string[]
    links: SongLink[]
    cover_url?: string | null
    duration_seconds?: number | null
  }
): Promise<void> {
  const supabase = createClient()

  // Update global song fields
  const { error: songError } = await supabase
    .from('global_songs')
    .update({
      title: data.title,
      artist: data.artist,
      album: data.album ?? null,
      standard_key: data.key,
      cover_url: data.cover_url ?? null,
      duration_seconds: data.duration_seconds ?? null,
      links: data.links,
    })
    .eq('id', entry.song_id)

  if (songError) {
    logger.error('Failed to update global song', new Error(songError.message), { code: songError.code, songId: entry.song_id })
    throw new Error(`Failed to update global song: ${songError.message}`)
  }

  // Update repertoire fields
  const { error: repertoireError } = await supabase
    .from('user_repertoire')
    .update({
      status: data.status,
      tags: data.tags,
      personal_key: data.key,
    })
    .eq('id', entry.id)

  if (repertoireError) {
    logger.error('Failed to update repertoire entry', new Error(repertoireError.message), { code: repertoireError.code, repertoireId: entry.id })
    throw new Error(`Failed to update repertoire entry: ${repertoireError.message}`)
  }
}

// Create a new global song (or reuse an existing one) and add it to the user's repertoire.
// Duplicate prevention rules:
//   - When album is provided: match on title + album (case-insensitive).
//   - When album is absent/empty: match on title alone.
// Throws if the song is already present in the user's repertoire.
export async function createAndAddSong(data: {
  title: string
  artist: string
  album?: string
  standard_key?: string
  cover_url?: string
  duration_seconds?: number
  links?: SongLink[]
}): Promise<UserRepertoire> {
  const supabase = createClient()

  // Resolve the current user so we can set contributor_id, satisfying the RLS
  // INSERT policy that requires contributor_id = auth.uid().
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    logger.error('Cannot create a song: user is not authenticated')
    throw new Error('Cannot create a song: user is not authenticated')
  }

  // --- Step 1: find-or-create the global song ---
  let songId: string

  const albumValue = data.album?.trim() ?? ''

  let lookupQuery = supabase
    .from('global_songs')
    .select('id')
    .ilike('title', data.title)

  if (albumValue) {
    lookupQuery = lookupQuery.ilike('album', albumValue)
  }

  const { data: existing, error: lookupError } = await lookupQuery.maybeSingle()

  if (lookupError) {
    logger.error('Failed to look up global song', new Error(lookupError.message), { code: lookupError.code })
    throw new Error(`Failed to look up global song: ${lookupError.message}`)
  }

  if (existing) {
    songId = existing.id
  } else {
    const { data: globalSong, error: songError } = await supabase
      .from('global_songs')
      .insert({
        contributor_id: user.id,
        title: data.title,
        artist: data.artist,
        album: albumValue || null,
        standard_key: data.standard_key ?? null,
        cover_url: data.cover_url ?? null,
        duration_seconds: data.duration_seconds ?? null,
        links: data.links ?? [],
      })
      .select('id')
      .single()

    if (songError) {
      logger.error('Failed to create global song', new Error(songError.message), { code: songError.code })
      throw new Error(`Failed to create global song: ${songError.message}`)
    }

    songId = globalSong.id
  }

  // --- Step 2: guard against duplicate repertoire entries ---
  const { data: existingEntry, error: entryLookupError } = await supabase
    .from('user_repertoire')
    .select('id')
    .eq('user_id', user.id)
    .eq('song_id', songId)
    .maybeSingle()

  if (entryLookupError) {
    logger.error('Failed to check existing repertoire entry', new Error(entryLookupError.message), { code: entryLookupError.code, songId })
    throw new Error(`Failed to check existing repertoire entry: ${entryLookupError.message}`)
  }

  if (existingEntry) {
    throw new Error('Song already in your repertoire')
  }

  // --- Step 3: add to the user's repertoire ---
  const { data: repertoireEntry, error: repertoireError } = await supabase
    .from('user_repertoire')
    .insert({ song_id: songId, user_id: user.id, status: 'unknown' as SongStatus })
    .select('*, song:global_songs(*)')
    .single()

  if (repertoireError) {
    logger.error('Song created but failed to add to repertoire', new Error(repertoireError.message), { code: repertoireError.code, songId })
    throw new Error(
      `Song created but failed to add to repertoire: ${repertoireError.message}`
    )
  }

  return repertoireEntry as UserRepertoire
}
