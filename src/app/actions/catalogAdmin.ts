'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  deleteSongVersion,
  getCatalogBlastRadius,
  mergeSongVersions,
  type BlastRadius,
  type CatalogTarget,
} from '@/lib/catalogAdmin'

export async function getCatalogBlastRadiusAction(target: CatalogTarget): Promise<BlastRadius> {
  const adminUserId = await getRequiredUserId()
  return getCatalogBlastRadius(adminUserId, target)
}

export async function mergeSongVersionsAction(
  fromVersionId: string,
  intoVersionId: string,
): Promise<void> {
  const adminUserId = await getRequiredUserId()
  return mergeSongVersions(adminUserId, fromVersionId, intoVersionId)
}

export async function deleteSongVersionAction(versionId: string): Promise<void> {
  const adminUserId = await getRequiredUserId()
  return deleteSongVersion(adminUserId, versionId)
}
