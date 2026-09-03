/**
 * RH-16 — Band deletion is confirmed in-page, never with a native dialog.
 *
 * Playwright auto-dismisses browser dialogs when no handler is registered, so a
 * native `confirm()` would resolve to `false` and the deletion would silently do
 * nothing. Every test here therefore records any `dialog` event and asserts none
 * fired: the specs only pass once the confirmation is a real in-page element.
 *
 * All tests reuse the authenticated session created by global-setup.ts.
 */

import { test, expect, type Page } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'

test.use({ storageState: AUTH_STATE_PATH })

// The Next.js dev server compiles routes on first hit, so the first test to
// reach /bands can pay a large one-off compile cost. Allow more than the 30s
// default rather than reporting a cold cache as a product failure.
test.describe.configure({ timeout: 90_000 })

/**
 * Records every native dialog the page raises. The returned array must stay
 * empty — its contents are the failure message when it does not.
 */
function trackDialogs(page: Page): string[] {
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    dialog.dismiss()
  })
  return dialogs
}

/** Creates a band through the UI and returns its name and detail-page URL. */
async function createBand(page: Page): Promise<{ name: string; url: string }> {
  const name = `E2E Band Confirm ${Date.now()}`

  await page.goto('/bands')

  const newBandButton = page.getByRole('button', { name: '+ New Band' })
  const nameInput = page.getByPlaceholder('The Rolling Stones')

  // The button paints before React hydrates, so a click can be swallowed on a
  // cold route. Retry opening the dialog until the name field actually appears.
  await expect(newBandButton).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    await newBandButton.click()
    await expect(nameInput).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })

  await nameInput.fill(name)
  await page.getByRole('button', { name: 'Create Band' }).click()

  await page.waitForURL(/\/bands\/[^/]+$/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name })).toBeVisible()

  return { name, url: page.url() }
}

/** Opens the delete-band confirmation and returns a locator for the panel. */
async function openDeleteConfirmation(page: Page) {
  await page.getByTitle('Delete band').click()
  const panel = page.getByRole('alertdialog')
  await expect(panel).toBeVisible()
  return panel
}

test('delete band via the inline confirmation', async ({ page }) => {
  const dialogs = trackDialogs(page)
  const { name } = await createBand(page)

  const panel = await openDeleteConfirmation(page)
  await expect(panel).toContainText(name)

  await panel.getByRole('button', { name: 'Delete' }).click()

  await page.waitForURL(/\/bands$/, { timeout: 15_000 })
  await expect(page.getByText(name)).toHaveCount(0)
  expect(dialogs).toEqual([])
})

test('cancel keeps the band', async ({ page }) => {
  const dialogs = trackDialogs(page)
  const { name, url } = await createBand(page)

  const panel = await openDeleteConfirmation(page)
  const cancel = panel.getByRole('button', { name: 'Cancel' })

  // The safe choice takes focus when the confirmation opens.
  await expect(cancel).toBeFocused()
  await cancel.click()

  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(page.url()).toBe(url)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  expect(dialogs).toEqual([])

  // Clean up so no stray band is left behind.
  const confirmPanel = await openDeleteConfirmation(page)
  await confirmPanel.getByRole('button', { name: 'Delete' }).click()
  await page.waitForURL(/\/bands$/, { timeout: 15_000 })
})

test('Escape dismisses the confirmation', async ({ page }) => {
  const dialogs = trackDialogs(page)
  const { name, url } = await createBand(page)

  await openDeleteConfirmation(page)
  await page.keyboard.press('Escape')

  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(page.url()).toBe(url)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  expect(dialogs).toEqual([])

  // Clean up so no stray band is left behind.
  const panel = await openDeleteConfirmation(page)
  await panel.getByRole('button', { name: 'Delete' }).click()
  await page.waitForURL(/\/bands$/, { timeout: 15_000 })
})
