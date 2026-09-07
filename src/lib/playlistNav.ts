/**
 * Pure, DOM-free decision helpers for Fast View's playlist navigation (RH-48).
 *
 * Extracted for the same reason as `stageInteraction.ts`: the decisions that are
 * easy to get wrong — which entry is "next", how far a finger has to travel
 * before it counts as a swipe, and exactly which query string survives a move
 * between two songs of the same setlist — become directly unit-testable in the
 * existing `node` vitest environment, with no DOM and no router.
 *
 * This module must not import from `react` / `react-dom` and must not touch
 * `window`, `document` or the App Router tree.
 *
 * See docs/tasks/RH-48-spec.md §1 for the full reasoning.
 */

/**
 * One playlist entry as the setlist UI needs it. Structurally identical to
 * `PlaylistEntrySummary` in `src/lib/playlists.ts`, redeclared here so this
 * client-safe module never pulls the `pg` pool into the browser bundle.
 */
export interface PlaylistEntry {
  repertoireId: string
  songId: string
  title: string
  artist: string | null
}

/** Where the current song sits inside the setlist it was opened from. */
export interface PlaylistNav {
  prevId: string | null
  nextId: string | null
  position: number
  total: number
  playlistId: string
  playlistName: string
}

/** Which way the page slides out before the next one is pushed. */
export type SlideDirection = 'left' | 'right'

/** Minimum horizontal travel, in CSS pixels, that counts as a swipe. */
export const SWIPE_THRESHOLD_PX = 60

/** How long the slide-out transition runs before the router push, in ms. */
export const SLIDE_OUT_MS = 220

/** Base classes of the page's `<main>`, without the transform. */
const MAIN_CLASSES =
  'min-h-screen px-6 py-8 flex flex-col gap-6 max-w-xl mx-auto transition-transform duration-200 ease-in-out '

/** `/playlists/<id>` -> `<id>`; anything else (incl. null) -> null. */
export function playlistIdFromReturnTo(returnTo: string | null): string | null {
  const match = returnTo?.match(/^\/playlists\/([\w-]+)$/)
  return match ? match[1] : null
}

/** null when `entries` is empty or `currentRepertoireId` is not in it. */
export function computePlaylistNav(
  entries: PlaylistEntry[],
  currentRepertoireId: string,
  playlistId: string,
  playlistName: string,
): PlaylistNav | null {
  const index = entries.findIndex((entry) => entry.repertoireId === currentRepertoireId)
  if (index === -1) return null

  return {
    prevId: index > 0 ? entries[index - 1].repertoireId : null,
    nextId: index < entries.length - 1 ? entries[index + 1].repertoireId : null,
    position: index + 1,
    total: entries.length,
    playlistId,
    playlistName,
  }
}

/**
 * `/songs/<id>/fast-view?returnTo=..&bandId=..`, both omitted when empty and
 * always in that order.
 *
 * The `?` is emitted even when both are absent, byte-identical to the string the
 * page built before the extraction: preserving it keeps a bookmark or a history
 * entry created by either version of the page comparable.
 */
export function fastViewHref(
  repertoireId: string,
  returnTo: string | null,
  bandId: string | null,
): string {
  const qs = new URLSearchParams()
  if (returnTo) qs.set('returnTo', returnTo)
  if (bandId) qs.set('bandId', bandId)
  return `/songs/${repertoireId}/fast-view?${qs.toString()}`
}

/** 'left' when the target sits later in the list, otherwise 'right'. */
export function slideDirection(
  entries: PlaylistEntry[],
  currentRepertoireId: string,
  targetRepertoireId: string,
): SlideDirection {
  const currentIndex = entries.findIndex((entry) => entry.repertoireId === currentRepertoireId)
  const targetIndex = entries.findIndex((entry) => entry.repertoireId === targetRepertoireId)
  return targetIndex > currentIndex ? 'left' : 'right'
}

/**
 * Where a horizontal swipe lands. `deltaX = startX - endX`, so a positive delta
 * is a leftward drag, which reveals the *next* song.
 *
 * Null below `SWIPE_THRESHOLD_PX`, without a nav, and when the neighbour the
 * gesture asks for does not exist (first or last entry of the setlist).
 */
export function swipeTarget(
  deltaX: number,
  nav: PlaylistNav | null,
): { repertoireId: string; direction: SlideDirection } | null {
  if (!nav || Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return null

  if (deltaX > 0) {
    return nav.nextId ? { repertoireId: nav.nextId, direction: 'left' } : null
  }
  return nav.prevId ? { repertoireId: nav.prevId, direction: 'right' } : null
}

/** The full className of the page's `<main>`, including the transform. */
export function slideOutClassName(slideOut: SlideDirection | null): string {
  if (slideOut === 'left') return `${MAIN_CLASSES}-translate-x-full`
  if (slideOut === 'right') return `${MAIN_CLASSES}translate-x-full`
  return `${MAIN_CLASSES}translate-x-0`
}

/** What the back button must do. */
export function backTarget(
  returnTo: string | null,
): { kind: 'push'; href: string } | { kind: 'back' } {
  return returnTo ? { kind: 'push', href: returnTo } : { kind: 'back' }
}
