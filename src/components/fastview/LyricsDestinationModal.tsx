'use client'

import type { LyricsVersion } from '@/lib/lyricsEditor'

export interface LyricsDestinationModalProps {
  open: boolean
  /**
   * The member's own repertoire row for this song, or `null` when they have
   * none. `null` is what makes the dialog disclose that saving will create one
   * (RH-83 ER15) — the row is created on Save, never on open and never on
   * Cancel, so browsing this dialog costs nothing.
   */
  personalRepertoireId: string | null
  onChoose: (version: LyricsVersion) => void
  onCancel: () => void
}

/**
 * Band vs personal lyrics choice, shown every time Edit/Add is pressed on a
 * band entry — including once a personal version exists. The operator chose
 * consistency over fewer taps: the question "whose text am I about to change?"
 * has the same answer-shape every time (RH-83 ER4).
 *
 * Modelled on `TabDestinationModal` and rendered at the page's root fragment
 * for the same reason: `<main>` carries a `translate-*` class, which makes it
 * the containing block of any fixed-position descendant, so `fixed inset-0`
 * would resolve against the narrow reading column instead of the viewport.
 */
export function LyricsDestinationModal({
  open,
  personalRepertoireId,
  onChoose,
  onCancel,
}: LyricsDestinationModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl border border-gray-150 shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
        <div>
          <h3 className="text-base font-bold text-gray-900">Which lyrics are you editing?</h3>
          <p className="text-xs text-gray-500 mt-1">This song belongs to a band, so there are two versions.</p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onChoose('band')}
            className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/20 text-left transition-all group focus:outline-none"
          >
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-gray-800 group-hover:text-emerald-700 transition-colors">👥 Band lyrics</span>
              <span className="text-[10px] text-gray-400">Everyone in the band sees this.</span>
            </span>
            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">Shared</span>
          </button>

          <button
            type="button"
            onClick={() => onChoose('personal')}
            className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50/20 text-left transition-all group focus:outline-none"
          >
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-gray-800 group-hover:text-blue-700 transition-colors">👤 My version</span>
              <span className="text-[10px] text-gray-400">Private to you. Starts as a copy of the band&apos;s lyrics.</span>
              {personalRepertoireId === null && (
                <span className="text-[10px] text-blue-600 font-semibold">
                  Adds this song to your personal repertoire when you save.
                </span>
              )}
            </span>
            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">Private</span>
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-xs font-semibold rounded-lg text-gray-600 transition-colors focus:outline-none"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
