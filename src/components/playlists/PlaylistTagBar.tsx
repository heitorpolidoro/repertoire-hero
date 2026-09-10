"use client";

import { TagEditRow } from "@/components/playlists/TagEditRow";
import type { TagEditorController } from "@/hooks/useTagEditor";
import type { Playlist } from "@/types/database";

export interface PlaylistTagBarProps {
  playlist: Playlist;
  /** The signed-in user, or `null` — derived by the page from the session. */
  currentUserId: string | null;
  /** The playlist half of the page's tag editing. */
  editor: TagEditorController;
}

/**
 * RH-69 — the playlist's own tag bar, under the header.
 *
 * It owns the ownership gate the page used to take inline: a band playlist is
 * taggable by anyone browsing it (the band shares it), a personal playlist only
 * by the user who owns it. `currentUserId` arrives as a prop rather than being
 * read from the session here, so the decision stays testable and the session
 * stays the page's business.
 */
export function PlaylistTagBar({
  playlist,
  currentUserId,
  editor,
}: PlaylistTagBarProps) {
  if (playlist.band_id === null && playlist.user_id !== currentUserId) {
    return null;
  }

  return (
    <TagEditRow
      subject={playlist.id}
      tags={playlist.tags ?? []}
      editor={editor}
      addLabel="Add tag to playlist"
      className="px-4 py-2 md:px-6 border-b border-gray-100 bg-white flex flex-wrap items-center gap-1.5"
    />
  );
}
