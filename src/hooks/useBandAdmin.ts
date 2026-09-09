import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useBandEdit, type BandEditController } from "@/hooks/useBandEdit";
import {
  useBandPendingAction,
  type BandPendingController,
} from "@/hooks/useBandPendingAction";
import { resolveLoadErrorMessage, type BandAdminLoadPolicy } from "@/lib/bandAdminLoad";
import { buildInviteUrl, withInviteCode } from "@/lib/bandAdminState";
import type { ToastTone } from "@/lib/uiTones";
import type { Band, Playlist } from "@/types/database";

/**
 * The eight band Server Actions the controller calls. Injected rather than
 * imported, so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted — a default would have to import `@/app`.
 */
export interface BandAdminActions {
  getBandWithMembers: (bandId: string) => Promise<Band | null>;
  getBandPlaylists: (bandId: string) => Promise<Playlist[]>;
  updateBand: (
    bandId: string,
    data: {
      name?: string;
      description?: string | null;
      cover_url?: string | null;
      color?: string | null;
    },
  ) => Promise<void>;
  deleteBand: (bandId: string) => Promise<void>;
  leaveBand: (bandId: string) => Promise<void>;
  removeBandMember: (memberId: string) => Promise<void>;
  createBandPlaylist: (bandId: string, name: string) => Promise<string>;
  uploadBandCover: (formData: FormData) => Promise<{ coverUrl?: string; error?: string }>;
}

const CREATE_PLAYLIST_ERROR = "Failed to create playlist";

/**
 * The invite-link widget. `copied` is meaningless without the commands that
 * move it, so both live here rather than as loose members of the controller.
 */
export interface BandInviteController {
  url: string;
  copied: boolean;
  copy: () => Promise<void>;
  /** After /bands/[id] regenerates the code: patch the band and drop `copied`. */
  applyNewCode: (code: string) => void;
}

/** The "+ New playlist" form: its disclosure state and the only ways to move it. */
export interface NewPlaylistController {
  open: boolean;
  name: string;
  creating: boolean;
  toggle: () => void;
  changeName: (name: string) => void;
  close: () => void;
  submit: (e: React.FormEvent) => Promise<void>;
}

/**
 * What the two band surfaces read: data, three grouped widgets, and commands
 * named after the user's intent. No raw state setter is exposed — every write
 * goes through a command that knows what it means (RH-64/F14).
 *
 * The edit modal's seven members (`editDraft`, `saving`, `startEdit`,
 * `updateDraft`, `pickCoverFile`, `saveEdit`, `cancelEdit`) are inherited flat
 * from `BandEditController` rather than restated, so the sub-hook stays their
 * single declaration. Nineteen members in total.
 */
export interface BandAdminController extends BandEditController {
  currentUserId: string | null;
  band: Band | null;
  playlists: Playlist[];
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  isMember: boolean;
  invite: BandInviteController;
  pending: BandPendingController;
  newPlaylist: NewPlaylistController;
  dismissError: () => void;
  reportError: (message: string) => void;
}

export interface UseBandAdminOptions {
  bandId: string;
  /** Required, never defaulted — see `src/app/bandAdminActions.ts`. */
  actions: BandAdminActions;
  showToast: (message: string, tone?: ToastTone) => void;
  /** bands page: `router.replace('/bands')`; profile: `reportError('Band not found.')`. */
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
 * `/profile`. It is a composition root: it owns the loaded data and the two
 * small widgets (invite link, new-playlist form), delegates the edit modal to
 * `useBandEdit` and the destructive confirmations to `useBandPendingAction`,
 * and keeps every pure transition in `src/lib/bandAdminState.ts`. The two pages
 * keep their own (deliberately different) markup.
 *
 * Everything the two copies disagreed about is an explicit option carrying that
 * page's current value — nothing is unified silently. The callbacks may be
 * plain inline arrows: `load` is memoized on the data it reads, and reaches
 * `onNotFound` through a ref, so a caller can close over this hook's own
 * `reportError` without re-running the load effect on every render.
 */
export function useBandAdmin({
  bandId,
  actions,
  showToast,
  onNotFound,
  loadPolicy,
  onGone,
  onNavigateToPlaylist,
  messages,
}: UseBandAdminOptions): BandAdminController {
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? null;

  const [band, setBand] = useState<Band | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);

  const saveErrorMessage = messages?.save ?? "Failed to save";
  const loadErrorMessage = messages?.load ?? "Failed to load band profile";

  const onNotFoundRef = useRef(onNotFound);
  useEffect(() => {
    onNotFoundRef.current = onNotFound;
  });

  // `load` reads the actions through a ref so `actions` can stay out of its
  // dependency array; a caller that rebuilds the object every render must not
  // be able to restart the load effect.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  const load = useCallback(async () => {
    const runLoad = async () => {
      const [bandData, playlistData] = await Promise.all([
        actionsRef.current.getBandWithMembers(bandId),
        actionsRef.current.getBandPlaylists(bandId),
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

  const dismissError = useCallback(() => setError(null), []);
  const reportError = useCallback((message: string) => setError(message), []);

  /** The one place the loaded band is rewritten, for every sub-controller. */
  const patchBand = useCallback((patch: (current: Band) => Band) => {
    setBand((prev) => (prev ? patch(prev) : prev));
  }, []);

  const currentMember = band?.members?.find((m) => m.user_id === currentUserId);
  const isAdmin = currentMember?.role === "admin";
  const isMember = currentMember !== undefined;

  const inviteUrl =
    typeof window !== "undefined"
      ? buildInviteUrl(window.location.origin, band?.invite_code)
      : "";

  const invite: BandInviteController = {
    url: inviteUrl,
    copied,
    copy: async () => {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    applyNewCode: (code: string) => {
      patchBand((current) => withInviteCode(current, code));
      setCopied(false);
    },
  };

  const edit = useBandEdit({
    bandId,
    band,
    actions,
    patchBand,
    reportError,
    dismissError,
    saveErrorMessage,
  });

  const pending = useBandPendingAction({
    bandId,
    actions,
    currentUserId,
    patchBand,
    showToast,
    reportError,
    dismissError,
    onGone,
  });

  const newPlaylist: NewPlaylistController = {
    open: newPlaylistOpen,
    name: newPlaylistName,
    creating: creatingPlaylist,
    toggle: () => setNewPlaylistOpen((prev) => !prev),
    changeName: (name: string) => setNewPlaylistName(name),
    close: () => setNewPlaylistOpen(false),
    submit: async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newPlaylistName.trim() || !currentUserId) return;
      setCreatingPlaylist(true);
      try {
        const playlistId = await actions.createBandPlaylist(bandId, newPlaylistName.trim());
        onNavigateToPlaylist(playlistId);
      } catch (err) {
        reportError(err instanceof Error ? err.message : CREATE_PLAYLIST_ERROR);
        setCreatingPlaylist(false);
      }
    },
  };

  return {
    currentUserId,
    band,
    playlists,
    loading,
    error,
    isAdmin,
    isMember,
    editDraft: edit.editDraft,
    saving: edit.saving,
    invite,
    pending,
    newPlaylist,
    dismissError,
    reportError,
    startEdit: edit.startEdit,
    updateDraft: edit.updateDraft,
    pickCoverFile: edit.pickCoverFile,
    saveEdit: edit.saveEdit,
    cancelEdit: edit.cancelEdit,
  };
}
