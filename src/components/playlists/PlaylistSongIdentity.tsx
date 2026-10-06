"use client";

import Image from "next/image";
import type { Song } from "@/types/database";

export interface PlaylistSongIdentityProps {
  /** The catalog song of the row; absent for a playlist row whose song failed to load. */
  song?: Song;
  /**
   * The version's own label — `"2011 Remaster"`, `"Live at Wembley"` — drawn
   * under the artist (RH-125). Without it a setlist holding two takes of one
   * song would show two identical rows, which is the whole reason a playlist
   * entry names a version rather than a song.
   */
  label?: string | null;
  /**
   * True when the block sits inside the row's Fast View `<Link>`, which is the
   * only difference between the two copies RH-68 replaced with this component:
   * the linked title picks up the group hover colour.
   */
  linked: boolean;
}

/**
 * The cover + title/artist/album block of one playlist row. The row rendered it
 * twice — once inside the Fast View link, once bare — and jscpd reported both
 * halves as clones; it is rendered once from here instead.
 */
export function PlaylistSongIdentity({ song, label, linked }: PlaylistSongIdentityProps) {
  return (
    <>
      {song?.cover_url ? (
        <Image
          src={song.cover_url}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 rounded object-cover shrink-0"
          unoptimized
        />
      ) : (
        <div
          className="h-10 w-10 rounded bg-emerald-100 shrink-0"
          aria-hidden="true"
        />
      )}
      <div className="flex-1 min-w-0">
        <p
          className={
            linked
              ? "text-sm font-medium text-gray-900 group-hover:text-emerald-600 transition-colors truncate"
              : "text-sm font-medium text-gray-900 truncate"
          }
        >
          {song?.title ?? "—"}
        </p>
        <p className="text-xs text-gray-500 truncate">{song?.artist ?? "—"}</p>
        {label && (
          <p className="text-xs text-emerald-700 truncate">{label}</p>
        )}
        {song?.album && (
          <p className="text-xs text-gray-400 italic truncate">{song.album}</p>
        )}
      </div>
    </>
  );
}
