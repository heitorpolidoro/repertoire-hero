/**
 * RH-55 (RH-25 F17), RH-107 — the only sanctioned way to narrow a proposed
 * catalog correction before it reaches the catalog.
 *
 * A row in the moderation queue holds whatever the requester submitted, so its
 * values must be narrowed before any of them reaches an `UPDATE`. This module
 * owns that narrowing for the mutable catalog columns a correction may propose:
 * it accepts a subset of them, normalizes each one the way the catalog stores
 * it, and throws a message the UI can show verbatim otherwise.
 *
 * **Two functions, because they refuse different things.**
 *
 *  - {@link parseCatalogSuggestionPayload} is the submit-time group narrower.
 *    Keys that are not catalog columns are **ignored** rather than rejected
 *    (`src/components/songs/CorrectionModal.tsx` sends a `reason` alongside the
 *    proposed columns, and the admin queue renders it), and they never appear
 *    in the returned payload.
 *  - {@link parseCatalogSuggestionValue} is the per-`(table, column)`
 *    validator, and the one place a caller-supplied identifier is admitted. It
 *    **rejects** a pair outside {@link CATALOG_SUGGESTION_COLUMNS}, because it
 *    is called immediately before that column name is interpolated into an
 *    identifier position.
 *
 * That split is what makes the ignore-vs-reject asymmetry safe: the only
 * function that ever sees a column *name* refuses an unknown one, and the only
 * function that tolerates stray keys never produces a name.
 */
import { splitSongTitle } from '@/lib/songTitle'
import type { SongLink } from '@/types/database'

/**
 * The one refusal prefix this module uses, exported because
 * `src/lib/moderation.ts`'s catch filter has to re-throw a refusal carrying it
 * verbatim instead of wrapping it (convention L1a). Exported rather than
 * duplicated as a literal there: two copies of the string are two places for
 * it to drift, and a drifted copy shows the admin the wrong message.
 */
export const CATALOG_SUGGESTION_PREFIX = 'Invalid catalog suggestion'

const PREFIX = CATALOG_SUGGESTION_PREFIX
const HTTP_URL = /^https?:\/\/\S+$/i

/**
 * The proposed title, split at its `" - "` and narrowed to the **left half**
 * (RH-122).
 *
 * The suffix is dropped on this path rather than routed to a version label, and
 * that is deliberate: the moderation queue has no version context — a queued
 * correction proposes columns of one `songs` row and nothing more — so there is
 * no version for a label to belong to. Routing a correction at a version is the
 * job of the task that admits a version as a suggestion target. What matters
 * here is the half that cannot wait: an approved correction may not write a
 * title that still carries a suffix, or the moderation queue would be the one
 * way back to the shape the split removes.
 */
function parseTitle(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '') {
    const { title } = splitSongTitle(value)
    if (title !== '') return title
  }
  throw new Error(`${PREFIX}: title must be a non-empty string`)
}

function parseArtist(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  throw new Error(`${PREFIX}: artist must be a non-empty string`)
}

/**
 * The proposed album name, trimmed only (RH-122). The stripper that used to
 * clean `(30th Anniversary Super Deluxe Edition)` off it is gone: `albums` keys
 * on `(lower(artist), lower(name))`, so a stripped name merges two separate
 * releases, and album names are now stored as the source reports them.
 */
function parseAlbum(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value.trim() || null
  throw new Error(`${PREFIX}: album must be a string or null`)
}

function parseStandardKey(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string') return value.trim() || null
  throw new Error(`${PREFIX}: standard_key must be a string or null`)
}

function parseCoverUrl(value: unknown): string | null {
  if (value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (HTTP_URL.test(trimmed)) return trimmed
  }
  throw new Error(`${PREFIX}: cover_url must be null or an http(s) URL`)
}

function parseDurationSeconds(value: unknown): number | null {
  if (value === null) return null
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  throw new Error(`${PREFIX}: duration_seconds must be a non-negative integer or null`)
}

function isSongLink(value: unknown): value is SongLink {
  if (typeof value !== 'object' || value === null) return false
  // Convention E1: a scoped structural cast, never an `any`-typed binding.
  const link = value as { label?: unknown; url?: unknown }
  return typeof link.label === 'string' && typeof link.url === 'string' && HTTP_URL.test(link.url)
}

function parseLinks(value: unknown): SongLink[] {
  if (Array.isArray(value)) {
    const links = value.filter(isSongLink)
    if (links.length === value.length) return links
  }
  throw new Error(`${PREFIX}: links must be an array of {label, url} objects with http(s) urls`)
}

