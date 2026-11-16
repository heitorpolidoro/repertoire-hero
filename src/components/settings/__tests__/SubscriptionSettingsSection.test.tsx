// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import {
  SubscriptionSettingsSection,
  type SubscriptionSettingsActions,
} from '../SubscriptionSettingsSection'
import type { SubscriptionStatusView } from '@/types/subscription'

const DAY = 24 * 60 * 60 * 1000

function status(overrides: Partial<SubscriptionStatusView> = {}): SubscriptionStatusView {
  return {
    plan: 'pro',
    status: 'active',
    isEnforced: true,
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    cancelAtPeriodEnd: false,
    provider: 'mock',
    ...overrides,
  }
}

function makeActions(view: SubscriptionStatusView): SubscriptionSettingsActions {
  return {
    getStatus: vi.fn(async () => ({ status: view })),
    startCheckout: vi.fn(async () => ({ url: '/mock-checkout?session_id=mock_cs_monthly_u1' })),
    openPortal: vi.fn(async () => ({ url: '/mock-checkout?portal=1' })),
  }
}

describe('SubscriptionSettingsSection', () => {
  afterEach(cleanup)

  it('Free shows "Upgrade to Pro" and starts checkout from it', async () => {
    const actions = makeActions(status({ plan: 'free' }))
    const navigate = vi.fn()
    render(<SubscriptionSettingsSection actions={actions} offline={false} navigate={navigate} />)

    const button = await screen.findByRole('button', { name: /Upgrade to Pro/ })
    expect(screen.getByText('Free')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Manage Subscription/ })).toBeNull()

    fireEvent.click(button)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/mock-checkout?session_id=mock_cs_monthly_u1'))
    expect(actions.startCheckout).toHaveBeenCalledWith('monthly')
  })

  it('Trial shows the days remaining', async () => {
    const trialEndsAt = new Date(Date.now() + 11 * DAY - 60_000).toISOString()
    render(
      <SubscriptionSettingsSection
        actions={makeActions(status({ status: 'trialing', trialEndsAt }))}
        offline={false}
      />,
    )
    expect(await screen.findByText('11 days remaining')).toBeTruthy()
    expect(screen.getByText('Pro Trial')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Upgrade to Pro/ })).toBeTruthy()
  })

  it('Active Pro shows the renewal date and "Manage Subscription"', async () => {
    const actions = makeActions(status({ currentPeriodEndsAt: '2026-12-16T12:00:00.000Z' }))
    const navigate = vi.fn()
    render(<SubscriptionSettingsSection actions={actions} offline={false} navigate={navigate} />)

    expect(await screen.findByText('Renews on Dec 16, 2026.')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Upgrade to Pro/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Manage Subscription/ }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/mock-checkout?portal=1'))
  })

  it('surfaces a load error inline', async () => {
    const actions = makeActions(status())
    actions.getStatus = vi.fn(async () => ({ error: 'Failed to fetch subscription: down' }))
    render(<SubscriptionSettingsSection actions={actions} offline={false} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Failed to fetch subscription: down')
  })

  it('surfaces a checkout error inline and does not navigate', async () => {
    const actions = makeActions(status({ plan: 'free' }))
    actions.startCheckout = vi.fn(async () => ({ error: 'Unsupported billing provider: x' }))
    const navigate = vi.fn()
    render(<SubscriptionSettingsSection actions={actions} offline={false} navigate={navigate} />)
    fireEvent.click(await screen.findByRole('button', { name: /Upgrade to Pro/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('Unsupported billing provider: x')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('disables the action while offline', async () => {
    render(<SubscriptionSettingsSection actions={makeActions(status({ plan: 'free' }))} offline />)
    const button = (await screen.findByRole('button', { name: /Upgrade to Pro/ })) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
