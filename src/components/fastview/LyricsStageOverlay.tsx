'use client'

import type { LyricsEditorController } from '@/lib/lyricsEditor'
import { parseLyricsMarkdown } from '@/lib/lyricsMarkdown'
import { useEdgeDoubleTap } from '@/hooks/useEdgeDoubleTap'

export interface LyricsStageOverlayProps {
  controller: LyricsEditorController
  songTitle: string
  songKey?: string | null
  onNavigatePrev?: () => void
  onNavigateNext?: () => void
}

/**
 * The full-screen lyrics Stage Mode surface: a sticky header with the song
 * title, the key and the reading controls, and the lyrics themselves at the
 * chosen font size.
 *
 * Presentational only — the open state, the font size, the dark mode and the
 * back-button intercept belong to `useLyricsEditor` (RH-51).
 */
export function LyricsStageOverlay({
  controller,
  songTitle,
  songKey,
  onNavigatePrev,
  onNavigateNext,
}: LyricsStageOverlayProps) {
  useEdgeDoubleTap({
    enabled: controller.isStageOpen,
    onPrev: onNavigatePrev,
    onNext: onNavigateNext,
  })

  if (!controller.isStageOpen) return null

  return (
    <div
      className={`fixed inset-0 z-50 overflow-y-auto px-6 py-8 flex flex-col gap-6 transition-colors duration-300 ${
        controller.isDarkMode ? 'bg-gray-950 text-gray-100' : 'bg-white text-gray-900'
      }`}
      style={{ fontSize: `${controller.fontSize}px` }}
    >
      {/* Header Controls */}
      <div className="sticky top-0 z-10 py-3 flex items-center justify-between border-b backdrop-blur-md bg-opacity-70 pr-2 border-gray-200/20">
        <div className="flex flex-col min-w-0">
          <h2 className={`text-lg font-bold truncate ${controller.isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
            {songTitle}
          </h2>
          {songKey && (
            <span className="text-xs opacity-75">Tom: {songKey}</span>
          )}
        </div>

        {/* Control Panel */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Dark Mode Toggle */}
          <button
            type="button"
            onClick={controller.toggleDarkMode}
            className={`p-2 rounded-lg text-xs font-semibold transition-colors focus:outline-none ${
              controller.isDarkMode
                ? 'bg-gray-800 text-yellow-400 hover:bg-gray-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            title="Alternar Modo Escuro"
          >
            {controller.isDarkMode ? '☀️ Claro' : '🌙 Escuro'}
          </button>

          {/* Font Size decrease */}
          <button
            type="button"
            onClick={controller.decreaseFont}
            className={`w-8 h-8 rounded-lg text-sm font-bold flex items-center justify-center transition-colors focus:outline-none ${
              controller.isDarkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'
            }`}
            title="Diminuir Fonte"
          >
            A-
          </button>

          {/* Font Size increase */}
          <button
            type="button"
            onClick={controller.increaseFont}
            className={`w-8 h-8 rounded-lg text-sm font-bold flex items-center justify-center transition-colors focus:outline-none ${
              controller.isDarkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'
            }`}
            title="Aumentar Fonte"
          >
            A+
          </button>

          {/* Close Button */}
          <button
            type="button"
            onClick={controller.closeStage}
            className="ml-2 w-9 h-9 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center justify-center transition-colors focus:outline-none shadow-sm"
            title="Fechar Modo Palco"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Lyrics Body or Empty State */}
      {controller.displayedLyrics ? (
        <div className="flex-1 max-w-xl mx-auto w-full py-4 select-text">
          <div
            className="font-mono leading-relaxed tracking-wide whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: parseLyricsMarkdown(controller.displayedLyrics) }}
          />
        </div>
      ) : (
        <div className="flex-1 max-w-xl mx-auto w-full py-4 select-text flex items-center justify-center">
          <p className="text-sm opacity-60 text-center">No lyrics available for this song</p>
        </div>
      )}
    </div>
  )
}
