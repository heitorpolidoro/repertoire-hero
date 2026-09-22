'use client'

export interface OfflineUnavailableProps {
  onBack: () => void
}

/**
 * The whole-screen state for a Fast View opened offline for a song that is in
 * no downloaded playlist (RH-80).
 *
 * It replaces `SongNotFound` offline, and the distinction is the point: the
 * song exists, it simply was never downloaded, and "Song not found" would send
 * the musician looking for a problem that is not there. The fix is an action
 * they can take — download the playlist while they still have signal.
 */
export function OfflineUnavailable({ onBack }: OfflineUnavailableProps) {
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
        It is not in any playlist you downloaded. Open the playlist while you have a connection and
        choose <span className="font-medium">Available offline</span> to keep it on this device.
      </p>
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
