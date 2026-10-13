/**
 * RH-97 — the shared-catalog write rule, as a pure decision.
 *
 * `songs` is a wiki: a row is shared by everyone who has the song, so a
 * single repertoire owner may *fill a blank* but may not overwrite a value
 * somebody else's repertoire also shows. `updateSong` used to express that as
 * `SET artist = CASE WHEN artist IS NULL OR artist = '' THEN $2 ELSE artist END`
 * for all seven columns, which made the refusal invisible: the save reported
 * success and the value snapped back.
 *
 * The rule lives here instead, with no database access, so `updateSong` only
 * has to apply it — and so the song form can ask the same question (is this
 * field still fillable?) before it renders an input the database would ignore.
 *
 * Three rules are worth stating explicitly, because each one exists to avoid a
 * false alarm:
 *
 *  - **Equality is never a refusal.** Text is compared after trimming and
 *    `duration_seconds` as an integer. A form that round-trips the catalog's own
 *    values proposes nothing.
 *  - **An empty proposal is no proposal.** A column the caller left blank is
 *    neither filled nor refused; erasing a shared value is not something this
 *    path offers, and warning about an absent value would be noise.
 *  - **`standard_key` is fill-when-empty but never refused**, because the key
 *    the musician typed was in fact saved — to the owner row's `key`.
 *
 * A refused column's route is `CorrectionModal` -> the moderation queue; see
 * `docs/use-cases.md` § *Suggest a correction to the catalog*.
 *
 * **Links are not a column here (RH-138).** They live in `song_links`, one row
 * each, and a correction to them is per row: {@link changedLinkRows}. The
 * `links` member of the snapshot and the proposal below feeds only the
 * empty-catalog fill, which `applyCatalogFill` decides on `song_links` itself.
 */
import type { CatalogSuggestionPayload } from '@/lib/catalogSuggestionPayload'
import type {
  CatalogFieldValue,
  RefusableCatalogColumn,
  RefusedCatalogField,
  SongLink,
} from '@/types/database'

/** The mutable `songs` columns, in column order. */
export const CATALOG_COLUMNS = [
  'title',
  'artist',
  'album',
  'standard_key',
  'cover_url',
  'duration_seconds',
] as const

export type CatalogColumn = (typeof CATALOG_COLUMNS)[number]

/** The catalog row as stored: every column may be `NULL`. */
export type CatalogSnapshot = {
  title: string | null
  artist: string | null
  album: string | null
  standard_key: string | null
  cover_url: string | null
  duration_seconds: number | null
  /** Not a column: the link rows the song form and the correction form start from. */
  links: SongLink[] | null
}

/** What a song edit proposes for the shared columns. */
export type CatalogProposal = {
  title: string
  artist: string
  album: string | null
  standard_key: string | null
  cover_url: string | null
  duration_seconds: number | null
  /** Not a column: consumed by the empty-catalog links fill only. */
  links: SongLink[]
}

/** One column the `UPDATE songs` SET list may carry. */
export interface CatalogFill {
  /** A `songs` column name out of `CATALOG_COLUMNS` — safe to interpolate. */
  column: CatalogColumn
  /** The value as `pg` must receive it. */
  value: string | number | null
}

export interface CatalogUpdateSplit {
  fill: CatalogFill[]
  refused: RefusedCatalogField[]
}

/** The columns a refusal may name: everything except `standard_key`. */
const REFUSABLE: ReadonlySet<CatalogColumn> = new Set<CatalogColumn>([
  'title',
  'artist',
  'album',
  'cover_url',
  'duration_seconds',
])

function isBlankText(value: string | null | undefined): boolean {
  return value === null || value === undefined || value === ''
}

/**
 * Is this column still fillable — i.e. does the catalog hold nothing for it?
 *
 * The definition is per column and matches what the catalog stores: `NULL` or
 * `''` for text, `NULL` for `duration_seconds` (so a `0` duration counts as a
 * value).
 */
export function isCatalogFieldEmpty(song: CatalogSnapshot, column: CatalogColumn): boolean {
  if (column === 'duration_seconds') return song.duration_seconds === null
  return isBlankText(song[column])
}

