import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import { getPendingGlobalSongEdits } from "@/lib/moderation";
import { reviewGlobalSongEditAction } from "@/app/actions/moderation";
import {
  ModerationQueue,
  type ModerationQueueActions,
} from "@/components/admin/ModerationQueue";
import type { GlobalSongEdit } from "@/types/database";

/**
 * Composition root for the moderation island: the page owns the Server Action
 * and injects it, so `src/components` never imports from `@/app/*` (F21).
 */
const MODERATION_ACTIONS: ModerationQueueActions = {
  reviewGlobalSongEdit: reviewGlobalSongEditAction,
};

function AccessDeniedPanel() {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4 space-y-4">
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-6 text-center space-y-3"
      >
        <div className="text-3xl">🚫</div>
        <h2 className="text-lg font-bold text-red-800">Access Denied</h2>
        <p className="text-sm text-red-600">
          You must be a System Administrator to access this page.
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center px-4 py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 transition-colors"
          >
            ← Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Server Component: the pending queue is read here, not in a mount effect.
 * `getPendingGlobalSongEdits` re-throws its authorization failure unwrapped
 * (convention L1a), so `Access denied` is a reliable discriminator — the same
 * one the client page used. A non-admin gets the panel with HTTP 200; any other
 * failure is handed to the island, which surfaces it as an error banner.
 */
export default async function AdminModerationPage() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  let edits: GlobalSongEdit[] = [];
  let loadError: string | null = null;
  try {
    edits = await getPendingGlobalSongEdits(userId);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    loadError = err.message;
  }

  if (loadError?.startsWith("Access denied")) {
    return <AccessDeniedPanel />;
  }

  return (
    <ModerationQueue
      initialEdits={edits}
      initialError={loadError}
      actions={MODERATION_ACTIONS}
    />
  );
}
