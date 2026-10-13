/**
 * RH-138 — applying an approved link-row suggestion to `song_links`.
 *
 * A link correction names one `song_links` row by its stable id and one thing
 * about it: its `url`, its `label`, or its removal. Approving it writes that one
 * row and nothing else — no replace-set, no renumbering, never `position`.
 *
 * A plain library module (no server-action directive, not under
 * `src/app/actions/`): it takes a `Queryable` the caller already opened a
 * transaction on and holds no authorization decision. `src/lib/moderation.ts`
 * owns the gate and the transaction.
 *
 * **The column name is never interpolated.** Each of the three allowlisted
 * columns maps to its own fixed statement text in {@link LINK_ROW_STATEMENTS};
 * a column outside the map is refused with the `Invalid catalog suggestion`
 * prefix before any statement is issued.
 */
import { CATALOG_SUGGESTION_PREFIX, parseCatalogSuggestionValue } from '@/lib/catalogSuggestionPayload'
import {
  LINK_SUGGESTION_TARGET_TABLE as LINK_TARGET_TABLE,
  type SuggestionEntry,
} from '@/lib/catalogSuggestionSql'
import type { Queryable } from '@/lib/db'
import type { CatalogSuggestion } from '@/types/database'

/** One approved, already-narrowed link-row suggestion. */
export interface ApprovedLinkChange {
  linkId: string
  column: string
  value: unknown
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One link row's change as a correction submits it (`LinkChangeInput`, in
 * `catalogFields.ts`). `removed` wins: a row marked removed carries no `url` /
 * `label` entries.
 */
function entriesOfLinkChange(item: unknown, seen: Set<string>): SuggestionEntry[] {
  if (typeof item !== 'object' || item === null) {
    throw new Error(`${CATALOG_SUGGESTION_PREFIX}: a link change must be an object`)
  }
  const change: Record<string, unknown> = { ...item }
  const linkId = change.linkId
  if (typeof linkId !== 'string' || !UUID.test(linkId)) {
    throw new Error(`${CATALOG_SUGGESTION_PREFIX}: a link change must name a link id`)
  }
  if (seen.has(linkId)) {
    throw new Error(`${CATALOG_SUGGESTION_PREFIX}: link ${linkId} is changed twice`)
  }
  seen.add(linkId)
  const columns =
    change.removed === undefined ? ['url', 'label'].filter((c) => change[c] !== undefined) : ['removed']
  if (columns.length === 0) {
    throw new Error(`${CATALOG_SUGGESTION_PREFIX}: link ${linkId} proposes no change`)
  }
  return columns.map((column) => ({
    table: LINK_TARGET_TABLE,
    targetId: linkId,
    column,
    value: parseCatalogSuggestionValue(LINK_TARGET_TABLE, column, change[column]),
  }))
}

/**
 * Narrows a submission's `linkChanges` into fan-out entries: one per
 * (link id, changed thing). Absent means no link change. Pure.
 *
 * @throws with the `Invalid catalog suggestion` prefix on anything malformed.
 */
export function parseLinkChanges(raw: unknown): SuggestionEntry[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    throw new Error(`${CATALOG_SUGGESTION_PREFIX}: linkChanges must be an array`)
  }
  const seen = new Set<string>()
  return raw.flatMap((item) => entriesOfLinkChange(item, seen))
}

/** The closed column-to-statement map. */
const LINK_ROW_STATEMENTS: Readonly<Record<string, string>> = {
  url: 'UPDATE song_links SET url = $2 WHERE id = $1',
  label: 'UPDATE song_links SET label = $2 WHERE id = $1',
  removed: 'DELETE FROM song_links WHERE id = $1',
}

/** Every column a link-row suggestion can name, for supersession on removal. */
const LINK_COLUMNS = ['url', 'label', 'removed'] as const

/** `song_links` rows of every song that owns one of the given links. */
const SIBLING_LINKS_SQL = `
  SELECT id, song_id, url FROM song_links
   WHERE song_id IN (SELECT song_id FROM song_links WHERE id = ANY($1::uuid[]))
`

interface SiblingLink {
  id: string
  song_id: string
  url: string
}

/**
 * The first approved url edit that would land on a url another row of the same
 * song holds (`UNIQUE (song_id, url)`), as an error message — or `undefined`.
 *
 * A row removed by the same approval does not count as holding its url, and two
 * edits landing on one url collide with each other. Pure.
 */
