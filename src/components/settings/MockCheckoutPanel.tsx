'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/ui/Spinner'

/** RH-202: injected from `src/app/billingActions.ts` (F21). */
export interface MockCheckoutActions {
  completeCheckout: (sessionId: string) => Promise<{ success?: boolean; error?: string }>
  cancelSubscription: () => Promise<{ success?: boolean; error?: string }>
}

export interface MockCheckoutPanelProps {
  actions: MockCheckoutActions
  /** `checkout` simulates paying for `sessionId`; `portal` simulates the customer portal. */
  mode: 'checkout' | 'portal'
  sessionId: string | null
  priceLabel: string
}

/**
 * The dev/test stand-in for a provider's hosted checkout and customer portal.
 * A real adapter sends the browser to the provider instead.
 */
export function MockCheckoutPanel({ actions, mode, sessionId, priceLabel }: MockCheckoutPanelProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (op: () => Promise<{ success?: boolean; error?: string }>, next: string) => {
    setBusy(true)
    setError(null)
    const result = await op()
    if (result.success) {
      router.push(next)
      return
    }
    setError(result.error ?? 'Something went wrong')
    setBusy(false)
  }

  const primary =
    mode === 'checkout'
      ? {
          label: 'Simulate Successful Checkout',
          onClick: () => void run(() => actions.completeCheckout(sessionId ?? ''), '/settings?checkout=success'),
        }
      : {
          label: 'Cancel Subscription at Period End',
          onClick: () => void run(actions.cancelSubscription, '/settings'),
        }

  return (
    <div className="max-w-md w-full mx-auto mt-8 rounded-2xl border border-gray-200 bg-white shadow-lg p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between border-b border-gray-100 pb-4">
        <div>
          <h1 className="text-sm font-bold text-gray-900">
            {mode === 'checkout' ? 'Repertoire Hero Checkout' : 'Manage Subscription'}
          </h1>
          <p className="text-[11px] text-gray-500">Provider-agnostic payment adapter</p>
        </div>
        <span className="text-[10px] font-mono uppercase bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold border border-amber-200">
          Mock Mode
        </span>
      </div>

      <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 flex justify-between text-sm font-semibold text-gray-900">
        <span>Repertoire Hero Pro</span>
        <span>{priceLabel}</span>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={busy || (mode === 'checkout' && !sessionId)}
          onClick={primary.onClick}
          className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {busy && <Spinner />}
          {primary.label}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => router.push(mode === 'checkout' ? '/settings?checkout=canceled' : '/settings')}
          className="w-full py-2 px-4 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-medium"
        >
          {mode === 'checkout' ? 'Cancel and Return' : 'Back to Settings'}
        </button>
      </div>

      <p className="text-[11px] text-gray-400 text-center border-t border-gray-100 pt-3">
        In production this page is replaced by the chosen payment provider.
      </p>
    </div>
  )
}
