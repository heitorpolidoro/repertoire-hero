"use client";

import { useOfflineLibrary } from "@/hooks/useOfflineLibrary";
import { formatOfflineBytes } from "@/lib/offlineFormat";
import { type OfflineStore } from "@/lib/offlineStore";

export interface OfflineStorageSectionProps {
  /** Defaults to the real `OFFLINE_STORE`; a test passes its own. */
  store?: OfflineStore;
}

/**
 * The `/settings` offline storage section (RH-79).
 *
 * The total is the **sum of the stored records' own `bytes`**, never the
 * Storage API, so it always agrees with the per-playlist figures beside it and
 * is always available. `navigator.storage.estimate()` only ever adds a
 * secondary "x of y used" line; when the API is absent, rejects, or reports no
 * quota, that line is simply omitted — no placeholder and no spinner.
 *
 * The library arrives through `useOfflineLibrary`, which publishes a
 * module-level cache through `useSyncExternalStore`: the mount effect writes no
 * React state, so this section adds no `react-hooks/set-state-in-effect` error
 * to the one `src/app/settings/page.tsx` already carries.
 */
export function OfflineStorageSection({ store }: OfflineStorageSectionProps) {
  const library = useOfflineLibrary({ store });

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

      {library.rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">
          No playlist is stored on this device.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-100 border-t border-gray-100" role="list">
          {library.rows.map((row) => (
            <li key={row.playlistId} className="flex items-center gap-3 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{row.playlistName}</p>
                <p className="text-xs text-gray-400">
                  {formatOfflineBytes(row.bytes)} &middot; downloaded {row.downloadedAgo}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${row.playlistName} from this device`}
                onClick={() => void library.remove(row.playlistId)}
                className="ml-auto rounded-md px-3 py-1.5 text-xs text-red-600 border border-red-200 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
