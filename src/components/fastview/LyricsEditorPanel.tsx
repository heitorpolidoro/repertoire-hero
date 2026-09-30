'use client'

import { ConfirmPanel } from '@/components/ui/ConfirmPanel'
import type { LyricsEditorController } from '@/lib/lyricsEditor'
import { LyricsFormatGuide } from './LyricsFormatGuide'

export interface LyricsEditorPanelProps {
  controller: LyricsEditorController
}

/**
 * The two in-button spinners are byte-identical apart from their colour class,
 * so they are emitted from here rather than copied twice — the rendered DOM is
 * unchanged, and the duplication budget (jscpd) is not handed a new clone.
 */
function ButtonSpinner({ className }: { className: string }) {
  return (
    <svg className={`animate-spin h-3.5 w-3.5 ${className}`} fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )
}

const TARGET_LABEL = {
  band: '👥 Editing the band lyrics',
  personal: '👤 Editing my version',
} as const

const TARGET_STYLE = {
  band: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  personal: 'text-blue-700 bg-blue-50 border-blue-200',
} as const

/**
 * The lyrics editor: which version is being written, the draft textarea, the
 * online auto-import button, the Discard my version control and the
 * Cancel / Save pair, with the formatting guide beside them (RH-94).
 *
 * The editor column holds everything but the guide, so from `sm` up the
 * buttons end where the textarea ends and never run under the guide. Below `sm`
 * the column is `contents`, its children join the outer column, and `order-*`
 * puts the guide between the textarea and the buttons without rendering twice
 * (the version header and the discard confirmation keep order 0, on top).
 *
 * Presentational only — the draft, the two in-flight flags and every action
 * belong to `useLyricsEditor`, which supplies the controller (RH-51). The
 * discard confirmation is the shared `ConfirmPanel`, never `window.confirm`
 * (AGENTS.md — "NO Browser Alerts").
 */
export function LyricsEditorPanel({ controller }: LyricsEditorPanelProps) {
  const target = controller.editTarget

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="contents sm:flex sm:flex-col sm:gap-3 sm:flex-1 sm:min-w-0">
        {(target || controller.canDiscardPersonal) && (
          <div className="flex items-center justify-between gap-2">
            {target ? (
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${TARGET_STYLE[target]}`}>
                {TARGET_LABEL[target]}
              </span>
            ) : (
              <span />
            )}
            {controller.canDiscardPersonal && !controller.isDiscardPending && (
              <button
                type="button"
                onClick={controller.requestDiscard}
                disabled={controller.saving}
                className="text-[11px] font-semibold text-red-600 hover:text-red-800 transition-colors focus:outline-none"
              >
                🗑 Discard my version
              </button>
            )}
          </div>
        )}

        {controller.isDiscardPending && (
          <ConfirmPanel
            message="Discard your version? The band's lyrics will be shown instead. Your status, tags and tabs for this song are untouched."
            confirmLabel="Discard"
            busyLabel="Discarding..."
            busy={controller.saving}
            onConfirm={controller.confirmDiscard}
            onCancel={controller.cancelDiscard}
          />
        )}

        <textarea
          className="order-1 sm:order-none w-full min-h-[250px] p-4 rounded-xl border border-gray-200 shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-sm font-sans resize-y leading-relaxed text-gray-800"
          value={controller.draft}
          onChange={(e) => controller.setDraft(e.target.value)}
          placeholder="Paste or type the lyrics here..."
          disabled={controller.saving}
        />
        <div className="order-3 sm:order-none flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={controller.autoImport}
            disabled={controller.fetching || controller.saving}
            className="px-3 py-1.5 border border-emerald-200 text-emerald-700 bg-emerald-50/50 hover:bg-emerald-50 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
          >
            {controller.fetching ? (
              <>
                <ButtonSpinner className="text-emerald-600" />
                Importing...
              </>
            ) : (
              <>
                <span>✨ Auto-import</span>
              </>
            )}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={controller.cancelEditing}
              disabled={controller.saving}
              className="px-3 py-1.5 border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={controller.save}
              disabled={controller.saving}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-100 disabled:text-gray-400 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1 shadow-sm"
            >
              {controller.saving ? (
                <>
                  <ButtonSpinner className="text-gray-400" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
      </div>
      <LyricsFormatGuide />
    </div>
  )
}
