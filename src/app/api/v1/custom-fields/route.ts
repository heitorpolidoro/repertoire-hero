/**
 * RH-187: GET /api/v1/custom-fields
 * Returns the user's custom fields in position order.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withApiAuth } from '@/lib/apiAuth'
import { listCustomFields } from '@/lib/customFields'

export const GET = withApiAuth('read', async (_request: NextRequest, { userId }) => {
  const fields = await listCustomFields(userId)
  return NextResponse.json(fields.map((f) => ({ name: f.name })))
})
