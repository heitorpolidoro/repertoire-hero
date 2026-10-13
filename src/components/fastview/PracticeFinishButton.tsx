'use client'

import type { PracticeFinishController } from '@/hooks/usePracticeFinish'

export interface PracticeFinishButtonProps {
  finish: Pick<PracticeFinishController, 'visible' | 'loading' | 'open'>
}

/** RH-169: the "Finish practice" control shown on the last entry of a queue. */
export function PracticeFinishButton({ finish }: PracticeFinishButtonProps) {
  if (!finish.visible) return null
  return (
    <div className="mt-6 flex justify-center">
      <button
        type="button"
        disabled={finish.loading}
        onClick={() => {
          finish.open().catch(() => undefined)
        }}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
      >
        Finish practice
      </button>
    </div>
  )
}
