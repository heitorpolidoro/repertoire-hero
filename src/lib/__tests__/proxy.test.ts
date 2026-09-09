import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy as middleware, config as proxyConfig } from '../../proxy'

// The proxy reads the Better Auth session cookie straight off the request
// headers, so a request is all the fixture these tests need — there is no
// network call to mock.
const SESSION_COOKIE = 'better-auth.session_token=abc.def'
const SECURE_SESSION_COOKIE = '__Secure-better-auth.session_token=abc.def'

function request(url: string, cookie?: string): NextRequest {
  const target = new URL(url)
  return cookie === undefined
    ? new NextRequest(target)
    : new NextRequest(target, { headers: { cookie } })
}

/** Compiles the matcher the same way src/lib/__tests__/pdfWorkerAsset.test.ts does. */
function matcherPatterns(): RegExp[] {
  return proxyConfig.matcher.map((entry) => new RegExp(`^${entry}$`))
}

function isMatched(pathname: string): boolean {
  return matcherPatterns().some((pattern) => pattern.test(pathname))
}

describe('proxy — session resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('redirects a cookieless request for a private route to /login with the path in the redirect param', () => {
    const response = middleware(request('http://localhost/playlists'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/login?redirect=%2Fplaylists')
  })

  it('passes a request that carries a Better Auth session cookie straight through', () => {
    const response = middleware(request('http://localhost/profile', SESSION_COOKIE))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('accepts the __Secure- prefixed session cookie used in production', () => {
    const response = middleware(request('http://localhost/profile', SECURE_SESSION_COOKIE))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('treats an empty session cookie value as no session', () => {
    const response = middleware(request('http://localhost/profile', 'better-auth.session_token='))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/login?redirect=%2Fprofile')
  })

  it('ignores unrelated cookies when deciding whether a session cookie is present', () => {
    const response = middleware(request('http://localhost/profile', 'foo=bar; theme=dark'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/login?redirect=%2Fprofile')
  })

  it('resolves the session without ever calling fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    expect(middleware(request('http://localhost/profile')).status).toBe(307)
    expect(middleware(request('http://localhost/profile', SESSION_COOKIE)).status).toBe(200)
    expect(middleware(request('http://localhost/login', SESSION_COOKIE)).status).toBe(307)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('preserves the original query string when it redirects to /login', () => {
    const response = middleware(request('http://localhost/songs/search?q=hey&tag=rock'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost/login?q=hey&tag=rock&redirect=%2Fsongs%2Fsearch',
    )
  })

  it('redirects a request carrying a session cookie away from /login to the root', () => {
    const response = middleware(request('http://localhost/login', SESSION_COOKIE))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/')
  })

  it('redirects a request carrying a session cookie away from /signup to the root', () => {
    const response = middleware(request('http://localhost/signup', SESSION_COOKIE))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/')
  })

  it('leaves a cookieless request for /login untouched', () => {
    const response = middleware(request('http://localhost/login'))

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('leaves a cookieless request for /forgot-password and /reset-password untouched', () => {
    for (const path of ['/forgot-password', '/reset-password']) {
      const response = middleware(request(`http://localhost${path}`))

      expect(response.status, path).toBe(200)
      expect(response.headers.get('location'), path).toBeNull()
    }
  })

  it('passes a present but unvalidated session cookie through to the page, which owns the authorization decision', () => {
    // The proxy never verifies the cookie: an expired, revoked or hand-crafted
    // token reaches the page, which resolves the real session and answers.
    const response = middleware(
      request('http://localhost/bands/abc', 'better-auth.session_token=garbage.value'),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })
})

describe('proxy — matcher allow-list', () => {
  it('matches every client-rendered private route', () => {
    for (const path of [
      '/profile',
      '/settings',
      '/bands',
      '/bands/abc',
      '/playlists',
      '/playlists/abc',
      '/songs/search',
      '/songs/abc/fast-view',
      '/admin/moderation',
    ]) {
      expect(isMatched(path), path).toBe(true)
    }
  })

  it('matches the four auth pages', () => {
    for (const path of ['/login', '/signup', '/forgot-password', '/reset-password']) {
      expect(isMatched(path), path).toBe(true)
    }
  })

  it('does not match /, the invite route or any route under /api', () => {
    for (const path of [
      '/',
      '/join/ABCDEF',
      '/api/auth/get-session',
      '/api/dev/profiles',
      '/api/spotify/search',
      '/api/spotify/playlists',
    ]) {
      expect(isMatched(path), path).toBe(false)
    }
  })

  it('does not match static assets, the pdf worker or an unknown path', () => {
    for (const path of [
      '/_next/static/chunk.js',
      '/_next/image',
      '/favicon.ico',
      '/icon.jpg',
      '/pdf.worker.min.mjs',
      '/robots.txt',
      '/nope',
    ]) {
      expect(isMatched(path), path).toBe(false)
    }
  })

  it('lists exactly twelve matcher entries, each a valid regular-expression source', () => {
    expect(proxyConfig.matcher).toHaveLength(12)
    expect([...proxyConfig.matcher].sort()).toEqual([
      '/admin/(.*)',
      '/bands',
      '/bands/(.*)',
      '/forgot-password',
      '/login',
      '/playlists',
      '/playlists/(.*)',
      '/profile',
      '/reset-password',
      '/settings',
      '/signup',
      '/songs/(.*)',
    ])
    for (const entry of proxyConfig.matcher) {
      expect(() => new RegExp(`^${entry}$`), entry).not.toThrow()
    }
  })
})
