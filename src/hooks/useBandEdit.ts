import { useState } from "react";
import { compressImageFile } from "@/lib/imageCompressor";
import { useBandContextStore } from "@/store/bandContextStore";
import {
  applyBandUpdate,
  draftFromBand,
  draftToBandUpdate,
  isDraftNameBlank,
  type BandEditDraft,
  type BandUpdatePayload,
} from "@/lib/bandAdminState";
import type { BandAdminActions } from "@/hooks/useBandAdmin";
import type { Band } from "@/types/database";

/**
 * The edit-modal half of the band-detail controller. `editDraft` is `null` when
 * the modal is closed, so there is no second `editing` flag that could disagree
 * with it, and `updateDraft` is the only way to move a field the user types in
 * (`pickCoverFile` is the one field the page cannot set directly, because it
 * goes through `compressImageFile` first).
 */
export interface BandEditController {
  editDraft: BandEditDraft | null;
  saving: boolean;
  startEdit: () => void;
  updateDraft: (patch: Partial<BandEditDraft>) => void;
  pickCoverFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  saveEdit: (e: React.FormEvent) => Promise<void>;
  cancelEdit: () => void;
}

export interface UseBandEditOptions {
  bandId: string;
  /** The loaded band the draft is seeded from; null until the load settles. */
  band: Band | null;
  actions: Pick<BandAdminActions, "updateBand" | "uploadBandCover">;
  /** Patches the composition root's loaded band after a successful save. */
  patchBand: (patch: (band: Band) => Band) => void;
  reportError: (message: string) => void;
  dismissError: () => void;
  /** The page's own fallback when a save throws a non-`Error`. */
  saveErrorMessage: string;
}

/**
 * Keeps the app chrome's context switcher in step when the band being edited is
 * the one the user is currently browsing under.
 */
function syncActiveBandContext(bandId: string, update: BandUpdatePayload) {
  const currentContext = useBandContextStore.getState().context;
  if (currentContext.type === "band" && currentContext.id === bandId) {
    useBandContextStore.getState().setBandContext(bandId, update.name, update.color);
  }
}

export function useBandEdit({
  bandId,
  band,
  actions,
  patchBand,
  reportError,
  dismissError,
  saveErrorMessage,
}: UseBandEditOptions): BandEditController {
  const [editDraft, setEditDraft] = useState<BandEditDraft | null>(null);
  // The compressed file itself never reaches the page — only its preview URL,
  // which lives on the draft.
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setCoverFile(null);
    setEditDraft(draftFromBand(band));
  }

  function updateDraft(patch: Partial<BandEditDraft>) {
    setEditDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function cancelEdit() {
    setEditDraft(null);
  }

  async function pickCoverFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    const compressed = await compressImageFile(file);
    setCoverFile(compressed);
    updateDraft({ coverPreview: URL.createObjectURL(compressed) });
  }

  /** Uploads a newly picked cover, or keeps the band's current one. */
  async function resolveCoverUrl(): Promise<{ url: string | null; error?: string }> {
    if (!coverFile) return { url: band?.cover_url ?? null };
    const formData = new FormData();
    formData.append("file", coverFile);
    const uploadRes = await actions.uploadBandCover(formData);
    if (uploadRes.error) return { url: null, error: uploadRes.error };
    return { url: uploadRes.coverUrl ?? null };
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editDraft || isDraftNameBlank(editDraft)) return;
    setSaving(true);
    dismissError();
    try {
      const cover = await resolveCoverUrl();
      if (cover.error) {
        reportError(cover.error);
        return;
      }

      const update = draftToBandUpdate(editDraft, cover.url);
      await actions.updateBand(bandId, update);
      patchBand((current) => applyBandUpdate(current, update));
      syncActiveBandContext(bandId, update);
      setEditDraft(null);
    } catch (err) {
      reportError(err instanceof Error ? err.message : saveErrorMessage);
    } finally {
      setSaving(false);
    }
  }

  return { editDraft, saving, startEdit, updateDraft, pickCoverFile, saveEdit, cancelEdit };
}
