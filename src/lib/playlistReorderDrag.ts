/**
 * RH-103 — the pure arithmetic behind dragging a playlist row.
 *
 * `usePlaylistReorderDrag` owns the Pointer Events and the measuring; every
 * *decision* is here, so it can be checked against plain numbers with no DOM
 * and no React. No module under `src/lib` may hold a gesture, and no hook
 * should hold arithmetic nobody can test.
 */

/** How close to a scroll container's edge the pointer has to get, in px. */
const EDGE_SCROLL_ZONE = 48

/** How far the container scrolls per pointer move while inside that zone. */
const EDGE_SCROLL_STEP = 8

/**
 * Which gap the pointer is over, given the rows' vertical midpoints in list
 * order: `0` above the first row, `n` below the last. A pointer exactly on a
 * midpoint reads as *past* it — the comparison has to fall one way, and this
 * way the answer only ever moves forwards as the finger moves down.
 *
 * The index is an insertion index into the list as it stands, which is what
 * `reorderIds` below expects.
 */
export function insertionIndexAt(midpoints: number[], y: number): number {
  let index = 0
  while (index < midpoints.length && y >= midpoints[index]) index++
  return index
}

/**
 * What a release decides: the whole new id order, or that it changed nothing.
 * Reported rather than returning an unchanged order so the controller can
 * short-circuit — a drag released where it started must not become a real
 * `UPDATE` and a real Spotify track-list replacement.
 */
export type PlaylistReorder =
  | { reordered: true; orderedIds: string[] }
  | { reordered: false }

/** The no-op report, so no call site has to spell the literal. */
export const NO_PLAYLIST_REORDER: PlaylistReorder = { reordered: false }

/**
 * `ids` with the row at `from` lifted out and inserted at the gap `to`, where
 * `to` is an insertion index read against the *original* list. Two gaps leave
 * the row where it was — the one it is already above (`from`) and the one just
 * below it (`from + 1`) — and both report no change, as does an origin outside
 * the list. The source array is never mutated.
 */
export function reorderIds(ids: string[], from: number, to: number): PlaylistReorder {
  if (from < 0 || from >= ids.length) return NO_PLAYLIST_REORDER
  if (to === from || to === from + 1) return NO_PLAYLIST_REORDER

  const orderedIds = [...ids]
  const [moved] = orderedIds.splice(from, 1)
  orderedIds.splice(to > from ? to - 1 : to, 0, moved)
  return { reordered: true, orderedIds }
}

/** Whether two id lists are the same ids in the same places. */
export function isSameOrder(current: string[], next: string[]): boolean {
  return current.length === next.length && current.every((id, index) => id === next[index])
}

/**
 * How far the scroll container should move so a row can reach a place that is
 * off-screen: a fixed step up near the top edge, down near the bottom edge, and
 * nothing anywhere between. The caller applies it per pointer move, which is
 * frequent enough to feel continuous and costs no animation frame of its own.
 */
export function edgeScrollStep(y: number, top: number, bottom: number): number {
  if (y - top < EDGE_SCROLL_ZONE) return -EDGE_SCROLL_STEP
  if (bottom - y < EDGE_SCROLL_ZONE) return EDGE_SCROLL_STEP
  return 0
}
