import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL || process.env.BETTER_AUTH_DATABASE_URL

if (!connectionString && process.env.NODE_ENV !== 'production') {
  console.warn('Warning: Neither DATABASE_URL nor BETTER_AUTH_DATABASE_URL is set.')
}

export const pool = new Pool({
  connectionString: connectionString || undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = any>(text: string, params?: any[]) {
  return pool.query<T>(text, params)
}
