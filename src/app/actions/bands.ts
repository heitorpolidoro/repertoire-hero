'use server'

import { put } from '@vercel/blob'
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
  regenerateBandInviteCode,
} from '@/lib/bands'
import type { Band, Playlist } from '@/types/database'

export async function getBandsAction(): Promise<Band[]> {
  const userId = await getRequiredUserId()
  return getBands(userId)
}

export async function getBandWithMembersAction(bandId: string): Promise<Band | null> {
  const userId = await getRequiredUserId()
  return getBandWithMembers(bandId, userId)
}

export async function createBandAction(
  name: string,
  description?: string | null,
  coverUrl?: string | null,
  color?: string | null,
): Promise<string> {
  const userId = await getRequiredUserId()
  return createBand(userId, name, description, coverUrl, color)
}

export async function updateBandAction(
  bandId: string,
  data: {
    name?: string
    description?: string | null
    cover_url?: string | null
    color?: string | null
  },
): Promise<void> {
  const userId = await getRequiredUserId()
  return updateBand(bandId, userId, data)
}

export async function deleteBandAction(bandId: string): Promise<void> {
  const userId = await getRequiredUserId()
  return deleteBand(bandId, userId)
}

export async function leaveBandAction(bandId: string): Promise<void> {
  const userId = await getRequiredUserId()
  return leaveBand(bandId, userId)
}

export async function removeBandMemberAction(memberId: string): Promise<void> {
  const userId = await getRequiredUserId()
  return removeBandMember(memberId, userId)
}

export async function getBandPlaylistsAction(bandId: string): Promise<Playlist[]> {
  const userId = await getRequiredUserId()
  return getBandPlaylists(bandId, userId)
}

export async function createBandPlaylistAction(bandId: string, name: string): Promise<string> {
  const userId = await getRequiredUserId()
  return createBandPlaylist(bandId, userId, name)
}

export async function regenerateBandInviteCodeAction(bandId: string): Promise<string> {
  const userId = await getRequiredUserId()
  return regenerateBandInviteCode(bandId, userId)
}

export async function uploadBandCoverAction(
  formData: FormData
): Promise<{ coverUrl?: string; error?: string }> {
  try {
    const userId = await getRequiredUserId()
    const file = formData.get('file') as File | null

    if (!file) {
      return { error: 'No image file provided' }
    }

    if (!file.type.startsWith('image/')) {
      return { error: 'Only image files (JPEG, PNG, WebP, GIF) are allowed' }
    }

    if (file.size > 5 * 1024 * 1024) {
      return { error: 'Image size exceeds 5MB limit' }
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    const filePath = `band-covers/${userId}/${Date.now()}-${cleanFileName}`

    const blob = await put(filePath, buffer, {
      access: 'public',
      contentType: file.type,
    })

    return { coverUrl: blob.url }
  } catch (err) {
    const message = err instanceof Error ? err.message : undefined
    return { error: message || 'Failed to upload band cover image' }
  }
}
