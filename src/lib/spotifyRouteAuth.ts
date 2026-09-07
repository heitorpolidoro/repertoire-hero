/**
 * Shared prologue for the `/api/spotify/playlists/[id]/*` route handlers:
 * resolve the session, then the Spotify access token, answering the same two
 * 401s the routes used to write out themselves.
 *
 * `/api/spotify/playlists/route.ts` is deliberately NOT a caller: it answers
 * `{ connected: false }` instead of a 401.
 *
 * Authentication is only half of the prologue. `resolveOwnedPlaylist()` and
 * `resolveBandOwnership()` below answer the second question — may *this*
 * caller act on *this* resource — by delegating to the same domain predicates
 * the Server Actions use (`assertPlaylistAccess`, `assertBandMember`), so the
 * ownership rule lives in exactly one place per resource.
 *
 * `[id]` is not the same kind of id in all three routes, which is why they do
 * not all get a guard:
 *   - `sync`   — `[id]` is a local `playlists.id`: guarded by
 *                `resolveOwnedPlaylist()`.
 *   - `import` — `[id]` is a Spotify playlist id and no local playlist exists
 *                yet; what needs authorizing is the `band_id` in the request
 *                body: guarded by `resolveBandOwnership()`.
 *   - `tracks` — `[id]` is a Spotify playlist id forwarded with the caller's
 *                own access token, so there is no local row to own and nothing
 *                to guard. See that route's header comment.
 */

import { NextResponse } from 'next/server'
import { getRequiredUserId } from '@/lib/auth-session'
import { getSpotifyAccessToken } from '@/lib/spotifyAuth'
import { assertPlaylistAccess } from '@/lib/playlists'
import { assertBandMember } from '@/lib/bands'
import { logger } from '@/lib/logger'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Every refusal answers 404, never 403: `assertPlaylistAccess` deliberately
 * throws the same message for a foreign row and for a missing one, so
 * distinguishing them at the HTTP layer would put the existence leak back.
 */
function notFound(resource: 'Playlist' | 'Band'): NextResponse {
  return NextResponse.json({ error: `${resource} not found`, code: 404 }, { status: 404 })
}

function guardFailed(): NextResponse {
  return NextResponse.json(
    { error: 'Unexpected error authorizing this request', code: 500 },
    { status: 500 }
  )
}

export type SpotifyRouteAccess =
  | { ok: true; userId: string; accessToken: string }
  | { ok: false; response: NextResponse }

export async function resolveSpotifyRouteAccess(): Promise<SpotifyRouteAccess> {
  let userId: string
  try {
    userId = await getRequiredUserId()
  } catch {
    // No session — the caller has nothing to log; the 401 is the whole answer.
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized', code: 401 }, { status: 401 }),
    }
  }

  const accessToken = await getSpotifyAccessToken(userId)

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Spotify not connected', code: 401 },
        { status: 401 }
      ),
    }
  }

  return { ok: true, userId, accessToken }
}

/**
 * The one place the two guards below differ is the domain predicate they run
 * and the noun in the refusal body; everything else — the pre-flight id shape
 * check, the "Access denied means 404" rule, the log-and-500 fallback — is the
 * same decision table, so it is written once.
 *
 * A malformed id is refused before the predicate runs: it cannot name a row
 * the caller may reach, and letting it through would surface as a Postgres
 * `22P02` 500, which would tell an attacker "well-formed but not yours" apart
 * from "not an id at all".
 */
async function guardResource<T>(
  id: string,
  resource: 'Playlist' | 'Band',
  authorize: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  if (!UUID_RE.test(id)) return { ok: false, response: notFound(resource) }

  try {
    return { ok: true, value: await authorize() }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    // The domain predicates raise this exact prefix for "no such row, or not
    // yours" (convention L1a) — that is a refusal, not a failure.
    if (err.message.startsWith('Access denied')) {
      return { ok: false, response: notFound(resource) }
    }
    logger.error('[spotify/playlists/authz]', err, { id, resource })
    return { ok: false, response: guardFailed() }
  }
}

export type PlaylistRouteAccess =
  | { ok: true; playlist: { id: string; user_id: string | null; band_id: string | null } }
  | { ok: false; response: NextResponse }

/**
 * Resolves a **local** `playlists.id` to the row, only if `userId` owns it or
 * is a member of the band that does. Returns the row so the caller does not
 * have to read it a second time.
 */
export async function resolveOwnedPlaylist(
  localPlaylistId: string,
  userId: string
): Promise<PlaylistRouteAccess> {
  const result = await guardResource(localPlaylistId, 'Playlist', () =>
    assertPlaylistAccess(localPlaylistId, userId)
  )
  return result.ok ? { ok: true, playlist: result.value } : result
}

export type BandRouteAccess = { ok: true } | { ok: false; response: NextResponse }

/** Confirms `userId` is a member of `bandId` before anything is created for it. */
export async function resolveBandOwnership(
  bandId: string,
  userId: string
): Promise<BandRouteAccess> {
  const result = await guardResource(bandId, 'Band', () => assertBandMember(bandId, userId))
  return result.ok ? { ok: true } : result
}
