import { useSyncExternalStore } from 'react'

/**
 * RH-77 — "has this tree hydrated in the browser yet?".
 *
 * A client island rendered through the SSR pass must not read a value the
 * server cannot know: `src/store/bandContextStore.ts` rehydrates synchronously
 * from `localStorage` at store creation, so a band-mode user's first client
 * render already carries `{ type: 'band', ... }` while the server rendered the
 * `{ type: 'user' }` default. Gating every band-context-derived output behind
 * this flag makes the server render and the first client render identical, and
 * lets the real value appear on the render that follows hydration.
 *
 * `useSyncExternalStore` is the shape, deliberately, and not
 * `useState(false)` + `useEffect(() => setMounted(true), [])`: the latter is a
 * `react-hooks/set-state-in-effect` error under this repository's eslint
 * config (both occurrences in `AppLayout.tsx` are errors in the baseline).
 * React calls `getServerSnapshot` during SSR and during the hydration render,
 * then `getSnapshot` on every render after it, so the flip happens without any
 * state write of our own. `subscribe` never fires — the value changes exactly
 * once, and React already re-renders at that point.
 */
const subscribe = (): (() => void) => () => {}
const getSnapshot = (): boolean => true
const getServerSnapshot = (): boolean => false

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
