// @vitest-environment jsdom
/**
 * RH-78 — the registrar is the one place `/sw.js` is registered. It renders
 * nothing, so its whole observable behaviour is the `register` call and what it
 * does when that call rejects (convention P1: narrow with `instanceof Error`,
 * report through `logger`, never `console.error`, never throw).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { logger } from '@/lib/logger'
import ServiceWorkerRegistrar from '../ServiceWorkerRegistrar'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const originalNodeEnv = process.env.NODE_ENV

function stubServiceWorker(register: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: { register },
  })
}

function removeServiceWorker(): void {
  Reflect.deleteProperty(window.navigator, 'serviceWorker')
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  removeServiceWorker()
  process.env.NODE_ENV = originalNodeEnv
})

describe('ServiceWorkerRegistrar', () => {
  it('registers /sw.js at the root scope on mount', async () => {
    const register = vi.fn().mockResolvedValue({})
    stubServiceWorker(register)

    const { container } = render(<ServiceWorkerRegistrar />)

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    expect(register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
    // It renders nothing: no chrome, no layout impact.
    expect(container.innerHTML).toBe('')
  })

  it('reports a rejected registration through logger.error without throwing', async () => {
    const failure = new Error('SecurityError: failed to register')
    const register = vi.fn().mockRejectedValue(failure)
    stubServiceWorker(register)

    expect(() => render(<ServiceWorkerRegistrar />)).not.toThrow()

    await waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1))
    expect(vi.mocked(logger.error).mock.calls[0][1]).toBe(failure)
  })

  it('narrows a non-Error rejection instead of passing it straight through', async () => {
    const register = vi.fn().mockRejectedValue('nope')
    stubServiceWorker(register)

    render(<ServiceWorkerRegistrar />)

    await waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1))
    const reported = vi.mocked(logger.error).mock.calls[0][1]
    expect(reported).toBeInstanceOf(Error)
    expect((reported as Error).message).toContain('nope')
  })

  it('does nothing outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const register = vi.fn().mockResolvedValue({})
    stubServiceWorker(register)

    render(<ServiceWorkerRegistrar />)

    await Promise.resolve()
    expect(register).not.toHaveBeenCalled()
  })

  it('does nothing when the browser has no serviceWorker support', () => {
    removeServiceWorker()

    expect(() => render(<ServiceWorkerRegistrar />)).not.toThrow()
    expect(logger.error).not.toHaveBeenCalled()
  })
})
