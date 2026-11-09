'use client'

import Link from 'next/link'
import { fastViewHref } from '@/lib/playlistNav'
import { formatTuningDisplay } from '@/lib/songTuning'
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
      {c.countdown !== null && <CountdownOverlay c={c} />}
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

function CountdownOverlay({ c }: { c: SetlistPlayerController }) {
  const validFields = (c.customFields || []).filter((f) => f.value && f.value.trim() !== '')
  const hasMetadata = Boolean(c.tuning || validFields.length > 0)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Setlist countdown"
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-black/90 p-8 text-white backdrop-blur-md pointer-events-auto select-none"
    >
      <div className="flex w-full max-w-md items-center justify-between">
        <span className="rounded-full border border-emerald-800/80 bg-emerald-950/60 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Starting Song In
        </span>
        <button
          type="button"
          aria-label="Cancel countdown"
          onClick={c.cancelCountdown}
          className="flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          Cancel
        </button>
      </div>

      <div className="my-auto flex w-full max-w-md flex-col items-center justify-center text-center">
        <div
          data-testid="countdown-display"
          className="text-[30vh] font-black leading-none tracking-tighter text-white tabular-nums drop-shadow-2xl"
        >
          {c.countdown}
        </div>
        <div className="mt-4 w-full px-4">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Up Next</p>
          <h3 className="mt-1 truncate text-xl font-bold text-white">{c.title}</h3>
          {c.artist && <p className="truncate text-sm text-gray-300">{c.artist}</p>}
          {hasMetadata && (
            <div
              data-testid="countdown-metadata"
              className="mt-3 flex flex-wrap items-center justify-center gap-2 max-w-full px-2"
            >
              {c.tuning && (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-950/50 px-2.5 py-1 text-xs text-emerald-300 shadow-sm max-w-full min-w-0">
                  <span className="font-medium text-emerald-400/80 shrink-0">Tuning:</span>
                  <span className="font-semibold text-emerald-200 truncate">
                    {formatTuningDisplay(c.tuning)}
                  </span>
                </span>
              )}
              {validFields.map((field) => (
                <span
                  key={field.name}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-gray-200 shadow-sm max-w-full min-w-0"
                >
                  <span className="max-w-[120px] truncate font-medium text-gray-400">{field.name}:</span>
                  <span className="max-w-[160px] truncate font-semibold text-white">{field.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex w-full max-w-xs flex-col items-center gap-2">
        <button
          type="button"
          aria-label="Skip countdown"
          onClick={c.skipCountdown}
          className="flex w-full items-center justify-center rounded-full bg-emerald-500 px-6 py-3.5 text-sm font-bold tracking-wide text-slate-950 shadow-xl shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-95"
        >
          Skip countdown
        </button>
      </div>
    </div>
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
