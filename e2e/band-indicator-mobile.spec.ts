/**
 * RH-180 — the band-mode indicator at a phone width.
 *
 * This file is run ONLY by the `mobile` project in playwright.config.ts (Pixel 5
 * emulation, narrowed here to the 390 × 844 viewport the task names); the
 * desktop `chromium` project ignores it.
 *
 * At 390px there is no context switcher (it lives in the `hidden md:flex`
 * sidebar), so band context is entered the way a returning musician has it:
 * through the persisted `band-context` store, which `AppShell` then reconciles
 * against the user's real bands. The band itself is created through the UI, as
 * e2e/bands-confirm.spec.ts does, and deleted again at the end.
 */

import { test, expect, type Page } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'
import { addSong, goHome, songCard, uniqueFixtureName, uniqueSongTitle } from './helpers'

test.use({ storageState: AUTH_STATE_PATH, viewport: { width: 390, height: 844 } })

// Six cold routes plus a band and a song created through the UI: allow more
// than the 30s default rather than report a cold compile as a product failure.
test.describe.configure({ timeout: 180_000 })

const MAIN_SCREENS = ['/', '/playlists', '/bands', '/profile', '/settings']

/** Creates a band through the UI and returns its id, name and detail URL. */
async function createBand(page: Page): Promise<{ id: string; name: string; url: string }> {
  const name = uniqueFixtureName('E2E Band Indicator')
  await page.goto('/bands')

  const newBandButton = page.getByRole('button', { name: '+ New Band' })
  const nameInput = page.getByPlaceholder('The Rolling Stones')
  await expect(newBandButton).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    await newBandButton.click()
    await expect(nameInput).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })

  await nameInput.fill(name)
  await page.getByRole('button', { name: 'Create Band' }).click()
  await page.waitForURL(/\/bands\/[^/]+$/, { timeout: 15_000 })

  const url = page.url()
  return { id: url.split('/').pop() ?? '', name, url }
}

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

function bottomNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main navigation' }).filter({ visible: true })
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * Hides Next's dev overlay (`<nextjs-portal>`: the dev-tools button and the
 * issue badge) for the current document. Under `npm run dev` it floats over
 * the bottom-left of the viewport, on top of the bottom nav at 390px, and would
 * make the trial clicks below fail on a dev-only element that never ships. Only
 * that framework element is hidden; every app element stays as rendered.
 */
async function hideNextDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
}

async function deleteBand(page: Page, url: string) {
  await page.goto(url)
  await page.getByTitle('Delete band').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await page.waitForURL(/\/bands$/, { timeout: 15_000 })
}

test('the band indicator is on every main screen at 390px and clears the bottom nav', async ({
  page,
  viewport,
}) => {
  expect(viewport?.width).toBe(390)

  const songPath = await fastViewPath(page)
  const band = await createBand(page)
  await enterBandContext(page, band)

  for (const path of [...MAIN_SCREENS, songPath]) {
    await page.goto(path)
    const indicator = page.getByTestId('band-indicator')
    await expect(indicator, `indicator on ${path}`).toBeVisible({ timeout: 30_000 })
    await expect(indicator).toContainText(band.name)

    const nav = bottomNav(page)
    await expect(nav).toBeVisible()
    const [indicatorBox, navBox] = await Promise.all([indicator.boundingBox(), nav.boundingBox()])
    expect(indicatorBox, `indicator box on ${path}`).not.toBeNull()
    expect(navBox, `nav box on ${path}`).not.toBeNull()
    expect(intersects(indicatorBox!, navBox!), `indicator overlaps the nav on ${path}`).toBe(false)

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
  await page.getByTestId('band-indicator').getByRole('button').click()

  await expect(page.getByTestId('band-indicator')).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
  expect(
    await page.evaluate(() => (window as unknown as { __rh180Sentinel?: boolean }).__rh180Sentinel),
  ).toBe(true)

  // Personal context persists across a real reload.
  await page.reload()
  await expect(bottomNav(page)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('band-indicator')).toHaveCount(0)

  await deleteBand(page, band.url)
})
