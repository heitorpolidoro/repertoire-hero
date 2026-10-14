/**
 * RH-136 — an approved link correction, the two bridge triggers, and the
 * Spotify import, against a real Postgres (ER14, ER17, ER18).
 *
 * The correction is reached through `reviewCatalogSuggestionGroup` by
 * `group_id`. Since RH-138 it is per row (`linkChanges`), no longer a replace-set
 * over the whole array.
 *
 * The other half of the behaviour suite lives in `songLinksTable.db.test.ts`;
 * the seam is the subsystem under test and neither file may reach the hard
 * `max-lines` of 800 the complexity ratchet forbids overriding.
 *
 * The fixtures seed `song_links` rows directly. The `songs.links` column and
 * the forward bridge trigger that mirrored it are gone (RH-143), so the trigger
 * cases that used to live here left with them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { query } from '@/lib/db'
import { createTestUser, deleteTestUser } from './test-helpers'
import { reviewCatalogSuggestionGroup, submitCatalogSuggestion } from '../moderation'
import { findOrCreateSong } from '../spotifyPlaylistSync'
import type { LinkChangeInput } from '@/lib/catalogFields'
import type { SongLink } from '@/types/database'

const RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? ''

interface StoredLink {
  id: string
  url: string
  label: string
  provider: string
  position: number
}

const UA = 'https://tabs.example/rh136b-a'
const UB = 'https://youtu.be/rh136b-b'
const UC = 'https://open.spotify.com/track/rh136b-c'

describe.skipIf(!RUN_DB_TESTS)('the song_links bridge and the moderation replace-set (RH-136)', () => {
  const suffix = Date.now()
  let userId: string
  let adminId: string
  const createdSongIds = new Set<string>()

  /** Seeds a song and its `song_links` rows at positions 1, 2, … in order. */
  const seedSong = async (label: string, links: SongLink[] = []): Promise<string> => {
    const res = await query<{ id: string }>(
      'INSERT INTO songs (title, artist) VALUES ($1, $2) RETURNING id',
      [`RH-136B ${label} ${suffix}`, `RH-136B Artist ${suffix}`],
    )
    createdSongIds.add(res.rows[0].id)
    for (const [index, link] of links.entries()) {
      await query('INSERT INTO song_links (song_id, url, label, position) VALUES ($1, $2, $3, $4)', [
        res.rows[0].id,
        link.url,
        link.label,
        index + 1,
      ])
    }
    return res.rows[0].id
  }

  const storedLinks = async (songId: string): Promise<StoredLink[]> => {
    const res = await query<StoredLink>(
      `SELECT id, url, label, provider, position FROM song_links
        WHERE song_id = $1 ORDER BY position, created_at, id`,
      [songId],
    )
    return res.rows
  }

  const updatedAt = async (songId: string): Promise<string> => {
    const res = await query<{ updated_at: string }>(
      'SELECT updated_at::text AS updated_at FROM songs WHERE id = $1',
      [songId],
    )
    return res.rows[0].updated_at
  }

  /** A pending link-row correction, approved, returning the suggestion's final status. */
  const approveChange = async (songId: string, change: LinkChangeInput): Promise<string> => {
    const submitted = await submitCatalogSuggestion(userId, songId, { linkChanges: [change] })
    const reviewed = await reviewCatalogSuggestionGroup(adminId, submitted[0].group_id, 'approve')
    return reviewed[0].status
  }

  beforeAll(async () => {
    userId = await createTestUser({ email: `rh136-bridge-${suffix}@example.com` })
    adminId = await createTestUser({ email: `rh136-bridge-admin-${suffix}@example.com` })
    await query('UPDATE profiles SET is_system_admin = true WHERE id = $1', [adminId])
  })

  afterAll(async () => {
    if (createdSongIds.size > 0) {
      await query('DELETE FROM songs WHERE id = ANY($1)', [Array.from(createdSongIds)])
    }
    if (userId) await deleteTestUser(userId)
    if (adminId) await deleteTestUser(adminId)
  })

  // RH-138: the replace-set is gone. An approved link correction writes one row;
  // the per-row suite (ER3-ER8) lives in `linkRowSuggestions.db.test.ts`. What
  // stays here is the one thing that needs this file's fixtures: the row id and
  // position survive an approved edit, and the timestamp still advances.
  describe('an approved link-row correction touches only its row (ER14)', () => {
    it('removes one row, keeps every survivor id and position, and bumps the timestamp', async () => {
      const songId = await seedSong('Row Removal', [
        { label: 'A', url: UA },
        { label: 'B', url: UB },
        { label: 'C', url: UC },
      ])
      const before = await storedLinks(songId)
      const stamp = await updatedAt(songId)

      expect(await approveChange(songId, { linkId: before[1].id, removed: true })).toBe('approved')

      const after = await storedLinks(songId)
      expect(after).toEqual([before[0], before[2]])
      expect(await updatedAt(songId) > stamp).toBe(true)
    })

    it('renames one row without moving it', async () => {
      const songId = await seedSong('Row Rename', [
        { label: 'A', url: UA },
        { label: 'B', url: UB },
      ])
      const before = await storedLinks(songId)

      expect(await approveChange(songId, { linkId: before[0].id, label: 'A renamed' })).toBe('approved')

      const after = await storedLinks(songId)
      expect(after[0]).toEqual({ ...before[0], label: 'A renamed' })
      expect(after[1]).toEqual(before[1])
    })
  })

  describe('the Spotify import keeps its link visible (ER18)', () => {
    it('leaves the imported url in song_links with provider spotify', async () => {
      const title = `RH-136B Import ${suffix}`
      const artist = `RH-136B Import Artist ${suffix}`
      const songId = await seedSong('Import Target')
      // `findOrCreateSong` resolves by (artist, title), so the seeded row has
      // to carry the identity the track will resolve to.
      await query('UPDATE songs SET title = $1, artist = $2 WHERE id = $3', [title, artist, songId])
      expect(await storedLinks(songId)).toHaveLength(0)

      const resolved = await findOrCreateSong({
        spotifyTrackId: `rh136b-${suffix}`,
        title,
        artist,
        album: null,
        albumArt: null,
        spotifyUrl: UC,
        durationSeconds: 210,
      })

      expect(resolved.songId).toBe(songId)
      const rows = await storedLinks(songId)
      expect(rows.map((row) => row.url)).toEqual([UC])
      expect(rows[0].provider).toBe('spotify')
      expect(rows[0].label).toBe(title)
    })

    it('appends at max(position) + 1, and bumps updated_at (RH-137)', async () => {
      const title = `RH-137 Import ${suffix}`
      const artist = `RH-137 Import Artist ${suffix}`
      // Two links already on the song, at positions 1 and 2 — the state
      // `max(position)` is read from.
      const songId = await seedSong('Import Append Target', [
        { label: 'A', url: UA },
        { label: 'B', url: UB },
      ])
      await query('UPDATE songs SET title = $1, artist = $2 WHERE id = $3', [title, artist, songId])
      const before = await storedLinks(songId)
      expect(before.map((row) => row.position)).toEqual([1, 2])
      const beforeUpdatedAt = await updatedAt(songId)

      const track = {
        spotifyTrackId: `rh137-${suffix}`,
        title,
        artist,
        album: null,
        albumArt: null,
        spotifyUrl: UC,
        durationSeconds: 210,
      }
      expect((await findOrCreateSong(track)).songId).toBe(songId)

      const after = await storedLinks(songId)
      expect(after.map((row) => row.url)).toEqual([UA, UB, UC])
      const appended = after.find((row) => row.url === UC)!
      expect(appended.position).toBe(3)
      expect(appended.provider).toBe('spotify')
      // Nothing was deleted and reinserted.
      for (const row of before) {
        expect(after.find((candidate) => candidate.url === row.url)!.id).toBe(row.id)
      }
      expect(await updatedAt(songId) > beforeUpdatedAt).toBe(true)

      // Re-importing the same track adds no second row.
      await findOrCreateSong(track)
      expect(await storedLinks(songId)).toHaveLength(3)
    })
  })
})
