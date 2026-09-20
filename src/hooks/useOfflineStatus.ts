import { useSyncExternalStore } from 'react'

/**
 * RH-78 — "is the browser offline right now?".
 *
 * The signal the PWA shell publishes and RH-79/RH-80 consume: `true` while the
 * browser reports no network, `false` otherwise and always during SSR (the
 * server cannot know, and the optimistic answer keeps the server render and the
 * hydration render identical).
 *
 * The shape follows `useHydrated.ts` (RH-77) deliberately. `useState` +
 * `useEffect` would be the obvious spelling and is a
 * `react-hooks/set-state-in-effect` error under this repository's eslint
 * config; `useSyncExternalStore` subscribes to the two `window` events and
 * re-reads `navigator.onLine` with no state write of our own.
 *
 * `navigator.onLine` is a floor, not a guarantee: `true` only means the machine
 * has *a* network interface, so a request may still fail. Every consumer treats
 * a failed fetch as offline regardless of what this returns.
 */
function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange)
  window.addEventListener('offline', onStoreChange)
  return () => {
    window.removeEventListener('online', onStoreChange)
    window.removeEventListener('offline', onStoreChange)
  }
}

function getSnapshot(): boolean {
  return !navigator.onLine
}

function getServerSnapshot(): boolean {
  return false
}

export function useOfflineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
