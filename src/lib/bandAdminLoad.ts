/**
 * Load semantics for the shared band-admin controller (`useBandAdmin`).
 *
 * `/bands/[id]` and the band tab of `/profile` render the same data through the
 * same handlers, but their `load()` differs in exactly two decisions. Each
 * decision is an explicit, required option here rather than a default, so
 * neither page can inherit the other's behaviour by omission.
 */

export interface BandAdminLoadPolicy {
  /** true → load() wraps everything in try/catch/finally; false → a rejection propagates unhandled. */
  catchLoadErrors: boolean
  /** true → the not-found branch calls setLoading(false) before returning; false → it does not. */
  clearLoadingOnNotFound: boolean
}

/**
 * `/bands/[id]`: a failed load rejects unhandled (the page has never shown a
 * load error), and the not-found branch keeps `loading` true so the page keeps
 * rendering `Loading...` while `router.replace('/bands')` is in flight instead
 * of blanking the screen.
 */
export const BANDS_PAGE_LOAD_POLICY: BandAdminLoadPolicy = {
  catchLoadErrors: false,
  clearLoadingOnNotFound: false,
}

/**
 * `/profile` (band tab): a failed load sets the inline error banner, and the
 * not-found branch clears `loading` so the view can render
 * `Band not found or inaccessible.`.
 */
export const BAND_PROFILE_LOAD_POLICY: BandAdminLoadPolicy = {
  catchLoadErrors: true,
  clearLoadingOnNotFound: true,
}

/** An `Error` contributes its own message; anything else falls back. */
export function resolveLoadErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}
