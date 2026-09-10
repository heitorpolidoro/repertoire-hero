/**
 * RH-69 — the pure tag decisions behind both tag editors of `/playlists/[id]`.
 *
 * The playlist tag bar and the per-song tag row each took these inline, and not
 * the same way: the playlist path trimmed, lowercased, stripped every trailing
 * comma and trimmed again, while the song path only trimmed and lowercased. The
 * already-present check was written twice, the append twice and the filter-out
 * twice. They are decisions about strings, not about rendering, so they live
 * here and `useTagEditor` is the only thing that calls them.
 */

/** Trim, lowercase, strip every trailing comma, then trim what the comma hid. */
export function normalizeTag(raw: string): string {
  let tag = raw.trim().toLowerCase()
  while (tag.endsWith(',')) tag = tag.slice(0, -1)
  return tag.trim()
}

/** Whether the list already carries `tag`, which is expected to be normalised. */
export function hasTag(tags: readonly string[], tag: string): boolean {
  return tags.includes(tag)
}

/**
 * The list with the normalised tag appended, or `null` when there is nothing to
 * write — the tag normalises to the empty string, or the list already has it.
 * Returning `null` rather than the unchanged list is what lets the caller skip
 * both the optimistic apply and the round trip.
 */
export function addTag(tags: readonly string[], raw: string): string[] | null {
  const tag = normalizeTag(raw)
  if (!tag || hasTag(tags, tag)) return null
  return [...tags, tag]
}

/** The list without `tag`, on a copy, with the remaining tags in their order. */
export function removeTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((existingTag) => existingTag !== tag)
}
