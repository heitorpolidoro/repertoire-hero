"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getProfileAction as getProfile,
  updateProfileAction as updateProfile,
  updateEmailAction as updateEmail,
} from "@/app/actions/profile";
import { useBandContextStore } from "@/store/bandContextStore";
import { BandColorPicker } from "@/components/bands/BandColorPicker";
import { getBandThemeStyles } from "@/lib/bandColors";
import { InstrumentPicker, INSTRUMENT_ICONS } from "@/components/profile/InstrumentPicker";
import { AlertBanner } from "@/components/ui/AlertBanner";
import { ConfirmPanel } from "@/components/ui/ConfirmPanel";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/hooks/useToast";
import { useBandAdmin } from "@/hooks/useBandAdmin";
import { BAND_PROFILE_LOAD_POLICY } from "@/lib/bandAdminLoad";
import type { Profile } from "@/types/database";

/** Module-level so the hook's `load` callback stays referentially stable. */
const BAND_PROFILE_MESSAGES = {
  save: "Failed to save band profile",
  load: "Failed to load band profile",
};

// ---------------------------------------------------------------------------
// BandProfileView Component
// ---------------------------------------------------------------------------
function BandProfileView({ bandId }: { bandId: string }) {
  const router = useRouter();

  const { toast, showToast, dismissToast } = useToast();

  const bandAdmin = useBandAdmin({
    bandId,
    showToast,
    onNotFound: () => setError("Band not found."),
    loadPolicy: BAND_PROFILE_LOAD_POLICY,
    onGone: () => router.replace("/bands"),
    onNavigateToPlaylist: (playlistId) => router.push(`/playlists/${playlistId}`),
    messages: BAND_PROFILE_MESSAGES,
  });

  const {
    currentUserId, band, playlists, loading, error, setError,
    editing, setEditing, editName, setEditName, editDesc, setEditDesc,
    editCoverPreview, editColor, setEditColor, saving, copied,
    showNewPlaylist, setShowNewPlaylist, newPlaylistName, setNewPlaylistName,
    creatingPlaylist, pendingAction, setPendingAction, actionBusy,
    currentMember, isAdmin, inviteUrl,
  } = bandAdmin;

  const {
    handleCopyInvite, openEdit, handleEditCoverChange, handleSaveEdit,
    handleDelete, handleLeave, handleRemoveMember, confirmPendingAction,
    handleCreatePlaylist,
  } = bandAdmin;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-400">
        Loading band profile...
      </div>
    );
  }

  if (!band) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p>Band not found or inaccessible.</p>
      </div>
    );
  }

  const members = band.members ?? [];
  const theme = getBandThemeStyles(band.color);

  return (
    <div className="space-y-6">
      {error && (
        <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />
      )}

      {/* Band Profile Card */}
      <section className="bg-white rounded-2xl border border-gray-200 px-6 py-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
          {band.cover_url ? (
            <Image
              src={band.cover_url}
              alt={band.name}
              width={80}
              height={80}
              className="w-20 h-20 rounded-2xl object-cover shrink-0 border border-gray-200 shadow-sm"
              unoptimized
            />
          ) : (
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl shrink-0 font-bold border"
              style={theme.lightCardBadgeStyle}
            >
              🎸
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-md uppercase tracking-wider border"
                style={theme.lightCardBadgeStyle}
              >
                Band Profile
              </span>
              {isAdmin && (
                <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                  Admin
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold text-gray-900 truncate mt-1">
              {band.name}
            </h2>
            {band.description && (
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                {band.description}
              </p>
            )}
            <p className="text-xs text-gray-400 font-medium mt-1">
              👥 {members.length} member{members.length !== 1 ? "s" : ""}
            </p>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
              <button
                onClick={openEdit}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors border"
                style={theme.lightCardBadgeStyle}
              >
                <span>✏️</span> Edit Band
              </button>
              <button
                onClick={handleDelete}
                title="Delete band"
                className="p-2 rounded-xl hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
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
      </section>

      {/* Invite Link */}
      <section className="bg-white rounded-2xl border border-gray-200 px-5 py-4 shadow-sm">
        <h3 className="font-semibold text-gray-900 text-sm mb-2">Band Invite Link</h3>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={inviteUrl}
            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 truncate"
          />
          <button
            onClick={handleCopyInvite}
            className="shrink-0 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors"
            style={theme.style}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">
          Share this link with musicians to let them join {band.name}.
        </p>
      </section>

      {/* Members */}
      <section className="bg-white rounded-2xl border border-gray-200 px-5 py-4 shadow-sm space-y-3">
        <h3 className="font-semibold text-gray-900 text-sm">
          Members ({members.length})
        </h3>
        <ul className="space-y-2.5">
          {members.map((member) => (
            <li key={member.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border"
                  style={theme.lightCardBadgeStyle}
                >
                  {(member.profile?.full_name ?? member.profile?.email ?? "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {member.profile?.full_name ?? member.profile?.email ?? "Unknown"}
                    {member.user_id === currentUserId && (
                      <span className="ml-1 text-xs text-gray-400 font-normal">(you)</span>
                    )}
                  </p>
                  {member.profile?.primary_instrument && (
                    <p className="text-xs text-gray-500 truncate">
                      <span aria-hidden="true">
                        {INSTRUMENT_ICONS[member.profile.primary_instrument] ?? "🎵"}
                      </span>{" "}
                      {member.profile.primary_instrument}
                    </p>
                  )}
                </div>
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${
                    member.role === "admin"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {member.role}
                </span>
                {isAdmin && member.user_id !== currentUserId && (
                  <button
                    onClick={() => handleRemoveMember(member)}
                    className="text-gray-400 hover:text-red-500 transition-colors text-base leading-none"
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

        {currentMember && (
          <div className="pt-2">
            <button
              onClick={handleLeave}
              className="text-xs text-red-600 hover:text-red-700 font-medium"
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
      </section>

      {/* Band Playlists */}
      <section className="bg-white rounded-2xl border border-gray-200 px-5 py-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 text-sm">Playlists</h3>
          <button
            onClick={() => setShowNewPlaylist(!showNewPlaylist)}
            className="text-xs font-bold hover:opacity-80 transition-opacity"
            style={{ color: theme.bgHex }}
          >
            + New playlist
          </button>
        </div>

        {showNewPlaylist && (
          <form onSubmit={handleCreatePlaylist} className="flex gap-2">
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
              className="rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-60 transition-colors"
              style={theme.style}
            >
              {creatingPlaylist ? "..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setShowNewPlaylist(false)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </form>
        )}

        {playlists.length === 0 ? (
          <p className="text-xs text-gray-400 py-1">No band playlists yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <Link
                  href={`/playlists/${playlist.id}`}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-gray-100/70 transition-colors"
                >
                  <span className="text-lg">🎶</span>
                  <span className="flex-1 text-sm font-medium text-gray-900 truncate">
                    {playlist.name}
                  </span>
                  <span className="text-gray-400 text-xs">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Edit Band Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <form
            onSubmit={handleSaveEdit}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md px-6 py-6 space-y-4"
          >
            <h2 className="text-lg font-bold text-gray-900">Edit Band Profile</h2>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                Band Name
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
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0 font-bold border"
                    style={theme.badgeStyle}
                  >
                    🎸
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleEditCoverChange}
                  className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 cursor-pointer"
                />
              </div>
            </div>
            <BandColorPicker value={editColor} onChange={setEditColor} />
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-60 transition-colors"
                style={theme.style}
              >
                {saving ? "Saving..." : "Save Profile"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PersonalProfileView Component
// ---------------------------------------------------------------------------
function PersonalProfileView() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [instruments, setInstruments] = useState<string[]>([]);
  const [primaryInstrument, setPrimaryInstrument] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    getProfile()
      .then((p) => {
        if (!p) return;
        setProfile(p);
        setFullName(p.full_name ?? "");
        setAvatarUrl(p.avatar_url ?? "");
        setInstruments(p.instruments ?? []);
        setPrimaryInstrument(p.primary_instrument ?? null);
        setEmail(p.email);
        setNewEmail(p.email);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load profile"),
      )
      .finally(() => setLoading(false));
  }, []);

  const handleSaveProfile = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateProfile({
        full_name: fullName.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        instruments,
        primary_instrument: primaryInstrument,
      });
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              full_name: fullName.trim() || null,
              avatar_url: avatarUrl.trim() || null,
              instruments,
              primary_instrument: primaryInstrument,
            }
          : prev,
      );
      setSuccess("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateEmail = async () => {
    if (!newEmail.trim() || newEmail === email) return;
    setEmailSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateEmail(newEmail.trim());
      setSuccess(
        `Confirmation email sent to ${newEmail.trim()}. Check your inbox to complete the change.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update email");
    } finally {
      setEmailSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-400">
        Loading profile...
      </div>
    );
  }

  const avatarPreview = avatarUrl.trim();

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />
      )}
      {success && (
        <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />
      )}

      {/* Photo */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-700">Photo</h2>
        <div className="flex items-center gap-4">
          <div className="shrink-0 h-[72px] w-[72px]">
            {avatarPreview ? (
              <Image
                src={avatarPreview}
                alt="Profile photo"
                width={72}
                height={72}
                className="h-[72px] w-[72px] rounded-full object-cover border border-gray-200"
                unoptimized
              />
            ) : (
              <div className="h-[72px] w-[72px] rounded-full bg-emerald-100 flex items-center justify-center text-2xl font-semibold text-emerald-600 border border-emerald-200 select-none">
                {fullName.trim() ? fullName.trim()[0].toUpperCase() : "?"}
              </div>
            )}
          </div>
          <div className="flex-1">
            <label
              htmlFor="avatar-url"
              className="text-xs font-medium text-gray-600 block mb-1"
            >
              Image URL
            </label>
            <input
              id="avatar-url"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </section>

      {/* Name */}
      <section className="flex flex-col gap-2">
        <label
          htmlFor="full-name"
          className="text-sm font-semibold text-gray-700"
        >
          Name
        </label>
        <input
          id="full-name"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Your name"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </section>

      {/* Instruments */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Instruments</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {instruments.length === 0
              ? "Select one or more. The first becomes your primary."
              : primaryInstrument
                ? `Primary: ${primaryInstrument} - Click star on any selected to change it`
                : "Click the star to set your primary instrument"}
          </p>
        </div>
        <InstrumentPicker
          selected={instruments}
          primary={primaryInstrument}
          onChange={(sel, prim) => {
            setInstruments(sel);
            setPrimaryInstrument(prim);
          }}
        />
      </section>

      {/* Save */}
      <button
        type="button"
        onClick={() => {
          handleSaveProfile();
        }}
        disabled={saving}
        className="self-start px-5 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {saving ? "Saving..." : "Save profile"}
      </button>

      <hr className="border-gray-100" />

      {/* Email */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Email</h2>
        <div className="flex gap-2">
          <input
            id="email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="button"
            onClick={() => {
              handleUpdateEmail();
            }}
            disabled={emailSaving || !newEmail.trim() || newEmail === email}
            className="shrink-0 px-4 py-2 rounded-md bg-gray-800 text-white text-sm font-medium hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {emailSaving ? "Sending..." : "Change"}
          </button>
        </div>
        {newEmail !== email && newEmail.trim() && (
          <p className="text-xs text-amber-600">
            A confirmation link will be sent to {newEmail.trim()}.
          </p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ProfilePage Export
// ---------------------------------------------------------------------------
export default function ProfilePage() {
  const context = useBandContextStore((s) => s.context);
  const isBandMode = context.type === "band";

  const [activeTab, setActiveTab] = useState<"band" | "personal">(
    isBandMode ? "band" : "personal"
  );

  const bandTheme = getBandThemeStyles(context.type === "band" ? context.color : null);

  // Sync tab with band context if context changes
  useEffect(() => {
    setActiveTab(context.type === "band" ? "band" : "personal");
  }, [context.type]);

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-4 md:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {activeTab === "band" && isBandMode
              ? `Band Profile · ${context.name}`
              : "Personal Profile"}
          </h1>
        </div>

        {/* Tab switcher when in Band Mode */}
        {isBandMode && (
          <div className="flex bg-gray-100 p-1 rounded-xl self-start sm:self-auto">
            <button
              onClick={() => setActiveTab("band")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === "band"
                  ? "shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              style={activeTab === "band" ? bandTheme.style : undefined}
            >
              🎸 {context.name}
            </button>
            <button
              onClick={() => setActiveTab("personal")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === "personal"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              👤 Personal
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 max-w-3xl">
        {activeTab === "band" && isBandMode ? (
          <BandProfileView bandId={context.id} />
        ) : (
          <PersonalProfileView />
        )}
      </div>
    </div>
  );
}
