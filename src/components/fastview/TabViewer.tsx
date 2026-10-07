'use client'

import { useState } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { isImageTab } from '@/lib/tabRenderer'

export interface TabViewerProps {
  url: string | null
  title: string
  /**
   * The active file's `song_files.content_type` (RH-128). An image is rendered
   * directly; anything else — `application/pdf`, an absent value from a row
   * written before RH-127, an unknown string — keeps the `gview` iframe.
   */
  contentType?: string | null
  onOpenStage: () => void
  onClose: () => void
  /**
   * True while the browser has no network. Passed down from the page's single
   * `useOfflineStatus()` call — this component never reads the signal itself
   * (RH-38/RH-52). Optional and `false` by default, so the online card and
   * every other call site are unchanged.
   */
  offline?: boolean
}

/**
 * The embedded viewer card for the selected tab. Renders nothing without an
 * active tab, so the page keeps no conditional of its own.
 *
 * Offline (RH-80) the header row is untouched and only the body changes. The
 * body is a cross-origin `docs.google.com/gview` iframe, which with no network
 * paints a blank 550px card — and because this card's `Stage` button is the
 * only `onOpenStage` trigger in the app, a blank card would hide the one
 * renderer that *does* work offline (Stage Mode's `react-pdf` reads the
 * same-origin cache key `src/app/sw.ts` answers). So offline the iframe is
 * replaced by a panel that says so and points at Stage Mode.
 *
 * RH-128 put the image branch **in front of** the offline one. The offline
 * panel exists because `gview` is a cross-origin viewer with no network to
 * reach; an `<img>` pointed at the synthetic same-origin cache key
 * `src/app/sw.ts` answers (`/__offline-tab/...`) has no such problem, so an
 * image tab renders its bytes online and offline alike and never mounts the
 * panel. Only a PDF still takes the offline branch.
 */
export function TabViewer({
  url,
  title,
  contentType,
  onOpenStage,
  onClose,
  offline = false,
}: TabViewerProps) {
  if (!url) return null

  return (
    <div className="flex flex-col gap-2 bg-white border border-emerald-200 rounded-xl p-3 shadow-sm transition-all duration-300">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-gray-700 truncate max-w-[200px] sm:max-w-[280px]">
          Viewing: {title}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenStage}
            className="text-xs font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 transition-colors flex items-center gap-1"
          >
            <span>⛶</span> Stage
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
      {isImageTab(contentType) ? (
        <ImageFrame key={url} url={url} title={title} />
      ) : offline ? (
        <div
          data-testid="tab-viewer-offline"
          className="w-full rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 px-6 py-10 flex flex-col items-center gap-2 text-center"
        >
          <span aria-hidden="true" className="text-3xl">
            📴
          </span>
          <p className="text-sm font-semibold text-gray-700">Preview needs a connection</p>
          <p className="max-w-xs text-xs text-gray-500">
            This chart is downloaded and ready. Open <span className="font-medium">Stage</span>{' '}
            above to read it offline.
          </p>
        </div>
      ) : (
        <GviewFrame key={url} url={url} title={title} />
      )}
    </div>
  )
}

/**
 * An image tab's bytes, rendered directly in the same 550px card box: no
 * viewer service, no iframe and nothing cross-origin (RH-128).
 *
 * `object-contain` inside a fixed-height box keeps a portrait phone photo and
 * a landscape scan both whole, and the spinner is the same
 * until-it-loads treatment the iframe gets, so switching between a PDF and a
 * photo looks like one card and not two.
 */
function ImageFrame({ url, title }: { url: string; title: string }) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="relative">
      {!loaded && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-gray-50 text-xs text-gray-500"
          role="status"
        >
          <Spinner />
          Loading preview…
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- a user-uploaded
          Blob URL, or the service worker's offline cache key; `next/image`
          would route both through the optimizer, which is exactly what is
          unreachable with no network. */}
      <img
        src={url}
        alt={title}
        onLoad={() => setLoaded(true)}
        className="w-full h-[550px] object-contain rounded-lg border border-gray-150 bg-gray-50"
      />
    </div>
  )
}

/**
 * The Google viewer iframe, with a spinner over it until it loads: gview often
 * takes seconds and paints nothing meanwhile. Keyed by url at the call site, so
 * picking another tab starts from "loading" again.
 */
function GviewFrame({ url, title }: { url: string; title: string }) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="relative">
      {!loaded && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-gray-50 text-xs text-gray-500"
          role="status"
        >
          <Spinner />
          Loading preview…
        </div>
      )}
      <iframe
        src={`https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`}
        className="w-full h-[550px] rounded-lg border border-gray-150"
        title={title}
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}
