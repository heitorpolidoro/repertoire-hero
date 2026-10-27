/**
 * RH-187: GET /api/v1/songs/[versionId]
 * Returns song details for any existing version, held or not.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withApiAuth, jsonError } from '@/lib/apiAuth'
import { getResolvedEntryForVersion } from '@/lib/ownerSongs'
import { getCustomFieldValues } from '@/lib/customFields'
import { findSongVersion, type ApiSongDetail } from '@/lib/apiSongs'

export const GET = withApiAuth<{ versionId: string }>(
  'read',
  async (_request: NextRequest, { userId, params }) => {
    const { versionId } = await params
    const versionRow = await findSongVersion(versionId)
    if (!versionRow) {
      return jsonError('Song version not found', 404)
    }

    const entry = await getResolvedEntryForVersion({ userId }, versionId)
    const customFields = await getCustomFieldValues(userId, versionId)

    const detail: ApiSongDetail = {
      versionId: entry.version_id,
      songId: entry.song_id,
      title: entry.song?.title ?? '',
      artist: entry.song?.artist ?? null,
      inRepertoire: entry.ownerRowId !== null,
      status: entry.ownerRowId !== null ? entry.status : null,
      key: entry.key,
      tuning: entry.tuning,
      customFields: customFields.map((f) => ({ name: f.name, value: f.value })),
    }
    return NextResponse.json(detail)
  },
)
