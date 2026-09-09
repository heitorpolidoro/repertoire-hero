import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import { getBands } from "@/lib/bands";
import { createBandAction, uploadBandCoverAction } from "@/app/actions/bands";
import { BandsView, type BandsViewActions } from "@/components/bands/BandsView";
import type { Band } from "@/types/database";

/**
 * Composition root for the bands island: the page owns the Server Actions and
 * injects them, so `src/components` never imports from `@/app/*` (F21).
 */
const BANDS_VIEW_ACTIONS: BandsViewActions = {
  createBand: createBandAction,
  uploadBandCover: uploadBandCoverAction,
};

/**
 * Server Component: the band list is read here, not in a mount effect. Dynamic
 * by construction — `getSession()` awaits `headers()` — so no `export const
 * dynamic` is needed. `src/proxy.ts` already answers an unauthenticated request
 * with a 307 to /login; the redirect below is defence in depth and is what
 * narrows `userId` to `string`.
 */
export default async function BandsPage() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  let bands: Band[] = [];
  let loadError: string | null = null;
  try {
    bands = await getBands(userId);
  } catch (error) {
    // `src/lib/bands.ts` already logged this at L1; a second log would
    // double-report to Sentry. Degrade to an inline banner, as before.
    const err = error instanceof Error ? error : new Error(String(error));
    loadError = err.message;
  }

  return <BandsView bands={bands} initialError={loadError} actions={BANDS_VIEW_ACTIONS} />;
}
