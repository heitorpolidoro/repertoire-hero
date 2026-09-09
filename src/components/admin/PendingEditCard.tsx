import { PendingEditDiff } from "@/components/admin/PendingEditDiff";
import type { GlobalSongEdit } from "@/types/database";

interface PendingEditCardProps {
  edit: GlobalSongEdit;
  isProcessing: boolean;
  isRejecting: boolean;
  rejectionReason: string;
  onRejectionReasonChange: (reason: string) => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onConfirmReject: () => void;
  onApprove: () => void;
}

/**
 * One card of the moderation queue. Presentational and stateless — every piece
 * of state it renders is owned by `ModerationQueue`, which is the only client
 * component in this tree that holds any.
 */
export function PendingEditCard({
  edit,
  isProcessing,
  isRejecting,
  rejectionReason,
  onRejectionReasonChange,
  onStartReject,
  onCancelReject,
  onConfirmReject,
  onApprove,
}: PendingEditCardProps) {
  const requester = edit.requester;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
      {/* Proposal Info Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <div>
          <span className="text-xs font-semibold text-gray-400">
            Edit Request ID: {edit.id.substring(0, 8)}...
          </span>
          <p className="text-xs text-gray-500 mt-0.5">
            Requested by{" "}
            <span className="font-medium text-gray-700">
              {requester?.full_name || requester?.email || edit.requested_by}
            </span>{" "}
            on {new Date(edit.created_at).toLocaleDateString()}
          </p>
        </div>
        <span className="self-start sm:self-auto text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md">
          Pending
        </span>
      </div>

      {/* Diff Comparison */}
      <PendingEditDiff song={edit.song} proposed={edit.proposed_data} />

      {/* Rejection reason form */}
      {isRejecting ? (
        <div className="space-y-3 pt-2 bg-red-50/50 p-4 rounded-xl border border-red-100">
          <label className="block text-xs font-semibold text-red-800">
            Rejection Reason (Optional)
          </label>
          <input
            type="text"
            value={rejectionReason}
            onChange={(e) => onRejectionReasonChange(e.target.value)}
            placeholder="e.g. Inaccurate information or duplicate submission"
            className="w-full rounded-lg border border-red-200 px-3 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isProcessing}
              onClick={onConfirmReject}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {isProcessing ? "Rejecting..." : "Confirm Rejection"}
            </button>
            <button
              type="button"
              onClick={onCancelReject}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs hover:bg-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Action Buttons */
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onStartReject}
            className="px-4 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            Reject Request
          </button>
          <button
            type="button"
            disabled={isProcessing}
            onClick={onApprove}
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {isProcessing ? "Approving..." : "Approve & Apply"}
          </button>
        </div>
      )}
    </div>
  );
}
