"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getProfileAction as getProfile,
  updateProfileAction as updateProfile,
  updateEmailAction as updateEmail,
} from "@/app/actions/profile";
import {
  getBandWithMembersAction as getBandWithMembers,
  updateBandAction as updateBand,
  getBandPlaylistsAction as getBandPlaylists,
  createBandPlaylistAction as createBandPlaylist,
  uploadBandCoverAction,
  deleteBandAction as deleteBand,
  leaveBandAction as leaveBand,
  removeBandMemberAction as removeBandMember,
} from "@/app/actions/bands";
import { authClient } from "@/lib/auth-client";
import { useBandContextStore } from "@/store/bandContextStore";
import { compressImageFile } from "@/lib/imageCompressor";
import { BandColorPicker } from "@/components/bands/BandColorPicker";
import { DEFAULT_BAND_COLOR, getBandThemeStyles } from "@/lib/bandColors";
import { InstrumentPicker, INSTRUMENT_ICONS } from "@/components/profile/InstrumentPicker";
import type { Profile, Band, BandMember, Playlist } from "@/types/database";

// ---------------------------------------------------------------------------
// BandProfileView Component
// ---------------------------------------------------------------------------
function BandProfileView({ bandId }: { bandId: string }) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? null;

  const [band, setBand] = useState<Band | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit band state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCoverFile, setEditCoverFile] = useState<File | null>(null);
  const [editCoverPreview, setEditCoverPreview] = useState<string | null>(null);
  const [editColor, setEditColor] = useState<string>(DEFAULT_BAND_COLOR);
  const [saving, setSaving] = useState(false);

  // Invite link copy state
  const [copied, setCopied] = useState(false);

  // New playlist state
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);

  const load = useCallback(async () => {
    try {
      const [bandData, playlistData] = await Promise.all([
        getBandWithMembers(bandId),
        getBandPlaylists(bandId),
      ]);

      if (!bandData) {
        setError("Band not found.");
        setLoading(false);
        return;
      }

      setBand(bandData);
      setPlaylists(playlistData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load band profile");
    } finally {
      setLoading(false);
    }
  }, [bandId]);

  useEffect(() => {
    load();
  }, [load]);

  const currentMember = band?.members?.find((m) => m.user_id === currentUserId);
  const isAdmin = currentMember?.role === "admin";
  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/join/${band?.invite_code ?? ""}`
      : "";

  async function handleCopyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openEdit() {
    setEditName(band?.name ?? "");
    setEditDesc(band?.description ?? "");
    setEditCoverFile(null);
    setEditCoverPreview(band?.cover_url ?? null);
    setEditColor(band?.color ?? DEFAULT_BAND_COLOR);
    setEditing(true);
  }

  async function handleEditCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      const compressed = await compressImageFile(file);
      setEditCoverFile(compressed);
      setEditCoverPreview(URL.createObjectURL(compressed));
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      let cover_url = band?.cover_url ?? null;
      if (editCoverFile) {
        const formData = new FormData();
        formData.append("file", editCoverFile);
        const uploadRes = await uploadBandCoverAction(formData);
        if (uploadRes.error) {
          setError(uploadRes.error);
          setSaving(false);
          return;
        }
        cover_url = uploadRes.coverUrl ?? null;
      }

      await updateBand(bandId, {
        name: editName.trim(),
        description: editDesc.trim() || null,
        cover_url,
        color: editColor,
      });

      setBand((prev) =>
        prev
          ? {
              ...prev,
              name: editName.trim(),
              description: editDesc.trim() || null,
              cover_url,
              color: editColor,
            }
          : prev,
      );

      const currentContext = useBandContextStore.getState().context;
      if (currentContext.type === "band" && currentContext.id === bandId) {
        useBandContextStore.getState().setBandContext(bandId, editName.trim(), editColor);
      }

      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save band profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${band?.name}"? This cannot be undone.`)) return;
    try {
      await deleteBand(bandId);
      router.replace("/bands");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete band");
    }
  }

  async function handleLeave() {
    if (!currentUserId) return;
    if (!confirm("Leave this band?")) return;
    try {
      await leaveBand(bandId);
      router.replace("/bands");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to leave band");
    }
  }

  async function handleRemoveMember(member: BandMember) {
    if (!confirm(`Remove ${member.profile?.full_name ?? "this member"}?`)) return;
    try {
      await removeBandMember(member.id);
      setBand((prev) =>
        prev
          ? {
              ...prev,
              members: prev.members?.filter((m) => m.id !== member.id),
            }
          : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  async function handleCreatePlaylist(e: React.FormEvent) {
    e.preventDefault();
    if (!newPlaylistName.trim() || !currentUserId) return;
    setCreatingPlaylist(true);
    try {
      const playlistId = await createBandPlaylist(bandId, newPlaylistName.trim());
      router.push(`/playlists/${playlistId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create playlist");
      setCreatingPlaylist(false);
    }
  }

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
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-red-700">{error}</p>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xs focus:outline-none">
            ✕
          </button>
        </div>
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
            <li key={member.id} className="flex items-center gap-3">
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
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3"
        >
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600 text-xs focus:outline-none"
          >
            ✕
          </button>
        </div>
      )}
      {success && (
        <div
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between gap-3"
        >
          <p className="text-sm text-green-700">{success}</p>
          <button
            type="button"
            onClick={() => setSuccess(null)}
            className="text-green-500 hover:text-green-700 text-xs focus:outline-none"
          >
            ✕
          </button>
        </div>
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
