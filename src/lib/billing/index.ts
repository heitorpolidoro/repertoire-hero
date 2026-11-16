/**
 * RH-202: Picks the payment adapter from `BILLING_PROVIDER`. Unset or `mock`
 * gives the mock; a real provider is added here by its own adapter task.
 */
import { isBillingEnforced } from '@/lib/subscriptions'
import { MockPaymentAdapter } from '@/lib/billing/mockAdapter'
import type { PaymentAdapter } from '@/lib/billing/types'

export function getPaymentAdapter(): PaymentAdapter {
  const provider = process.env.BILLING_PROVIDER || 'mock'
  if (provider !== 'mock') throw new Error(`Unsupported billing provider: ${provider}`)
  // The mock grants Pro to whoever asks: harmless while billing is not
  // enforced, a free-Pro hole once it is, so production refuses that pairing.
  if (process.env.NODE_ENV === 'production' && isBillingEnforced()) {
    throw new Error('The mock billing provider cannot run with billing enforced in production')
  }
  return new MockPaymentAdapter()
}
