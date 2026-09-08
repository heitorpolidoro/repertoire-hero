import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'

const connectionString = process.env.DATABASE_URL || process.env.BETTER_AUTH_DATABASE_URL

if (!connectionString && process.env.NODE_ENV !== 'production') {
  console.warn('Warning: Neither DATABASE_URL nor BETTER_AUTH_DATABASE_URL is set.')
}

const globalForDb = global as unknown as { pool?: Pool }

export const pool = globalForDb.pool ?? new Pool({
  connectionString: connectionString || undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool
}

/**
 * The default row shape: a bare record whose values are `unknown`, not `any`.
 * A caller that names no type argument therefore has to prove what it reads,
 * instead of silently getting `any` back from `@types/pg`'s `QueryResultRow`
 * index signature (RH-54 / RH-25 F16).
 */
export type DbRow = Record<string, unknown>

export async function query<T extends QueryResultRow = DbRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
  return pool.query<T>(text, params)
}

/**
 * Anything that can run a parameterized statement: the pool itself, or one
 * client checked out of it inside `withTransaction`. A helper that takes a
 * `Queryable` works both standalone and as part of a caller's transaction.
 */
export interface Queryable {
  query<T extends QueryResultRow = DbRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>
}

/**
 * Runs `fn` inside a real transaction on a single pooled client: `BEGIN`, the
 * callback, `COMMIT`. When the callback throws, the transaction is rolled back
 * and the original error is rethrown unwrapped, so the caller's own L1
 * log-then-wrap still produces the message it always did.
 *
 * `query()` is `pool.query()` — it hands back an arbitrary idle connection per
 * call, so transaction control issued through it lands on connections that
 * never saw the `BEGIN`. Every multi-statement write that must be atomic goes
 * through here instead (see AGENTS.md, "Transactions").
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // The connection is already unusable; release() below discards it, and
      // the original error is the one worth propagating.
    }
    throw error
  } finally {
    client.release()
  }
}
