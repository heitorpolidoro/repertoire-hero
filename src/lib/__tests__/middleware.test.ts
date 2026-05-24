import { describe, it, expect, vi, beforeEach } from 'vitest'
import { middleware } from '../../middleware'
import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}))

describe('middleware', () => {
  let mockUser: any = null
  let capturedOptions: any = null

  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = null
    capturedOptions = null

    // Ensure env variables are set
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'some-anon-key'
    process.env.NEXT_PUBLIC_AUTO_LOGIN = 'false'

    // Mock createServerClient to return our mock auth user and capture options
    vi.mocked(createServerClient).mockImplementation((url, key, options) => {
      capturedOptions = options
      return {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
        },
      } as any
    })
  })

  it('should construct Supabase server client and handle cookie getter/setter', async () => {
    mockUser = { id: 'test-user-id' }
    
    // Create a mock request with cookies
    const request = new NextRequest(new URL('http://localhost/'))
    request.cookies.set('my-cookie', 'cookie-val')

    const response = await middleware(request)
    expect(response).toBeDefined()
    expect(createServerClient).toHaveBeenCalled()

    // Test cookie getAll() logic
    expect(capturedOptions).toBeDefined()
    expect(capturedOptions.cookies).toBeDefined()
    
    const allCookies = capturedOptions.cookies.getAll()
    expect(allCookies.find((c: any) => c.name === 'my-cookie')?.value).toBe('cookie-val')

    // Test cookie setAll() logic
    const cookiesToSet = [
      { name: 'new-cookie', value: 'new-val', options: { path: '/' } }
    ]
    capturedOptions.cookies.setAll(cookiesToSet)

    // Check request cookies updated
    expect(request.cookies.get('new-cookie')?.value).toBe('new-val')
  })

  it('should redirect unauthenticated users to dev-login if NEXT_PUBLIC_AUTO_LOGIN is true', async () => {
    process.env.NEXT_PUBLIC_AUTO_LOGIN = 'true'
    mockUser = null

    const request = new NextRequest(new URL('http://localhost/dashboard'))
    const response = await middleware(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/api/auth/dev-login?next=%2Fdashboard')
  })

  it('should not redirect unauthenticated users to dev-login if path starts with dev-login', async () => {
    process.env.NEXT_PUBLIC_AUTO_LOGIN = 'true'
    mockUser = null

    const request = new NextRequest(new URL('http://localhost/api/auth/dev-login'))
    const response = await middleware(request)

    // Should not redirect to dev-login again, but since it is a public path, it should pass through
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('should redirect unauthenticated users to /login for private paths', async () => {
    process.env.NEXT_PUBLIC_AUTO_LOGIN = 'false'
    mockUser = null

    const request = new NextRequest(new URL('http://localhost/playlists'))
    const response = await middleware(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/login?redirect=%2Fplaylists')
  })

  it('should allow unauthenticated users to access public paths without redirect', async () => {
    process.env.NEXT_PUBLIC_AUTO_LOGIN = 'false'
    mockUser = null

    const request = new NextRequest(new URL('http://localhost/signup'))
    const response = await middleware(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })

  it('should redirect authenticated users on /login to root /', async () => {
    mockUser = { id: 'user123' }

    const request = new NextRequest(new URL('http://localhost/login'))
    const response = await middleware(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/')
  })

  it('should redirect authenticated users on /signup to root /', async () => {
    mockUser = { id: 'user123' }

    const request = new NextRequest(new URL('http://localhost/signup'))
    const response = await middleware(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/')
  })

  it('should allow authenticated users to access private paths without redirect', async () => {
    mockUser = { id: 'user123' }

    const request = new NextRequest(new URL('http://localhost/profile'))
    const response = await middleware(request)

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
  })
})
