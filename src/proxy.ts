import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup', '/api/auth/', '/api/dev/', '/join/']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  // Better Auth uses pg (Node.js only) — call the session endpoint via fetch
  // rather than importing auth directly (which would pull pg into Edge Runtime).
  // Skip the session check for API/static public paths — only /login and /signup
  // need the session (to redirect already-authenticated users away from them).
  const skipSession = ['/api/auth/', '/api/dev/', '/join/'].some((p) => pathname.startsWith(p))
  let user: { id: string } | null = null
  if (!skipSession) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const sessionRes = await fetch(
        new URL('/api/auth/get-session', request.url),
        { headers: { cookie: request.headers.get('cookie') ?? '' }, signal: controller.signal }
      )
      clearTimeout(timeout)
      if (sessionRes.ok) {
        const data = (await sessionRes.json()) as { user?: { id: string } } | null
        user = data?.user ?? null
      }
    } catch {
      // Session check failed or timed out — treat as unauthenticated
    }
  }

  // Auto-login: dev convenience — bounce through dev-login if unauthenticated.
  // Only applies to private page routes — never to public or API paths.
  if (
    process.env.NEXT_PUBLIC_AUTO_LOGIN === 'true' &&
    !user &&
    !isPublicPath
  ) {
    const devLoginUrl = request.nextUrl.clone()
    devLoginUrl.pathname = '/api/auth/dev-login'
    devLoginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(devLoginUrl)
  }

  // Unauthenticated users must go to /login (skip public paths to avoid loops).
  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated users who land on /login or /signup are sent to the root.
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/'
    return NextResponse.redirect(homeUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
