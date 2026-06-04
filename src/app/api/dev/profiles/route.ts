import { NextResponse } from 'next/server'
import { Pool } from 'pg'

export const dynamic = 'force-dynamic'

/**
 * GET /api/dev/profiles
 *
 * Development-only endpoint. Returns all users from the Better Auth "user"
 * table to power the Dev Fast Login section on the login page.
 *
 * Returns 404 in production.
 */
export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    const { rows } = await pool.query<{ id: string; email: string; name: string | null }>(
      `SELECT id, email, name FROM "user" ORDER BY name`
    )
    await pool.end()

    return NextResponse.json(
      rows.map((r) => ({ id: r.id, email: r.email, full_name: r.name }))
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
