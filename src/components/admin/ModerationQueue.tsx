"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { PendingEditCard } from "@/components/admin/PendingEditCard";
import { PendingSongCard } from "@/components/admin/PendingSongCard";
import type { FieldReviewControls } from "@/components/admin/PendingFieldSection";
import {
  FIELD_ALREADY_REVIEWED,
  approvalNotice,
  fieldKey,
  groupFieldsBySong,
} from "@/lib/pendingFields";
import type { CatalogSuggestion, PendingCatalogSuggestionGroup } from "@/types/database";
import type {
  ApprovedFieldOutcome,
  PendingFieldGroup,
  PendingFieldOption,
} from "@/types/pendingFieldGroup";

/**
 * The Server Actions the queue calls. Injected by
 * `src/app/admin/moderation/page.tsx` rather than imported, so `src/components`
 * never points back into `src/app` (F21).
 */
export interface ModerationQueueActions {
  approveCatalogFieldOption: (suggestionIds: string[]) => Promise<ApprovedFieldOutcome>;
  rejectCatalogField: (songId: string, column: string, reason?: string) => Promise<number>;
  /** Decides the `song_links` rows of one submission (RH-138). */
  reviewLinkChanges: (
    groupId: string,
    action: "approve" | "reject",
    reason?: string,
    rejectLinkSuggestionIds?: string[],
  ) => Promise<CatalogSuggestion[]>;
}

interface ModerationQueueProps {
  /** Read on the server by `getPendingFieldGroups(userId)`; this island never fetches. */
  initialFields: PendingFieldGroup[];
  /** The link-row corrections, read on the server by `getPendingCatalogSuggestions(userId, true)`. */
  initialLinkGroups: PendingCatalogSuggestionGroup[];
  /** A non-authorization server-side read failure, seeded into the error banner. */
  initialError: string | null;
  actions: ModerationQueueActions;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function ModerationQueue({
  initialFields,
  initialLinkGroups,
  initialError,
  actions,
}: ModerationQueueProps) {
  const router = useRouter();
  const [fields, setFields] = useState<PendingFieldGroup[]>(initialFields);
  const [linkGroups, setLinkGroups] = useState<PendingCatalogSuggestionGroup[]>(initialLinkGroups);
  const [error, setError] = useState<string | null>(initialError);
  const [success, setSuccess] = useState<string | null>(null);

  // One reason input at a time: the field or the link submission being rejected.
  const [rejectingKey, setRejectingKey] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // Per-submission link-row verdicts (RH-138): the suggestion ids marked "reject".
  const [rejectedLinks, setRejectedLinks] = useState<Record<string, string[]>>({});

  /** Runs one decision: busy flag, cleared banners, error to the banner, refresh on success. */
  async function decide(key: string, work: () => Promise<void>, onStale?: () => void) {
    setBusyKey(key);
    setError(null);
    setSuccess(null);
    try {
      await work();
      // Local state is what the user sees; `refresh()` only re-seeds the props a
      // later mount would receive from the Server Component read.
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // Someone else decided it first: it has nothing left to decide here.
      if (msg === FIELD_ALREADY_REVIEWED) onStale?.();
    } finally {
      setBusyKey(null);
    }
  }

  function dropField(field: PendingFieldGroup) {
    setFields((prev) => prev.filter((f) => fieldKey(f) !== fieldKey(field)));
  }

  function closeRejectForm() {
    setRejectingKey(null);
    setRejectionReason("");
  }

  const fieldControls: FieldReviewControls = {
    busyKey,
    rejectingKey,
    rejectionReason,
    onRejectionReasonChange: setRejectionReason,
    onApprove: (field: PendingFieldGroup, option: PendingFieldOption) =>
      decide(
        fieldKey(field),
        async () => {
          const outcome = await actions.approveCatalogFieldOption(option.suggestion_ids);
          dropField(field);
          setSuccess(approvalNotice(outcome.superseded));
        },
        () => dropField(field),
      ),
    onStartReject: (field) => setRejectingKey(fieldKey(field)),
    onCancelReject: closeRejectForm,
    onConfirmReject: (field) =>
      decide(
        fieldKey(field),
        async () => {
          await actions.rejectCatalogField(
            field.song_id,
            field.target_column,
            rejectionReason.trim() || undefined,
          );
          dropField(field);
          setSuccess("All proposals for this field rejected.");
          closeRejectForm();
        },
        () => dropField(field),
      ),
  };

  function toggleLinkVerdict(groupId: string, suggestionId: string) {
    setRejectedLinks((prev) => {
      const current = prev[groupId] ?? [];
      const next = current.includes(suggestionId)
        ? current.filter((id) => id !== suggestionId)
        : [...current, suggestionId];
      return { ...prev, [groupId]: next };
    });
  }

  function dropLinkGroup(groupId: string) {
    setLinkGroups((prev) => prev.filter((g) => g.group_id !== groupId));
  }

  function approveLinks(groupId: string) {
    return decide(groupId, async () => {
      const rejectedIds = rejectedLinks[groupId] ?? [];
      if (rejectedIds.length > 0) {
        await actions.reviewLinkChanges(groupId, "approve", undefined, rejectedIds);
      } else {
        await actions.reviewLinkChanges(groupId, "approve");
      }
      dropLinkGroup(groupId);
      setSuccess("Link changes applied to the catalog.");
    });
  }

  function rejectLinks(groupId: string) {
    return decide(groupId, async () => {
      await actions.reviewLinkChanges(groupId, "reject", rejectionReason.trim() || undefined);
      dropLinkGroup(groupId);
      setSuccess("Link changes rejected.");
      closeRejectForm();
    });
  }

  const songCards = groupFieldsBySong(fields);
  const isEmpty = fields.length === 0 && linkGroups.length === 0;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🛡️</span>
            <h1 className="text-2xl font-bold text-gray-900">System Admin Moderation</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Review and manage global song catalog edit proposals.
          </p>
        </div>
        <span className="text-xs font-bold px-3 py-1 bg-amber-100 text-amber-800 rounded-full border border-amber-200">
          {plural(fields.length, "Pending Field")}
        </span>
      </div>

      {/* Toast Alerts */}
      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}

      {success && (
        <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />
      )}

      {/* Moderation Queue */}
      {isEmpty && (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center space-y-2 shadow-sm">
          <div className="text-3xl">✨</div>
          <h2 className="text-base font-semibold text-gray-900">Queue is empty</h2>
          <p className="text-xs text-gray-500">
            There are no pending catalog corrections to review right now.
          </p>
        </div>
      )}

      {songCards.length > 0 && (
        <div className="space-y-4">
          {songCards.map((card) => (
            <PendingSongCard key={card.song_id} card={card} controls={fieldControls} />
          ))}
        </div>
      )}

      {linkGroups.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-gray-700">
            {plural(linkGroups.length, "link correction")}
          </h2>
          {linkGroups.map((group) => (
            <PendingEditCard
              key={group.group_id}
              group={group}
              rejectedLinkIds={rejectedLinks[group.group_id] ?? []}
              onToggleLinkVerdict={(id) => toggleLinkVerdict(group.group_id, id)}
              isProcessing={busyKey === group.group_id}
              isRejecting={rejectingKey === group.group_id}
              rejectionReason={rejectionReason}
              onRejectionReasonChange={setRejectionReason}
              onStartReject={() => setRejectingKey(group.group_id)}
              onCancelReject={closeRejectForm}
              onConfirmReject={() => rejectLinks(group.group_id)}
              onApprove={() => approveLinks(group.group_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
