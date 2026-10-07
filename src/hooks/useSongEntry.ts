import { useCallback, useEffect, useState } from 'react'
import { logger } from '@/lib/logger'
import {
  shouldLoadPersonalEntry,
  songIdentity,
  withLyrics,
  withSongLinks,
  withStatus,
  type SongEntryController,
} from '@/lib/songEntry'
import type { Repertoire, ResolvedSongEntry, SongLink, SongStatus } from '@/types/database'

/**
 * The entry Server Actions the controller calls. Injected rather than imported,
 * so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted — a default would have to import that tree.
 */
export interface SongEntryActions {
  /**
   * The route's entry, resolved for `(owner, version)` (RH-132).
   *
   * Online it never answers `null` and throws for a version that does not
   * exist; the offline-first wrapper *can* answer `null`, meaning "this song is
   * in no downloaded playlist", which is what the not-found branch below
   * absorbs.
   */
  getResolvedEntryForVersion: (
    versionId: string,
    bandId: string | null,
  ) => Promise<ResolvedSongEntry | null>
  /** Song-keyed, not version-keyed — RH-132 §3a says why it stays that way. */
  getPersonalEntryForSong: (songId: string) => Promise<Repertoire | null>
}

export interface UseSongEntryOptions {
  /** The route's `song_versions.id`, i.e. `useParams().versionId` (RH-132). */
  versionId: string
  /** From the page's `useSearchParams().get('bandId')` — F26. */
  bandId: string | null
  /** Required, never defaulted — see `src/app/fastViewEntryActions.ts` (F21). */
  actions: SongEntryActions
}

/**
 * Fast View's song-entry controller: it owns the route entry's load, the
 * not-found state, the band-context reconciliation that fetches the member's
 * own row in the background, and the five in-place patches the other
 * controllers issue when a write succeeds (status, links, both lyrics texts and
 * the personal entry another controller created).
 *
 * The decisions themselves live in `@/lib/songEntry` and are unit-tested
 * without React; what is left here is the state, the one effect and the wiring
 * to the injected actions (RH-52).
 *
 * The dependency array carries `bandId`, which the page derives from
 * `useSearchParams()`: a navigation that changes only `?bandId=` refetches
 * (F26).
 *
 * Since RH-132 the route entry is a `ResolvedSongEntry` read by
 * `(versionId, bandId)`, so a version whose owner holds no row resolves to a
 * readable page with `ownerRowId: null` instead of a not-found. The personal
 * read below is unchanged and still keyed by `data.song_id`.
 */
export function useSongEntry({
  versionId,
  bandId,
  actions,
}: UseSongEntryOptions): SongEntryController {
  const [entry, setEntry] = useState<ResolvedSongEntry | null>(null)
  const [personalEntry, setPersonalEntry] = useState<Repertoire | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingPersonal, setLoadingPersonal] = useState(false)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const data = await actions.getResolvedEntryForVersion(versionId, bandId)
        if (cancelled) return
        if (!data) {
          setNotFound(true)
          return
        }
        setEntry(data)

        // In band context the member's own row carries their tabs and lyrics;
        // it is optional chrome, so it loads in the background and a failure
        // never hides the band entry that is already on screen.
        if (shouldLoadPersonalEntry(bandId, data.song_id)) {
          setLoadingPersonal(true)
          actions
            .getPersonalEntryForSong(data.song_id)
            .then((personal) => {
              if (personal && !cancelled) setPersonalEntry(personal)
            })
            .catch((error) => {
              logger.error(
                'Failed to load personal entry',
                error instanceof Error ? error : new Error(String(error)),
              )
            })
            .finally(() => {
              if (!cancelled) setLoadingPersonal(false)
            })
        }
      } catch {
        // Any read failure — missing row, revoked access, network — lands the
        // musician on the same "Song not found" screen.
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [actions, bandId, versionId])

  const applyStatus = useCallback(
    (status: SongStatus) => setEntry((prev) => withStatus(prev, status)),
    [],
  )

  const applyLinks = useCallback(
    (links: SongLink[]) => setEntry((prev) => withSongLinks(prev, links)),
    [],
  )

  const applyEntryLyrics = useCallback(
    (lyrics: string) => setEntry((prev) => withLyrics(prev, lyrics)),
    [],
  )

  const applyPersonalLyrics = useCallback(
    (lyrics: string) => setPersonalEntry((prev) => withLyrics(prev, lyrics)),
    [],
  )

  return {
    entry,
    personalEntry,
    loading,
    loadingPersonal,
    notFound,
    identity: songIdentity(entry),
    // The page's `?bandId=`, not a field of the entry: `ResolvedSongEntry`
    // carries no `band_id`, and this option is the parameter the owner was
    // resolved from in the first place (RH-132 §3a).
    entryBandId: bandId,
    songId: entry?.song_id ?? null,
    personalRepertoireId: personalEntry?.id ?? null,
    ownerRowId: entry?.ownerRowId ?? null,
    adoptPersonalEntry: setPersonalEntry,
    applyStatus,
    applyLinks,
    applyEntryLyrics,
    applyPersonalLyrics,
  }
}
