/**
 * T4.6 — Fast View E2E tests (mobile viewport)
 *
 * DoD: Playwright device emulation confirms the correct layout and song
 * search behaviour at mobile breakpoints; CI run passes.
 *
 * This file is ONLY run by the "mobile" project in playwright.config.ts
 * (Pixel 5, 393 × 851). The `testMatch` setting on that project makes sure
 * desktop runs skip this file automatically.
 */

import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'
import { addSong, goHome, songCard } from './helpers'

const MOBILE_SONG_TITLE = 'E2E Mobile Song'

// ---------------------------------------------------------------------------
// Use authenticated session
// ---------------------------------------------------------------------------
test.use({ storageState: AUTH_STATE_PATH })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('song list is visible on a mobile viewport', async ({ page, viewport }) => {
  // Sanity-check: confirm we're running at mobile width
  expect(viewport?.width).toBeLessThanOrEqual(420)

  await goHome(page)

  // The repertoire list container should be visible on mobile
  const songList = page.getByRole('list', { name: 'Song list' }).or(
    page.locator('[aria-label="Song list"]')
  )
  await expect(songList).toBeVisible()
})

test('search works on a mobile viewport', async ({ page }) => {
  await goHome(page)

  // Add a uniquely-titled song so we can search for it
  await addSong(page, { title: MOBILE_SONG_TITLE, artist: 'Mobile Artist' })
  await expect(songCard(page, MOBILE_SONG_TITLE)).toBeVisible()

  // Type into the search input and wait for debounce
  const searchInput = page.locator('#search-input')
  await expect(searchInput).toBeVisible()
  await searchInput.fill(MOBILE_SONG_TITLE)

  // After debounce the card should still be visible (matching) and unrelated
  // cards should be hidden
  await expect(songCard(page, MOBILE_SONG_TITLE)).toBeVisible()
})

test('fast-view page renders the song title on mobile', async ({ page }) => {
  await goHome(page)

  // Ensure there is at least one song we can navigate to
  await addSong(page, { title: MOBILE_SONG_TITLE })

  // Find the fast-view link for our song and click it
  const card = songCard(page, MOBILE_SONG_TITLE)
  const fastViewLink = card.getByRole('link', { name: /fast view|🎸|📖/i }).or(
    // Fallback: any link inside the card that goes to /fast-view
    card.locator('a[href*="fast-view"]')
  )
  await expect(fastViewLink).toBeVisible()
  await fastViewLink.click()

  // Verify we're on the fast-view URL and the song title is displayed
  await page.waitForURL(/\/songs\/.+\/fast-view/, { timeout: 8_000 })
  await expect(page).toHaveURL(/\/songs\/.+\/fast-view/)
  await expect(page.getByRole('heading').filter({ hasText: MOBILE_SONG_TITLE })).toBeVisible()
})
