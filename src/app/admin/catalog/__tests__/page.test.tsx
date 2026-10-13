/**
 * RH-156 — the /admin/catalog page gates itself: signed out redirects, a
 * non-admin sees Access Denied without the catalog being read, an admin gets
 * the island with the search results.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

const { getSessionSpy, checkSystemAdminSpy, searchSongsSpy, redirectSpy } = vi.hoisted(() => ({
  getSessionSpy: vi.fn(),
  checkSystemAdminSpy: vi.fn(),
  searchSongsSpy: vi.fn(),
  redirectSpy: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`)
  }),
}))

vi.mock('@/lib/auth-session', () => ({ getSession: getSessionSpy }))
vi.mock('@/lib/moderation', () => ({ checkSystemAdmin: checkSystemAdminSpy }))
vi.mock('@/lib/songs', () => ({ searchSongs: searchSongsSpy }))
vi.mock('next/navigation', () => ({ redirect: redirectSpy }))
vi.mock('@/app/catalogAdminActions', () => ({ CATALOG_ADMIN_ACTIONS: { marker: true } }))
vi.mock('@/components/admin/CatalogAdmin', () => ({ CatalogAdmin: () => null }))

import AdminCatalogPage from '../page'
import { CatalogAdmin } from '@/components/admin/CatalogAdmin'

const params = (q?: string) => Promise.resolve(q === undefined ? {} : { q })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/admin/catalog page', () => {
  it('redirects a signed-out visitor to /login and reads nothing', async () => {
    getSessionSpy.mockResolvedValue(null)

    await expect(AdminCatalogPage({ searchParams: params('bad') })).rejects.toThrow(
      'NEXT_REDIRECT:/login',
    )
    expect(redirectSpy).toHaveBeenCalledWith('/login')
    expect(checkSystemAdminSpy).not.toHaveBeenCalled()
    expect(searchSongsSpy).not.toHaveBeenCalled()
  })

  it('shows Access Denied to a non-admin without reading the catalog', async () => {
    getSessionSpy.mockResolvedValue({ user: { id: 'u1' } })
    checkSystemAdminSpy.mockRejectedValue(new Error('Access denied: User is not a system admin'))

    const out = (await AdminCatalogPage({ searchParams: params('bad') })) as ReactElement

    expect(out.type).not.toBe(CatalogAdmin)
    expect(renderToStaticMarkup(out)).toContain('Access Denied')
    expect(searchSongsSpy).not.toHaveBeenCalled()
  })

  it('rethrows a failure that is not an access refusal', async () => {
    getSessionSpy.mockResolvedValue({ user: { id: 'u1' } })
    checkSystemAdminSpy.mockRejectedValue(new Error('db down'))

    await expect(AdminCatalogPage({ searchParams: params('bad') })).rejects.toThrow('db down')
  })

  it('renders the island with the search results for a system admin', async () => {
    getSessionSpy.mockResolvedValue({ user: { id: 'u1' } })
    checkSystemAdminSpy.mockResolvedValue(undefined)
    const songs = [{ id: 's1', title: 'Bad', versions: [] }]
    searchSongsSpy.mockResolvedValue(songs)

    const out = (await AdminCatalogPage({ searchParams: params(' bad ') })) as ReactElement<{
      songs: unknown
      query: string
      actions: unknown
    }>

    expect(checkSystemAdminSpy).toHaveBeenCalledWith('u1')
    expect(searchSongsSpy).toHaveBeenCalledWith('bad')
    expect(out.type).toBe(CatalogAdmin)
    expect(out.props.songs).toBe(songs)
    expect(out.props.query).toBe('bad')
    expect(out.props.actions).toEqual({ marker: true })
  })

  it('does not search when q is missing or blank', async () => {
    getSessionSpy.mockResolvedValue({ user: { id: 'u1' } })
    checkSystemAdminSpy.mockResolvedValue(undefined)

    const out = (await AdminCatalogPage({ searchParams: params(undefined) })) as ReactElement<{
      songs: unknown[]
    }>
    await AdminCatalogPage({ searchParams: params('   ') })

    expect(searchSongsSpy).not.toHaveBeenCalled()
    expect(out.props.songs).toEqual([])
  })
})
