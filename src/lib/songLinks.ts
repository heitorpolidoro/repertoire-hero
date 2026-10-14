/**
 * Pure, DOM-free decision helpers for Fast View's links section (RH-52).
 *
 * The duplicate check, the label fallback chain and the two list edits are the
 * parts of the add/delete flows that are easy to get wrong, so they live here
 * and are unit-tested in the default `node` vitest environment, with no DOM, no
 * React and no Server Action.
 *
 * It also declares the `SongLinksController` contract, so the presentational
 * components under `src/components/fastview` can type the controller they
 * receive without importing the hook that builds it.
 */

import type { SongLink } from '@/types/database'

/** True when the typed url is already in the list; compared against `url.trim()`. */
export function isDuplicateLinkUrl(links: SongLink[], url: string): boolean {
  const candidate = url.trim()
  return links.some((link) => link.url === candidate)
}

/** The typed label, else the auto-fetched page title, else the url itself. */
export function resolveLinkLabel(label: string, fetchedTitle: string, url: string): string {
  return label || fetchedTitle || url
}

/** A new list with `link` appended; the input list is not mutated. */
export function appendLink(links: SongLink[], link: SongLink): SongLink[] {
  return [...links, link]
}

/** A new list without any link carrying `url`; the input list is not mutated. */
export function removeLinkByUrl(links: SongLink[], url: string): SongLink[] {
  return links.filter((link) => link.url !== url)
}

/** One row of the Links section: a plain link, or several links of one provider. */
export type LinkEntry =
  | { kind: 'single'; link: SongLink }
  | { kind: 'group'; provider: 'spotify' | 'youtube'; links: SongLink[] }

const GROUPED_PROVIDERS = ['spotify', 'youtube'] as const

/**
 * Partitions links into display rows (RH-145): Spotify, then YouTube, then every
 * other link (a missing provider counts as `other`) as its own row. A provider
 * with one link is a `single`, with several a `group`. Input order is kept.
 */
export function groupLinksByProvider(links: SongLink[]): LinkEntry[] {
  const entries: LinkEntry[] = []
  for (const provider of GROUPED_PROVIDERS) {
    const own = links.filter((link) => link.provider === provider)
    if (own.length === 1) entries.push({ kind: 'single', link: own[0] })
    else if (own.length > 1) entries.push({ kind: 'group', provider, links: own })
  }
  for (const link of links) {
    if (link.provider !== 'spotify' && link.provider !== 'youtube') entries.push({ kind: 'single', link })
  }
  return entries
}

/**
 * Everything `useSongLinks` exposes. Declared here, not in the hook, so the
 * presentational components can type it without importing `src/hooks`.
 */
export interface SongLinksController {
  /** `entry?.song?.links ?? []`. */
  links: SongLink[]
  isAdding: boolean
  startAdding: () => void
  /** Closes the add form and clears both inputs. */
  cancelAdding: () => void
  label: string
  setLabel: (value: string) => void
  url: string
  setUrl: (value: string) => void
  saving: boolean
  /** DOM-free: the form's `preventDefault` stays in `AddLinkForm`. */
  submit: () => Promise<void>
  /** The url whose delete confirmation is on screen; null when there is none. */
  pendingDeleteUrl: string | null
  deleteBusy: boolean
  requestDelete: (url: string) => void
  confirmDelete: () => Promise<void>
  cancelDelete: () => void
}
