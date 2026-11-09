"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { logger } from "@/lib/logger";
import type { OfflineSetlistRecord } from "@/lib/offlineRecords";
import { offlineFastViewPath, songRecordId } from "@/lib/offlineSongRecord";
import { OFFLINE_STORE, type OfflineStore } from "@/lib/offlineStore";
import { writeSongQueue } from "@/lib/songQueue";

export interface OfflineSetlistsProps {
  /** Defaults to the real `OFFLINE_STORE`; a test injects its own. */
  store?: OfflineStore;
}

/** What the device holds: the downloaded setlists and every stored song record id. */
interface DeviceSetlists {
  setlists: OfflineSetlistRecord[];
  /** `songRecordId(versionId, bandId)` of every song on the device. */
  storedIds: ReadonlySet<string>;
}

const NOTHING: DeviceSetlists = { setlists: [], storedIds: new Set() };

const ICON = {
  viewBox: "0 0 24 24",
  className: "h-4 w-4",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Never throws: an unreadable device is a device with nothing to list. */
async function readDeviceSetlists(store: OfflineStore): Promise<DeviceSetlists> {
  try {
    const setlists = await store.listOfflineSetlists();
    if (setlists.length === 0) return NOTHING;
    const songs = await store.listOfflineSongs();
    return { setlists, storedIds: new Set(songs.map((song) => song.playlistId)) };
  } catch (error) {
    logger.error("Failed to read the downloaded playlists", error);
    return NOTHING;
  }
}

/** The whole setlist — missing songs included — as the tab's queue, Back going to `/offline`. */
function writeSetlistQueue(setlist: OfflineSetlistRecord): void {
  writeSongQueue({
    entries: setlist.entries,
    owner: setlist.bandId ? { type: "band", bandId: setlist.bandId } : { type: "personal" },
    originHref: "/offline",
    label: setlist.playlistName,
  });
}

/**
 * RH-195 — the downloaded setlists, beneath the "You are offline" card.
 *
 * `/offline` is the worker's precached fallback, so it must stay statically
 * prerenderable: the device is read after mount, and until that read lands —
 * or when it finds no downloaded setlist — this renders nothing, leaving the
 * card alone exactly as before. Individually downloaded songs are not listed.
 *
 * Each setlist shows its songs in stored order and how many of them this
 * device holds **in the setlist's owner context** (the song record id carries
 * the band). A stored song links to its Fast View — the path a download stored
 * its document under — and opening it writes the whole setlist as the queue,
 * so Prev/Next and the setlist chrome work offline. A song not on the device is
 * a dashed row with no link. The icons are inline lucide shapes
 * (`chevron-right`, `circle-dashed`); the project ships no icon package.
 */
export function OfflineSetlists({ store = OFFLINE_STORE }: OfflineSetlistsProps) {
  const headingId = useId();
  const [device, setDevice] = useState<DeviceSetlists>(NOTHING);

  useEffect(() => {
    let active = true;
    void readDeviceSetlists(store).then((next) => {
      if (active) setDevice(next);
    });
    return () => {
      active = false;
    };
  }, [store]);

  if (device.setlists.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="w-full max-w-md space-y-2 text-left">
      <h2 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Downloaded playlists
      </h2>
      {device.setlists.map((setlist) => {
        const isStored = (versionId: string) => device.storedIds.has(songRecordId(versionId, setlist.bandId));
        const storedCount = setlist.entries.filter((entry) => isStored(entry.versionId)).length;
        return (
          <div key={setlist.playlistId} className="mt-3 first:mt-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="min-w-0 truncate text-sm font-semibold text-gray-900">{setlist.playlistName}</h3>
              <p className="shrink-0 text-xs text-gray-500">{`${storedCount} of ${setlist.entries.length} songs`}</p>
            </div>
            <ol aria-label={setlist.playlistName} className="mt-2 flex flex-col gap-1.5">
              {setlist.entries.map((entry, index) => {
                const number = (
                  <span className="w-5 shrink-0 text-right font-mono text-xs text-gray-400">{`${index + 1}.`}</span>
                );
                const title = <span className="min-w-0 flex-1 truncate">{entry.title}</span>;
                if (!isStored(entry.versionId)) {
                  return (
                    <li
                      key={`${index}-${entry.versionId}`}
                      className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 px-3 py-2 text-sm text-gray-400"
                    >
                      {number}
                      {title}
                      <span role="img" aria-label="Not on this device" className="flex shrink-0 items-center gap-1 text-[10px]">
                        <svg aria-hidden="true" {...ICON}>
                          <path d="M10.1 2.182a10 10 0 0 1 3.8 0" />
                          <path d="M13.9 21.818a10 10 0 0 1-3.8 0" />
                          <path d="M17.609 3.721a10 10 0 0 1 2.69 2.7" />
                          <path d="M2.182 13.9a10 10 0 0 1 0-3.8" />
                          <path d="M20.279 17.609a10 10 0 0 1-2.7 2.69" />
                          <path d="M21.818 10.1a10 10 0 0 1 0 3.8" />
                          <path d="M3.721 6.391a10 10 0 0 1 2.7-2.69" />
                          <path d="M6.391 20.279a10 10 0 0 1-2.69-2.7" />
                        </svg>
                        <span>Not on this device</span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={`${index}-${entry.versionId}`}>
                    <Link
                      href={offlineFastViewPath(entry.versionId, setlist.bandId)}
                      // Shown offline, where a prefetch can only fail.
                      prefetch={false}
                      onClick={() => writeSetlistQueue(setlist)}
                      className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm font-medium text-gray-900 transition-colors hover:border-emerald-300 hover:bg-emerald-50/40"
                    >
                      {number}
                      {title}
                      <svg aria-hidden="true" {...ICON} className="h-4 w-4 shrink-0 text-emerald-600">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </section>
  );
}
