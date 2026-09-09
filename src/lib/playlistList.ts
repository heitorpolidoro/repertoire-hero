import type { Playlist } from '@/types/database'

/**
 * RH-63 — the pure decisions of the `/playlists` list, lifted out of the page
 * when it became a Server Component. Grouping and formatting are data
 * questions, not rendering ones, so they live here and are unit-tested; the
 * islands under `src/components/playlists/` only render what these return.
 */

export interface PlaylistGroup {
  type: 'personal' | 'band'
  bandId?: string
  bandName?: string
  playlists: Playlist[]
}

/**
 * Splits a user-scoped playlist list into `My playlists` plus one section per
 * band, bands sorted by name. A band row with no `name` falls back to its id so
 * a section never renders headerless.
 */
export function buildPlaylistGroups(playlists: Playlist[]): PlaylistGroup[] {
  const personal = playlists.filter(pl => pl.band_id === null)
  const bandMap = new Map<string, { name: string; playlists: Playlist[] }>()
  for (const pl of playlists) {
    if (pl.band_id === null) continue
    const existing = bandMap.get(pl.band_id)
    if (existing) {
      existing.playlists.push(pl)
    } else {
      bandMap.set(pl.band_id, {
        name: pl.band?.name ?? pl.band_id,
        playlists: [pl],
      })
    }
  }
  const bandGroups: PlaylistGroup[] = [...bandMap.entries()]
    .sort(([, infoA], [, infoB]) => infoA.name.localeCompare(infoB.name))
    .map(([bandId, { name, playlists: bandPlaylists }]) => ({
      type: 'band' as const,
      bandId,
      bandName: name,
      playlists: bandPlaylists,
    }))
  const groups: PlaylistGroup[] = []
  if (personal.length > 0) groups.push({ type: 'personal', playlists: personal })
  groups.push(...bandGroups)
  return groups
}

/** In-flight local edits an island applies on top of its server-rendered props. */
export interface PlaylistOverlay {
  /** Ids deleted in this tab; their cards disappear before the refresh lands. */
  removedIds: string[]
  /** Renames issued in this tab, by playlist id. */
  renames: Record<string, string>
}

/**
 * Applies the overlay to the server-read list. The props stay the source of
 * truth — nothing is copied into state — so a `router.refresh()` is visible at
 * once, and an overlay entry the refresh already reflects is simply a no-op.
 */
export function applyPlaylistOverlay(
  playlists: Playlist[],
  overlay: PlaylistOverlay,
): Playlist[] {
  const removed = new Set(overlay.removedIds)
  return playlists
    .filter(pl => !removed.has(pl.id))
    .map(pl => {
      const renamed = overlay.renames[pl.id]
      return renamed === undefined ? pl : { ...pl, name: renamed }
    })
}

/** `h:mm:ss` past an hour, `m:ss` below it. */
export function formatPlaylistDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * Total playing time of a playlist. `getUserPlaylists` projects `songs` as a
 * json aggregate that can be absent or null, so the array check stays.
 */
export function playlistDurationSeconds(playlist: Playlist): number {
  if (!Array.isArray(playlist.songs)) return 0
  return playlist.songs.reduce(
    (sum: number, ps: { song?: { duration_seconds?: number | null } }) =>
      sum + (ps.song?.duration_seconds ?? 0),
    0,
  )
}
