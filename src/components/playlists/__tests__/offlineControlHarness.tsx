/**
 * RH-193 — `OfflineDownloadButton` takes the page's controller as a prop, so a
 * suite that wants the real hook over the real store renders it through this
 * harness, which owns the one `useOfflinePlaylist` call the way
 * `PlaylistDetailView` does on the page.
 *
 * Not a test file: it exports a helper and holds no `describe`.
 */
import { OfflineDownloadButton } from '@/components/playlists/OfflineDownloadButton'
import { useOfflinePlaylist, type UseOfflinePlaylistOptions } from '@/hooks/useOfflinePlaylist'

export interface HookedOfflineControlProps extends UseOfflinePlaylistOptions {
  offline?: boolean
}

export function HookedOfflineControl({ offline, ...options }: HookedOfflineControlProps) {
  const controller = useOfflinePlaylist(options)
  return <OfflineDownloadButton controller={controller} offline={offline} />
}