/** The proposed value for one column, normalized the way the catalog stores it. */
function proposedValue(proposal: CatalogProposal, column: CatalogColumn): CatalogFieldValue {
  if (column === 'duration_seconds') return proposal.duration_seconds
  const text = proposal[column]
  return typeof text === 'string' ? text.trim() : null
}

/** Nothing was proposed for this column, so it is neither filled nor refused. */
function isAbsent(value: CatalogFieldValue): boolean {
  return value === null || value === ''
}

/**
 * Is the proposal the value the catalog already holds? Integer durations and
 * trimmed text are the two comparison rules.
 */
function matchesStored(current: CatalogFieldValue, proposed: CatalogFieldValue): boolean {
  if (typeof current === 'string' && typeof proposed === 'string') {
    return current.trim() === proposed
  }
  return current === proposed
}

/**
 * Splits a proposed catalog update into the columns the database will take and
 * the ones it refuses.
 *
 * `fill` carries only columns the catalog currently leaves empty, so applying
 * it can never overwrite a shared value. `refused` carries one entry per
 * populated column whose proposed value differs from the stored one, with both
 * values, so the caller can both report it and offer it as a correction.
 */
export function splitCatalogUpdate(
  song: CatalogSnapshot,
  proposal: CatalogProposal,
): CatalogUpdateSplit {
  const fill: CatalogFill[] = []
  const refused: RefusedCatalogField[] = []

  for (const column of CATALOG_COLUMNS) {
    const proposed = proposedValue(proposal, column)
    if (isAbsent(proposed)) continue

    if (isCatalogFieldEmpty(song, column)) {
      fill.push({ column, value: proposed })
      continue
    }

    if (!REFUSABLE.has(column)) continue

    const current = song[column]
    if (matchesStored(current, proposed)) continue

    refused.push({ column: column as RefusableCatalogColumn, current, proposed })
  }

  return { fill, refused }
}

/**
 * One shared catalog row as the correction form holds it: every value a string,
 * because that is what an `<input>` carries. The link rows are held apart, as
 * {@link LinkDraftRow}s keyed by id.
 */
export type CatalogDraft = {
  title: string
  artist: string
  album: string
  standard_key: string
  cover_url: string
  duration: string
}

/** The catalog row as the correction form's starting point. */
export function catalogDraftFromSong(song: CatalogSnapshot): CatalogDraft {
  return {
    title: song.title ?? '',
    artist: song.artist ?? '',
    album: song.album ?? '',
    standard_key: song.standard_key ?? '',
    cover_url: song.cover_url ?? '',
    duration: song.duration_seconds === null ? '' : String(song.duration_seconds),
  }
}

/** One catalog link row as the correction form holds it, keyed by its stable id. */
export type LinkDraftRow = {
  id: string
  label: string
  url: string
  removed: boolean
}

/**
 * One link row's proposed change: the shape `submitCatalogSuggestion` takes as
 * `linkChanges`. Defined here, with the helper that produces it, because a
 * client component imports this module and may not import the server-only one
 * that consumes it.
 */
export type LinkChangeInput = {
  linkId: string
  url?: string
  label?: string
  removed?: true
}

/**
 * The catalog's link rows as the correction form's starting point. A link read
 * without an id (a bare `{label, url}`) cannot be addressed, so it is left out.
 */
export function linkDraftFromSong(links: readonly SongLink[] | null): LinkDraftRow[] {
  return (links ?? []).flatMap((link) =>
    link.id === undefined ? [] : [{ id: link.id, label: link.label, url: link.url, removed: false }],
  )
}

function changeOfLinkRow(base: LinkDraftRow, row: LinkDraftRow): LinkChangeInput | undefined {
  if (row.removed) return { linkId: base.id, removed: true }
  const change: LinkChangeInput = { linkId: base.id }
  const url = row.url.trim()
  // A blank url is not a correction: the catalog cannot store a link without one.
  if (url !== '' && url !== base.url.trim()) change.url = url
  const label = row.label.trim()
  if (label !== base.label.trim()) change.label = label
  return change.url === undefined && change.label === undefined ? undefined : change
}

