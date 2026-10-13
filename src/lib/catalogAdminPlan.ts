/**
 * RH-156 — the pure decisions behind the /admin/catalog screen: when Delete and
 * Split are allowed, and the wording of the four confirmations. Client-safe: no
 * `@/lib/db`, only type imports of the data layer.
 */
import type { BlastRadius, CatalogTarget, SplitTarget } from '@/lib/catalogAdmin'

/**
 * The Server Actions the screen calls. Injected by `src/app/admin/catalog/page.tsx`
 * (through `src/app/catalogAdminActions.ts`) so `src/components` and `src/hooks`
 * never import from `@/app/*` (F21).
 */
export interface CatalogAdminActions {
  getBlastRadius: (target: CatalogTarget) => Promise<BlastRadius>
  mergeSongVersions: (fromVersionId: string, intoVersionId: string) => Promise<void>
  deleteSongVersion: (versionId: string) => Promise<void>
  splitSongVersions: (
    sourceSongId: string,
    versionIds: string[],
    target: SplitTarget,
  ) => Promise<void>
  mergeSongs: (fromSongId: string, intoSongId: string) => Promise<void>
}

/** What the island knows about one blast radius. */
export type RadiusState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; radius: BlastRadius }

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** "2 repertoires and 1 playlist". */
export function countsPhrase(radius: BlastRadius): string {
  return `${plural(radius.repertoires, 'repertoire')} and ${plural(radius.playlists, 'playlist')}`
}

/** "2 repertoires · 1 playlist" - the compact line shown on a version row. */
export function radiusSummary(radius: BlastRadius): string {
  return `${plural(radius.repertoires, 'repertoire')} · ${plural(radius.playlists, 'playlist')}`
}

/** Why Delete is disabled, or null when it is allowed. */
export function deleteDisabledReason(state: RadiusState | undefined): string | null {
  if (canDeleteVersion(state)) return null
  if (!state || state.status === 'loading') return 'Counts are still loading'
  if (state.status === 'error') return 'Counts could not be loaded'
  return 'Still held or referenced; merge it instead'
}

/** Delete is offered only for a loaded radius of exactly 0 and 0. */
export function canDeleteVersion(state: RadiusState | undefined): boolean {
  return (
    state?.status === 'ready' && state.radius.repertoires === 0 && state.radius.playlists === 0
  )
}

/** A split moves some versions, never all of them (that would be a merge). */
export function canSplit(chosen: number, total: number): boolean {
  return chosen >= 1 && chosen < total
}

export function sumRadii(radii: BlastRadius[]): BlastRadius {
  return radii.reduce(
    (acc, r) => ({
      repertoires: acc.repertoires + r.repertoires,
      playlists: acc.playlists + r.playlists,
    }),
    { repertoires: 0, playlists: 0 },
  )
}

export function versionDisplayLabel(version: {
  label: string | null
  albumName: string | null
}): string {
  return version.label || version.albumName || 'Original'
}

export function mergeVersionsMessage(
  sourceLabel: string,
  targetLabel: string,
  radius: BlastRadius,
): string {
  return (
    `Merge "${sourceLabel}" into "${targetLabel}"? ${countsPhrase(radius)} hold or reference "${sourceLabel}". ` +
    `Where "${targetLabel}" is already held, the ${targetLabel} row wins and the "${sourceLabel}" row is discarded. This cannot be undone.`
  )
}

export function splitMessage(versionCount: number, radius: BlastRadius, targetName: string): string {
  return (
    `Move ${plural(versionCount, 'version')} to ${targetName}? ` +
    `Together they are held or referenced by up to ${countsPhrase(radius)} (an owner holding two of them counts twice). This cannot be undone.`
  )
}

export function mergeSongsMessage(
  sourceTitle: string,
  targetTitle: string,
  radius: BlastRadius,
): string {
  return (
    `Merge song "${sourceTitle}" into "${targetTitle}"? ${countsPhrase(radius)} hold or reference its versions. ` +
    `Duplicate versions are merged and "${sourceTitle}" is removed. This cannot be undone.`
  )
}

export function deleteVersionMessage(label: string): string {
  return `Delete "${label}"? 0 repertoires and 0 playlists reference this version. This cannot be undone.`
}
