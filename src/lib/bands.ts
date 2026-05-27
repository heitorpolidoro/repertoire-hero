import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import type { Band, BandMember, Playlist } from "@/types/database";

export async function getBands(): Promise<Band[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("bands")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to fetch bands", new Error(error.message));
    throw new Error(`Failed to fetch bands: ${error.message}`);
  }

  return (data ?? []) as Band[];
}

export async function getBandWithMembers(bandId: string): Promise<Band | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("bands")
    .select(
      `
      *,
      members:band_members(
        id, band_id, user_id, role, joined_at,
        profile:profiles(id, full_name, avatar_url, email, primary_instrument)
      )
    `,
    )
    .eq("id", bandId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    logger.error("Failed to fetch band", new Error(error.message));
    throw new Error(`Failed to fetch band: ${error.message}`);
  }

  return data as unknown as Band;
}

export async function createBand(
  name: string,
  description?: string | null,
  coverUrl?: string | null,
): Promise<string> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("create_band", {
    p_name: name,
    p_description: description ?? null,
    p_cover_url: coverUrl ?? null,
  });

  if (error) {
    logger.error("Failed to create band", new Error(error.message));
    throw new Error(`Failed to create band: ${error.message}`);
  }

  return data as string;
}

export async function updateBand(
  bandId: string,
  data: {
    name?: string;
    description?: string | null;
    cover_url?: string | null;
  },
): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("bands")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", bandId);

  if (error) {
    logger.error("Failed to update band", new Error(error.message));
    throw new Error(`Failed to update band: ${error.message}`);
  }
}

export const deleteBand = async (bandId: string): Promise<void> => {
  const supabase = createClient();

  const { error } = await supabase.from("bands").delete().eq("id", bandId);

  if (error) {
    logger.error("Failed to delete band", new Error(error.message));
    throw new Error(`Failed to delete band: ${error.message}`);
  }
};

export async function leaveBand(bandId: string, userId: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("band_members")
    .delete()
    .eq("band_id", bandId)
    .eq("user_id", userId);

  if (error) {
    logger.error("Failed to leave band", new Error(error.message));
    throw new Error(`Failed to leave band: ${error.message}`);
  }
}

export async function removeBandMember(memberId: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("band_members")
    .delete()
    .eq("id", memberId);

  if (error) {
    logger.error("Failed to remove band member", new Error(error.message));
    throw new Error(`Failed to remove band member: ${error.message}`);
  }
}

export async function getBandPlaylists(bandId: string): Promise<Playlist[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("playlists")
    .select("*, songs:playlist_songs(id, song:global_songs(duration_seconds))")
    .eq("band_id", bandId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to fetch band playlists", new Error(error.message));
    throw new Error(`Failed to fetch band playlists: ${error.message}`);
  }

  return (data ?? []) as unknown as Playlist[];
}

export const createBandPlaylist = async (
  bandId: string,
  name: string,
): Promise<string> => {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("playlists")
    .insert({ name, band_id: bandId, sync_with_spotify: false })
    .select("id")
    .single();

  if (error) {
    logger.error("Failed to create band playlist", new Error(error.message));
    throw new Error(`Failed to create band playlist: ${error.message}`);
  }

  return data.id as string;
};

export const joinBandByInviteClient = async (
  inviteCode: string,
): Promise<string | null> => {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("join_band_by_invite", {
    p_invite_code: inviteCode,
  });

  if (error) {
    logger.error("Failed to join band", new Error(error.message));
    throw new Error(`Failed to join band: ${error.message}`);
  }

  return data as string | null;
};

export function getBandMembers(band: Band): BandMember[] {
  return (band.members ?? []) as BandMember[];
}
