/**
 * RH-201 — what the playlist page shows of its offline copy: the entries of the
 * offline group in the header's "More actions" menu, and the compact icon
 * after the playlist name.
 *
 * Pure, so the header stays presentational: it reads the controller's state
 * plus the device's network state and returns plain data. A menu item names
 * the controller command it runs (`download`, `refresh`, `remove`) instead of
 * holding a callback; the header binds it.
 *
 * The labels and the enabled/disabled rules are RH-193's, relocated: offline a
 * download cannot complete, so the two download items are disabled; "Remove
 * offline copy" stays enabled because it is a purely local write.
 */
import { formatOfflineBytes } from '@/lib/offlineFormat'

/** The slice of `OfflinePlaylistController` these decisions read. */
export interface PlaylistOfflineState {
  status: 'idle' | 'downloading' | 'downloaded'
  progress: { done: number; total: number }
  stored: number
  total: number
  bytes: number
  downloadedAgo: string | null
}

export type PlaylistOfflineCommand = 'download' | 'refresh' | 'remove'

export type PlaylistOfflineMenuEntry =
  | {
      kind: 'item'
      label: string
      command: PlaylistOfflineCommand
      disabled: boolean
      /** A sub-line under the label. */
      description?: string
      danger?: boolean
    }
  | { kind: 'summary'; text: string }

export type PlaylistOfflineIndicatorState =
  | { kind: 'downloading'; label: string }
  | { kind: 'downloaded'; label: string; title: string }

/** Why the idle item is disabled offline (RH-188 copy). */
const OFFLINE_HINT = 'Connect to the internet to download this playlist.'

/** "Download 1 missing song" / "Download N missing songs" (RH-193). */
function missingLabel(missing: number): string {
  return `Download ${missing} missing song${missing === 1 ? '' : 's'}`
}

function idleEntries(state: PlaylistOfflineState, isOffline: boolean): PlaylistOfflineMenuEntry[] {
  const description = isOffline
    ? OFFLINE_HINT
    : state.stored > 0
      ? `${state.stored} of ${state.total} songs are already on this device.`
      : undefined
  return [
    {
      kind: 'item',
      label: 'Make available offline',
      command: 'download',
      disabled: isOffline,
      ...(description ? { description } : {}),
    },
  ]
}

function downloadedEntries(state: PlaylistOfflineState, isOffline: boolean): PlaylistOfflineMenuEntry[] {
  const missing = state.total - state.stored
  const entries: PlaylistOfflineMenuEntry[] = [
    {
      kind: 'summary',
      text: `Available offline · ${state.stored} of ${state.total} songs · ${formatOfflineBytes(state.bytes)} · downloaded ${state.downloadedAgo ?? 'unknown'}`,
    },
  ]
  if (missing > 0) {
    entries.push({ kind: 'item', label: missingLabel(missing), command: 'download', disabled: isOffline })
  }
  entries.push(
    { kind: 'item', label: 'Refresh offline copy', command: 'refresh', disabled: isOffline },
    { kind: 'item', label: 'Remove offline copy', command: 'remove', disabled: false, danger: true },
  )
  return entries
}

/**
 * The offline group of the "More actions" menu. Empty while a download runs:
 * the progress is the header icon's, and there is nothing to start or remove.
 */
export function playlistOfflineMenu(state: PlaylistOfflineState, isOffline: boolean): PlaylistOfflineMenuEntry[] {
  if (state.status === 'idle') return idleEntries(state, isOffline)
  if (state.status === 'downloaded') return downloadedEntries(state, isOffline)
  return []
}

/** The compact icon after the playlist name; `null` (nothing) while idle. */
export function playlistOfflineIndicator(state: PlaylistOfflineState): PlaylistOfflineIndicatorState | null {
  if (state.status === 'downloading') {
    return { kind: 'downloading', label: `Downloading ${state.progress.done} / ${state.progress.total} songs` }
  }
  if (state.status === 'downloaded') {
    return { kind: 'downloaded', label: 'Available offline', title: `${state.stored} of ${state.total} songs on this device` }
  }
  return null
}
