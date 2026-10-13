/**
 * Pure rules of the Fast View song map (RH-118): the stored shape's parser, the
 * normaliser every write goes through, the editor's draft helpers and the entry
 * patch. Client-safe: no `@/lib/db`.
 *
 * The stored jsonb is `{ sections: [{ name, bars, note }] }`, ordered by array
 * position. Anything else read from the database is "no map" (`null`), never a
 * crash.
 */

import type { ResolvedSongEntry, SongMap, SongSection } from '@/types/database'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSection(raw: unknown): SongSection | null {
  if (!isRecord(raw) || typeof raw.name !== 'string') return null
  const { bars = null, note = null } = raw
  if (bars !== null && typeof bars !== 'number') return null
  if (note !== null && typeof note !== 'string') return null
  return { name: raw.name, bars, note }
}

/** A stored blob as a `SongMap`, or `null` when it does not match the shape. */
export function parseSongMap(raw: unknown): SongMap | null {
  if (!isRecord(raw) || !Array.isArray(raw.sections)) return null
  const sections: SongSection[] = []
  for (const item of raw.sections) {
    const section = parseSection(item)
    if (!section) return null
    sections.push(section)
  }
  return { sections }
}

function normalizeSection(section: SongSection): SongSection | null {
  const name = section.name.trim()
  if (name === '') return null
  const bars = Number.isInteger(section.bars) && (section.bars as number) > 0 ? section.bars : null
  const note = section.note?.trim() || null
  return { name, bars, note }
}

/**
 * The value to save: names and notes trimmed, blank-named sections dropped,
 * `bars` a positive integer or null, and an empty list stored as `null`.
 */
export function normalizeSongMap(map: SongMap | null): SongMap | null {
  if (!map) return null
  const sections = map.sections.flatMap((section) => normalizeSection(section) ?? [])
  return sections.length === 0 ? null : { sections }
}

/**
 * Validates an incoming Server Action payload (a public endpoint) and returns
 * the normalised value to store. Throws on anything that is not a song map.
 */
export function validateSongMapPayload(payload: unknown): SongMap | null {
  if (payload === null) return null
  const parsed = parseSongMap(payload)
  if (!parsed) throw new Error('Invalid song map')
  return normalizeSongMap(parsed)
}

/** One section in the editor; `bars` is the input's text and `id` its React key. */
export interface SongSectionDraft {
  id: string
  name: string
  bars: string
  note: string
}

let draftCounter = 0

function newDraftId(): string {
  draftCounter += 1
  return `section-${draftCounter}`
}

export function mapToDraft(map: SongMap | null): SongSectionDraft[] {
  return (map?.sections ?? []).map((s) => ({
    id: newDraftId(),
    name: s.name,
    bars: s.bars === null ? '' : String(s.bars),
    note: s.note ?? '',
  }))
}

/** The draft as the value to save (normalised, so an empty draft is `null`). */
export function draftToMap(draft: SongSectionDraft[]): SongMap | null {
  const sections = draft.map((s) => ({
    name: s.name,
    bars: /^\s*\d+\s*$/.test(s.bars) ? Number(s.bars) : null,
    note: s.note,
  }))
  return normalizeSongMap({ sections })
}

export function addDraftSection(draft: SongSectionDraft[]): SongSectionDraft[] {
  return [...draft, { id: newDraftId(), name: '', bars: '', note: '' }]
}

export function removeDraftSection(draft: SongSectionDraft[], index: number): SongSectionDraft[] {
  return draft.filter((_, i) => i !== index)
}

export function renameDraftSection(
  draft: SongSectionDraft[],
  index: number,
  patch: Partial<Omit<SongSectionDraft, 'id'>>,
): SongSectionDraft[] {
  return draft.map((s, i) => (i === index ? { ...s, ...patch } : s))
}

/** Swaps a section with its neighbour; at either end the draft is unchanged. */
export function moveDraftSection(draft: SongSectionDraft[], index: number, direction: -1 | 1): SongSectionDraft[] {
  const target = index + direction
  if (target < 0 || target >= draft.length) return draft
  const next = [...draft]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function mapSavedMessage(map: SongMap | null): string {
  return map === null ? 'Map cleared' : 'Map saved'
}

/**
 * A new entry carrying `map` as the owner's own override (`null` clears the
 * marker); a null entry stays null.
 */
export function withMap(entry: ResolvedSongEntry | null, map: SongMap | null): ResolvedSongEntry | null {
  return entry ? { ...entry, map, mapOverridden: map !== null } : null
}

/**
 * Everything `useSongMap` exposes. Declared here so the presentational section
 * can type it without importing `src/hooks`.
 */
export interface SongMapController {
  /** The resolved map, already parsed: `null` for none or a foreign blob. */
  map: SongMap | null
  /** True when the owner's own row holds a map. */
  overridden: boolean
  /** The editor is open. */
  editing: boolean
  draft: SongSectionDraft[]
  /** A write in flight. */
  updating: boolean
  /** The "Use the original" confirmation is showing. */
  confirmingReset: boolean
  startEdit: () => void
  cancelEdit: () => void
  addSection: () => void
  removeSection: (index: number) => void
  editSection: (index: number, patch: Partial<Omit<SongSectionDraft, 'id'>>) => void
  moveSection: (index: number, direction: -1 | 1) => void
  save: () => Promise<void>
  requestReset: () => void
  cancelReset: () => void
  confirmReset: () => Promise<void>
}
