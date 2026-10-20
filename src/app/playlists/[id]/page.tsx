import { redirect } from "next/navigation";
import {
  updatePlaylistAction,
  deletePlaylistAction,
  removeSongFromPlaylistAction,
  reorderPlaylistSongsAction,
} from "@/app/actions/playlists";
import {
  recordPracticeAction,
  recordPracticeStatusAction,
  updateSongStatusAction,
  updateSongTagsAction,
} from "@/app/actions/repertoire";
import { OFFLINE_DOWNLOAD_ACTIONS } from "@/app/offlineActions";
import { PRACTICE_ACTIONS } from "@/app/practiceActions";
import { SONG_PICKER_ACTIONS } from "@/app/songPickerActions";
import { PlaylistDetailView } from "@/components/playlists/PlaylistDetailView";
import type { PlaylistDetailActions } from "@/hooks/usePlaylistDetail";
import { getSession } from "@/lib/auth-session";
import { assertBandMember, getBandMembers, getBandWithMembers } from "@/lib/bands";
import { getPlaylistWithSongs } from "@/lib/playlists";
import { getRepertoire } from "@/lib/ownerSongs";

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
  recordPractice: recordPracticeAction,
  recordPracticeStatus: recordPracticeStatusAction,
  reorderPlaylistSongs: reorderPlaylistSongsAction,
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

  // RH-103: reordering a band setlist is an admin act, so the role is read here
  // — on the server, under the session this page already resolved — and the
  // island is handed one boolean. The non-null playlist read above already
  // proved membership, so `assertBandMember` cannot refuse; what it adds is the
  // role. A plain member is offered nothing, and `reorderPlaylistSongs` refuses
  // them again at the write.
  const isBandAdmin = bandId ? (await assertBandMember(bandId, userId)) === "admin" : false;
  const canReorder = bandId ? isBandAdmin : true;

  // RH-119: only a band admin may mark who was at the rehearsal, so only they
  // are handed the members; everyone else gets the review list as before.
  const band = bandId && isBandAdmin ? await getBandWithMembers(bandId, userId) : null;
  const presence = band
    ? {
        selfId: userId,
        members: getBandMembers(band).map((m) => ({
          userId: m.user_id,
          name: m.profile?.full_name ?? m.profile?.email ?? "Member",
        })),
      }
    : undefined;

  return (
    <PlaylistDetailView
      playlist={playlist}
      repertoire={repertoire}
      currentUserId={userId}
      canReorder={canReorder}
      presence={presence}
      actions={PLAYLIST_DETAIL_ACTIONS}
      pickerActions={SONG_PICKER_ACTIONS}
      offlineActions={OFFLINE_DOWNLOAD_ACTIONS}
      practiceActions={PRACTICE_ACTIONS}
    />
  );
}
