import { useCallback, useEffect, useRef, useState } from "react";
import {
  getBandWithMembersAction as getBandWithMembers,
  updateBandAction as updateBand,
  deleteBandAction as deleteBand,
  leaveBandAction as leaveBand,
  removeBandMemberAction as removeBandMember,
  getBandPlaylistsAction as getBandPlaylists,
  createBandPlaylistAction as createBandPlaylist,
  uploadBandCoverAction,
} from "@/app/actions/bands";
import { authClient } from "@/lib/auth-client";
import { useBandContextStore } from "@/store/bandContextStore";
import { compressImageFile } from "@/lib/imageCompressor";
import { DEFAULT_BAND_COLOR } from "@/lib/bandColors";
import { resolveLoadErrorMessage, type BandAdminLoadPolicy } from "@/lib/bandAdminLoad";
import type { ToastTone } from "@/lib/uiTones";
import type { Band, BandMember, Playlist } from "@/types/database";

/** A destructive action awaiting in-page confirmation. */
export type PendingAction =
  | { kind: "deleteBand" }
  | { kind: "leaveBand" }
  | { kind: "removeMember"; member: BandMember };

// Error messages that were already identical on both surfaces.
const DELETE_ERROR = "Failed to delete band";
const LEAVE_ERROR = "Failed to leave band";
const REMOVE_MEMBER_ERROR = "Failed to remove member";
const CREATE_PLAYLIST_ERROR = "Failed to create playlist";

export interface UseBandAdminOptions {
  bandId: string;
  showToast: (message: string, tone?: ToastTone) => void;
  /** bands page: `router.replace('/bands')`; profile: `setError('Band not found.')`. */
  onNotFound: () => void;
  /** Required, never defaulted — see `src/lib/bandAdminLoad.ts`. */
  loadPolicy: BandAdminLoadPolicy;
  /** After a delete/leave succeeds — both surfaces: `router.replace('/bands')`. */
  onGone: () => void;
  onNavigateToPlaylist: (id: string) => void;
  messages?: { save?: string; load?: string };
}

/**
 * The band-detail controller shared by `/bands/[id]` and the band tab of
 * `/profile`. It owns the data, the edit-modal state, the destructive-action
 * confirmations and the playlist creation flow; the two pages keep their own
 * (deliberately different) markup.
 *
 * Everything the two copies disagreed about is an explicit option carrying that
 * page's current value — nothing is unified silently. The callbacks may be
 * plain inline arrows: `load` is memoized on the data it reads, and reaches
 * `onNotFound` through a ref, so a caller can close over this hook's own
 * `setError` without re-running the load effect on every render.
 */
export function useBandAdmin({
  bandId,
  showToast,
  onNotFound,
  loadPolicy,
  onGone,
  onNavigateToPlaylist,
  messages,
}: UseBandAdminOptions) {
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? null;

  const [band, setBand] = useState<Band | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit band modal state
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

  // Destructive action confirmation state
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const saveErrorMessage = messages?.save ?? "Failed to save";
  const loadErrorMessage = messages?.load ?? "Failed to load band profile";

  const onNotFoundRef = useRef(onNotFound);
  useEffect(() => {
    onNotFoundRef.current = onNotFound;
  });

  const load = useCallback(async () => {
    const runLoad = async () => {
      const [bandData, playlistData] = await Promise.all([
        getBandWithMembers(bandId),
        getBandPlaylists(bandId),
      ]);

      if (!bandData) {
        onNotFoundRef.current();
        if (loadPolicy.clearLoadingOnNotFound) setLoading(false);
        return;
      }

      setBand(bandData);
      setPlaylists(playlistData);
      setLoading(false);
    };

    if (!loadPolicy.catchLoadErrors) {
      // The rejection escapes unhandled, exactly as it does today.
      await runLoad();
      return;
    }

    try {
      await runLoad();
    } catch (err) {
      setError(resolveLoadErrorMessage(err, loadErrorMessage));
    } finally {
      setLoading(false);
    }
  }, [bandId, loadPolicy, loadErrorMessage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      setError(err instanceof Error ? err.message : saveErrorMessage);
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    setError(null);
    setPendingAction({ kind: "deleteBand" });
  }

  function handleLeave() {
    if (!currentUserId) return;
    setError(null);
    setPendingAction({ kind: "leaveBand" });
  }

  function handleRemoveMember(member: BandMember) {
    setError(null);
    setPendingAction({ kind: "removeMember", member });
  }

  async function confirmPendingAction() {
    if (!pendingAction) return;
    setActionBusy(true);
    try {
      switch (pendingAction.kind) {
        case "deleteBand":
          try {
            await deleteBand(bandId);
            setPendingAction(null);
            // No toast: the view unmounts immediately, navigation is the feedback.
            onGone();
          } catch (err) {
            setError(err instanceof Error ? err.message : DELETE_ERROR);
          }
          break;
        case "leaveBand":
          try {
            await leaveBand(bandId);
            setPendingAction(null);
            onGone();
          } catch (err) {
            setError(err instanceof Error ? err.message : LEAVE_ERROR);
          }
          break;
        case "removeMember": {
          const { member } = pendingAction;
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
            setPendingAction(null);
            showToast(
              `${member.profile?.full_name ?? "This member"} removed from the band.`,
              "success",
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : REMOVE_MEMBER_ERROR);
          }
          break;
        }
      }
    } finally {
      setActionBusy(false);
    }
  }

  async function handleCreatePlaylist(e: React.FormEvent) {
    e.preventDefault();
    if (!newPlaylistName.trim() || !currentUserId) return;
    setCreatingPlaylist(true);
    try {
      const playlistId = await createBandPlaylist(bandId, newPlaylistName.trim());
      onNavigateToPlaylist(playlistId);
    } catch (err) {
      setError(err instanceof Error ? err.message : CREATE_PLAYLIST_ERROR);
      setCreatingPlaylist(false);
    }
  }

  return {
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
  };
}
