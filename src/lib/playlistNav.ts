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

import { queueNeighbours, type SongQueueEntry } from '@/lib/songQueue'

/**
 * One playlist entry as a *playlist read* knows it: every field, none optional.
 * Structurally identical to `PlaylistEntrySummary` in `src/lib/playlists.ts`,
 * redeclared here so this client-safe module never pulls the `pg` pool into the
 * browser bundle.
 *
 * `versionId` is the entry's identity and is always non-null (RH-125). It is
 * also the Fast View address since RH-132, so **every** entry is navigable.
 * `repertoireId` is the owner's row **if there is one**; a null means "not in
 * this repertoire yet", which is information the row still renders, never "this
 * entry has nowhere to navigate to".
 *
 * **This is also a persisted shape**, which is why RH-133 left it strict rather
 * than widening it for the queue: `src/lib/offlineStore.ts`,
 * `src/lib/offlineSnapshot.ts` and `src/lib/offlineSnapshotV5.ts` all type the
 * `entry` they write into IndexedDB as this interface, and their runtime
 * validator only checks that it is a record — so the type is the whole
 * guarantee that a future snapshot writer cannot drop `songId`. The setlist
 * chrome uses the laxer `SetlistEntry` below instead.
 */
export interface PlaylistEntry {
  repertoireId: string | null
  versionId: string
  songId: string
  title: string
  artist: string | null
}

/**
 * One entry as the *setlist chrome* needs it: the three navigation fields every
 * queue entry carries (`SongQueueEntry`), plus the two only a playlist read can
 * supply, both optional.
 *
 * Optional, because since RH-133 the chrome is fed from the `sessionStorage`
 * queue, which deliberately stores neither: `undefined` means "this source does
 * not know", while `repertoireId: null` still means "the owner holds no row for
 * this entry" and is still rendered as such. A `PlaylistEntry` is assignable to
 * this, which is the direction that matters.
 */
export interface SetlistEntry extends SongQueueEntry {
  repertoireId?: string | null
  songId?: string
}

/**
 * Where the current song sits inside the queue it was opened from.
 *
 * RH-133 dropped `playlistId` (nothing read it once Back went to the queue's
 * recorded origin) and renamed the playlist-specific name field to
 * `queueLabel`, so a queue that is not a playlist — a practice session, a
 * hand-picked selection — can label itself.
 */
