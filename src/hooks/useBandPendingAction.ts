import { useState } from "react";
import { withoutMember, type PendingAction } from "@/lib/bandAdminState";
import type { BandAdminActions } from "@/hooks/useBandAdmin";
import type { ToastTone } from "@/lib/uiTones";
import type { Band, BandMember } from "@/types/database";

// Error messages that were already identical on both surfaces.
const DELETE_ERROR = "Failed to delete band";
const LEAVE_ERROR = "Failed to leave band";
const REMOVE_MEMBER_ERROR = "Failed to remove member";

/**
 * The destructive-action half of the band-detail controller: one staged
 * confirmation at a time, and the three commands that can stage it. The pages
 * render `action` as an in-page `ConfirmPanel` — never a native dialog.
 */
export interface BandPendingController {
  action: PendingAction | null;
  busy: boolean;
  requestDelete: () => void;
  requestLeave: () => void;
  requestRemove: (member: BandMember) => void;
  confirm: () => Promise<void>;
  dismiss: () => void;
}

export interface UseBandPendingActionOptions {
  bandId: string;
  actions: Pick<BandAdminActions, "deleteBand" | "leaveBand" | "removeBandMember">;
  /** `null` when nobody is signed in, which makes `requestLeave` a no-op. */
  currentUserId: string | null;
  /** Drops the removed member from the composition root's loaded band. */
  patchBand: (patch: (band: Band) => Band) => void;
  showToast: (message: string, tone?: ToastTone) => void;
  reportError: (message: string) => void;
  dismissError: () => void;
  /** After a delete/leave succeeds — both surfaces: `router.replace('/bands')`. */
  onGone: () => void;
}

export function useBandPendingAction({
  bandId,
  actions,
  currentUserId,
  patchBand,
  showToast,
  reportError,
  dismissError,
  onGone,
}: UseBandPendingActionOptions): BandPendingController {
  const [action, setAction] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  function requestDelete() {
    dismissError();
    setAction({ kind: "deleteBand" });
  }

  function requestLeave() {
    if (!currentUserId) return;
    dismissError();
    setAction({ kind: "leaveBand" });
  }

  function requestRemove(member: BandMember) {
    dismissError();
    setAction({ kind: "removeMember", member });
  }

  function dismiss() {
    setAction(null);
  }

  // Named `confirmPending` rather than `confirm`: a bare `confirm(` is the native
  // browser dialog the RH-16 guard forbids anywhere under `src`.
  async function confirmPending() {
    if (!action) return;
    setBusy(true);
    try {
      switch (action.kind) {
        case "deleteBand":
          try {
            await actions.deleteBand(bandId);
            setAction(null);
            // No toast: the view unmounts immediately, navigation is the feedback.
            onGone();
          } catch (err) {
            reportError(err instanceof Error ? err.message : DELETE_ERROR);
          }
          break;
        case "leaveBand":
          try {
            await actions.leaveBand(bandId);
            setAction(null);
            onGone();
          } catch (err) {
            reportError(err instanceof Error ? err.message : LEAVE_ERROR);
          }
          break;
        case "removeMember": {
          const { member } = action;
          try {
            await actions.removeBandMember(member.id);
            patchBand((current) => withoutMember(current, member.id));
            setAction(null);
            showToast(
              `${member.profile?.full_name ?? "This member"} removed from the band.`,
              "success",
            );
          } catch (err) {
            reportError(err instanceof Error ? err.message : REMOVE_MEMBER_ERROR);
          }
          break;
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    action,
    busy,
    requestDelete,
    requestLeave,
    requestRemove,
    confirm: confirmPending,
    dismiss,
  };
}
