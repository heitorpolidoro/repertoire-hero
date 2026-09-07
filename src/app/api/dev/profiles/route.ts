import { NextResponse } from 'next/server'
import { listDevProfiles } from '@/lib/devProfiles'
import { logger } from '@/lib/logger'

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
    return NextResponse.json(await listDevProfiles())
  } catch (error) {
    logger.error('[dev/profiles]', error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Unexpected error listing dev profiles', code: 500 },
      { status: 500 },
    )
  }
}
