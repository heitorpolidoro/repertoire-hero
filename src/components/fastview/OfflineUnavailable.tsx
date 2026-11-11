'use client'

/** A queue song this screen can move to, named on its button. */
export interface OfflineUnavailableTarget {
  title: string
  onSelect: () => void
}

export interface OfflineUnavailableProps {
  onBack: () => void
  /** The nearest previous queue song on this device; absent outside a queue (RH-196). */
  prev?: OfflineUnavailableTarget | null
  /** The nearest next queue song on this device. */
  next?: OfflineUnavailableTarget | null
}

const TARGET_CLASSES =
  'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50'

/**
 * The whole-screen state for a Fast View opened offline for a song that is not
 * stored on this device (RH-80, RH-196).
 *
 * It replaces `SongNotFound` offline, and the distinction is the point: the
 * song exists, it simply is not on this device, and "Song not found" would send
 * the musician looking for a problem that is not there. The fix is an action
 * they can take while they still have signal — the playlist download or the
 * song's own control. Inside a queue it also offers the nearest songs that are
 * on the device, so a gig can carry on past the gap.
 */
export function OfflineUnavailable({ onBack, prev = null, next = null }: OfflineUnavailableProps) {
  return (
    <div
      data-testid="offline-unavailable"
      className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <span aria-hidden="true" className="text-4xl">
        📴
      </span>
      <p className="text-lg font-semibold text-gray-700">This song is not available offline</p>
      <p className="max-w-sm text-sm text-gray-500">
        It is not stored on this device. While you have a connection, open its playlist and choose{' '}
        <span className="font-medium">Make available offline</span>, or open the song and choose{' '}
        <span className="font-medium">Available offline</span>.
      </p>
      {(prev || next) && (
        <div className="w-full max-w-xs flex flex-col gap-2">
          {prev && (
            <button type="button" onClick={prev.onSelect} className={TARGET_CLASSES}>
              &larr; Previous: {prev.title}
            </button>
          )}
          {next && (
            <button type="button" onClick={next.onSelect} className={TARGET_CLASSES}>
              Next: {next.title} &rarr;
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-medium text-emerald-600 hover:text-emerald-800 transition-colors"
      >
        &larr; Back
      </button>
    </div>
  )
}
