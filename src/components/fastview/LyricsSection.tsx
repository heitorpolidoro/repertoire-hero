'use client'

import type { LyricsEditorController } from '@/lib/lyricsEditor'
import { parseLyricsMarkdown } from '@/lib/lyricsMarkdown'
import { LyricsEditorPanel } from './LyricsEditorPanel'

export interface LyricsSectionProps {
  controller: LyricsEditorController
  /** True while the member's own entry is still loading. Page state (RH-52). */
  loadingPersonal: boolean
}

/**
 * The whole "Lyrics" section: the heading with its Band/Personal badge, the
 * Stage Mode and Edit/Add buttons, the version-switcher banner and either the
 * read-only lyrics card or the editor panel.
 *
 * Presentational only — every piece of state and every action belongs to
 * `useLyricsEditor`, which supplies the controller (RH-51).
 */
export function LyricsSection({ controller, loadingPersonal }: LyricsSectionProps) {
  return (
    <section aria-label="Lyrics" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Lyrics</h2>
          {controller.isBandEntry && (
            controller.showPersonalLyrics ? (
              <span className="text-[9px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                👤 Personal
              </span>
            ) : (
              <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-250 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                👥 Band
              </span>
            )
          )}
        </div>
        <div className="flex items-center gap-3">
          {controller.displayedLyrics && !controller.isEditing && (
            <button
              type="button"
              onClick={controller.openStage}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 transition-colors flex items-center gap-1 focus:outline-none"
            >
              <span>🔍 Stage Mode</span>
            </button>
          )}
          {!controller.isEditing && (
            <button
              type="button"
              onClick={controller.startEditing}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 transition-colors focus:outline-none"
            >
              {controller.displayedLyrics ? 'Edit' : 'Add'}
            </button>
          )}
        </div>
      </div>

      {/* Lyrics version switcher banner (only in band mode if personal differs) */}
      {controller.hasDifferentPersonalLyrics && !controller.isEditing && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 shadow-sm text-xs text-blue-700">
          <span className="font-medium">💡 You have a different personal lyrics version for this song.</span>
          <button
            type="button"
            onClick={controller.toggleVersion}
            className="font-bold underline hover:text-blue-900 transition-colors focus:outline-none shrink-0"
          >
            {controller.showPersonalLyrics ? 'View Band lyrics (👥)' : 'View my lyrics (👤)'}
          </button>
        </div>
      )}

      {controller.isEditing ? (
        <LyricsEditorPanel controller={controller} />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          {controller.displayedLyrics ? (
            <div
              className="text-gray-800 text-sm font-sans leading-relaxed select-text whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: parseLyricsMarkdown(controller.displayedLyrics) }}
            />
          ) : loadingPersonal ? (
            <div className="flex flex-col gap-2 animate-pulse" aria-busy="true" aria-label="Loading lyrics...">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className={`h-3 rounded bg-gray-200 ${i % 3 === 0 ? 'max-w-[55%]' : i % 2 === 0 ? 'max-w-[80%]' : 'max-w-full'}`} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-2">No lyrics added yet.</p>
          )}
        </div>
      )}
    </section>
  )
}
