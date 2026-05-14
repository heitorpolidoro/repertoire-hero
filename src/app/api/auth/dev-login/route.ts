import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * GET /api/auth/dev-login
 *
 * Development-only convenience endpoint. Signs in with the credentials stored
 * in NEXT_PUBLIC_DEV_USER_EMAIL / NEXT_PUBLIC_DEV_USER_PASSWORD and redirects
 * to the original destination (or / if none was provided).
 *
 * The route is a no-op (404) when NEXT_PUBLIC_AUTO_LOGIN is not 'true'.
 */
export async function GET(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_AUTO_LOGIN !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const email = process.env.NEXT_PUBLIC_DEV_USER_EMAIL
  const password = process.env.NEXT_PUBLIC_DEV_USER_PASSWORD

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Dev credentials are not configured' },
      { status: 500 }
    )
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return NextResponse.json(
      { error: `Auto-login failed: ${error.message}` },
      { status: 401 }
    )
  }

  // Redirect to the original destination supplied by the middleware, or /.
  // Validate that `next` is a relative path to prevent open-redirect abuse.
  const rawNext = request.nextUrl.searchParams.get('next') ?? '/'
  const safeNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'
  const redirectUrl = request.nextUrl.clone()
  redirectUrl.pathname = safeNext
  redirectUrl.search = ''

  return NextResponse.redirect(redirectUrl)
}
