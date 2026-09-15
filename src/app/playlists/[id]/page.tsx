import { redirect } from "next/navigation";
import {
  updatePlaylistAction,
  deletePlaylistAction,
  removeSongFromPlaylistAction,
} from "@/app/actions/playlists";
import { updateSongStatusAction, updateSongTagsAction } from "@/app/actions/repertoire";
import { SONG_PICKER_ACTIONS } from "@/app/songPickerActions";
import { PlaylistDetailView } from "@/components/playlists/PlaylistDetailView";
import type { PlaylistDetailActions } from "@/hooks/usePlaylistDetail";
import { getSession } from "@/lib/auth-session";
import { getPlaylistWithSongs } from "@/lib/playlists";
import { getRepertoire } from "@/lib/songs";

/**
 * The page owns the Server Actions and injects them, so `src/components` and
 * `src/hooks` never import from `@/app/*` (F21).
 */
const PLAYLIST_DETAIL_ACTIONS: PlaylistDetailActions = {
  updatePlaylist: updatePlaylistAction,
  deletePlaylist: deletePlaylistAction,
  removeSongFromPlaylist: removeSongFromPlaylistAction,
  updateSongStatus: updateSongStatusAction,
  updateSongTags: updateSongTagsAction,
};

/**
 * Server Component (RH-71): the playlist and the repertoire beside it are read
 * here, not in a mount effect, and the repertoire owner is the playlist's own
 * owner — no server render can read the localStorage band-context store, a
 * non-null read proves the caller may act as that owner, and the island carries
 * that same owner into both repertoire writes.
 *
 * Dynamic by construction, since `getSession()` awaits `headers()`. A playlist
 * the caller may not read is indistinguishable from one that does not exist,
 * and both go to `/playlists`, where the deleted client load sent them too.
 */
export default async function PlaylistDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const { id } = await props.params;
  const playlist = await getPlaylistWithSongs(id, userId);
  if (!playlist) redirect("/playlists");
  const bandId = playlist.band_id;
  const repertoire = await getRepertoire(bandId ? { bandId } : { userId });

  return (
    <PlaylistDetailView
      playlist={playlist}
      repertoire={repertoire}
      currentUserId={userId}
      actions={PLAYLIST_DETAIL_ACTIONS}
      pickerActions={SONG_PICKER_ACTIONS}
    />
  );
}
