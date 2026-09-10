/**
 * T4.4 — Song CRUD E2E tests
 *
 * DoD: CI run passes; tests cover add, edit, and delete actions end-to-end
 * against a real running instance of the app.
 *
 * All tests reuse the authenticated session created by global-setup.ts
 * so no login step is needed inside these specs.
 */

import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'
import { addSong, editSong, deleteSong, goHome, songCard, uniqueSongTitle } from './helpers'

// ---------------------------------------------------------------------------
// Song titles are built with `uniqueSongTitle` inside each test body, never as
// module-level constants: the e2e database is never reset, so a constant title
// can only be added once and every later run (or retry) dies on its own
// leftovers with `Song already in your repertoire`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Use authenticated session for every test in this file
// ---------------------------------------------------------------------------
test.use({ storageState: AUTH_STATE_PATH })

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
test.beforeEach(async ({ page }) => {
  await goHome(page)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('add a new song and verify it appears in the list', async ({ page }) => {
  const songAdd = uniqueSongTitle('E2E Song Add Test')

  await addSong(page, { title: songAdd, artist: 'E2E Artist' })

  // The new song should now be visible in the repertoire list
  await expect(songCard(page, songAdd)).toBeVisible()
  await expect(songCard(page, songAdd)).toContainText('E2E Artist')
})

/**
 * `global_songs` is a shared catalog, so `updateSong` (src/lib/songs.ts) writes
 * it fill-if-empty: a field that already carries a value is left alone, and only
 * an empty one is filled in. Correcting an already-set field is a different
 * mechanism entirely — `Correct Global Info` -> the admin moderation queue
 * (RH-15) — so the rule worth guarding here is exactly the one the code
 * implements: the typed artist lands because the field was empty, the typed
 * title is discarded because the title was not.
 */
test('editing a song fills the empty catalog fields and leaves the shared title unchanged', async ({
  page,
}) => {
  const originalTitle = uniqueSongTitle('E2E Song Before Edit')
  const typedTitle = uniqueSongTitle('E2E Song After Edit')

  // Add the song with a title and NO artist, so the artist field is the empty
  // one the edit is allowed to fill.
  await addSong(page, { title: originalTitle })
  await expect(songCard(page, originalTitle)).toBeVisible()

  await editSong(page, originalTitle, {
    title: typedTitle,
    artist: 'Filled In Artist',
  })

  // The empty field was filled; the title the catalog already had is untouched.
  await expect(songCard(page, originalTitle)).toBeVisible()
  await expect(songCard(page, originalTitle)).toContainText('Filled In Artist')

  // ...and the typed title never becomes a song of its own.
  await expect(songCard(page, typedTitle)).toHaveCount(0)
})

test('delete a song and verify it is removed from the list', async ({ page }) => {
  const songDelete = uniqueSongTitle('E2E Song Delete Test')

  // Add the song first so we have something to delete
  await addSong(page, { title: songDelete })
  await expect(songCard(page, songDelete)).toBeVisible()

  await deleteSong(page, songDelete)

  // Song should no longer appear
  await expect(songCard(page, songDelete)).toHaveCount(0)
})
