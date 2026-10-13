'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import {
  deleteSongVersion,
  getCatalogBlastRadius,
  mergeSongVersions,
  mergeSongs,
  splitSongVersions,
  type BlastRadius,
  type CatalogTarget,
  type SplitTarget,
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

export async function splitSongVersionsAction(
  sourceSongId: string,
  versionIds: string[],
  target: SplitTarget,
): Promise<void> {
  const adminUserId = await getRequiredUserId()
  return splitSongVersions(adminUserId, sourceSongId, versionIds, target)
}

export async function mergeSongsAction(fromSongId: string, intoSongId: string): Promise<void> {
  const adminUserId = await getRequiredUserId()
  return mergeSongs(adminUserId, fromSongId, intoSongId)
}
