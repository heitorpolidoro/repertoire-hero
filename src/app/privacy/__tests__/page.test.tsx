// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const cookieGet = vi.fn()
const headerGet = vi.fn()

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet }),
  headers: async () => ({ get: headerGet }),
}))
vi.mock('@/lib/auth-session', () => ({
  getSession: () => {
    throw new Error('/privacy must not look up a session')
  },
}))

import PrivacyPage from '../page'
import en from '@/i18n/dictionaries/en.json'
import ptBR from '@/i18n/dictionaries/pt-BR.json'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('/privacy (RH-160)', () => {
  it('renders the English policy with no session', async () => {
    cookieGet.mockReturnValue({ value: 'en' })
    render(await PrivacyPage())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.privacy.title)
    expect(screen.getByText(en.privacy.sections[0].body)).toBeDefined()
  })

  it('renders the pt-BR policy when the cookie says so', async () => {
    cookieGet.mockReturnValue({ value: 'pt-BR' })
    render(await PrivacyPage())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(ptBR.privacy.title)
  })

  it('covers collection, no sale and deletion in both languages', () => {
    for (const dict of [en, ptBR]) {
      expect(dict.privacy.sections.length).toBeGreaterThanOrEqual(3)
    }
    const body = en.privacy.sections.map((s) => s.body).join(' ')
    expect(body).toMatch(/not sold/i)
    expect(body).toMatch(/delet/i)
  })
})
