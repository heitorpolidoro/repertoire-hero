import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import { getPendingCatalogSuggestions } from "@/lib/moderation";
import { getPendingFieldGroups } from "@/lib/moderationFields";
import {
  approveCatalogFieldOptionAction,
  rejectCatalogFieldAction,
  reviewLinkChangesAction,
} from "@/app/actions/moderation";
import {
  ModerationQueue,
  type ModerationQueueActions,
} from "@/components/admin/ModerationQueue";
import { AccessDeniedPanel } from "@/components/admin/AccessDeniedPanel";
import type { PendingCatalogSuggestionGroup } from "@/types/database";
import type { PendingFieldGroup } from "@/types/pendingFieldGroup";

/**
 * Composition root for the moderation island: the page owns the Server Actions
 * and injects them, so `src/components` never imports from `@/app/*` (F21).
 */
const MODERATION_ACTIONS: ModerationQueueActions = {
  approveCatalogFieldOption: approveCatalogFieldOptionAction,
  rejectCatalogField: rejectCatalogFieldAction,
  reviewLinkChanges: reviewLinkChangesAction,
};

/**
 * Server Component: the pending queue is read here, not in a mount effect.
 * Both reads re-throw their authorization failure unwrapped (convention L1a),
 * so `Access denied` is a reliable discriminator - the same one the client page
 * used. A non-admin gets the panel with HTTP 200; any other failure is handed to
 * the island, which surfaces it as an error banner.
 */
export default async function AdminModerationPage() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  let fields: PendingFieldGroup[] = [];
  let linkGroups: PendingCatalogSuggestionGroup[] = [];
  let loadError: string | null = null;
  try {
    [fields, linkGroups] = await Promise.all([
      getPendingFieldGroups(userId),
      getPendingCatalogSuggestions(userId, true),
    ]);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    loadError = err.message;
  }

  if (loadError?.startsWith("Access denied")) {
    return <AccessDeniedPanel />;
  }

  return (
    <ModerationQueue
      initialFields={fields}
      initialLinkGroups={linkGroups}
      initialError={loadError}
      actions={MODERATION_ACTIONS}
    />
  );
}
