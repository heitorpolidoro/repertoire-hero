// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('@/lib/bands.server', () => ({
  getBandByInviteCodeServer: vi.fn(),
  joinBandByInviteServer: vi.fn(),
}))

vi.mock('@/lib/auth-session', () => ({
  getSession: vi.fn(),
  getRequiredUserId: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

// The page lives at src/app/join/[code]/page.tsx; the test sits one level up so
// no glob has to cope with the literal brackets in the segment name.
import JoinBandPage from '../[code]/page'
import { getBandByInviteCodeServer } from '@/lib/bands.server'
import { getSession } from '@/lib/auth-session'

afterEach(cleanup)

const CODE = 'INV123'
const BAND_INFO = {
  id: 'band-1',
  name: 'The Band',
  description: 'Loud and proud',
  cover_url: null,
  member_count: 3,
}

/** Await the async Server Component, then render the element it returns. */
async function renderPage(searchParams: { error?: string; joined?: string } = {}) {
  const element = await JoinBandPage({
    params: Promise.resolve({ code: CODE }),
    searchParams: Promise.resolve(searchParams),
  })
  return render(element)
}

const signedIn = () =>
  vi.mocked(getSession).mockResolvedValue({ user: { id: 'user-1', email: 'me@example.com' } } as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBandByInviteCodeServer).mockResolvedValue(BAND_INFO)
  vi.mocked(getSession).mockResolvedValue(null as never)
})

describe('join/[code] page branches', () => {
  it('shows a retryable "Something went wrong" page when the invite lookup throws', async () => {
    vi.mocked(getBandByInviteCodeServer).mockRejectedValue(new Error('db down'))

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe(`/join/${CODE}`)
    expect(screen.getByRole('link', { name: 'Go home' }).getAttribute('href')).toBe('/')
    // The session is never consulted on this branch.
    expect(getSession).not.toHaveBeenCalled()
  })

  it('shows "Invalid invite link" for an unknown code', async () => {
    vi.mocked(getBandByInviteCodeServer).mockResolvedValue(null)

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Invalid invite link' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull()
  })

  it.each([
    ['Sign in to accept', '/login'],
    ['Create free account', '/signup'],
  ])('offers %s carrying the encoded join path for an anonymous visitor', async (linkName, pathname) => {
    await renderPage()

    expect(screen.getByRole('heading', { name: 'Sign in to accept' })).toBeDefined()
    expect(screen.getByRole('link', { name: linkName }).getAttribute('href')).toBe(
      `${pathname}?redirect=%2Fjoin%2F${CODE}`,
    )
    expect(screen.queryByRole('button', { name: 'Accept Invitation & Join' })).toBeNull()
  })

  it('shows the accept/decline card with the signed-in email', async () => {
    signedIn()

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Accept invitation?' })).toBeDefined()
    expect(screen.getByText('me@example.com')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Accept Invitation & Join' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Decline / Cancel' }).getAttribute('href')).toBe('/')
  })

  it('shows the already-a-member interstitial for ?joined=already', async () => {
    signedIn()

    await renderPage({ joined: 'already' })

    expect(screen.getByRole('heading', { name: "You're already a member!" })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Go to The Band' }).getAttribute('href')).toBe('/bands/band-1')
    expect(screen.queryByRole('button', { name: 'Accept Invitation & Join' })).toBeNull()
  })

  it.each([
    ['technical', 'Something went wrong while joining. Please try again.'],
    ['invalid', 'This invite is no longer valid — it may have just been revoked by the band admin.'],
  ])('banners the ?error=%s join failure above the accept card', async (error, message) => {
    signedIn()

    await renderPage({ error })

    expect(screen.getByText(message)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Accept Invitation & Join' })).toBeDefined()
  })

  it('renders the band identity block, including the cover image when there is one', async () => {
    vi.mocked(getBandByInviteCodeServer).mockResolvedValue({
      ...BAND_INFO,
      cover_url: 'https://cdn.example/cover.jpg',
      member_count: 1,
    })

    await renderPage()

    expect(screen.getByRole('heading', { name: 'The Band' })).toBeDefined()
    expect(screen.getByText('Loud and proud')).toBeDefined()
    // Singular member count — the pluralisation branch.
    expect(screen.getByText(/1 member$/)).toBeDefined()
    expect(screen.getByAltText('The Band')).toBeDefined()
  })

  it('falls back to the placeholder when the band has no cover or description', async () => {
    vi.mocked(getBandByInviteCodeServer).mockResolvedValue({
      ...BAND_INFO,
      description: null,
      cover_url: null,
    })

    await renderPage()

    expect(screen.queryByAltText('The Band')).toBeNull()
    expect(screen.queryByText('Loud and proud')).toBeNull()
    expect(screen.getByText(/3 members$/)).toBeDefined()
  })
})
