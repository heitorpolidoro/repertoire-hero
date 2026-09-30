'use client'

import { useId, useState } from 'react'
import { lyricsFormatGuide } from '@/lib/lyricsMarkdown'

/**
 * The lyrics formatting cheat sheet shown beside the editor (RH-94): each
 * format's literal syntax next to what `parseLyricsMarkdown` renders for it.
 *
 * From `sm` up it is a narrow, always-open column. Below `sm` it collapses
 * behind a "Formatting help" toggle; the entries stay in the DOM and only CSS
 * hides them, so the `open` flag never changes what is rendered.
 */
export function LyricsFormatGuide() {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const entries = lyricsFormatGuide()

  return (
    <aside
      aria-label="Lyrics formatting"
      className="order-2 sm:order-none rounded-xl border border-gray-200 bg-gray-50/60 p-2 sm:w-44 sm:shrink-0"
    >
      <h3 className="hidden sm:block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        Formatting
      </h3>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="sm:hidden w-full flex items-center justify-between gap-1 text-left text-xs font-semibold text-gray-500"
      >
        Formatting help
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <ul
        id={listId}
        className={`${open ? 'grid' : 'hidden'} grid-cols-2 gap-1.5 mt-2 sm:mt-0 sm:flex sm:flex-col`}
      >
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-col gap-0.5 min-w-0 rounded-lg bg-white border border-gray-100 px-2 py-1.5"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{entry.label}</span>
            <span className="flex items-center justify-between gap-2">
              <code className="text-xs font-mono text-gray-700 bg-gray-50 rounded px-1">{entry.syntax}</code>
              {/* Safe: the example syntaxes are constants run through the parser's escapes. */}
              <span className="text-sm" dangerouslySetInnerHTML={{ __html: entry.previewHtml }} />
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
