'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  submitSongEdit,
  getPendingSongEdits,
  reviewSongEdit,
} from '@/lib/moderation'
import type { SongEdit } from '@/types/database'

export async function submitSongEditAction(
  songId: string,
  data: Record<string, unknown>
): Promise<SongEdit> {
  const userId = await getRequiredUserId()
  return submitSongEdit(userId, songId, data)
}

export async function getPendingSongEditsAction(): Promise<SongEdit[]> {
  const adminUserId = await getRequiredUserId()
  return getPendingSongEdits(adminUserId)
}

export async function reviewSongEditAction(
  editId: string,
  action: 'approve' | 'reject',
  reason?: string
): Promise<SongEdit> {
  const adminUserId = await getRequiredUserId()
  return reviewSongEdit(adminUserId, editId, action, reason)
}
