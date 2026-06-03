import { auth } from '@/lib/auth'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup', '/api/auth/', '/api/dev/', '/join/']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  const session = await auth.api.getSession({ headers: request.headers })
  const user = session?.user ?? null

  // Auto-login: dev convenience — bounce through dev-login if unauthenticated.
  if (
    process.env.NEXT_PUBLIC_AUTO_LOGIN === 'true' &&
    !user &&
    !pathname.startsWith('/api/auth/dev-login')
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
