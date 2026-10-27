/**
 * RH-187: POST /api/v1/tabs
 * Uploads a local PDF tab file attached to a version.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withApiAuth, jsonError } from '@/lib/apiAuth'
import { uploadTabForUser } from '@/lib/tabUpload'
import { findSongVersion } from '@/lib/apiSongs'

export const POST = withApiAuth('write:tabs', async (request: NextRequest, { userId }) => {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonError('Invalid form data', 400)
  }

  const versionId = formData.get('versionId')
  const title = formData.get('title')
  const file = formData.get('file')

  if (
    typeof versionId !== 'string' ||
    !versionId ||
    typeof title !== 'string' ||
    !title ||
    !(file instanceof File)
  ) {
    return jsonError('Missing required fields', 400)
  }

  const versionRow = await findSongVersion(versionId)
  if (!versionRow) {
    return jsonError('Song version not found', 404)
  }

  const result = await uploadTabForUser({
    userId,
    songId: versionRow.songId,
    title,
    file,
  })

  if (result.error) {
    return jsonError(result.error, 400)
  }

  if (!result.data) {
    return jsonError('Upload failed', 500)
  }

  return NextResponse.json(
    {
      id: result.data.id,
      title: result.data.title,
      contentType: result.data.content_type,
      createdInRepertoire: Boolean(result.entry),
    },
    { status: 201 },
  )
})
