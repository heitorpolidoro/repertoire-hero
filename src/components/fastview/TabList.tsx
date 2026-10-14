'use client'

import { resolvePrimaryTab } from '@/lib/tabLibrary'
import type { SongFile } from '@/types/database'

export interface TabListProps {
  tabs: SongFile[]
  activeTabUrl: string | null
  onSelect: (tab: SongFile) => void
  onDelete: (fileId: string) => void
  /** Designates one file as the primary (RH-147). */
  onSetPrimary: (fileId: string) => void
  /**
   * True while the Fast View is read-only, i.e. offline (RH-99). The delete and
   * the set-as-primary star are disabled: selecting a tab and opening it in a
   * new tab are reads.
   */
  readOnly?: boolean
}

/**
 * The musician's own uploaded PDFs for this song.
 *
 * One list and no origin badge since RH-123: a file belongs to a person and a
 * song, so "band or personal?" is not a question the row can answer or needs
 * to.
 */
export function TabList({
  tabs,
  activeTabUrl,
  onSelect,
  onDelete,
  onSetPrimary,
  readOnly = false,
}: TabListProps) {
  // The list keeps its `created_at DESC` order; the primary is marked in place.
  const primaryId = resolvePrimaryTab(tabs)?.id
  return (
    <ul className="flex flex-col gap-2">
      {tabs.map((tab) => {
        const isActive = activeTabUrl === tab.file_url
        const isPrimary = tab.id === primaryId
        return (
          <li
            key={tab.id}
            className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
              isActive
                ? 'bg-emerald-50/60 border-emerald-300 shadow-sm'
                : 'bg-white border-gray-200 hover:border-emerald-100 shadow-sm'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(tab)}
              className="flex flex-1 items-center gap-3 text-left text-gray-700 hover:text-emerald-600 font-medium transition-colors focus:outline-none min-w-0"
            >
              {/* PDF Icon */}
              <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span className="truncate text-sm mr-1.5">{tab.title}</span>

              {isPrimary && (
                <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0 ml-1">
                  Primary
                </span>
              )}

              {isActive && (
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-105 px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0 ml-1">
                  Viewing
                </span>
              )}
            </button>

            <div className="flex items-center gap-1 shrink-0">
              {/* External Link Button */}
              <a
                href={tab.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-emerald-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                title="Open in new tab / download"
              >
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>

              {/* Set-as-primary star: filled for the primary file (RH-147) */}
              <button
                type="button"
                onClick={() => onSetPrimary(tab.id)}
                disabled={readOnly}
                aria-pressed={isPrimary}
                className={`p-1.5 rounded-lg hover:bg-gray-50 transition-colors disabled:text-gray-300 disabled:hover:bg-transparent ${
                  isPrimary ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'
                }`}
                aria-label="Set as primary file"
              >
                <svg className="w-4.5 h-4.5" fill={isPrimary ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </button>

              {/* Delete Button */}
              <button
                type="button"
                onClick={() => onDelete(tab.id)}
                disabled={readOnly}
                className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors disabled:text-gray-300 disabled:hover:bg-transparent"
                aria-label="Delete file"
              >
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
