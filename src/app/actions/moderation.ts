'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  submitCatalogSuggestion,
  getPendingCatalogSuggestions,
  reviewCatalogSuggestionGroup,
  getUnseenSuggestionOutcomes,
  acknowledgeSuggestionOutcomes,
} from '@/lib/moderation'
import {
  approveCatalogFieldOption,
  getPendingFieldGroups,
  rejectCatalogField,
} from '@/lib/moderationFields'
import type {
  CatalogSuggestion,
  PendingCatalogSuggestionGroup,
  SuggestionOutcomeGroup,
} from '@/types/database'
import type { ApprovedFieldOutcome, PendingFieldGroup } from '@/types/pendingFieldGroup'

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

export async function getPendingFieldGroupsAction(): Promise<PendingFieldGroup[]> {
  const adminUserId = await getRequiredUserId()
  return getPendingFieldGroups(adminUserId)
}

export async function approveCatalogFieldOptionAction(
  suggestionIds: string[]
): Promise<ApprovedFieldOutcome> {
  const adminUserId = await getRequiredUserId()
  return approveCatalogFieldOption(adminUserId, suggestionIds)
}

export async function rejectCatalogFieldAction(
  songId: string,
  column: string,
  reason?: string
): Promise<number> {
  const adminUserId = await getRequiredUserId()
  return rejectCatalogField(adminUserId, songId, column, reason)
}

export async function getUnseenSuggestionOutcomesAction(): Promise<SuggestionOutcomeGroup[]> {
  const userId = await getRequiredUserId()
  return getUnseenSuggestionOutcomes(userId)
}

export async function acknowledgeSuggestionOutcomesAction(ids: string[]): Promise<number> {
  const userId = await getRequiredUserId()
  return acknowledgeSuggestionOutcomes(userId, ids)
}

/**
 * Decides the `song_links` rows of one submission (RH-138). The `songs` column
 * rows of the same submission are decided per field, by
 * `approveCatalogFieldOptionAction` / `rejectCatalogFieldAction`.
 */
export async function reviewLinkChangesAction(
  groupId: string,
  action: 'approve' | 'reject',
  reason?: string,
  rejectLinkSuggestionIds?: string[]
): Promise<CatalogSuggestion[]> {
  const adminUserId = await getRequiredUserId()
  return reviewCatalogSuggestionGroup(adminUserId, groupId, action, {
    reason,
    rejectLinkSuggestionIds,
    linksOnly: true,
  })
}
