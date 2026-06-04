'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  getBands,
  getBandWithMembers,
  createBand,
  updateBand,
  deleteBand,
  leaveBand,
  removeBandMember,
  getBandPlaylists,
  createBandPlaylist,
  joinBandByInviteClient,
} from '@/lib/bands'
import type { Band, Playlist } from '@/types/database'

export async function getBandsAction(): Promise<Band[]> {
  const userId = await getRequiredUserId()
  return getBands(userId)
}

export async function getBandWithMembersAction(bandId: string): Promise<Band | null> {
  return getBandWithMembers(bandId)
}

export async function createBandAction(
  name: string,
  description?: string | null,
  coverUrl?: string | null,
): Promise<string> {
  const userId = await getRequiredUserId()
  return createBand(userId, name, description, coverUrl)
}

export async function updateBandAction(
  bandId: string,
  data: {
    name?: string
    description?: string | null
    cover_url?: string | null
  },
): Promise<void> {
  return updateBand(bandId, data)
}

export async function deleteBandAction(bandId: string): Promise<void> {
  return deleteBand(bandId)
}

export async function leaveBandAction(bandId: string): Promise<void> {
  const userId = await getRequiredUserId()
  return leaveBand(bandId, userId)
}

export async function removeBandMemberAction(memberId: string): Promise<void> {
  return removeBandMember(memberId)
}

export async function getBandPlaylistsAction(bandId: string): Promise<Playlist[]> {
  return getBandPlaylists(bandId)
}

export async function createBandPlaylistAction(bandId: string, name: string): Promise<string> {
  return createBandPlaylist(bandId, name)
}

export async function joinBandByInviteAction(inviteCode: string): Promise<string | null> {
  const userId = await getRequiredUserId()
  return joinBandByInviteClient(userId, inviteCode)
}
