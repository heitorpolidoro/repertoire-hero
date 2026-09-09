import { query } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * RH-63 — is this user connected to Spotify at all?
 *
 * A deliberate row-existence check rather than the token helper in
 * `@/lib/spotifyAuth`, which refreshes a near-expiry token over HTTP against
 * Spotify's accounts host: the server render of `/playlists` must never block
 * on that round trip for a flag that only enables a tab and one sentence of
 * empty-state copy.
 *
 * It also degrades to `false` instead of following the L1 log-then-throw of the
 * rest of `src/lib`, because it replaces the client's
 * `catch { setSpotifyConnected(false) }`: an unreachable `spotify_tokens` table
 * must not turn a page whose main content does not depend on Spotify into a 500
 * document.
 */
export async function hasSpotifyConnection(userId: string): Promise<boolean> {
  try {
    const res = await query<{ one: number }>(
      'SELECT 1 AS one FROM spotify_tokens WHERE user_id = $1 LIMIT 1',
      [userId],
    )
    return (res.rowCount ?? 0) > 0
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to check the Spotify connection', err, { userId })
    return false
  }
}
