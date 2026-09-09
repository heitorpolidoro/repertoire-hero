/**
 * The pure state transitions of the band-detail controller (`useBandAdmin`).
 *
 * Sibling to `bandAdminLoad.ts`: that module owns the two pages' load
 * *policies*, this one owns the value transformations the hook used to perform
 * inline — seeding the edit draft from a band, trimming it back into an update
 * payload, and patching the loaded band. Nothing here touches React, so each
 * decision is unit-testable on its own (RH-64/F14).
 */

import { DEFAULT_BAND_COLOR } from "@/lib/bandColors";
import type { Band, BandMember } from "@/types/database";

/** A destructive action awaiting in-page confirmation. */
export type PendingAction =
  | { kind: "deleteBand" }
  | { kind: "leaveBand" }
  | { kind: "removeMember"; member: BandMember };

/**
 * The edit modal's form values. `null` (rather than a draft plus an `editing`
 * flag) is what "the modal is closed" means, so a stale draft from a previous
 * band cannot be expressed.
 */
export interface BandEditDraft {
  name: string;
  description: string;
  coverPreview: string | null;
  color: string;
}

/** What a saved draft sends to `updateBand`, in the DB's own column names. */
export interface BandUpdatePayload {
  name: string;
  description: string | null;
  cover_url: string | null;
  color: string;
}

/** Seeds the edit modal. A band with no colour picks up the palette default. */
export function draftFromBand(band: Band | null): BandEditDraft {
  return {
    name: band?.name ?? "",
    description: band?.description ?? "",
    coverPreview: band?.cover_url ?? null,
    color: band?.color ?? DEFAULT_BAND_COLOR,
  };
}

/** A band must keep a name: a blank draft name refuses to save. */
export function isDraftNameBlank(draft: BandEditDraft): boolean {
  return draft.name.trim() === "";
}

/** The cover URL is resolved by the caller (upload first, then save). */
export function draftToBandUpdate(
  draft: BandEditDraft,
  coverUrl: string | null,
): BandUpdatePayload {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    cover_url: coverUrl,
    color: draft.color,
  };
}

/** Patches the loaded band with what was just saved, leaving the rest alone. */
export function applyBandUpdate(band: Band, update: BandUpdatePayload): Band {
  return { ...band, ...update };
}

/** Drops a removed member from the loaded band's member list. */
export function withoutMember(band: Band, memberId: string): Band {
  return { ...band, members: band.members?.filter((m) => m.id !== memberId) };
}

/** Applies a regenerated invite code to the loaded band. */
export function withInviteCode(band: Band, code: string): Band {
  return { ...band, invite_code: code };
}

/** The shareable join link. The origin is passed in so this stays pure. */
export function buildInviteUrl(
  origin: string,
  inviteCode: string | null | undefined,
): string {
  return `${origin}/join/${inviteCode ?? ""}`;
}
