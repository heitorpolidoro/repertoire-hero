'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { describeSubscription, type SubscriptionDisplay } from '@/lib/subscriptionDisplay'
import { PRO_PRICES } from '@/lib/billing/prices'
import type { BillingInterval } from '@/lib/billing/types'
import type { SubscriptionStatusView } from '@/types/subscription'

/** RH-202: injected from `src/app/billingActions.ts` (F21). */
export interface SubscriptionSettingsActions {
  getStatus: () => Promise<{ status?: SubscriptionStatusView; error?: string }>
  startCheckout: (interval?: BillingInterval) => Promise<{ url?: string; error?: string }>
  openPortal: () => Promise<{ url?: string; error?: string }>
}

export interface SubscriptionSettingsSectionProps {
  actions: SubscriptionSettingsActions
  offline: boolean
  /** Opens a checkout or portal URL; a full navigation, since a real provider is off-site. */
  navigate?: (url: string) => void
}

const CARD_TONE: Record<SubscriptionDisplay['kind'], string> = {
  free: 'border-gray-200 bg-white',
  trial: 'border-amber-200 bg-amber-50/40',
  active: 'border-emerald-200 bg-emerald-50/40',
  included: 'border-emerald-200 bg-white',
}

const BADGE_TONE: Record<SubscriptionDisplay['kind'], string> = {
  free: 'bg-gray-100 text-gray-700 border-gray-200',
  trial: 'bg-amber-100 text-amber-800 border-amber-300',
  active: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  included: 'bg-emerald-100 text-emerald-800 border-emerald-200',
}

function defaultNavigate(url: string): void {
  window.location.assign(url)
}

export function SubscriptionSettingsSection({
  actions,
  offline,
  navigate = defaultNavigate,
}: SubscriptionSettingsSectionProps) {
  const [view, setView] = useState<SubscriptionStatusView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void actions.getStatus().then((result) => {
      if (!alive) return
      if (result.status) setView(result.status)
      else setError(result.error ?? 'Failed to load subscription')
    })
    return () => {
      alive = false
    }
  }, [actions])

  const runAction = async (open: () => Promise<{ url?: string; error?: string }>) => {
    setBusy(true)
    setError(null)
    const result = await open()
    if (result.url) {
      navigate(result.url)
      return
    }
    setError(result.error ?? 'Something went wrong')
    setBusy(false)
  }

  const display = view ? describeSubscription(view, new Date()) : null

  return (
    <section className="flex flex-col gap-3" aria-labelledby="subscription-heading">
      <h2 id="subscription-heading" className="text-sm font-semibold text-gray-700">
        Subscription &amp; Plan
      </h2>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!display && !error && (
        <div className="rounded-lg border border-gray-100 bg-white shadow-sm px-4 py-3 flex items-center gap-2 text-sm text-gray-400">
          <Spinner />
          Loading your plan...
        </div>
      )}

      {display && (
        <div
          className={`rounded-xl border p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${CARD_TONE[display.kind]}`}
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-gray-900">{display.title}</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${BADGE_TONE[display.kind]}`}
              >
                {display.badge}
              </span>
            </div>
            <p className="text-xs text-gray-600 mt-1">{display.detail}</p>
          </div>
          {display.action === 'upgrade' ? (
            <button
              type="button"
              disabled={offline || busy}
              onClick={() => void runAction(() => actions.startCheckout('monthly'))}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy && <Spinner />}
              Upgrade to Pro — {PRO_PRICES.monthly.label}
            </button>
          ) : (
            <button
              type="button"
              disabled={offline || busy}
              onClick={() => void runAction(actions.openPortal)}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy && <Spinner />}
              Manage Subscription
            </button>
          )}
        </div>
      )}
    </section>
  )
}
