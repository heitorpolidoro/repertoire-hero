import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type { GlobalSong, Repertoire, SongLink, SongStatus } from '@/types/database'

export type RepertoireOwner = { userId: string } | { bandId: string }

export async function getRepertoire(owner: RepertoireOwner): Promise<Repertoire[]> {
  const supabase = createAdminClient()
  const query = supabase.from('repertoire').select('*, song:global_songs(*)')
  const filtered = 'bandId' in owner
    ? query.eq('band_id', owner.bandId)
    : query.eq('user_id', owner.userId)
  const { data, error } = await filtered.order('id', { ascending: false })
  if (error) {
    logger.error('Failed to fetch repertoire', new Error(error.message), { code: error.code })
    throw new Error(`Failed to fetch repertoire: ${error.message}`)
  }
  return data as Repertoire[]
}

export async function addSongToRepertoire(owner: RepertoireOwner, songId: string): Promise<Repertoire> {
  const supabase = createAdminClient()
  const q = supabase.from('repertoire')
  const inserted = 'bandId' in owner
    ? q.insert({ song_id: songId, band_id: owner.bandId, status: 'unknown' as SongStatus })
    : q.insert({ song_id: songId, user_id: owner.userId, status: 'unknown' as SongStatus })
  const { data, error } = await inserted.select('*, song:global_songs(*)').single()
  if (error) {
    logger.error('Failed to add song to repertoire', new Error(error.message), { code: error.code })
    throw new Error(`Failed to add song to repertoire: ${error.message}`)
  }
  return data as Repertoire
}

export async function updateSongStatus(owner: RepertoireOwner, repertoireId: string, status: SongStatus): Promise<void> {
  const supabase = createAdminClient()
  const q = supabase.from('repertoire').update({ status }).eq('id', repertoireId)
  const { data, error } = await ('bandId' in owner ? q.eq('band_id', owner.bandId) : q.eq('user_id', owner.userId)).select('id')
  if (error) {
    logger.error('Failed to update song status', new Error(error.message), { code: error.code, repertoireId, status })
    throw new Error(`Failed to update song status: ${error.message}`)
  }
  if (!data || data.length === 0) throw new Error('Repertoire entry not found or access denied')
}

export async function updateSongTags(owner: RepertoireOwner, repertoireId: string, tags: string[]): Promise<void> {
  const supabase = createAdminClient()
  const q = supabase.from('repertoire').update({ tags }).eq('id', repertoireId)
  const { data, error } = await ('bandId' in owner ? q.eq('band_id', owner.bandId) : q.eq('user_id', owner.userId)).select('id')
  if (error) {
    logger.error('Failed to update song tags', new Error(error.message), { code: error.code, repertoireId })
    throw new Error(`Failed to update song tags: ${error.message}`)
  }
  if (!data || data.length === 0) throw new Error('Repertoire entry not found or access denied')
}

export async function updatePersonalKey(owner: RepertoireOwner, repertoireId: string, personalKey: string): Promise<void> {
  const supabase = createAdminClient()
  const q = supabase.from('repertoire').update({ personal_key: personalKey }).eq('id', repertoireId)
  const { data, error } = await ('bandId' in owner ? q.eq('band_id', owner.bandId) : q.eq('user_id', owner.userId)).select('id')
  if (error) {
    logger.error('Failed to update personal key', new Error(error.message), { code: error.code, repertoireId })
    throw new Error(`Failed to update personal key: ${error.message}`)
  }
  if (!data || data.length === 0) throw new Error('Repertoire entry not found or access denied')
}

export async function removeSongFromRepertoire(owner: RepertoireOwner, repertoireId: string): Promise<void> {
  const supabase = createAdminClient()
  const q = supabase.from('repertoire').delete().eq('id', repertoireId)
  const { data, error } = await ('bandId' in owner ? q.eq('band_id', owner.bandId) : q.eq('user_id', owner.userId)).select('id')
  if (error) {
    logger.error('Failed to remove song from repertoire', new Error(error.message), { code: error.code, repertoireId })
    throw new Error(`Failed to remove song from repertoire: ${error.message}`)
  }
  if (!data || data.length === 0) throw new Error('Repertoire entry not found or access denied')
}

