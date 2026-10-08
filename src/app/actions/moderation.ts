'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  submitCatalogSuggestion,
  getPendingCatalogSuggestions,
  reviewCatalogSuggestionGroup,
} from '@/lib/moderation'
import type { CatalogSuggestion, PendingCatalogSuggestionGroup } from '@/types/database'

export async function submitCatalogSuggestionAction(
  songId: string,
  data: Record<string, unknown>
): Promise<CatalogSuggestion[]> {
  const userId = await getRequiredUserId()
  return submitCatalogSuggestion(userId, songId, data)
}

export async function getPendingCatalogSuggestionsAction(): Promise<
  PendingCatalogSuggestionGroup[]
> {
  const adminUserId = await getRequiredUserId()
  return getPendingCatalogSuggestions(adminUserId)
}

export async function reviewCatalogSuggestionGroupAction(
  groupId: string,
  action: 'approve' | 'reject',
  reason?: string
): Promise<CatalogSuggestion[]> {
  const adminUserId = await getRequiredUserId()
  return reviewCatalogSuggestionGroup(adminUserId, groupId, action, reason)
}
