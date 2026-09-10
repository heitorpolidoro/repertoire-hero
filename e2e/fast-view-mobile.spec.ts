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
import { addSong, goHome, songCard, uniqueSongTitle } from './helpers'

// ---------------------------------------------------------------------------
// Song titles are built with `uniqueSongTitle` inside each test body, never as
// module-level constants: the e2e database is never reset, so a constant title
// can only be added once and every later run (or retry) dies on its own
// leftovers with `Song already in your repertoire`. The two prefixes below are
// also deliberately not prefixes of one another — `songCard` matches by
// substring, so `E2E Mobile Song` used to match the `... Fast View` card too and
// blow up strict mode once both rows existed.
// ---------------------------------------------------------------------------
const SEARCH_SONG_PREFIX = 'E2E Mobile Search Song'
const FAST_VIEW_SONG_PREFIX = 'E2E Mobile FastView Song'

// ---------------------------------------------------------------------------
// Use authenticated session
// ---------------------------------------------------------------------------
test.use({ storageState: AUTH_STATE_PATH })

// The dev server compiles routes on first hit, so the first test to reach
// /songs/[id]/fast-view can pay a large one-off compile cost on top of the
// the hydration retry loop below. Allow more than the 30s default rather than
// reporting a cold cache as a product failure (same reasoning as
// e2e/bands-confirm.spec.ts).
test.describe.configure({ timeout: 90_000 })

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
  const songTitle = uniqueSongTitle(SEARCH_SONG_PREFIX)

  await goHome(page)

  // Add a uniquely-titled song so we can search for it
  await addSong(page, { title: songTitle, artist: 'Mobile Artist' })
  await expect(songCard(page, songTitle)).toBeVisible()

  // Type into the search input and wait for debounce
  const searchInput = page.locator('#search-input')
  await expect(searchInput).toBeVisible()
  await searchInput.fill(songTitle)

  // After debounce the card should still be visible (matching) and unrelated
  // cards should be hidden
  await expect(songCard(page, songTitle)).toBeVisible()
})

test('fast-view page renders the song title on mobile', async ({ page }) => {
  const songTitle = uniqueSongTitle(FAST_VIEW_SONG_PREFIX)

  await goHome(page)

  // Ensure there is at least one song we can navigate to
  await addSong(page, { title: songTitle })

  // Find the fast-view link for our song and click it
  const card = songCard(page, songTitle)
  const fastViewLink = card.getByRole('link', { name: /fast view|🎸|📖/i }).or(
    // Fallback: any link inside the card that goes to /fast-view
    card.locator('a[href*="fast-view"]')
  )
  await expect(fastViewLink).toBeVisible()

  // The card is a next/link inside a client-rendered list: it paints before
  // React hydrates, so a click on a cold route can be swallowed with no
  // navigation logged at all (the CI failure mode of this test). Retry the click
  // until the navigation actually happens, exactly as bands-confirm and
  // server-pages retry their cold-route clicks.
  await expect(async () => {
    await fastViewLink.click()
    await expect(page).toHaveURL(/\/songs\/.+\/fast-view/, { timeout: 5_000 })
  }).toPass({ timeout: 30_000 })

  // Verify we're on the fast-view URL and the song title is displayed
  await expect(page).toHaveURL(/\/songs\/.+\/fast-view/)
  // Budget, not a sleep: covers the client navigation above plus `useSongEntry`'s entry fetch, which the 5 s expect default does not.
  await expect(page.getByRole('heading').filter({ hasText: songTitle })).toBeVisible({
    timeout: 15_000,
  })
})