export async function searchGlobalSongs(query: string): Promise<GlobalSong[]> {
  const supabase = createAdminClient()
  const trimmed = query.trim()
  if (!trimmed) return []
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

export async function getSongEntry(owner: RepertoireOwner, repertoireId: string): Promise<Repertoire | null> {
  const supabase = createAdminClient()
  const q = supabase.from('repertoire').select('*, song:global_songs(*)').eq('id', repertoireId)
  const { data, error } = await ('bandId' in owner ? q.eq('band_id', owner.bandId) : q.eq('user_id', owner.userId)).single()
  if (error) {
    if (error.code === 'PGRST116') return null
    logger.error('Failed to fetch song entry', new Error(error.message), { code: error.code, repertoireId })
    throw new Error(`Failed to fetch song entry: ${error.message}`)
  }
  return data as Repertoire
}

export async function updateSong(
  owner: RepertoireOwner,
  entry: Repertoire,
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
  const supabase = createAdminClient()
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
  const updateQ = supabase.from('repertoire')
    .update({ status: data.status, tags: data.tags, personal_key: data.key })
    .eq('id', entry.id)
  const { error: repertoireError } = await ('bandId' in owner ? updateQ.eq('band_id', owner.bandId) : updateQ.eq('user_id', owner.userId))
  if (repertoireError) {
    logger.error('Failed to update repertoire entry', new Error(repertoireError.message), { code: repertoireError.code, repertoireId: entry.id })
    throw new Error(`Failed to update repertoire entry: ${repertoireError.message}`)
  }
}

export async function createAndAddSong(
  owner: RepertoireOwner,
  data: {
    title: string
    artist: string
    album?: string
    standard_key?: string
    cover_url?: string
    duration_seconds?: number
    links?: SongLink[]
  }
): Promise<Repertoire> {
  const supabase = createAdminClient()
  const albumValue = data.album?.trim() ?? ''

  let lookupQuery = supabase.from('global_songs').select('id').ilike('title', data.title)
  if (albumValue) lookupQuery = lookupQuery.ilike('album', albumValue)
  const { data: existing, error: lookupError } = await lookupQuery.maybeSingle()
  if (lookupError) {
    logger.error('Failed to look up global song', new Error(lookupError.message), { code: lookupError.code })
    throw new Error(`Failed to look up global song: ${lookupError.message}`)
  }

  let songId: string
  if (existing) {
    songId = existing.id
  } else {
    const { data: globalSong, error: songError } = await supabase
      .from('global_songs')
      .insert({
        contributor_id: 'userId' in owner ? owner.userId : null,
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

  const checkQ = supabase.from('repertoire').select('id').eq('song_id', songId)
  const { data: existingEntry, error: entryLookupError } = await (
    'bandId' in owner ? checkQ.eq('band_id', owner.bandId) : checkQ.eq('user_id', owner.userId)
  ).maybeSingle()
  if (entryLookupError) {
    logger.error('Failed to check existing repertoire entry', new Error(entryLookupError.message), { code: entryLookupError.code, songId })
    throw new Error(`Failed to check existing repertoire entry: ${entryLookupError.message}`)
  }
  if (existingEntry) throw new Error('Song already in your repertoire')

  const q2 = supabase.from('repertoire')
  const inserted2 = 'bandId' in owner
    ? q2.insert({ song_id: songId, band_id: owner.bandId, status: 'unknown' as SongStatus })
    : q2.insert({ song_id: songId, user_id: owner.userId, status: 'unknown' as SongStatus })
  const { data: repertoireEntry, error: repertoireError } = await inserted2
    .select('*, song:global_songs(*)')
    .single()
  if (repertoireError) {
    logger.error('Song created but failed to add to repertoire', new Error(repertoireError.message), { code: repertoireError.code, songId })
    throw new Error(`Song created but failed to add to repertoire: ${repertoireError.message}`)
  }
  return repertoireEntry as Repertoire
}
