'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  submitGlobalSongEdit,
  getPendingGlobalSongEdits,
  reviewGlobalSongEdit,
} from '@/lib/moderation'
import type { GlobalSongEdit } from '@/types/database'

export async function submitGlobalSongEditAction(
  songId: string,
  data: Record<string, unknown>
): Promise<GlobalSongEdit> {
  const userId = await getRequiredUserId()
  return submitGlobalSongEdit(userId, songId, data)
}

export async function getPendingGlobalSongEditsAction(): Promise<GlobalSongEdit[]> {
  const adminUserId = await getRequiredUserId()
  return getPendingGlobalSongEdits(adminUserId)
}

export async function reviewGlobalSongEditAction(
  editId: string,
  action: 'approve' | 'reject',
  reason?: string
): Promise<GlobalSongEdit> {
  const adminUserId = await getRequiredUserId()
  return reviewGlobalSongEdit(adminUserId, editId, action, reason)
}
