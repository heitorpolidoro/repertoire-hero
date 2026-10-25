/**
 * RH-181 — switching between personal and band mode at a phone width.
 *
 * This file is run ONLY by the `mobile` project in playwright.config.ts (Pixel 5
 * emulation, narrowed here to 375 × 812); the desktop `chromium` project
 * ignores it. It drives the "Switch mode" control: the personal bar's trigger,
 * the sheet, and the band name in the RH-180 band bar. The band is created
 * through the UI, as e2e/band-indicator-mobile.spec.ts does, and deleted at the
 * end.
 */

import { test, expect, type Page } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'
import { boxesIntersect, createBand, deleteBand, hideNextDevOverlay, visibleMainNav } from './helpers'

test.use({ storageState: AUTH_STATE_PATH, viewport: { width: 375, height: 812 } })

// Five cold routes, a band created through the UI and four reloads: allow more
// than the 30s default rather than report a cold compile as a product failure.
test.describe.configure({ timeout: 180_000 })

const MAIN_SCREENS = ['/', '/playlists', '/bands', '/profile', '/settings']

function repertoireHeading(page: Page, name: string) {
  return page.getByRole('heading', { name, exact: true })
}

/** Opens the sheet from the one visible trigger and returns it. */
async function openSheet(page: Page) {
  await hideNextDevOverlay(page)
  const trigger = page.getByTestId('mobile-context-trigger')
  await expect(trigger).toBeVisible({ timeout: 30_000 })
  await trigger.click()
  const sheet = page.getByRole('dialog', { name: 'Switch mode' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveAttribute('data-testid', 'mobile-context-sheet')
  return sheet
}

test('switches personal → band → personal through the mobile control at 375px', async ({ page, viewport }) => {
  expect(viewport?.width).toBe(375)

  const band = await createBand(page, 'E2E Context Switch')

  // The personal-mode trigger is on every main screen and clears the bottom nav.
  for (const path of MAIN_SCREENS) {
    await page.goto(path)
    const trigger = page.getByTestId('mobile-context-trigger')
    await expect(trigger, `trigger on ${path}`).toBeVisible({ timeout: 30_000 })

    const nav = visibleMainNav(page)
    await expect(nav).toBeVisible()
    const [triggerBox, navBox] = await Promise.all([trigger.boundingBox(), nav.boundingBox()])
    expect(triggerBox, `trigger box on ${path}`).not.toBeNull()
    expect(navBox, `nav box on ${path}`).not.toBeNull()
    expect(boxesIntersect(triggerBox!, navBox!), `trigger overlaps the nav on ${path}`).toBe(false)
  }

  // Personal → band, from the personal bar.
  await page.goto('/')
  await expect(repertoireHeading(page, 'My Repertoire')).toBeVisible({ timeout: 30_000 })
  let sheet = await openSheet(page)
  await expect(sheet.getByRole('button', { name: /Personal/ })).toHaveAttribute('aria-current', 'true')
  await expect(sheet.getByRole('button', { name: band.name })).toBeVisible()
  await sheet.getByRole('button', { name: band.name }).click()

  await expect(sheet).toHaveCount(0)
  await expect(repertoireHeading(page, `🎸 ${band.name}`)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('band-indicator')).toBeVisible()
  await expect(page.getByTestId('mobile-context-bar')).toHaveCount(0)

  // The band survives a reload at 375px.
  await page.reload()
  await expect(repertoireHeading(page, `🎸 ${band.name}`)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('band-indicator')).toContainText(band.name)

  // The desktop sidebar switcher reads the same stored context.
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.reload()
  const sidebar = visibleMainNav(page)
  await expect(sidebar.getByRole('button', { name: band.name })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('mobile-context-trigger')).toBeHidden()

  // Band → personal, from the band bar's trigger.
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByTestId('band-indicator').getByTestId('mobile-context-trigger')).toBeVisible()
  sheet = await openSheet(page)
  await expect(sheet.getByRole('button', { name: band.name })).toHaveAttribute('aria-current', 'true')
  await sheet.getByRole('button', { name: /Personal/ }).click()

  await expect(repertoireHeading(page, 'My Repertoire')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('band-indicator')).toHaveCount(0)

  // Personal survives a reload too.
  await page.reload()
  await expect(repertoireHeading(page, 'My Repertoire')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('band-indicator')).toHaveCount(0)
  await expect(page.getByTestId('mobile-context-bar')).toBeVisible()

  await deleteBand(page, band.url)
})
