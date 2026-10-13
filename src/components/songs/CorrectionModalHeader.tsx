"use client";

/**
 * The correction dialog's title bar and its moderation notice. Presentational and
 * stateless; split out of `CorrectionModal` to keep that component under the F20
 * `max-lines-per-function` budget.
 */
export function CorrectionModalHeader({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-100 pb-3">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          ✏️ Suggest Global Song Correction
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Close modal"
        >
          &times;
        </button>
      </div>

      <p className="text-xs text-gray-500 leading-relaxed bg-amber-50 border border-amber-200/60 text-amber-800 p-3 rounded-xl">
        ℹ️ Your correction will be sent to the <strong>Admin Moderation Queue</strong>. Once approved by a System Admin, the global catalog song data will update across all repertoires sharing this song. Only the values you change are submitted.
      </p>
    </>
  );
}
