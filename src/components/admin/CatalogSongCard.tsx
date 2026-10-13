"use client";

import { CatalogFlowPanel } from "@/components/admin/CatalogFlowPanel";
import { CatalogVersionRow } from "@/components/admin/CatalogVersionRow";
import type { CatalogAdminController } from "@/hooks/useCatalogAdmin";
import type { CatalogSearchResult } from "@/types/database";

interface CatalogSongCardProps {
  song: CatalogSearchResult;
  allSongs: CatalogSearchResult[];
  controller: CatalogAdminController;
}

const ACTION_BUTTON =
  "rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";

/** One song of the results: collapsed to a header, opened to its versions and their counts. */
export function CatalogSongCard({ song, allSongs, controller }: CatalogSongCardProps) {
  const open = controller.openSongIds.includes(song.id);
  const flow = controller.flow?.songId === song.id ? controller.flow : null;
  const split = flow?.kind === "split" ? flow : null;
  const { busy } = controller;

  return (
    <section className="rounded-xl border border-gray-200 bg-white" aria-label={song.title}>
      <header className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-gray-900 truncate">{song.title}</h2>
          <p className="text-xs text-gray-500 truncate">
            {song.artist} · {song.versions.length} {song.versions.length === 1 ? "version" : "versions"}
          </p>
        </div>
        <button
          type="button"
          className={ACTION_BUTTON}
          disabled={busy}
          aria-expanded={open}
          onClick={() => controller.toggleSong(song)}
        >
          {open ? "Close" : "Open"}
        </button>
        {open && (
          <>
            <button
              type="button"
              className={ACTION_BUTTON}
              disabled={busy || song.versions.length < 2}
              onClick={() => controller.startSplit(song)}
            >
              Split...
            </button>
            <button
              type="button"
              className={ACTION_BUTTON}
              disabled={busy || allSongs.length < 2}
              onClick={() => controller.startMergeSongs(song)}
            >
              Merge song into...
            </button>
          </>
        )}
      </header>
      {open && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-3">
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {song.versions.map((version) => (
              <CatalogVersionRow
                key={version.versionId}
                version={version}
                radius={controller.radii[version.versionId]}
                busy={busy}
                splitChoice={
                  split
                    ? {
                        checked: split.chosen.includes(version.versionId),
                        onToggle: () => controller.toggleChosen(version.versionId),
                      }
                    : null
                }
                canMerge={song.versions.length > 1}
                onMerge={() => controller.startMergeVersions(song, version.versionId)}
                onDelete={() => controller.startDelete(song, version.versionId)}
              />
            ))}
          </ul>
          {flow && (
            <CatalogFlowPanel song={song} allSongs={allSongs} flow={flow} controller={controller} />
          )}
        </div>
      )}
    </section>
  );
}
