"use client";

import Link from "next/link";
import { buildPlaylistGroups } from "@/lib/playlistList";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import type { Playlist } from "@/types/database";

interface PlaylistGroupListProps {
  playlists: Playlist[];
  /**
   * Only the empty-state copy depends on it ("... or import one from Spotify"),
   * and it is a plain boolean because the server resolved it before the render.
   */
  spotifyConnected: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

type PlaylistCardListProps = Pick<
  PlaylistGroupListProps,
  "playlists" | "onOpen" | "onDelete" | "onRename"
>;

/** The card list of one section — the personal one and every band one. */
const PlaylistCardList = ({
  playlists,
  onOpen,
  onDelete,
  onRename,
}: PlaylistCardListProps) => (
  <ul className="flex flex-col gap-3" role="list">
    {playlists.map((playlist) => (
      <PlaylistCard
        key={playlist.id}
        playlist={playlist}
        onClick={() => onOpen(playlist.id)}
        onDelete={onDelete}
        onRename={onRename}
      />
    ))}
  </ul>
);

/**
 * Presentational: no state, no data access. The grouping decision lives in
 * `@/lib/playlistList` and is unit-tested there.
 */
export const PlaylistGroupList = ({
  playlists,
  spotifyConnected,
  onOpen,
  onDelete,
  onRename,
}: PlaylistGroupListProps) => {
  const groups = buildPlaylistGroups(playlists);
  const personalGroup = groups.find((g) => g.type === "personal");
  const bandGroups = groups.filter((g) => g.type === "band");

  if (playlists.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center h-40 text-center gap-2"
        aria-live="polite"
      >
        <p className="text-gray-500 font-medium">No playlists yet</p>
        <p className="text-sm text-gray-400">
          Create your first playlist with the &ldquo;+ New Playlist&rdquo; button
          {spotifyConnected && " or import one from Spotify"}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Personal section */}
      <section aria-label="My playlists">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            My playlists
          </p>
        </div>
        {personalGroup ? (
          <PlaylistCardList
            playlists={personalGroup.playlists}
            onOpen={onOpen}
            onDelete={onDelete}
            onRename={onRename}
          />
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">
            No personal playlists yet.
          </p>
        )}
      </section>

      {/* Band sections */}
      {bandGroups.map((group) => (
        <section key={group.bandId} aria-label={`Band: ${group.bandName}`}>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href={`/bands/${group.bandId}`}
              className="flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-900 focus:outline-none focus:underline"
            >
              🎸 {group.bandName}
            </Link>
          </div>
          <PlaylistCardList
            playlists={group.playlists}
            onOpen={onOpen}
            onDelete={onDelete}
            onRename={onRename}
          />
        </section>
      ))}
    </div>
  );
};
