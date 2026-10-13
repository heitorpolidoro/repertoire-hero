import { getSession } from "@/lib/auth-session";
import {
  createAndAddSongAction,
  addSongAction,
  addVersionAction,
  searchSongsAction,
  updateSongAction,
  updateSongStatusAction,
  updateSongTagsAction,
} from "@/app/actions/repertoire";
import { getBandRoleAction } from "@/app/actions/bands";
import { cookies, headers } from "next/headers";
import {
  acknowledgeSuggestionOutcomesAction,
  getUnseenSuggestionOutcomesAction,
  submitCatalogSuggestionAction,
} from "@/app/actions/moderation";
import { COOKIE_NAME, getSuggestionOutcomeCopy, resolveLocale } from "@/lib/i18n";
import LandingPage from "@/components/landing/LandingPage";
import SuggestionOutcomeBanner, {
  type SuggestionOutcomeBannerActions,
} from "@/components/songs/SuggestionOutcomeBanner";
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
  addVersion: addVersionAction,
  searchSongs: searchSongsAction,
  updateSong: updateSongAction,
  updateSongStatus: updateSongStatusAction,
  updateSongTags: updateSongTagsAction,
  submitCatalogSuggestion: submitCatalogSuggestionAction,
  getBandRole: getBandRoleAction,
};

/** RH-111: the banner's one write, injected for the same reason (F21). */
const SUGGESTION_OUTCOME_ACTIONS: SuggestionOutcomeBannerActions = {
  acknowledge: acknowledgeSuggestionOutcomesAction,
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

  const [outcomes, cookieStore, headerStore] = await Promise.all([
    getUnseenSuggestionOutcomesAction(),
    cookies(),
    headers(),
  ]);
  const copy = getSuggestionOutcomeCopy(
    resolveLocale({
      cookieValue: cookieStore.get(COOKIE_NAME)?.value,
      acceptLanguage: headerStore.get("accept-language"),
    }),
  );

  return (
    <RepertoireDashboard
      actions={REPERTOIRE_DASHBOARD_ACTIONS}
      outcomeBanner={
        <SuggestionOutcomeBanner
          groups={outcomes}
          copy={copy}
          actions={SUGGESTION_OUTCOME_ACTIONS}
        />
      }
    />
  );
}
