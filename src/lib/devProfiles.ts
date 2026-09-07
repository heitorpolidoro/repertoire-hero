import { query } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * Dev tooling data access, kept out of `src/lib/profile.ts` on purpose: this
 * reads Better Auth's `"user"` table, not the app's own `profiles` table, and
 * it exists only to populate the "Dev Fast Login" list on the login page. The
 * `NODE_ENV` guard stays in the route handler, which is where the decision to
 * expose it belongs.
 */

/** The shape the login page consumes; `full_name` mirrors `user.name`. */
export interface DevProfile {
  id: string
  email: string
  full_name: string | null
}

export async function listDevProfiles(): Promise<DevProfile[]> {
  try {
    const res = await query<{ id: string; email: string; name: string | null }>(
      `SELECT id, email, name FROM "user" ORDER BY name`,
    )
    return res.rows.map((r) => ({ id: r.id, email: r.email, full_name: r.name }))
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logger.error('Failed to list dev profiles', err)
    throw new Error(`Failed to list dev profiles: ${err.message}`)
  }
}
