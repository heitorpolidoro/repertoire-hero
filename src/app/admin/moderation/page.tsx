"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getPendingGlobalSongEditsAction,
  reviewGlobalSongEditAction,
} from "@/app/actions/moderation";
import { AlertBanner } from "@/components/ui/AlertBanner";
import type { GlobalSongEdit } from "@/types/database";

export default function AdminModerationPage() {
  const [edits, setEdits] = useState<GlobalSongEdit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Rejection modal / inline reason state
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);


  useEffect(() => {
    let isMounted = true;
    getPendingGlobalSongEditsAction()
      .then((data) => {
        if (isMounted) {
          setEdits(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleApprove(editId: string) {
    setProcessingId(editId);
    setError(null);
    setSuccess(null);
    try {
      await reviewGlobalSongEditAction(editId, "approve");
      setEdits((prev) => prev.filter((e) => e.id !== editId));
      setSuccess("Song edit approved and applied to global catalog.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleConfirmReject(editId: string) {
    setProcessingId(editId);
    setError(null);
    setSuccess(null);
    try {
      await reviewGlobalSongEditAction(
        editId,
        "reject",
        rejectionReason.trim() || undefined
      );
      setEdits((prev) => prev.filter((e) => e.id !== editId));
      setSuccess("Song edit proposal rejected.");
      setRejectingId(null);
      setRejectionReason("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setProcessingId(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4 flex justify-center text-sm text-gray-500">
        Loading moderation queue...
      </div>
    );
  }

  if (error && error.includes("Access denied")) {
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
          {edits.length} Pending Request{edits.length !== 1 ? "s" : ""}
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
      {edits.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center space-y-2 shadow-sm">
          <div className="text-3xl">✨</div>
          <h2 className="text-base font-semibold text-gray-900">
            Queue is empty
          </h2>
          <p className="text-xs text-gray-500">
            There are no pending global song edit proposals to review right now.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {edits.map((edit) => {
            const proposed = edit.proposed_data as Record<string, unknown>;
            const song = edit.song;
            const requester = edit.requester;
            const isProcessing = processingId === edit.id;
            const isRejecting = rejectingId === edit.id;

            return (
              <div
                key={edit.id}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4"
              >
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl text-xs">
                  <div className="space-y-2">
                    <h3 className="font-bold text-gray-600 uppercase tracking-wider text-[10px]">
                      Current Song Details
                    </h3>
                    <p>
                      <span className="font-medium text-gray-500">Title:</span>{" "}
                      <span className="font-semibold text-gray-900">
                        {song?.title || "N/A"}
                      </span>
                    </p>
                    <p>
                      <span className="font-medium text-gray-500">Artist:</span>{" "}
                      <span className="text-gray-800">
                        {song?.artist || "N/A"}
                      </span>
                    </p>
                    <p>
                      <span className="font-medium text-gray-500">Album:</span>{" "}
                      <span className="text-gray-800">
                        {song?.album || "N/A"}
                      </span>
                    </p>
                    <p>
                      <span className="font-medium text-gray-500">Key:</span>{" "}
                      <span className="text-gray-800">
                        {song?.standard_key || "N/A"}
                      </span>
                    </p>
                  </div>

                  <div className="space-y-2 border-t md:border-t-0 md:border-l border-gray-200 pt-3 md:pt-0 md:pl-4">
                    <h3 className="font-bold text-emerald-700 uppercase tracking-wider text-[10px]">
                      Proposed Edits
                    </h3>
                    {Object.entries(proposed).map(([key, val]) => (
                      <p key={key}>
                        <span className="font-medium text-gray-500 capitalize">
                          {key.replace("_", " ")}:
                        </span>{" "}
                        <span className="font-semibold text-emerald-900">
                          {typeof val === "object"
                            ? JSON.stringify(val)
                            : String(val)}
                        </span>
                      </p>
                    ))}
                  </div>
                </div>

                {/* Rejection reason form */}
                {isRejecting ? (
                  <div className="space-y-3 pt-2 bg-red-50/50 p-4 rounded-xl border border-red-100">
                    <label className="block text-xs font-semibold text-red-800">
                      Rejection Reason (Optional)
                    </label>
                    <input
                      type="text"
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="e.g. Inaccurate information or duplicate submission"
                      className="w-full rounded-lg border border-red-200 px-3 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleConfirmReject(edit.id)}
                        className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {isProcessing ? "Rejecting..." : "Confirm Rejection"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(null);
                          setRejectionReason("");
                        }}
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
                      onClick={() => setRejectingId(edit.id)}
                      className="px-4 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 disabled:opacity-50 transition-colors"
                    >
                      Reject Request
                    </button>
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => handleApprove(edit.id)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {isProcessing ? "Approving..." : "Approve & Apply"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
