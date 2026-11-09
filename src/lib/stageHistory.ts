/**
 * The Stage Mode history marker, in one place (RH-50).
 *
 * Both Stage Mode overlays — the lyrics one and the PDF one — push a history
 * entry when they open, so the hardware/browser back button closes the overlay
 * instead of leaving the page. Each owns its own effect, and they share this
 * module so the marker they push and the marker they test for cannot drift.
 *
 * Pure: no DOM access, so it runs in the default `node` test environment.
 */

/** The history entry Stage Mode pushes so the back button closes it. */
export function stageHistoryState(): { stageMode: true } {
  return { stageMode: true }
}

/**
 * True when `state` is the entry `stageHistoryState()` pushed, i.e. when the
 * entry on top of the history stack is the one an open Stage Mode added.
 *
 * The flag is read through a scoped structural cast rather than an `any`-typed
 * binding (AGENTS.md, "Error Handling Conventions"): the history state is
 * whatever the browser hands back, and only this one key is trusted.
 */
export function isStageHistoryEntry(state: unknown): boolean {
  return (state as { stageMode?: unknown } | null)?.stageMode === true
}

/**
 * Removes any `stage` query parameter from the current URL via history.replaceState,
 * keeping the existing history state. If no `stage` param is present, does nothing.
 */
export function stripStageParam(): void {
  if (typeof window === 'undefined') return
  const search = window.location.search
  if (!search) return

  const params = new URLSearchParams(search)
  if (!params.has('stage')) return

  params.delete('stage')
  const newSearch = params.toString() ? `?${params.toString()}` : ''
  const newUrl = `${window.location.pathname}${newSearch}${window.location.hash}`
  window.history.replaceState(window.history.state, '', newUrl)
}
