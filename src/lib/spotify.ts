export interface SpotifyTrack {
  id: string
  title: string
  artist: string
  album: string | null
  spotifyUrl: string
  previewUrl: string | null
  albumArt: string | null
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
