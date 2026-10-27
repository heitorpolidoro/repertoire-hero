/**
 * RH-187: PUT /api/v1/songs/[versionId]/custom-fields/[fieldName]
 * Sets a custom field value for a version. Accepts unheld versions.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withApiAuth, jsonError } from '@/lib/apiAuth'
import { listCustomFields, setCustomFieldValue } from '@/lib/customFields'
import { findSongVersion } from '@/lib/apiSongs'

export const PUT = withApiAuth<{ versionId: string; fieldName: string }>(
  'write:songs',
  async (request: NextRequest, { userId, params }) => {
    const { versionId, fieldName } = await params
    const versionRow = await findSongVersion(versionId)
    if (!versionRow) {
      return jsonError('Song version not found', 404)
    }

    const fields = await listCustomFields(userId)
    const field = fields.find((f) => f.name.toLowerCase() === fieldName.toLowerCase())
    if (!field) {
      return jsonError('Custom field not found', 404)
    }

    let body: { value?: unknown }
    try {
      body = (await request.json()) as { value?: unknown }
    } catch {
      return jsonError('Invalid JSON body', 400)
    }

    if (!body || typeof body !== 'object' || typeof body.value !== 'string') {
      return jsonError('Invalid value', 400)
    }

    const value = body.value

    try {
      const storedValue = await setCustomFieldValue(userId, field.id, versionId, value)
      return NextResponse.json({
        field: field.name,
        value: storedValue,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid value'
      return jsonError(message, 400)
    }
  },
)
