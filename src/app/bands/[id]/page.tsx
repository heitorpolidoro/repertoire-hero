"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { regenerateBandInviteCodeAction } from "@/app/actions/bands";
import { BandColorPicker } from "@/components/bands/BandColorPicker";
import { INSTRUMENT_ICONS } from "@/components/profile/InstrumentPicker";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/hooks/useToast";
import { useBandAdmin } from "@/hooks/useBandAdmin";
import { BANDS_PAGE_LOAD_POLICY } from "@/lib/bandAdminLoad";

/** Module-level so the hook's `load` callback stays referentially stable. */
const BAND_PAGE_MESSAGES = { save: "Failed to save" };

export default function BandDetailPage() {
  const { id: bandId } = useParams<{ id: string }>();
  const router = useRouter();

  const { toast, showToast, dismissToast } = useToast();

  const {
    currentUserId,
    band,
    setBand,
    playlists,
    loading,
    error,
    setError,
    editing,
    setEditing,
    editName,
    setEditName,
    editDesc,
    setEditDesc,
    editCoverPreview,
    editColor,
    setEditColor,
    saving,
    copied,
    setCopied,
    showNewPlaylist,
    setShowNewPlaylist,
    newPlaylistName,
    setNewPlaylistName,
    creatingPlaylist,
    pendingAction,
    setPendingAction,
    actionBusy,
    currentMember,
    isAdmin,
    inviteUrl,
    handleCopyInvite,
    openEdit,
    handleEditCoverChange,
    handleSaveEdit,
    handleDelete,
    handleLeave,
    handleRemoveMember,
    confirmPendingAction,
    handleCreatePlaylist,
  } = useBandAdmin({
    bandId,
    showToast,
    onNotFound: () => router.replace("/bands"),
    loadPolicy: BANDS_PAGE_LOAD_POLICY,
    onGone: () => router.replace("/bands"),
    onNavigateToPlaylist: (playlistId) => router.push(`/playlists/${playlistId}`),
    messages: BAND_PAGE_MESSAGES,
  });

  // Invite link regenerate state — single-site, so it stays on the page.
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  async function handleRegenerateInvite() {
    setRegenerating(true);
    setError(null);
    try {
      const newCode = await regenerateBandInviteCodeAction(bandId);
      setBand((prev) => (prev ? { ...prev, invite_code: newCode } : prev));
      setCopied(false);
      setConfirmingRegenerate(false);
      showToast("Invite link regenerated. The old link no longer works.", "success");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to regenerate invite link",
      );
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!band) return null;

  const members = band.members ?? [];

  return (
    <>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div>
          <button
            onClick={() => router.back()}
            className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1"
          >
            ← Back
          </button>

          <div className="flex items-start gap-4">
            {band.cover_url ? (
              <Image
                src={band.cover_url}
                alt={band.name}
                width={64}
                height={64}
                className="w-16 h-16 rounded-2xl object-cover shrink-0"
                unoptimized
              />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center text-3xl shrink-0">
                🎸
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-gray-900">{band.name}</h1>
              {band.description && (
                <p className="text-sm text-gray-500 mt-0.5">
                  {band.description}
                </p>
              )}
            </div>
            {isAdmin && (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={openEdit}
                  title="Edit band"
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
                >
                  ✏️
                </button>
                <button
                  onClick={handleDelete}
                  title="Delete band"
                  className="p-2 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600 transition-colors"
                >
                  🗑️
                </button>
              </div>
            )}
          </div>

          {pendingAction?.kind === "deleteBand" && (
            <ConfirmPanel
              className="mt-4"
              message={`Delete "${band.name}"? This can't be undone.`}
              confirmLabel="Delete"
              busy={actionBusy}
              onConfirm={confirmPendingAction}
              onCancel={() => setPendingAction(null)}
            />
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        {/* Invite link */}
        <section className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Invite link</h2>
            {isAdmin && !confirmingRegenerate && (
              <button
                onClick={() => setConfirmingRegenerate(true)}
                disabled={regenerating}
                className="text-sm text-emerald-600 hover:text-emerald-700 font-medium disabled:opacity-60"
              >
                Regenerate
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={inviteUrl}
              className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 truncate"
            />
            <button
              onClick={handleCopyInvite}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Anyone with this link can join the band.
          </p>

          {isAdmin && confirmingRegenerate && (
            <ConfirmPanel
              className="mt-3"
              tone="warning"
              message="This will invalidate the current link immediately. Anyone with the old link won't be able to join."
              confirmLabel="Regenerate"
              busyLabel="Regenerating..."
              busy={regenerating}
              onConfirm={handleRegenerateInvite}
              onCancel={() => setConfirmingRegenerate(false)}
            />
          )}
        </section>

        {/* Members */}
        <section className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
          <h2 className="font-semibold text-gray-900 mb-3">
            Members{" "}
            <span className="text-gray-400 font-normal text-sm">
              ({members.length})
            </span>
          </h2>
          <ul className="space-y-2">
            {members.map((member) => (
              <li key={member.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-semibold text-emerald-700 shrink-0">
                    {(member.profile?.full_name ??
                      member.profile?.email ??
                      "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {member.profile?.full_name ??
                        member.profile?.email ??
                        "Unknown"}
                      {member.user_id === currentUserId && (
                        <span className="ml-1 text-xs text-gray-400">(you)</span>
                      )}
                    </p>
                    {member.profile?.primary_instrument && (
                      <p className="text-xs text-gray-500 truncate">
                        <span aria-hidden="true">
                          {INSTRUMENT_ICONS[member.profile.primary_instrument] ??
                            "🎵"}
                        </span>{" "}
                        {member.profile.primary_instrument}
                      </p>
                    )}
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      member.role === "admin"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {member.role}
                  </span>
                  {isAdmin && member.user_id !== currentUserId && (
                    <button
                      onClick={() => handleRemoveMember(member)}
                      className="text-gray-400 hover:text-red-500 transition-colors text-lg leading-none"
                      title="Remove member"
                    >
                      ×
                    </button>
                  )}
                </div>

                {pendingAction?.kind === "removeMember" &&
                  pendingAction.member.id === member.id && (
                    <ConfirmPanel
                      message={`Remove ${member.profile?.full_name ?? "this member"} from the band?`}
                      confirmLabel="Remove"
                      busy={actionBusy}
                      onConfirm={confirmPendingAction}
                      onCancel={() => setPendingAction(null)}
                    />
                  )}
              </li>
            ))}
          </ul>
          {!isAdmin && currentMember && (
            <>
              <button
                onClick={handleLeave}
                className="mt-4 text-sm text-red-600 hover:text-red-700 font-medium"
              >
                Leave band
              </button>
              {pendingAction?.kind === "leaveBand" && (
                <ConfirmPanel
                  className="mt-3"
                  message="Leave this band?"
                  confirmLabel="Leave"
                  busy={actionBusy}
                  onConfirm={confirmPendingAction}
                  onCancel={() => setPendingAction(null)}
                />
              )}
            </>
          )}
        </section>

        {/* Band playlists */}
        <section className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Playlists</h2>
            <button
              onClick={() => setShowNewPlaylist(!showNewPlaylist)}
              className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
            >
              + New playlist
            </button>
          </div>

          {showNewPlaylist && (
            <form onSubmit={handleCreatePlaylist} className="flex gap-2 mb-4">
              <input
                type="text"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="Playlist name"
                required
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={creatingPlaylist}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
              >
                {creatingPlaylist ? "..." : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setShowNewPlaylist(false)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </form>
          )}

          {playlists.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">No playlists yet.</p>
          ) : (
            <ul className="space-y-2">
              {playlists.map((playlist) => (
                <li key={playlist.id}>
                  <button
                    onClick={() => router.push(`/playlists/${playlist.id}`)}
                    className="w-full text-left flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-xl">🎶</span>
                    <span className="flex-1 text-sm font-medium text-gray-900 truncate">
                      {playlist.name}
                    </span>
                    <span className="text-xs text-gray-400 tabular-nums">
                      {(() => {
                        const songs =
                          (
                            playlist as unknown as {
                              songs?: Array<{
                                song?: { duration_seconds?: number | null };
                              }>;
                            }
                          ).songs ?? [];
                        const count = songs.length;
                        const secs = songs.reduce(
                          (sum, ps) => sum + (ps.song?.duration_seconds ?? 0),
                          0,
                        );
                        const dur =
                          secs > 0
                            ? ` · ${Math.floor(secs / 3600) > 0 ? `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}`
                            : "";
                        return `${count} ${count === 1 ? "song" : "songs"}${dur}`;
                      })()}
                    </span>
                    <span className="text-gray-400">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Leave band (for non-admin members, shown at bottom too) */}
        {isAdmin && members.length > 1 && (
          <div>
            <button
              onClick={handleLeave}
              className="text-sm text-red-600 hover:text-red-700 font-medium"
            >
              Leave band
            </button>
            {pendingAction?.kind === "leaveBand" && (
              <ConfirmPanel
                className="mt-3"
                message="Leave this band?"
                confirmLabel="Leave"
                busy={actionBusy}
                onConfirm={confirmPendingAction}
                onCancel={() => setPendingAction(null)}
              />
            )}
          </div>
        )}
      </div>

      {/* Edit band modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <form
            onSubmit={handleSaveEdit}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md px-6 py-6 space-y-4"
          >
            <h2 className="text-lg font-semibold text-gray-900">Edit Band</h2>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Name
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Description
              </label>
              <input
                type="text"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Cover Image
              </label>
              <div className="flex items-center gap-3 pt-1">
                {editCoverPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={editCoverPreview}
                    alt="Band cover preview"
                    className="w-14 h-14 rounded-2xl object-cover border border-gray-200 shrink-0 shadow-sm"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center text-2xl shrink-0 font-bold">
                    🎸
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleEditCoverChange}
                  className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
                />
              </div>
            </div>
            <BandColorPicker value={editColor} onChange={setEditColor} />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />
      )}
    </>
  );
}
