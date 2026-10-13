/**
 * RH-151 — the parallel catalog + Spotify search both add-song surfaces run
 * (the playlist picker and the dashboard), as one function.
 *
 * Each half failing to `[]` is what makes a Spotify outage a complete
 * catalog-only list rather than an empty panel, and the reverse; both halves go
 * through one `mergeSongSearchResults`, because merging each source separately
 * and concatenating would reproduce the RH-108 defect.
 */

import { searchSpotify, type SpotifyTrack } from '@/lib/spotify'
import { mergeSongSearchResults, type SongSearchRow } from '@/lib/songSearchMerge'
import type { CatalogSearchResult } from '@/types/database'

/** The merged rows for `query`; neither half can reject. */
export async function searchMergedRows(
  searchCatalog: (query: string) => Promise<CatalogSearchResult[]>,
  query: string,
): Promise<SongSearchRow[]> {
  const [catalog, spotify] = await Promise.all([
    searchCatalog(query).catch(() => [] as CatalogSearchResult[]),
    searchSpotify(query).catch(() => [] as SpotifyTrack[]),
  ])
  return mergeSongSearchResults(catalog, spotify)
}
