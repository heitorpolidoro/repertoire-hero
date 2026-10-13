'use server'

import { getRequiredUserId } from '@/lib/auth-session'
import { assertBandMember } from '@/lib/bands'
import { getPracticeCandidates, listPracticePlaylists } from '@/lib/practiceCandidates'
import type { PracticeCandidate } from '@/lib/practiceOrder'
import type { PracticeSource } from '@/lib/practiceSession'

/**
 * RH-168 - the one read a practice start makes: the songs of a source with
 * their level and last-practised date. Read-only; reading a band is
 * member-level, so `assertBandMember` is the only gate and it runs first.
 */
export async function getPracticeCandidatesAction(
  source: PracticeSource,
  bandId: string | null,
): Promise<PracticeCandidate[]> {
  const userId = await getRequiredUserId()
  if (bandId) await assertBandMember(bandId, userId)
  return getPracticeCandidates(userId, source, bandId)
}

/** The owner's own playlists, for the source menu. Same gate as the read above. */
export async function getPracticePlaylistsAction(
  bandId: string | null,
): Promise<{ id: string; name: string }[]> {
  const userId = await getRequiredUserId()
  if (bandId) await assertBandMember(bandId, userId)
  return listPracticePlaylists(userId, bandId)
}
