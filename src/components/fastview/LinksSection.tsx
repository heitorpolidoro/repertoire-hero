'use client'

import type { SongLinksController } from '@/lib/songLinks'
import { AddLinkForm } from './AddLinkForm'
import { LinkIcon } from './LinkIcon'

export interface LinksSectionProps {
  controller: SongLinksController
  /**
   * The page wires this to "close the tab confirmation, then open the link
   * one", so the two confirmation panels are never on screen together.
   */
  onDelete: (url: string) => void
}

/**
 * The whole "Links" section: the heading with its `+ Add Link` trigger, one card
 * per link (Link Card UI, see AGENTS.md), the empty state and the add form.
 *
 * Presentational only — every write belongs to `useSongLinks` (RH-52).
 */
export function LinksSection({ controller, onDelete }: LinksSectionProps) {
  return (
    <section aria-label="Links" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Links</h2>
        {!controller.isAdding && (
          <button
            type="button"
            onClick={controller.startAdding}
            className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 transition-colors focus:outline-none"
          >
            + Add Link
          </button>
        )}
      </div>

      {controller.links.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {controller.links.map((link, idx) => (
            <li key={`${link.url}-${idx}`}>
              <div className="flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl bg-white border border-gray-200 shadow-sm hover:border-emerald-200 transition-colors">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-between gap-3 text-emerald-600 font-medium hover:underline min-w-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <LinkIcon url={link.url} />
                    <span className="truncate text-sm font-medium">{link.label || link.url}</span>
                  </div>
                  {/* External link icon (square with arrow out - matching PDF tabs) */}
                  <svg className="w-4 h-4 text-emerald-500 shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>

                <div className="h-4 w-px bg-gray-200 shrink-0" aria-hidden="true" />

                {/* Delete link button - inside card on the right */}
                <button
                  type="button"
                  onClick={() => onDelete(link.url)}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                  aria-label="Delete link"
                  title="Delete link"
                >
                  <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 bg-gray-100/60 border border-gray-200/50 rounded-xl p-4 text-center">No links added yet.</p>
      )}

      {/* Add Link Form */}
      <AddLinkForm controller={controller} />
    </section>
  )
}
