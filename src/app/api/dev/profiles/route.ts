import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/dev/profiles
 *
 * Development-only endpoint. Returns all user profiles (id, email, full_name)
 * to power the Dev Fast Login section on the login page.
 *
 * Returns 404 in production.
 * Requires SUPABASE_SERVICE_ROLE_KEY to bypass RLS.
 */
export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .order('full_name')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data ?? [])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
