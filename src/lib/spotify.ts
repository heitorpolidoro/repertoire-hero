/**
 * One track as `/api/spotify/search` projects it. Declared **once** (RH-108):
 * the route used to carry an identical copy, which nothing imported.
 */
export interface SpotifyTrack {
  id: string
  title: string
  artist: string
  album: string | null
  spotifyUrl: string
  previewUrl: string | null
  albumArt: string | null
  /**
   * `albums.album_type`'s Spotify counterpart — `album`, `single` or
   * `compilation` — and the album's release date as Spotify reports it, which
   * may be a `YYYY` or `YYYY-MM` prefix rather than a full date (RH-108).
   *
   * Both are null when Spotify omits them. They exist so a Spotify candidate
   * can be ordered against a catalog one at all: without them every Spotify
   * recording sorts last and the 2001 album can never beat a 2023
   * re-recording that happens to be the only version anyone has added.
   */
  albumType: string | null
  releaseDate: string | null
}

/**
 * Search Spotify for tracks matching `query`.
 *
 * - Returns `[]` when the query is shorter than 2 characters.
 * - Returns `[]` on any network/API error — Spotify is an optional feature.
 */
export async function searchSpotify(query: string): Promise<SpotifyTrack[]> {
  if (query.trim().length < 2) {
    return []
  }

  try {
    const url = `/api/spotify/search?q=${encodeURIComponent(query.trim())}`
    const response = await fetch(url)

    if (!response.ok) {
      return []
    }

    const data = await response.json() as SpotifyTrack[]
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
