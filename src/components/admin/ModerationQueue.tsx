"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { PendingEditCard } from "@/components/admin/PendingEditCard";
import type { CatalogSuggestion, PendingCatalogSuggestionGroup } from "@/types/database";

/**
 * The Server Action the queue calls. Injected by
 * `src/app/admin/moderation/page.tsx` rather than imported, so `src/components`
 * never points back into `src/app` (F21).
 */
export interface ModerationQueueActions {
  reviewCatalogSuggestionGroup: (
    groupId: string,
    action: "approve" | "reject",
    reason?: string,
  ) => Promise<CatalogSuggestion[]>;
}

interface ModerationQueueProps {
  /** Read on the server by `getPendingCatalogSuggestions(userId)`; this island never fetches. */
  initialGroups: PendingCatalogSuggestionGroup[];
  /** A non-authorization server-side read failure, seeded into the error banner. */
  initialError: string | null;
  actions: ModerationQueueActions;
}

export function ModerationQueue({ initialGroups, initialError, actions }: ModerationQueueProps) {
  const router = useRouter();
  const [groups, setGroups] = useState<PendingCatalogSuggestionGroup[]>(initialGroups);
  const [error, setError] = useState<string | null>(initialError);
  const [success, setSuccess] = useState<string | null>(null);

  // Rejection modal / inline reason state
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  async function handleApprove(groupId: string) {
    setProcessingId(groupId);
    setError(null);
    setSuccess(null);
    try {
      await actions.reviewCatalogSuggestionGroup(groupId, "approve");
      setGroups((prev) => prev.filter((g) => g.group_id !== groupId));
      setSuccess("Song edit approved and applied to global catalog.");
      // Local state is what the user sees; `refresh()` only re-seeds the props a
      // later mount would receive from the Server Component read.
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleConfirmReject(groupId: string) {
    setProcessingId(groupId);
    setError(null);
    setSuccess(null);
    try {
      await actions.reviewCatalogSuggestionGroup(
        groupId,
        "reject",
        rejectionReason.trim() || undefined
      );
      setGroups((prev) => prev.filter((g) => g.group_id !== groupId));
      setSuccess("Song edit proposal rejected.");
      setRejectingId(null);
      setRejectionReason("");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🛡️</span>
            <h1 className="text-2xl font-bold text-gray-900">
              System Admin Moderation
            </h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Review and manage global song catalog edit proposals.
          </p>
        </div>
        <span className="text-xs font-bold px-3 py-1 bg-amber-100 text-amber-800 rounded-full border border-amber-200">
          {groups.length} Pending Request{groups.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Toast Alerts */}
      {error && (
        <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />
      )}

      {success && (
        <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />
      )}

      {/* Moderation Queue */}
      {groups.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center space-y-2 shadow-sm">
          <div className="text-3xl">✨</div>
          <h2 className="text-base font-semibold text-gray-900">
            Queue is empty
          </h2>
          <p className="text-xs text-gray-500">
            There are no pending catalog corrections to review right now.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <PendingEditCard
              key={group.group_id}
              group={group}
              isProcessing={processingId === group.group_id}
              isRejecting={rejectingId === group.group_id}
              rejectionReason={rejectionReason}
              onRejectionReasonChange={setRejectionReason}
              onStartReject={() => setRejectingId(group.group_id)}
              onCancelReject={() => {
                setRejectingId(null);
                setRejectionReason("");
              }}
              onConfirmReject={() => handleConfirmReject(group.group_id)}
              onApprove={() => handleApprove(group.group_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
