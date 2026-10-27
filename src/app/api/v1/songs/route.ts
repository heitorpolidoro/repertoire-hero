/**
 * RH-187: GET /api/v1/songs
 * Returns personal repertoire filtered by `q`, at most 50 items.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withApiAuth } from '@/lib/apiAuth'
import { getRepertoire } from '@/lib/ownerSongs'
import { filterApiRepertoire } from '@/lib/apiSongs'

export const GET = withApiAuth('read', async (request: NextRequest, { userId }) => {
  const q = request.nextUrl.searchParams.get('q')
  const repertoire = await getRepertoire({ userId })
  const items = filterApiRepertoire(repertoire, q)
  return NextResponse.json(items)
})
