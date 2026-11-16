/**
 * RH-202: Pro prices. Monthly R$ 14,90 is decided; the annual R$ 119 is a
 * proposal and may change before a real provider ships.
 */
import type { BillingInterval } from '@/lib/billing/types'

export interface PlanPrice {
  amountCents: number
  currency: 'BRL'
  label: string
}

export const PRO_PRICES: Record<BillingInterval, PlanPrice> = {
  monthly: { amountCents: 1490, currency: 'BRL', label: 'R$ 14,90/month' },
  annual: { amountCents: 11900, currency: 'BRL', label: 'R$ 119/year' },
}
