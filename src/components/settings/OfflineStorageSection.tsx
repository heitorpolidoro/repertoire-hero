"use client";

import { useId } from "react";
import { OfflineStorageRow } from "@/components/settings/OfflineStorageRow";
import { useOfflineLibrary } from "@/hooks/useOfflineLibrary";
import { formatOfflineBytes } from "@/lib/offlineFormat";
import { type OfflineStore } from "@/lib/offlineStore";

export interface OfflineStorageSectionProps {
  /** Defaults to the real `OFFLINE_STORE`; a test passes its own. */
  store?: OfflineStore;
}

const LIST_CLASS = "flex flex-col divide-y divide-gray-100 border-t border-gray-100";
const HEADING_CLASS = "text-xs font-semibold uppercase tracking-wider text-gray-500";

/**
 * The `/settings` offline storage section (RH-79, RH-194).
 *
 * Two lists: **Playlists**, each measured against its stored list (`N of M
 * songs`, the bytes of its songs on this device, the download date), and
 * **Songs**, every stored song once with its size, date and the playlists
 * holding it or "Downloaded individually". A list with nothing in it is not
 * rendered; with nothing in either, the section says so.
 *
 * The total is the **sum of the stored songs' own `bytes`, each counted once**,
 * never the Storage API, so it is always available — and, because two
 * playlists can share a song, it can be less than the playlist rows added up.
 * `navigator.storage.estimate()` only ever adds a secondary "x of y used"
 * line; when the API is absent, rejects, or reports no quota, that line is
 * simply omitted — no placeholder and no spinner.
 *
 * The library arrives through `useOfflineLibrary`, which publishes a
 * module-level cache through `useSyncExternalStore`: the mount effect writes no
 * React state, so this section adds no `react-hooks/set-state-in-effect` error
 * to the one `src/app/settings/page.tsx` already carries.
 */
export function OfflineStorageSection({ store }: OfflineStorageSectionProps) {
  const library = useOfflineLibrary({ store });
  const playlistsHeading = useId();
  const songsHeading = useId();
  const empty = library.playlists.length === 0 && library.songs.length === 0;

  return (
    <section className="flex flex-col gap-3 border-t border-gray-100 pt-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Offline storage</h2>
        <div className="text-right">
          <p className="text-2xl font-bold text-gray-900" data-testid="offline-total">
            {formatOfflineBytes(library.totalBytes)}
          </p>
          {library.quota && (
            <p className="text-xs text-gray-400" data-testid="offline-quota">
              {formatOfflineBytes(library.quota.usedBytes)} of{" "}
              {formatOfflineBytes(library.quota.quotaBytes)} used
            </p>
          )}
        </div>
      </div>

      {empty && (
        <p className="text-sm text-gray-400 py-6 text-center">
          Nothing is stored on this device.
        </p>
      )}

      {library.playlists.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 id={playlistsHeading} className={HEADING_CLASS}>Playlists</h3>
          <ul className={LIST_CLASS} role="list" aria-labelledby={playlistsHeading}>
            {library.playlists.map((row) => (
              <OfflineStorageRow
                key={row.playlistId}
                name={row.playlistName}
                detail={`${row.storedCount} of ${row.totalCount} songs · ${formatOfflineBytes(row.bytes)} · downloaded ${row.downloadedAgo}`}
                onRemove={() => void library.removePlaylist(row.playlistId)}
              />
            ))}
          </ul>
        </div>
      )}

      {library.songs.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 id={songsHeading} className={HEADING_CLASS}>Songs</h3>
          <ul className={LIST_CLASS} role="list" aria-labelledby={songsHeading}>
            {library.songs.map((row) => (
              <OfflineStorageRow
                key={row.recordId}
                name={row.title}
                detail={`${formatOfflineBytes(row.bytes)} · downloaded ${row.downloadedAgo} · ${row.provenance}`}
                onRemove={() => void library.removeSong(row.recordId)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