export function findUrlCollision(
  siblings: readonly SiblingLink[],
  changes: readonly ApprovedLinkChange[],
): string | undefined {
  const removed = new Set(changes.filter((c) => c.column === 'removed').map((c) => c.linkId))
  const songOf = new Map(siblings.map((s) => [s.id, s.song_id]))
  const claimed = new Set<string>()
  for (const change of changes) {
    if (change.column !== 'url') continue
    const songId = songOf.get(change.linkId)
    if (songId === undefined) continue // the link is gone: the write matches nothing
    const url = String(change.value)
    const heldElsewhere = siblings.some(
      (s) => s.song_id === songId && s.url === url && s.id !== change.linkId && !removed.has(s.id),
    )
    const key = `${songId}\n${url}`
    if (heldElsewhere || claimed.has(key)) {
      return `${CATALOG_SUGGESTION_PREFIX}: url ${url} is already a link of this song`
    }
    claimed.add(key)
  }
  return undefined
}

/**
 * Writes the approved link rows. Every collision is checked first, so a refused
 * group has written nothing; removals run before edits so a url freed by a
 * removal in the same approval can be taken.
 *
 * Returns the ids of the songs the changed links belong to (read before the
 * write, so a removed link still names its song), which is how a link-only
 * group finds the `songs` row whose `updated_at` it bumps.
 *
 * @throws with the `Invalid catalog suggestion` prefix on an unknown column or a
 * url collision.
 */
export async function applyApprovedLinkChanges(
  client: Queryable,
  changes: readonly ApprovedLinkChange[],
): Promise<string[]> {
  if (changes.length === 0) return []
  for (const change of changes) {
    if (!Object.hasOwn(LINK_ROW_STATEMENTS, change.column)) {
      throw new Error(`${CATALOG_SUGGESTION_PREFIX}: ${LINK_TARGET_TABLE}.${change.column} is not applicable`)
    }
  }

  const siblings = await client.query<SiblingLink>(SIBLING_LINKS_SQL, [
    changes.map((c) => c.linkId),
  ])
  const collision = findUrlCollision(siblings.rows, changes)
  if (collision) throw new Error(collision)

  const ordered = [...changes].sort(
    (a, b) => Number(b.column === 'removed') - Number(a.column === 'removed'),
  )
  for (const change of ordered) {
    const sql = LINK_ROW_STATEMENTS[change.column]
    const params = change.column === 'removed' ? [change.linkId] : [change.linkId, change.value]
    await client.query<never>(sql, params)
  }

  const changed = new Set(changes.map((c) => c.linkId))
  return [...new Set(siblings.rows.filter((s) => changed.has(s.id)).map((s) => s.song_id))]
}

/**
 * The ids the admin rejects, each of which must be a pending link-row
 * suggestion of this group: a `songs` column row is decided with the group, and
 * an id from another group must not be reachable through this one. Pure.
 */
export function validatedRejectedIds(
  pending: readonly CatalogSuggestion[],
  requested: readonly string[] | undefined,
): string[] {
  const linkRowIds = new Set(
    pending.filter((r) => r.target_table === LINK_TARGET_TABLE).map((r) => r.id),
  )
  const ids = [...new Set(requested ?? [])]
  for (const id of ids) {
    if (!linkRowIds.has(id)) {
      throw new Error(`${CATALOG_SUGGESTION_PREFIX}: ${id} is not a link row of this group`)
    }
  }
  return ids
}

/**
 * The `(link id, column)` pairs an approval closes: an approved `removed` closes
 * every pending suggestion on that link (the row is gone); a `url` / `label`
 * closes pending competitors on the same `(link id, column)`. Returned as two
 * parallel arrays for one `unnest` statement. Pure.
 */
export function supersededLinkPairs(changes: readonly ApprovedLinkChange[]): {
  linkIds: string[]
  columns: string[]
} {
  const linkIds: string[] = []
  const columns: string[] = []
  for (const change of changes) {
    const closed = change.column === 'removed' ? LINK_COLUMNS : [change.column]
    for (const column of closed) {
      linkIds.push(change.linkId)
      columns.push(column)
    }
  }
  return { linkIds, columns }
}
