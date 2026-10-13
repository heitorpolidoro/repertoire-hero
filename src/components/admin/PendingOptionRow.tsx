import { formatFieldValue } from "@/lib/pendingFields";
import type { PendingFieldOption } from "@/types/pendingFieldGroup";

interface PendingOptionRowProps {
  option: PendingFieldOption;
  /** True while any decision on this field is in flight. */
  disabled: boolean;
  onApprove: () => void;
}

/**
 * One distinct proposed value of a contested field: the value, how many people
 * proposed it (highlighted when more than one), who they are, and the submission
 * reasons when any were given. Presentational and stateless.
 */
export function PendingOptionRow({ option, disabled, onApprove }: PendingOptionRowProps) {
  const many = option.count > 1;
  const names = option.requesters.map((requester) => requester.name).join(", ");

  return (
    <div
      className={`rounded-lg border p-2 flex items-start justify-between gap-2 ${
        many ? "border-indigo-200 bg-indigo-50" : "border-gray-200"
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm break-all">{formatFieldValue(option.value)}</span>
          <span
            aria-label={`${option.count} requests`}
            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              many ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-700"
            }`}
          >
            x{option.count}
          </span>
        </div>
        <div className="text-xs text-gray-500 mt-0.5">{names}</div>
        {option.reasons.map((reason) => (
          <div key={reason} className="text-xs text-gray-400 italic mt-0.5">
            &ldquo;{reason}&rdquo;
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onApprove}
        className="shrink-0 px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
      >
        Approve this
      </button>
    </div>
  );
}
