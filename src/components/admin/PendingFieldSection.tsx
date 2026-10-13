import { PendingOptionRow } from "@/components/admin/PendingOptionRow";
import { fieldKey, fieldLabel, formatFieldValue } from "@/lib/pendingFields";
import type { PendingFieldGroup, PendingFieldOption } from "@/types/pendingFieldGroup";

/**
 * Everything a field section needs from `ModerationQueue`, the only component of
 * this tree that holds state: which field is busy or being rejected, the typed
 * reason, and the commands.
 */
export interface FieldReviewControls {
  busyKey: string | null;
  rejectingKey: string | null;
  rejectionReason: string;
  onRejectionReasonChange: (reason: string) => void;
  onApprove: (field: PendingFieldGroup, option: PendingFieldOption) => void;
  onStartReject: (field: PendingFieldGroup) => void;
  onCancelReject: () => void;
  onConfirmReject: (field: PendingFieldGroup) => void;
}

interface PendingFieldSectionProps {
  field: PendingFieldGroup;
  controls: FieldReviewControls;
}

function RejectForm({ field, controls }: PendingFieldSectionProps) {
  const busy = controls.busyKey === fieldKey(field);
  return (
    <div className="space-y-3 bg-red-50/50 p-3 rounded-xl border border-red-100">
      <label className="block text-xs font-semibold text-red-800">
        Rejection Reason (Optional)
        <input
          type="text"
          value={controls.rejectionReason}
          onChange={(e) => controls.onRejectionReasonChange(e.target.value)}
          placeholder="e.g. Inaccurate information or duplicate submission"
          className="mt-1 w-full rounded-lg border border-red-200 px-3 py-2 text-xs font-normal text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => controls.onConfirmReject(field)}
          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {busy ? "Rejecting..." : "Confirm Rejection"}
        </button>
        <button
          type="button"
          onClick={controls.onCancelReject}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-xs hover:bg-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * One contested field: its current value, the competing options (most
 * requested first) and the one command that closes them all. Presentational and
 * stateless.
 */
export function PendingFieldSection({ field, controls }: PendingFieldSectionProps) {
  const busy = controls.busyKey === fieldKey(field);
  const optionCount = field.options.length;

  return (
    <section aria-label={`${fieldLabel(field.target_column)} of ${field.song_title}`} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs">
          <span className="font-semibold uppercase tracking-wide text-gray-500">
            {fieldLabel(field.target_column)}
          </span>{" "}
          <span className="text-gray-400">current:</span>{" "}
          <span className="font-mono">{formatFieldValue(field.current_value)}</span>
        </div>
        <span className="text-xs text-gray-500">
          {field.total} request{field.total === 1 ? "" : "s"}, {optionCount} option
          {optionCount === 1 ? "" : "s"}
        </span>
      </div>
      {field.options.map((option) => (
        <PendingOptionRow
          key={option.suggestion_ids.join(",")}
          option={option}
          disabled={busy}
          onApprove={() => controls.onApprove(field, option)}
        />
      ))}
      {controls.rejectingKey === fieldKey(field) ? (
        <RejectForm field={field} controls={controls} />
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => controls.onStartReject(field)}
            className="px-3 py-1 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            Reject all for this field
          </button>
        </div>
      )}
    </section>
  );
}
