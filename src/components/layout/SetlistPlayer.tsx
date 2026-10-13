'use client'

import Link from 'next/link'
import { fastViewHref } from '@/lib/playlistNav'
import type { SetlistPlayerController } from '@/hooks/useSetlistPlayer'

const BADGES = { file: 'File', spotify: 'Spotify', youtube: 'YouTube' } as const
const BUTTON = 'rounded-full px-3 py-1.5 text-sm font-semibold disabled:opacity-40'

interface SetlistPlayerProps {
  controller: SetlistPlayerController
  /** Callback refs for the two hoisted nodes (passed apart: they are not render data). */
  bindAudio: (node: HTMLAudioElement | null) => void
  bindYoutube: (node: HTMLElement | null) => void
}

/**
 * RH-167 - the persistent setlist bar. Mounted by `AppShell` above the routes,
 * so the `<audio>` node and the YouTube host never remount on navigation. Both
 * exist only online (offline mounts no audio, iframe or script) and `<audio>`
 * carries no `autoplay` and `preload="none"`: nothing loads before the tap.
 */
export function SetlistPlayer({ controller: c, bindAudio, bindYoutube }: SetlistPlayerProps) {
  if (!c.enabled) return null

  return (
    <>
      {!c.offline && <audio ref={bindAudio} preload="none" />}
      <div
        role="region"
        aria-label="Setlist player"
        hidden={!c.visible}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white shadow-2xl"
      >
        {/* The YouTube frame is visible whenever the current source is YouTube, never 0-sized. */}
        {!c.offline && (
          <div ref={bindYoutube} className={c.kind === 'youtube' ? 'mx-auto aspect-video w-full max-w-sm' : 'hidden'} />
        )}
        {c.visible && <Bar c={c} />}
      </div>
    </>
  )
}

function Bar({ c }: { c: SetlistPlayerController }) {
  const playing = c.status === 'playing'
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {c.kind && !c.offline && (
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
              {BADGES[c.kind]}
            </span>
          )}
          {c.versionId ? (
            <Link href={fastViewHref(c.versionId, c.bandId)} className="truncate text-sm font-bold text-gray-900">
              {c.title}
            </Link>
          ) : (
            <span className="truncate text-sm font-bold text-gray-900">{c.title}</span>
          )}
        </div>
        <p role="status" className="truncate text-xs font-medium text-amber-700">
          {c.message}
        </p>
        {c.nextTitle && <p className="truncate text-xs text-gray-600">Next: {c.nextTitle}</p>}
      </div>
      <span className="text-xs font-semibold text-gray-500">{c.counter}</span>
      <button type="button" aria-label="Previous" disabled={!c.hasPrev || c.offline} onClick={c.prev} className={BUTTON}>
        &#9198;
      </button>
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={c.offline}
        onClick={c.toggle}
        className={`${BUTTON} bg-emerald-600 text-white`}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button type="button" aria-label="Next" disabled={!c.hasNext || c.offline} onClick={c.next} className={BUTTON}>
        &#9197;
      </button>
      <button type="button" aria-label="Close player" onClick={c.dismiss} className={BUTTON}>
        &#10005;
      </button>
    </div>
  )
}