/**
 * The link-row corrections: one entry per catalog row the user touched, naming
 * only what changed on it, and nothing at all for an untouched row. Rows are
 * matched by id, never by position, so removing the first row cannot be read as
 * editing the second. Pure.
 */
export function changedLinkRows(
  base: readonly LinkDraftRow[],
  draft: readonly LinkDraftRow[],
): LinkChangeInput[] {
  const baseById = new Map(base.map((row) => [row.id, row]))
  return draft.flatMap((row) => {
    const original = baseById.get(row.id)
    const change = original ? changeOfLinkRow(original, row) : undefined
    return change ? [change] : []
  })
}

/** Reads the duration the form offers — `"3:45"` or `"225"` — as whole seconds. */
export function parseDurationInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (trimmed.includes(':')) {
    const [min, sec] = trimmed.split(':').map(Number)
    if (!Number.isFinite(min) || !Number.isFinite(sec)) return null
    return Math.trunc(min * 60 + sec)
  }
  const seconds = Number(trimmed)
  return Number.isFinite(seconds) ? Math.trunc(seconds) : null
}

/** The two columns `songs` declares NOT NULL, which a correction may never blank. */
const REQUIRED_COLUMNS: ReadonlySet<CatalogColumn> = new Set<CatalogColumn>(['title', 'artist'])

function putIfChanged(
  payload: Record<string, unknown>,
  column: CatalogColumn,
  current: string,
  proposed: string,
): void {
  const value = proposed.trim()
  if (value === current.trim()) return
  if (value === '') {
    if (!REQUIRED_COLUMNS.has(column)) payload[column] = null
    return
  }
  payload[column] = value
}

/**
 * The correction payload: only the fields whose draft value differs from the
 * catalog's own, normalized the way `parseCatalogSuggestionPayload` expects
 * them.
 *
 * Only-what-changed matters twice over. `parseCatalogSuggestionPayload` rejects
 * a payload proposing no known column, so an untouched form must be refused
 * before it is sent; and RH-107's one-row-per-field model fans the payload out
 * into one queue row per named column, so a payload that names only what
 * changed is already the set of rows a reviewer should see.
 */
export function changedCatalogFields(base: CatalogDraft, draft: CatalogDraft): CatalogSuggestionPayload {
  const payload: Record<string, unknown> = {}

  putIfChanged(payload, 'title', base.title, draft.title)
  putIfChanged(payload, 'artist', base.artist, draft.artist)
  putIfChanged(payload, 'album', base.album, draft.album)
  putIfChanged(payload, 'standard_key', base.standard_key, draft.standard_key)
  putIfChanged(payload, 'cover_url', base.cover_url, draft.cover_url)

  const duration = parseDurationInput(draft.duration)
  if (duration !== parseDurationInput(base.duration)) payload.duration_seconds = duration

  return payload as CatalogSuggestionPayload
}

/**
 * The refused proposals, as the correction form's starting values.
 *
 * This is what makes the backstop worth offering: a save the catalog refused
 * already carries the musician's own wording, so the correction opens holding
 * it rather than asking them to type it again.
 */
export function catalogDraftFromRefusals(refused: RefusedCatalogField[]): Partial<CatalogDraft> {
  const draft: Partial<CatalogDraft> = {}

  for (const field of refused) {
    if (field.column === 'duration_seconds') {
      draft.duration = field.proposed === null ? '' : String(field.proposed)
    } else {
      draft[field.column] = typeof field.proposed === 'string' ? field.proposed : ''
    }
  }

  return draft
}

/** The field names the refusal notice uses, one per refusable column. */
export const CATALOG_FIELD_LABELS: Record<RefusableCatalogColumn, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  cover_url: 'Cover image',
  duration_seconds: 'Duration',
}

/** One catalog value as the refusal notice states it. */
export function describeCatalogValue(value: CatalogFieldValue): string {
  if (value === null || value === '') return 'nothing'
  return String(value)
}
