'use client'

import type { MergedTab, TabOrigin } from '@/lib/tabLibrary'

export interface TabListProps {
  tabs: MergedTab[]
  activeTabUrl: string | null
  onSelect: (tab: MergedTab) => void
  onDelete: (tabId: string, origin: TabOrigin) => void
}

/** The uploaded PDFs of this song, band files and personal files in one list. */
export function TabList({ tabs, activeTabUrl, onSelect, onDelete }: TabListProps) {
  return (
    <ul className="flex flex-col gap-2">
      {tabs.map((tab) => {
        const isActive = activeTabUrl === tab.file_url
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

              {/* Origin Badge */}
              {tab.origin === 'band' ? (
                <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-250 px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0 flex items-center gap-0.5" title="Shared with the whole band">
                  👥 Band
                </span>
              ) : (
                <span className="text-[9px] font-semibold text-blue-700 bg-blue-50 border border-blue-250 px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0 flex items-center gap-0.5" title="Private study file">
                  👤 Personal
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

              {/* Delete Button */}
              <button
                type="button"
                onClick={() => onDelete(tab.id, tab.origin)}
                className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                aria-label="Delete tab"
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