export interface PlaylistNav {
  /** The previous entry's `versionId` — a Fast View address (RH-132). */
  prevId: string | null
  /** The next entry's `versionId` — a Fast View address (RH-132). */
  nextId: string | null
  position: number
  total: number
  /** What the chrome calls this queue: a playlist's name, a session's. */
  queueLabel: string
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

/**
 * null when `entries` is empty or `currentVersionId` is not in it.
 *
 * Matching is by `versionId`, because the Fast View route param *is* a
 * `song_versions.id` since RH-132 and the owner comes from the page's
 * `?bandId=`. Every entry therefore has an address, which is what removed the
 * skip-the-neighbour-with-no-owner-row step this function used to apply:
 * `prevId` and `nextId` are the plain neighbours now, including the ones whose
 * owner holds no row. `position` and `total` count every entry, as before.
 */
export function computePlaylistNav(
  entries: SongQueueEntry[],
  currentVersionId: string,
  queueLabel: string,
): PlaylistNav | null {
  const index = entries.findIndex((entry) => entry.versionId === currentVersionId)
  if (index === -1) return null

  // The ends are absent, never wrapped — one definition of that, in
  // `queueNeighbours`, shared with the window RH-134 will fetch.
  const { prev, next } = queueNeighbours(entries, currentVersionId)

  return {
    prevId: prev?.versionId ?? null,
    nextId: next?.versionId ?? null,
    position: index + 1,
    total: entries.length,
    queueLabel,
  }
}

/**
 * `/songs/<versionId>/fast-view?bandId=..`, with the parameter omitted when it
 * is empty.
 *
 * RH-133 removed the deleted playlist return parameter this used to carry
 * first: the origin Back goes to is recorded in the queue now, so the address
 * is just the version plus its owner. The historical account of the retired
 * parameter is in `docs/use-cases.md` § *Walk a queue of songs*.
 *
 * The `?` is emitted even when `bandId` is absent, byte-identical to the string
 * the page built before the extraction: preserving it keeps a bookmark or a
 * history entry created by either version of the page comparable.
 */
export function fastViewHref(versionId: string, bandId: string | null): string {
  const qs = new URLSearchParams()
  if (bandId) qs.set('bandId', bandId)
  return `/songs/${versionId}/fast-view?${qs.toString()}`
}

/** 'left' when the target sits later in the list, otherwise 'right'. */
export function slideDirection(
  entries: SongQueueEntry[],
  currentVersionId: string,
  targetVersionId: string,
): SlideDirection {
  const currentIndex = entries.findIndex((entry) => entry.versionId === currentVersionId)
  const targetIndex = entries.findIndex((entry) => entry.versionId === targetVersionId)
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
): { versionId: string; direction: SlideDirection } | null {
  if (!nav || Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return null

  if (deltaX > 0) {
    return nav.nextId ? { versionId: nav.nextId, direction: 'left' } : null
  }
  return nav.prevId ? { versionId: nav.prevId, direction: 'right' } : null
}

/**
 * The parts of a `keydown` event the arrow-key navigation decides on, already
 * read off the DOM by the caller so this module stays DOM-free.
 */
export interface NavKeyPress {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  /** The event was already handled by something else on the page. */
  defaultPrevented: boolean
  /** Focus sits in an input, textarea, select or contenteditable element. */
  editableTarget: boolean
}

/**
 * Where an arrow key lands: ArrowRight and ArrowDown go to the next song,
 * ArrowLeft and ArrowUp to the previous one, mirroring the swipe directions.
 * Up/Down are included for page-turner pedals that send them; in a playlist
 * they therefore no longer scroll the page (Space / Page Up / Page Down do).
 *
 * Null without a nav, for any other key, for a modified key (Alt+Left is the
 * browser's history back), while the musician is typing, when something else
 * already handled the event, and at either end of the setlist.
 */
const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown'])
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp'])

export function keyboardTarget(
  press: NavKeyPress,
  nav: PlaylistNav | null,
): { versionId: string; direction: SlideDirection } | null {
  if (!nav || press.defaultPrevented || press.editableTarget) return null
  if (press.altKey || press.ctrlKey || press.metaKey || press.shiftKey) return null

  if (NEXT_KEYS.has(press.key)) {
    return nav.nextId ? { versionId: nav.nextId, direction: 'left' } : null
  }
  if (PREV_KEYS.has(press.key)) {
    return nav.prevId ? { versionId: nav.prevId, direction: 'right' } : null
  }
  return null
}

/** The full className of the page's `<main>`, including the transform. */
export function slideOutClassName(slideOut: SlideDirection | null): string {
  if (slideOut === 'left') return `${MAIN_CLASSES}-translate-x-full`
  if (slideOut === 'right') return `${MAIN_CLASSES}translate-x-full`
  return `${MAIN_CLASSES}translate-x-0`
}

/**
 * What the back button must do: push the href the queue recorded as its origin,
 * or walk browser history back when there is no queue to ask.
 *
 * **No special case for a playlist.** The origin is whatever built the queue —
 * a playlist page, the band screen a practice session started from, wherever a
 * picker was opened — so reconstructing a route shape from anything but the
 * recorded href would satisfy only the one origin that exists today.
 */
export function backTarget(
  originHref: string | null,
): { kind: 'push'; href: string } | { kind: 'back' } {
  return originHref ? { kind: 'push', href: originHref } : { kind: 'back' }
}
