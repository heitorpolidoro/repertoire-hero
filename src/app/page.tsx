import { getSession } from "@/lib/auth-session";
import {
  createAndAddSongAction,
  addSongAction,
  searchSongsAction,
  updateSongAction,
  updateSongStatusAction,
  updateSongTagsAction,
} from "@/app/actions/repertoire";
import { getBandRoleAction } from "@/app/actions/bands";
import { submitSongEditAction } from "@/app/actions/moderation";
import LandingPage from "@/components/landing/LandingPage";
import RepertoireDashboard, {
  type RepertoireDashboardActions,
} from "@/components/songs/RepertoireDashboard";

/**
 * Composition root for the repertoire island: the page owns the Server Actions
 * and injects them, so `src/components` never imports from `@/app/*` (F21).
 * Module-level, so the object identity is stable across renders (RH-47).
 */
const REPERTOIRE_DASHBOARD_ACTIONS: RepertoireDashboardActions = {
  createAndAddSong: createAndAddSongAction,
  addSong: addSongAction,
  searchSongs: searchSongsAction,
  updateSong: updateSongAction,
  updateSongStatus: updateSongStatusAction,
  updateSongTags: updateSongTagsAction,
  submitSongEdit: submitSongEditAction,
  getBandRole: getBandRoleAction,
};

/**
 * Server Component (RH-77). The session is resolved here, on the server, so the
 * document a visitor or a crawler receives is the page itself rather than the
 * pending-session placeholder the client then replaced — which is what used to
 * make `/` hydrate against markup it did not match.
 *
 * Unlike the four precedents (`/bands`, `/playlists`, `/admin/moderation`,
 * `/playlists/[id]`) this page does **not** `redirect("/login")`: the
 * signed-out branch of `/` is the product's public marketing page, which is
 * also why `/` is deliberately absent from `src/proxy.ts`'s matcher.
 *
 * Dynamic by construction — `getSession()` awaits `headers()` — so no
 * `export const dynamic` is needed, and none is added.
 */
export default async function HomePage() {
  const session = await getSession();

  if (!session?.user?.id) {
    return <LandingPage />;
  }

  return <RepertoireDashboard actions={REPERTOIRE_DASHBOARD_ACTIONS} />;
}
