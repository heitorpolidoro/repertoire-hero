/**
 * RH-180 — the band-mode indicator at a phone width.
 *
 * This file is run ONLY by the `mobile` project in playwright.config.ts (Pixel 5
 * emulation, narrowed here to the 390 × 844 viewport the task names); the
 * desktop `chromium` project ignores it.
 *
 * Band context is entered here the way a returning musician has it: through
 * the persisted `band-context` store, which `AppShell` then reconciles against
 * the user's real bands. The mobile "Switch mode" control (RH-181) is the other
 * way in, and e2e/context-switch-mobile.spec.ts drives that one. The band
 * itself is created through the UI, as e2e/bands-confirm.spec.ts does, and
 * deleted again at the end.
 */

import { test, expect, type Page } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'
import {
  addSong,
  boxesIntersect,
  createBand,
  deleteBand,
  goHome,
  hideNextDevOverlay,
  songCard,
  uniqueSongTitle,
  visibleMainNav,
} from './helpers'

test.use({ storageState: AUTH_STATE_PATH, viewport: { width: 390, height: 844 } })

// Six cold routes plus a band and a song created through the UI: allow more
// than the 30s default rather than report a cold compile as a product failure.
test.describe.configure({ timeout: 180_000 })

const MAIN_SCREENS = ['/', '/playlists', '/bands', '/profile', '/settings']

/** Adds a personal song and returns its Fast View path. */
async function fastViewPath(page: Page): Promise<string> {
  const title = uniqueSongTitle('E2E Band Indicator Song')
  await goHome(page)
  await addSong(page, { title })
  const link = songCard(page, title).locator('a[href*="fast-view"]').first()
  const href = await link.getAttribute('href')
  if (!href) throw new Error('The song card carries no Fast View link')
  return href
}

/** Puts the persisted context store on the band, as a returning session has it. */
async function enterBandContext(page: Page, band: { id: string; name: string }) {
  await page.evaluate(({ id, name }) => {
    localStorage.setItem(
      'band-context',
      JSON.stringify({ state: { context: { type: 'band', id, name } }, version: 0 }),
    )
  }, band)
}

test('the band indicator is on every main screen at 390px and clears the bottom nav', async ({
  page,
  viewport,
}) => {
  expect(viewport?.width).toBe(390)

  const songPath = await fastViewPath(page)
  const band = await createBand(page, 'E2E Band Indicator')
  await enterBandContext(page, band)

  for (const path of [...MAIN_SCREENS, songPath]) {
    await page.goto(path)
    const indicator = page.getByTestId('band-indicator')
    await expect(indicator, `indicator on ${path}`).toBeVisible({ timeout: 30_000 })
    await expect(indicator).toContainText(band.name)

    const nav = visibleMainNav(page)
    await expect(nav).toBeVisible()
    const [indicatorBox, navBox] = await Promise.all([indicator.boundingBox(), nav.boundingBox()])
    expect(indicatorBox, `indicator box on ${path}`).not.toBeNull()
    expect(navBox, `nav box on ${path}`).not.toBeNull()
    expect(boxesIntersect(indicatorBox!, navBox!), `indicator overlaps the nav on ${path}`).toBe(false)

    // A trial click runs every actionability check - visible, stable, enabled
    // and not covered by another element - without navigating.
    await hideNextDevOverlay(page)
    for (const link of await nav.getByRole('link').all()) {
      await link.click({ trial: true })
    }
  }

  // Exit: the indicator goes away with no reload.
  await page.goto('/playlists')
  await expect(page.getByTestId('band-indicator')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => {
    ;(window as unknown as { __rh180Sentinel?: boolean }).__rh180Sentinel = true
  })
  await page.getByTestId('band-indicator-exit').click()

  await expect(page.getByTestId('band-indicator')).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  expect(
    await page.evaluate(() => (window as unknown as { __rh180Sentinel?: boolean }).__rh180Sentinel),
  ).toBe(true)

  // Personal context persists across a real reload.
  await page.reload()
  await expect(visibleMainNav(page)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('band-indicator')).toHaveCount(0)

  await deleteBand(page, band.url)
})
