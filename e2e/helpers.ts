/**
 * Shared E2E helpers.
 *
 * These functions encapsulate repetitive UI interactions so individual test
 * specs stay concise and readable.
 */

import { type Page, expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SongData {
  title: string
  artist?: string
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/** Navigate to the home page (repertoire list) and wait until it's ready. */
export async function goHome(page: Page) {
  await page.goto('/')
  // Wait for the song list container to appear (even if empty)
  await page.waitForSelector('[aria-label="Song list"]', { timeout: 10_000 })
}

// ---------------------------------------------------------------------------
// Song CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Open the "Add song" modal, fill in the fields, and submit.
 * The caller is responsible for navigating to the home page first.
 */
export async function addSong(page: Page, data: SongData) {
  // Click the FAB / "Add song" button
  await page.getByRole('button', { name: 'Add song' }).click()

  // Wait for the SongForm dialog to appear
  await page.waitForSelector('dialog[open]', { timeout: 5_000 })

  // Fill required field
  await page.locator('#sf-title').fill(data.title)

  // Fill optional fields
  if (data.artist) {
    await page.locator('#sf-artist').fill(data.artist)
  }

  // Submit
  await page.getByRole('button', { name: /add|save/i }).click()

  // Wait for the dialog to close
  await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 8_000 })
}

/**
 * Click the Edit button for the song with the given title.
 * Waits for the SongForm dialog to open.
 */
export async function openEditDialog(page: Page, title: string) {
  await page
    .getByRole('button', { name: new RegExp(`Edit ${title}`, 'i') })
    .click()
  await page.waitForSelector('dialog[open]', { timeout: 5_000 })
}

/**
 * Edit a song — opens the edit dialog, clears and re-fills the given fields,
 * then saves.
 */
export async function editSong(page: Page, title: string, data: Partial<SongData>) {
  await openEditDialog(page, title)

  if (data.title !== undefined) {
    await page.locator('#sf-title').clear()
    await page.locator('#sf-title').fill(data.title)
  }
  if (data.artist !== undefined) {
    await page.locator('#sf-artist').clear()
    await page.locator('#sf-artist').fill(data.artist)
  }

  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 8_000 })
}

/**
 * Delete the song with the given title.
 * Clicks the Delete button and confirms the inline confirmation.
 */
export async function deleteSong(page: Page, title: string) {
  // Click the Delete button for this specific song
  await page
    .getByRole('button', { name: new RegExp(`Delete ${title}`, 'i') })
    .click()

  // Confirm the deletion (confirm button appears inline)
  await page
    .getByRole('button', { name: /confirm|yes/i })
    .first()
    .click()
}

/**
 * Returns a locator scoped to the song card identified by the given title.
 * Useful for asserting card-level attributes.
 */
export function songCard(page: Page, title: string) {
  return page.getByRole('article').filter({ hasText: title })
}
