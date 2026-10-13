import { parseDurationInput } from '@/lib/catalogFields'
import type { SongLink, SongStatus } from '@/types/database'

/**
 * RH-152 - the dashboard's manual-entry draft and the one payload it builds.
 *
 * `title` is `null` until the musician types in the field: while it is `null`
 * the panel follows the search box, which is what "pre-filled from the query"
 * means without an effect copying one string into another.
 */
export interface ManualDraft {
  title: string | null
  artist: string
  album: string
  status: SongStatus
  key: string
  duration: string
  cover: string
  links: Array<SongLink & { id?: string }>
}

export const EMPTY_MANUAL_DRAFT: ManualDraft = {
  title: null,
  artist: '',
  album: '',
  status: 'unknown',
  key: '',
  duration: '',
  cover: '',
  links: [],
}

/** The catalog song a title and artist already identify (`findSongByIdentity`). */
export interface CatalogSongMatch {
  id: string
  title: string
  artist: string
}

/** What `createAndAddSong` takes; empty optional fields are left out. */
export interface ManualEntryInput {
  title: string
  artist: string
  album?: string
  standard_key?: string
  cover_url?: string
  duration_seconds?: number
  links?: SongLink[]
}

/** The draft's title as shown: the typed one, else the search query. */
export function draftTitle(draft: ManualDraft, query: string): string {
  return draft.title ?? query
}

/** The create payload, or `null` while the title or the artist is blank. */
export function manualEntryInput(draft: ManualDraft, query: string): ManualEntryInput | null {
  const title = draftTitle(draft, query).trim()
  const artist = draft.artist.trim()
  if (!title || !artist) return null

  const links = draft.links.filter((l) => l.url.trim()).map(({ label, url }) => ({ label, url }))
  const duration = parseDurationInput(draft.duration)
  return {
    title,
    artist,
    ...(draft.album.trim() && { album: draft.album.trim() }),
    ...(draft.key.trim() && { standard_key: draft.key.trim() }),
    ...(draft.cover.trim() && { cover_url: draft.cover.trim() }),
    ...(duration !== null && { duration_seconds: duration }),
    ...(links.length > 0 && { links }),
  }
}
