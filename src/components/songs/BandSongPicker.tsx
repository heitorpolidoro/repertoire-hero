"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Repertoire } from "@/types/database";
import { usePickedSelection } from "@/hooks/usePickedSelection";
import { PickableRowLink, SelectSongsButton, SongPickerBar } from "@/components/songs/SongPickerBar";

/** The one read the band screen's song list needs; injected by the page (F21). */
export interface BandSongPickerActions {
  getBandSongs: (bandId: string) => Promise<Repertoire[]>;
}

/**
 * RH-170 - the band screen's "Songs" section: the band repertoire, and the
 * "Select songs" mode that starts a practice session in tap order. The screen
 * only mounts this.
 */
export function BandSongPicker({ bandId, actions }: { bandId: string; actions: BandSongPickerActions }) {
  const router = useRouter();
  const [songs, setSongs] = useState<Repertoire[]>([]);

  useEffect(() => {
    let current = true;
    actions
      .getBandSongs(bandId)
      .then((rows) => current && setSongs(rows))
      // The list is optional chrome on this screen; an unreadable repertoire shows empty.
      .catch(() => current && setSongs([]));
    return () => {
      current = false;
    };
  }, [actions, bandId]);

  const rows = useMemo(
    () => songs.map((s) => ({ versionId: s.version_id, title: s.song?.title ?? "—", artist: s.song?.artist ?? null })),
    [songs],
  );
  const picker = usePickedSelection({
    rows,
    owner: { type: "band", bandId },
    originHref: `/bands/${bandId}`,
    push: router.push,
  });

  return (
    <section className="bg-white rounded-2xl border border-gray-200 px-5 py-4" aria-label="Band songs">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900">Songs</h2>
        <SelectSongsButton picker={picker} />
      </div>
      <SongPickerBar picker={picker} />
      {songs.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">No songs yet.</p>
      ) : (
        <ul className="space-y-1 mt-2">
          {songs.map((song) => (
            <li key={song.id}>
              <PickableRowLink
                picker={picker}
                versionId={song.version_id}
                href={`/songs/${song.version_id}/fast-view?bandId=${bandId}`}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-gray-50"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-gray-900 truncate">{song.song?.title ?? "—"}</span>
                  <span className="block text-xs text-gray-500 truncate">{song.song?.artist ?? "—"}</span>
                </span>
              </PickableRowLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
