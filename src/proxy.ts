import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

/**
 * NOT AN AUTHORIZATION BOUNDARY (RH-65, code-quality review F10).
 *
 * This file is a redirect convenience and nothing else. It answers one
 * question, from the request headers alone: does this request carry a Better
 * Auth session cookie? It never validates that cookie, never asks the
 * database, and never talks to the app over HTTP.
 *
 * A present cookie therefore proves nothing: it may be expired, revoked or
 * signed by a different secret. A page, a Server Action or a route handler
 * that skips its own session check because "the proxy already redirects" is a
 * bug. Every Server Action resolves its own session
 * (src/app/actions/__tests__/actionSessionGuard.test.ts), every route handler
 * under src/app/api/ resolves its own session and answers for itself, and the
 * three Server Component pages call redirect("/login") themselves. That is
 * where authorization lives.
 *
 * What this file buys is that a signed-out visitor who types /profile gets an
 * immediate 307 instead of a client-rendered page that would sit on a spinner.
 * The matcher below is an allow-list of exactly the routes that need that.
 * A new private page route does not inherit the redirect - add it here.
 */

const AUTH_PAGES = ['/login', '/signup', '/forgot-password', '/reset-password']

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isAuthPage = AUTH_PAGES.includes(pathname)
  const hasSessionCookie = getSessionCookie(request) !== null

  // No cookie on a gated route: send them to /login, remembering where they
  // were headed. `clone()` keeps the original query string, as before.
  if (!hasSessionCookie && !isAuthPage) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // A cookie on an auth page: they are (probably) already signed in.
  if (hasSessionCookie && isAuthPage) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/'
    return NextResponse.redirect(homeUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Auth pages: a visitor who already carries a session cookie is sent home.
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    // Client-rendered private routes: nothing on the server turns a signed-out
    // visitor away, so without this they would sit on a spinner.
    '/profile',
    '/settings',
    '/bands/(.*)',
    '/playlists/(.*)',
    '/songs/(.*)',
    // Server Component routes that redirect themselves. They stay here because
    // src/app/loading.tsx makes their own redirect() a streamed meta refresh
    // (HTTP 200 behind a spinner) rather than a 307 - see the audit above.
    '/admin/(.*)',
    '/bands',
    '/playlists',
  ],
}