/**
 * The closed allowlist of proposable catalog columns, keyed by target table and
 * then by column, each entry carrying the normaliser that column already uses.
 *
 * **A runtime value, not a type**, and that is the whole point. A TypeScript
 * interface has no runtime keys, so nothing could enumerate the admitted
 * columns at test time; this constant can be iterated, and
 * {@link CatalogSuggestionPayload} is *derived from it* as a mapped type rather
 * than declared independently — so the type, the submit narrower, the
 * per-column validator and `migrations/0021`'s row-wise CHECK all follow one
 * list and cannot drift apart.
 *
 * Declaration order is the catalog's column order, because
 * `Object.entries` over a narrowed payload has to be deterministic: the
 * approval statement builds its `SET` list from it.
 *
 * Only `songs` is admitted today. `albums`, `song_versions` and `song_links`
 * are not, because no surface submits a correction to them and an allowlist
 * entry no writer can reach is unverifiable; widening it is one `ALTER … CHECK`
 * plus an entry here, and belongs to the task that builds the surface.
 */
export const CATALOG_SUGGESTION_COLUMNS = {
  songs: {
    title: parseTitle,
    artist: parseArtist,
    album: parseAlbum,
    standard_key: parseStandardKey,
    cover_url: parseCoverUrl,
    duration_seconds: parseDurationSeconds,
    links: parseLinks,
  },
} as const

/** The normalisers admitted for one target table. */
type SongsColumns = (typeof CATALOG_SUGGESTION_COLUMNS)['songs']

/** A proposable catalog column of `songs`. */
export type CatalogSuggestionColumn = keyof SongsColumns

/**
 * One submission's proposed columns, narrowed.
 *
 * Derived from {@link CATALOG_SUGGESTION_COLUMNS}: every member optional, and
 * each member's type the return type of the normaliser that column is
 * allowlisted with.
 */
export type CatalogSuggestionPayload = {
  [K in CatalogSuggestionColumn]?: ReturnType<SongsColumns[K]>
}

/** Every value any allowlisted normaliser can return. */
export type CatalogSuggestionValue = ReturnType<SongsColumns[CatalogSuggestionColumn]>

/** The allowlisted columns of `songs`, in catalog column order. */
function songsColumns(): CatalogSuggestionColumn[] {
  return Object.keys(CATALOG_SUGGESTION_COLUMNS.songs) as CatalogSuggestionColumn[]
}

/**
 * Looks up the normaliser allowlisted for `(targetTable, targetColumn)`.
 *
 * `Object.hasOwn` rather than a plain index: `CATALOG_SUGGESTION_COLUMNS` is an
 * object literal, so a `targetColumn` of `constructor` or `toString` would
 * index straight into `Object.prototype` and come back truthy — and the caller
 * is about to interpolate that name into an identifier position.
 */
function allowlistedNormaliser(
  targetTable: string,
  targetColumn: string,
): ((value: unknown) => CatalogSuggestionValue) | undefined {
  const tables: Record<string, Record<string, (value: unknown) => CatalogSuggestionValue>> =
    CATALOG_SUGGESTION_COLUMNS
  if (!Object.hasOwn(tables, targetTable)) return undefined
  const columns = tables[targetTable]
  return Object.hasOwn(columns, targetColumn) ? columns[targetColumn] : undefined
}

/**
 * Narrows one proposed value, named by the table and column it is proposed
 * for.
 *
 * This is the one function in the codebase that takes a column name from its
 * caller, and it is called immediately before that name is interpolated into an
 * identifier position — once per row on the submit fan-out, and once per row on
 * approval. So an unallowlisted pair is **rejected**, not ignored.
 *
 * @throws when the pair is not allowlisted, or when the value is one the
 * catalog cannot store in that column.
 */
export function parseCatalogSuggestionValue(
  targetTable: string,
  targetColumn: string,
  value: unknown,
): CatalogSuggestionValue {
  const normalise = allowlistedNormaliser(targetTable, targetColumn)
  if (normalise === undefined) {
    throw new Error(
      `${PREFIX}: \`${targetTable}.${targetColumn}\` is not an allowlisted catalog column`,
    )
  }
  return normalise(value)
}

/**
 * Narrows a submitted payload to the catalog columns it may propose.
 *
 * Columns are read in {@link CATALOG_SUGGESTION_COLUMNS} order, so
 * `Object.entries` over the result is deterministic — the approval statement
 * builds its `SET` list from it.
 *
 * @throws when the payload is not a plain object, proposes no known column, or
 * carries a known column whose value the catalog cannot store.
 */
export function parseCatalogSuggestionPayload(data: unknown): CatalogSuggestionPayload {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${PREFIX}: payload must be a plain object`)
  }

  const source: Record<string, unknown> = { ...data }
  const payload: Record<string, CatalogSuggestionValue> = {}

  for (const column of songsColumns()) {
    if (source[column] !== undefined) {
      payload[column] = parseCatalogSuggestionValue('songs', column, source[column])
    }
  }

  if (Object.keys(payload).length === 0) {
    throw new Error(`${PREFIX}: at least one of ${songsColumns().join(', ')} must be present`)
  }

  return payload as CatalogSuggestionPayload
}
