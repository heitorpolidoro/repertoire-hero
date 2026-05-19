import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup', '/api/auth/', '/api/dev/', '/join/']

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Create a server client that reads/writes cookies on the request/response pair.
  // This is the pattern required by @supabase/ssr to keep the session token fresh.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the session — this is mandatory; do NOT remove.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  // Auto-login: when the dev convenience flag is on and the user is not
  // authenticated, bounce through the dev-login API route (which can set
  // cookies before returning a redirect to /).
  if (
    process.env.NEXT_PUBLIC_AUTO_LOGIN === 'true' &&
    !user &&
    !pathname.startsWith('/api/auth/dev-login')
  ) {
    const devLoginUrl = request.nextUrl.clone()
    devLoginUrl.pathname = '/api/auth/dev-login'
    // Preserve the original destination so the route handler can redirect back.
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

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Run on all paths except Next.js internals and static assets.
     * Keeping _next/static and _next/image out avoids unnecessary work on
     * every chunk/image request.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
