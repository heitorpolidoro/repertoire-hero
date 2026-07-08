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
import { addSong, editSong, deleteSong, goHome, songCard } from './helpers'

// ---------------------------------------------------------------------------
// Unique song titles to avoid cross-test pollution
// ---------------------------------------------------------------------------
const SONG_ADD = 'E2E Song Add Test'
const SONG_EDIT_BEFORE = 'E2E Song Before Edit'
const SONG_EDIT_AFTER = 'E2E Song After Edit'
const SONG_DELETE = 'E2E Song Delete Test'

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
  await addSong(page, { title: SONG_ADD, artist: 'E2E Artist' })

  // The new song should now be visible in the repertoire list
  await expect(songCard(page, SONG_ADD)).toBeVisible()
  await expect(songCard(page, SONG_ADD)).toContainText('E2E Artist')
})

test('edit an existing song and verify the changes', async ({ page }) => {
  // Add the song first so we have something to edit
  await addSong(page, { title: SONG_EDIT_BEFORE, artist: 'Original Artist' })
  await expect(songCard(page, SONG_EDIT_BEFORE)).toBeVisible()

  await editSong(page, SONG_EDIT_BEFORE, {
    title: SONG_EDIT_AFTER,
    artist: 'Updated Artist',
  })

  // Old title should be gone; updated card should be present
  await expect(songCard(page, SONG_EDIT_BEFORE)).toHaveCount(0)
  await expect(songCard(page, SONG_EDIT_AFTER)).toBeVisible()
  await expect(songCard(page, SONG_EDIT_AFTER)).toContainText('Updated Artist')
})

test('delete a song and verify it is removed from the list', async ({ page }) => {
  // Add the song first so we have something to delete
  await addSong(page, { title: SONG_DELETE })
  await expect(songCard(page, SONG_DELETE)).toBeVisible()

  await deleteSong(page, SONG_DELETE)

  // Song should no longer appear
  await expect(songCard(page, SONG_DELETE)).toHaveCount(0)
})
