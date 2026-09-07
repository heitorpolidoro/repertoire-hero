/**
 * RH-34 — the fail-closed rule, enforced mechanically instead of by convention.
 *
 * A Server Action is a public POST endpoint: anyone who can reach the page it is
 * bound to can invoke it with arbitrary arguments. This suite reads the source of
 * every `src/app/actions/*.ts` file and fails when an exported action does not
 * resolve the session, so the rule cannot be forgotten by a future action.
 */

import { describe, it, expect } from 'vitest'
import {
  actionFileNames,
  exportedActionBodies,
  readActionFile,
} from './actionScan'

/**
 * Helpers that resolve the session themselves, so calling one counts as
 * resolving it. Every entry carries the justification for trusting it — an
 * entry without one is a hole in the rule, not an exemption.
 */
const SESSION_RESOLVING_HELPERS: Record<string, string> = {
  // repertoire.ts — calls getRequiredUserId() and then assertBandMember() for
  // the band case; the nine repertoire actions all funnel through it.
  resolveOwner: 'src/app/actions/repertoire.ts',
  // playlists.ts — an exported action that itself calls getRequiredUserId()
  // before delegating to getPlaylistDetailsWithEntries(), which is where both
  // authorization checks now live (RH-45); getPlaylistEntryIdsAction is a thin
  // delegate to it.
  getPlaylistDetailsWithEntriesAction: 'src/app/actions/playlists.ts',
}

/** True when the body calls `getRequiredUserId()` or an allowlisted helper. */
function resolvesSession(body: string): boolean {
  if (body.includes('getRequiredUserId()')) return true
  return Object.keys(SESSION_RESOLVING_HELPERS).some((helper) =>
    body.includes(`${helper}(`),
  )
}

describe('every exported Server Action resolves the session', () => {
  it('names any action whose body neither calls getRequiredUserId() nor an allowlisted helper', () => {
    const violations: string[] = []

    for (const fileName of actionFileNames()) {
      for (const [action, body] of exportedActionBodies(fileName)) {
        if (!resolvesSession(body)) violations.push(`${fileName}:${action}`)
      }
    }

    expect(violations).toEqual([])
  })

  it('keeps membership SQL out of the action layer entirely', () => {
    const offenders = actionFileNames().filter((fileName) =>
      readActionFile(fileName).includes('band_members'),
    )

    // `grep -l band_members src/app/actions/*.ts` must print nothing: every
    // membership check lives behind a helper in src/lib.
    expect(offenders).toEqual([])
  })

  it('allowlists exactly the two helpers that resolve the session themselves', () => {
    expect(Object.keys(SESSION_RESOLVING_HELPERS).sort()).toEqual([
      'getPlaylistDetailsWithEntriesAction',
      'resolveOwner',
    ])
  })
})
