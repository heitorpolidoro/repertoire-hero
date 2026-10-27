/**
 * RH-187: PUT /api/v1/songs/[versionId]/tuning
 * Updates tuning override on a version held in user's repertoire.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withApiAuth, jsonError } from '@/lib/apiAuth'
import { getResolvedEntryForVersion, updateSongOverrides } from '@/lib/ownerSongs'
import { normalizeTuning } from '@/lib/songTuning'
import { findSongVersion } from '@/lib/apiSongs'

export const PUT = withApiAuth<{ versionId: string }>(
  'write:songs',
  async (request: NextRequest, { userId, params }) => {
    const { versionId } = await params
    const versionRow = await findSongVersion(versionId)
    if (!versionRow) {
      return jsonError('Song version not found', 404)
    }

    const entry = await getResolvedEntryForVersion({ userId }, versionId)
    if (entry.ownerRowId === null) {
      return jsonError('This song is not in your repertoire', 404)
    }

    let body: { tuning?: unknown }
    try {
      body = (await request.json()) as { tuning?: unknown }
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    if (!body || typeof body !== 'object' || !('tuning' in body)) {
      return jsonError('Missing tuning in request body', 400)
    }

    const rawTuning = body.tuning
    if (rawTuning !== null && typeof rawTuning !== 'string') {
      return jsonError('Invalid tuning value', 400)
    }

    if (typeof rawTuning === 'string' && rawTuning.length > 40) {
      return jsonError('Tuning is at most 40 characters', 400)
    }

    const normalized = typeof rawTuning === 'string' ? normalizeTuning(rawTuning) : null
    await updateSongOverrides({ userId }, entry.ownerRowId, { tuning: normalized })

    return NextResponse.json({ tuning: normalized })
  },
)
