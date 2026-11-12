/**
 * RH-193 / RH-201 — the playlist's offline controls (the header's icon and
 * "More actions" group, and the inline alert) take the page's controller as a
 * prop, so a suite that wants the real hook over the real store renders them
 * through this harness, which owns the one `useOfflinePlaylist` call the way
 * `PlaylistDetailView` does on the page.
 *
 * Not a test file: it exports helpers and holds no `describe`.
 */
import { fireEvent, screen } from '@testing-library/react'
import { PlaylistDetailHeader } from '@/components/playlists/PlaylistDetailHeader'
import { PlaylistOfflineAlert } from '@/components/playlists/PlaylistOfflineAlert'
import { useOfflinePlaylist, type OfflinePlaylistController, type UseOfflinePlaylistOptions } from '@/hooks/useOfflinePlaylist'
import { NO_PANEL, type PlaylistPanel } from '@/lib/playlistPanels'
import type { Playlist } from '@/types/database'

const HARNESS_PLAYLIST = {
  id: 'pl-1',
  user_id: null,
  band_id: 'band-1',
  name: 'Gig',
  cover_url: null,
  spotify_playlist_id: null,
  sync_with_spotify: false,
  last_synced_at: null,
} as unknown as Playlist

const noop = async () => {}

/** The header and the alert over a given controller, as the page renders them. */
export function OfflineControls({
  controller,
  offline,
  panel = NO_PANEL,
}: {
  controller: OfflinePlaylistController
  offline?: boolean
  panel?: PlaylistPanel
}) {
  return (
    <>
      <PlaylistDetailHeader
        playlist={HARNESS_PLAYLIST}
        panel={panel}
        dispatch={() => {}}
        syncing={false}
        onRename={noop}
        onDelete={noop}
        onSync={noop}
        canReorder={false}
        reordering={false}
        onToggleReorder={() => {}}
        offline={controller}
        isOffline={offline}
      />
      <PlaylistOfflineAlert controller={controller} offline={offline} />
    </>
  )
}

export interface HookedOfflineControlProps extends UseOfflinePlaylistOptions {
  offline?: boolean
}

export function HookedOfflineControl({ offline, ...options }: HookedOfflineControlProps) {
  const controller = useOfflinePlaylist(options)
  return <OfflineControls controller={controller} offline={offline} />
}

/** Opens "More actions" (when closed) and returns the named menu item. */
export function offlineMenuItem(name: string | RegExp): HTMLElement {
  if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  return screen.getByRole('menuitem', { name })
}

/** Like `offlineMenuItem`, but waits for the item to appear. */
export async function findOfflineMenuItem(name: string | RegExp): Promise<HTMLElement> {
  if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  return screen.findByRole('menuitem', { name })
}

/** Closes the menu if it is open, so the next lookup reopens it on fresh state. */
export function closeOfflineMenu() {
  if (screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
}
