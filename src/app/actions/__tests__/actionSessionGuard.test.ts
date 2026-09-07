/**
 * RH-34 — behavioural half of the fail-closed rule.
 *
 * `actionAuthorizationGuard.test.ts` proves every exported action *mentions* a
 * session resolution; this suite proves each one actually refuses to run when
 * there is no session, in the shape its callers expect. The table below carries
 * one entry per exported Server Action, and a key-set assertion makes it
 * impossible to add an action without deciding how it fails closed.
 *
 * `@/lib/db` is mocked to throw: reaching the database at all without a session
 * is itself a failure, whatever the action returns afterwards.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/auth-session', () => ({
  getRequiredUserId: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(async () => {
    throw new Error('the database must not be reached without a session')
  }),
  pool: { query: vi.fn() },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/lib/linkFetcher', () => ({
  fetchUrlTitle: vi.fn(),
}))

import { getRequiredUserId } from '@/lib/auth-session'
import { allExportedActionNames } from './actionScan'
import {
  getBandsAction,
  getBandWithMembersAction,
  createBandAction,
  updateBandAction,
  deleteBandAction,
  leaveBandAction,
  removeBandMemberAction,
  getBandPlaylistsAction,
  createBandPlaylistAction,
  regenerateBandInviteCodeAction,
  uploadBandCoverAction,
} from '../bands'
import {
  submitGlobalSongEditAction,
  getPendingGlobalSongEditsAction,
  reviewGlobalSongEditAction,
} from '../moderation'
import {
  getUserPlaylistsAction,
  createPlaylistAction,
  updatePlaylistAction,
  deletePlaylistAction,
  addSongToPlaylistAction,
  removeSongFromPlaylistAction,
  getPlaylistWithSongsAction,
  getPlaylistDetailsWithEntriesAction,
  getPlaylistEntryIdsAction,
} from '../playlists'
import { getProfileAction, updateProfileAction, updateEmailAction } from '../profile'
import {
  getRepertoireAction,
  addSongAction,
  updateSongStatusAction,
  updateSongTagsAction,
  removeSongAction,
  searchGlobalSongsAction,
  getSongEntryAction,
  updateSongAction,
  createAndAddSongAction,
  updateLyricsAction,
  fetchLyricsAction,
  updateSongLinksAction,
  getPersonalEntryForSongAction,
  fetchUrlTitleAction,
} from '../repertoire'
import {
  uploadTabAction,
  deleteTabAction,
  getTabAnnotationsAction,
  saveTabAnnotationsAction,
  getTabsAction,
} from '../tabs'
import type { Repertoire } from '@/types/database'

const BAND_ID = 'band-1'
const PLAYLIST_ID = 'playlist-1'
const REPERTOIRE_ID = 'repertoire-1'
const SONG_ID = 'song-1'
const TAB_ID = 'tab-1'

const ENTRY = { id: REPERTOIRE_ID, song_id: SONG_ID } as unknown as Repertoire
const SONG_PATCH = {
  title: 'Title',
  artist: 'Artist',
  key: null,
  status: 'unknown' as const,
  tags: [],
  links: [],
}

/** `uploadTabAction` / `uploadBandCoverAction` only ever read fields off it. */
const emptyFormData = () => ({ get: () => null }) as unknown as FormData

/**
 * How an action fails closed with no session:
 * - `throws`   — rejects with a message containing `Not authenticated`
 * - `envelope` — resolves to `{ error: '…Not authenticated…' }` (the actions
 *                that already return a result envelope keep doing so)
 * - `null`     — resolves to `null`
 */
type FailMode = 'throws' | 'envelope' | 'null'

