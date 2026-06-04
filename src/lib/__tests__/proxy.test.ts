import { describe, it, expect, vi, beforeEach } from 'vitest'
import { proxy as middleware } from '../../proxy'
import { NextRequest } from 'next/server'

// Mock global fetch — the middleware calls /api/auth/get-session
// to check the Better Auth session without importing pg into Edge Runtime.
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockSession(user: { id: string } | null) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(user ? { user } : null),
  })
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_AUTO_LOGIN = 'false'
    // Default: unauthenticated
    mockSession(null)
  })

  it('should redirect unauthenticated users to dev-login if NEXT_PUBLIC_AUTO_LOGIN is true', async () => {
    process.env.NEXT_PUBLIC_AUTO_LOGIN = 'true'
    mockSession(null)

    const request = new NextRequest(new URL('http://localhost/dashboard'))
    const response = await middleware(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/api/auth/dev-login?next=%2Fdashboard')
  })

  it('should not redirect unauthenticated users to dev-login if path starts with dev-login', async () => {
    process.env.NEXT_PUBLIC_AUTO_LOGIN = 'true'
    mockSession(null)

    const request = new NextRequest(new URL('http://localhost/api/auth/dev-login'))
    const response = await middleware(request)

    // /api/auth/ is a public path — passes through
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('should redirect unauthenticated users to /login for private paths', async () => {
    mockSession(null)

    const request = new NextRequest(new URL('http://localhost/playlists'))
    const response = await middleware(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/login?redirect=%2Fplaylists')
  })

  it('should allow unauthenticated users to access public paths without redirect', async () => {
    mockSession(null)

    const request = new NextRequest(new URL('http://localhost/signup'))
    const response = await middleware(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('should redirect authenticated users on /login to root /', async () => {
    mockSession({ id: 'user123' })

    const request = new NextRequest(new URL('http://localhost/login'))
    const response = await middleware(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/')
  })

  it('should redirect authenticated users on /signup to root /', async () => {
    mockSession({ id: 'user123' })

    const request = new NextRequest(new URL('http://localhost/signup'))
    const response = await middleware(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/')
  })

  it('should allow authenticated users to access private paths without redirect', async () => {
    mockSession({ id: 'user123' })

    const request = new NextRequest(new URL('http://localhost/profile'))
    const response = await middleware(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('should treat fetch failure as unauthenticated and redirect to /login', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))

    const request = new NextRequest(new URL('http://localhost/profile'))
    const response = await middleware(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
  })
})
