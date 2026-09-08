/**
 * RH-55 (RH-25 F17) — the only sanctioned way to read a moderation edit's
 * `proposed_data`.
 *
 * A `global_song_edits` row holds whatever the requester submitted, so its
 * fields must be narrowed before they reach the `global_songs` UPDATE. This
 * module owns that narrowing for the seven mutable catalog columns: it accepts
 * a subset of them, normalizes each one the way the catalog stores it, and
 * throws a message the UI can show verbatim otherwise.
 *
 * Keys that are not `global_songs` columns are ignored rather than rejected
 * (`src/components/songs/CorrectionModal.tsx` sends a `reason` alongside the
 * proposed columns, and the admin queue renders it), and they never appear in
 * the returned payload.
 */
import { sanitizeSongTitle, sanitizeAlbumName } from '@/lib/songSanitizer'
import type { SongLink } from '@/types/database'

export interface GlobalSongEditPayload {
  title?: string
  artist?: string
  album?: string | null
  standard_key?: string | null
  cover_url?: string | null
  duration_seconds?: number | null
  links?: SongLink[]
}

const PREFIX = 'Invalid global song edit'
const HTTP_URL = /^https?:\/\/\S+$/i

function parseTitle(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '') {
    const sanitized = sanitizeSongTitle(value.trim())
    if (sanitized !== '') return sanitized
  }
  throw new Error(`${PREFIX}: title must be a non-empty string`)
}

function parseArtist(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  throw new Error(`${PREFIX}: artist must be a non-empty string`)
}

function parseAlbum(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string') return sanitizeAlbumName(value.trim())
  throw new Error(`${PREFIX}: album must be a string or null`)
}

function parseStandardKey(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value.trim() || null
  throw new Error(`${PREFIX}: standard_key must be a string or null`)
}

function parseCoverUrl(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (HTTP_URL.test(trimmed)) return trimmed
  }
  throw new Error(`${PREFIX}: cover_url must be null or an http(s) URL`)
}

function parseDurationSeconds(value: unknown): number | null {
  if (value === null) return null
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  throw new Error(`${PREFIX}: duration_seconds must be a non-negative integer or null`)
}

function isSongLink(value: unknown): value is SongLink {
  if (typeof value !== 'object' || value === null) return false
  // Convention E1: a scoped structural cast, never an `any`-typed binding.
  const link = value as { label?: unknown; url?: unknown }
  return typeof link.label === 'string' && typeof link.url === 'string' && HTTP_URL.test(link.url)
}

function parseLinks(value: unknown): SongLink[] {
  if (Array.isArray(value)) {
    const links = value.filter(isSongLink)
    if (links.length === value.length) return links
  }
  throw new Error(`${PREFIX}: links must be an array of {label, url} objects with http(s) urls`)
}

/**
 * Narrows an edit payload to the `global_songs` columns it may propose.
 *
 * Fields are read in column order, so `Object.entries` over the result is
 * deterministic — the approval UPDATE builds its SET list from it.
 *
 * @throws when the payload is not a plain object, proposes no known column, or
 * carries a known column whose value the catalog cannot store.
 */
export function parseGlobalSongEditPayload(data: unknown): GlobalSongEditPayload {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${PREFIX}: payload must be a plain object`)
  }

  const source: Record<string, unknown> = { ...data }
  const payload: GlobalSongEditPayload = {}

  if (source.title !== undefined) payload.title = parseTitle(source.title)
  if (source.artist !== undefined) payload.artist = parseArtist(source.artist)
  if (source.album !== undefined) payload.album = parseAlbum(source.album)
  if (source.standard_key !== undefined) payload.standard_key = parseStandardKey(source.standard_key)
  if (source.cover_url !== undefined) payload.cover_url = parseCoverUrl(source.cover_url)
  if (source.duration_seconds !== undefined) {
    payload.duration_seconds = parseDurationSeconds(source.duration_seconds)
  }
  if (source.links !== undefined) payload.links = parseLinks(source.links)

  if (Object.keys(payload).length === 0) {
    throw new Error(
      `${PREFIX}: at least one of title, artist, album, standard_key, cover_url, duration_seconds, links must be present`
    )
  }

  return payload
}
