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
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/** Points the mocked session at one user for the next action call. */
export function asUser(userId: string): void {
  vi.mocked(getRequiredUserId).mockResolvedValue(userId)
}

/** Runs a `count(*)::int AS count` query and returns the number. */
export async function countRows(sql: string, params: unknown[]): Promise<number> {
  const res = await query<{ count: number }>(sql, params as never)
  return res.rows[0].count
}

/** Inserts a global song with the given links and returns its id. */
export async function createTestSong(title: string, links: unknown[] = []): Promise<string> {
  const res = await query(
    'INSERT INTO global_songs (title, artist, links) VALUES ($1, $2, $3::jsonb) RETURNING id',
    [title, 'RH-34 Artist', JSON.stringify(links)],
  )
  return res.rows[0].id as string
}
