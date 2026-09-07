'use client'

import type { LyricsEditorController } from '@/lib/lyricsEditor'

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

/**
 * The lyrics editor: the draft textarea, the online auto-import button and the
 * Cancel / Save pair.
 *
 * Presentational only — the draft, the two in-flight flags and every action
 * belong to `useLyricsEditor`, which supplies the controller (RH-51).
 */
export function LyricsEditorPanel({ controller }: LyricsEditorPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <textarea
        className="w-full min-h-[250px] p-4 rounded-xl border border-gray-200 shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-sm font-sans resize-y leading-relaxed text-gray-800"
        value={controller.draft}
        onChange={(e) => controller.setDraft(e.target.value)}
        placeholder="Paste or type the lyrics here..."
        disabled={controller.saving}
      />
      <div className="flex items-center justify-between gap-2">
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
  )
}