const FAIL_CLOSED: Record<string, { run: () => Promise<unknown>; mode: FailMode }> = {
  // --- bands.ts ---
  getBandsAction: { run: () => getBandsAction(), mode: 'throws' },
  getBandWithMembersAction: { run: () => getBandWithMembersAction(BAND_ID), mode: 'throws' },
  createBandAction: { run: () => createBandAction('The Band'), mode: 'throws' },
  updateBandAction: { run: () => updateBandAction(BAND_ID, { name: 'Renamed' }), mode: 'throws' },
  deleteBandAction: { run: () => deleteBandAction(BAND_ID), mode: 'throws' },
  leaveBandAction: { run: () => leaveBandAction(BAND_ID), mode: 'throws' },
  removeBandMemberAction: { run: () => removeBandMemberAction('member-1'), mode: 'throws' },
  getBandPlaylistsAction: { run: () => getBandPlaylistsAction(BAND_ID), mode: 'throws' },
  createBandPlaylistAction: { run: () => createBandPlaylistAction(BAND_ID, 'Setlist'), mode: 'throws' },
  regenerateBandInviteCodeAction: { run: () => regenerateBandInviteCodeAction(BAND_ID), mode: 'throws' },
  uploadBandCoverAction: { run: () => uploadBandCoverAction(emptyFormData()), mode: 'envelope' },

  // --- moderation.ts ---
  submitGlobalSongEditAction: { run: () => submitGlobalSongEditAction(SONG_ID, { title: 'x' }), mode: 'throws' },
  getPendingGlobalSongEditsAction: { run: () => getPendingGlobalSongEditsAction(), mode: 'throws' },
  reviewGlobalSongEditAction: { run: () => reviewGlobalSongEditAction('edit-1', 'approve'), mode: 'throws' },

  // --- playlists.ts ---
  getUserPlaylistsAction: { run: () => getUserPlaylistsAction(), mode: 'throws' },
  createPlaylistAction: { run: () => createPlaylistAction({ name: 'Gig night' }), mode: 'throws' },
  updatePlaylistAction: { run: () => updatePlaylistAction(PLAYLIST_ID, { name: 'Renamed' }), mode: 'throws' },
  deletePlaylistAction: { run: () => deletePlaylistAction(PLAYLIST_ID), mode: 'throws' },
  addSongToPlaylistAction: { run: () => addSongToPlaylistAction(PLAYLIST_ID, SONG_ID), mode: 'throws' },
  removeSongFromPlaylistAction: { run: () => removeSongFromPlaylistAction(PLAYLIST_ID, SONG_ID), mode: 'throws' },
  getPlaylistWithSongsAction: { run: () => getPlaylistWithSongsAction(PLAYLIST_ID), mode: 'throws' },
  getPlaylistDetailsWithEntriesAction: { run: () => getPlaylistDetailsWithEntriesAction(PLAYLIST_ID, null), mode: 'throws' },
  getPlaylistEntryIdsAction: { run: () => getPlaylistEntryIdsAction(PLAYLIST_ID, null), mode: 'throws' },

  // --- profile.ts ---
  getProfileAction: { run: () => getProfileAction(), mode: 'throws' },
  updateProfileAction: { run: () => updateProfileAction({ full_name: 'Jane' }), mode: 'throws' },
  updateEmailAction: { run: () => updateEmailAction('jane@example.com'), mode: 'throws' },

  // --- repertoire.ts ---
  getRepertoireAction: { run: () => getRepertoireAction(BAND_ID), mode: 'throws' },
  addSongAction: { run: () => addSongAction(SONG_ID, BAND_ID), mode: 'throws' },
  updateSongStatusAction: { run: () => updateSongStatusAction(REPERTOIRE_ID, 'learning', BAND_ID), mode: 'throws' },
  updateSongTagsAction: { run: () => updateSongTagsAction(REPERTOIRE_ID, ['rock'], BAND_ID), mode: 'throws' },
  removeSongAction: { run: () => removeSongAction(REPERTOIRE_ID, BAND_ID), mode: 'throws' },
  searchGlobalSongsAction: { run: () => searchGlobalSongsAction('nirvana'), mode: 'throws' },
  getSongEntryAction: { run: () => getSongEntryAction(REPERTOIRE_ID, BAND_ID), mode: 'throws' },
  updateSongAction: { run: () => updateSongAction(ENTRY, SONG_PATCH, BAND_ID), mode: 'throws' },
  createAndAddSongAction: { run: () => createAndAddSongAction({ title: 'Fresh', artist: 'Someone' }, BAND_ID), mode: 'throws' },
  updateLyricsAction: { run: () => updateLyricsAction(REPERTOIRE_ID, 'la la la', BAND_ID), mode: 'throws' },
  fetchLyricsAction: { run: () => fetchLyricsAction('Nirvana', 'Lithium'), mode: 'throws' },
  updateSongLinksAction: { run: () => updateSongLinksAction(REPERTOIRE_ID, [{ label: 'Chords', url: 'https://tabs.example/1' }]), mode: 'throws' },
  // The only `null` entry: it already resolves the session inside its own
  // `try { … } catch { return null }`, and its fast-view call site has no
  // rejection handler. No data crosses the boundary, so it stays that shape.
  getPersonalEntryForSongAction: { run: () => getPersonalEntryForSongAction(SONG_ID), mode: 'null' },
  fetchUrlTitleAction: { run: () => fetchUrlTitleAction('https://example.com'), mode: 'throws' },

  // --- tabs.ts ---
  uploadTabAction: { run: () => uploadTabAction(emptyFormData()), mode: 'envelope' },
  deleteTabAction: { run: () => deleteTabAction(TAB_ID, REPERTOIRE_ID), mode: 'envelope' },
  getTabAnnotationsAction: { run: () => getTabAnnotationsAction(TAB_ID, REPERTOIRE_ID), mode: 'envelope' },
  saveTabAnnotationsAction: { run: () => saveTabAnnotationsAction(TAB_ID, REPERTOIRE_ID, 1, []), mode: 'envelope' },
  getTabsAction: { run: () => getTabsAction(REPERTOIRE_ID), mode: 'throws' },
}

beforeEach(() => {
  vi.mocked(getRequiredUserId).mockReset()
  vi.mocked(getRequiredUserId).mockRejectedValue(new Error('Not authenticated'))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('the network must not be reached without a session')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('every exported Server Action fails closed without a session', () => {
  it('has exactly one table entry per exported action', () => {
    expect(Object.keys(FAIL_CLOSED).sort()).toEqual(allExportedActionNames())
  })

  it.each(Object.entries(FAIL_CLOSED))('%s refuses to run', async (_name, { run, mode }) => {
    if (mode === 'throws') {
      await expect(run()).rejects.toThrow('Not authenticated')
      return
    }
    if (mode === 'null') {
      await expect(run()).resolves.toBeNull()
      return
    }
    const result = (await run()) as { error?: string }
    expect(result.error).toContain('Not authenticated')
  })
})
