import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import { getUserPlaylists } from "@/lib/playlists";
import { hasSpotifyConnection } from "@/lib/spotifyConnection";
import {
  createPlaylistAction,
  deletePlaylistAction,
  updatePlaylistAction,
} from "@/app/actions/playlists";
import { PlaylistsView, type PlaylistsViewActions } from "@/components/playlists/PlaylistsView";
import type { Playlist } from "@/types/database";

/**
 * Composition root for the playlists island: the page owns the Server Actions
 * and injects them, so `src/components` never imports from `@/app/*` (F21).
 */
const PLAYLISTS_VIEW_ACTIONS: PlaylistsViewActions = {
  createPlaylist: createPlaylistAction,
  updatePlaylist: updatePlaylistAction,
  deletePlaylist: deletePlaylistAction,
};

/**
 * Server Component: the playlist list is read here, not in a mount effect. The
 * read is already user-scoped — personal playlists plus every band the user
 * belongs to — so the active band context is not an input to it and stays
 * client-side, where its one consumer (the import destination) reads it.
 *
 * Dynamic by construction — `getSession()` awaits `headers()` — so no
 * `export const dynamic` is needed. `src/proxy.ts` already answers an
 * unauthenticated request with a 307 to /login; the redirect below is defence
 * in depth and is what narrows `userId` to `string`.
 */
export default async function PlaylistsPage() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  let playlists: Playlist[] = [];
  let loadError: string | null = null;
  try {
    playlists = await getUserPlaylists(userId);
  } catch (error) {
    // `src/lib/playlists.ts` already logged this at L1; a second log would
    // double-report to Sentry. Degrade to the same banner as before.
    const err = error instanceof Error ? error : new Error(String(error));
    loadError = err.message;
  }

  return (
    <PlaylistsView
      playlists={playlists}
      initialError={loadError}
      spotifyConnected={await hasSpotifyConnection(userId)}
      actions={PLAYLISTS_VIEW_ACTIONS}
    />
  );
}
