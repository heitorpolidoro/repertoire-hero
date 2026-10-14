/**
 * Shared fixture helpers for the three RH-34 real-database authorization
 * suites (`authzBands`, `authzPlaylists`, `authzRepertoire`). Each suite mocks
 * `@/lib/auth-session` itself — the mock has to be hoisted in the test file —
 * and then drives it through `asUser` from here.
 */

import { vi } from 'vitest'
import { getRequiredUserId } from '@/lib/auth-session'
import { query } from '@/lib/db'

/** The suites are skipped without it, exactly like the `src/lib` DB tests. */
export const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

/** Points the mocked session at one user for the next action call. */
export function asUser(userId: string): void {
  vi.mocked(getRequiredUserId).mockResolvedValue(userId)
}

/** Runs a `count(*)::int AS count` query and returns the number. */
export async function countRows(sql: string, params: unknown[]): Promise<number> {
  const res = await query<{ count: number }>(sql, params as never)
  return res.rows[0].count
}

/**
 * Inserts a global song and returns its id. Links are seeded through
 * `song_links` (one row per link, in the given order), never through the
 * retired `songs.links` column.
 */
export async function createTestSong(title: string, links: unknown[] = []): Promise<string> {
  const res = await query('INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id', [
    title,
    'RH-34 Artist',
  ])
  const songId = res.rows[0].id as string
  for (const [position, link] of (links as { url: string; label?: string }[]).entries()) {
    await query('INSERT INTO song_links (song_id, url, label, position) VALUES ($1, $2, $3, $4)', [
      songId,
      link.url,
      link.label ?? '',
      position,
    ])
  }
  return songId
}
