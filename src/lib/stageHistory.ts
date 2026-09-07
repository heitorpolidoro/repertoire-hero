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
