import { auth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/auth/dev-login
 *
 * Development-only convenience endpoint. Signs in with the credentials stored
 * in NEXT_PUBLIC_DEV_USER_EMAIL / NEXT_PUBLIC_DEV_USER_PASSWORD and redirects
 * to the original destination (or / if none was provided).
 *
 * The route is a no-op (404) when NEXT_PUBLIC_AUTO_LOGIN is not 'true'.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (process.env.NEXT_PUBLIC_AUTO_LOGIN !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const email = process.env.NEXT_PUBLIC_DEV_USER_EMAIL
  const password = process.env.NEXT_PUBLIC_DEV_USER_PASSWORD

  if (!email || !password) {
    return NextResponse.json({ error: 'Dev credentials not configured' }, { status: 500 })
  }

  // Validate that `next` is a relative path to prevent open-redirect abuse.
  const rawNext = request.nextUrl.searchParams.get('next') ?? '/'
  const safeNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

  try {
    // Sign in via Better Auth internal API and get a response with Set-Cookie headers
    const signInResponse = await auth.api.signInEmail({
      body: { email, password },
      headers: request.headers,
      asResponse: true,
    })

    if (!signInResponse.ok) {
      return NextResponse.json({ error: 'Dev login failed' }, { status: 401 })
    }

    // Forward the Set-Cookie headers from Better Auth to complete the session
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = safeNext
    redirectUrl.search = ''
    const response = NextResponse.redirect(redirectUrl)
    signInResponse.headers.getSetCookie().forEach((cookie) => {
      response.headers.append('Set-Cookie', cookie)
    })
    return response
  } catch {
    return NextResponse.json({ error: 'Dev login failed' }, { status: 401 })
  }
}
