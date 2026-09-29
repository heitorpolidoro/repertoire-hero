import { useEffect } from 'react'

/**
 * Keeps the screen on while the page that calls it is mounted, through the
 * Screen Wake Lock API: a phone on a music stand must not dim or lock in the
 * middle of a song.
 *
 * The browser drops the lock by itself whenever the page is hidden (tab switch,
 * app switch, manual screen lock), so it is requested again each time the page
 * becomes visible. Best effort by design: without the API (older browsers, or
 * an insecure origin) or when the request is refused (e.g. battery saver), the
 * page simply behaves as it did before, with no error surfaced.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let disposed = false

    const acquire = () => {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return
      navigator.wakeLock
        .request('screen')
        .then((lock) => {
          // Unmounted while the request was in flight: give it straight back.
          if (disposed) {
            void lock.release()
            return
          }
          sentinel = lock
        })
        .catch(() => {
          // Refused (battery saver, page not visible yet): the screen just
          // follows the device's own timeout, as it did before.
        })
    }

    acquire()
    document.addEventListener('visibilitychange', acquire)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', acquire)
      if (sentinel && !sentinel.released) void sentinel.release()
    }
  }, [])
}
