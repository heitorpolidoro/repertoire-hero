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
// Fixture naming
// ---------------------------------------------------------------------------

/**
 * Counts the titles handed out by this worker process, so two calls made
 * inside the same millisecond still differ. Zero-padded at the call site so no
 * suffix can ever be a prefix of another one (`-001` vs `-010`), which matters
 * because `songCard` matches a card by substring.
 */
let songTitleSequence = 0

/**
 * Builds a song title that is unique to this invocation.
 *
 * The e2e database is never reset and `createAndAddSong` throws
 * `Song already in your repertoire` on a second add of the same title, so a
 * fixture named by a module-level constant can only ever be created once — a
 * retry, a `--repeat-each` run or simply a second run of the suite then fails
 * on its own leftovers, and no retry can rescue it.
 *
 * MUST be called from inside the test body (or a `beforeEach`), never at module
 * scope: a retry can execute in the same worker process, so a suffix computed
 * once at import time would repeat and collide exactly like a constant.
 */
export function uniqueSongTitle(prefix: string): string {
  songTitleSequence += 1
  return `${prefix} ${Date.now()}-${process.pid}-${String(songTitleSequence).padStart(3, '0')}`
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
  const addButton = page.getByRole('button', { name: 'Add song' })
  const dialog = page.locator('dialog[open]')

  // The FAB paints before React hydrates, so a click can be swallowed on a cold
  // route. Retry opening the dialog until it actually appears. Only the opening
  // click is retried — see the submit below.
  await expect(addButton).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    await addButton.click()
    await expect(dialog).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })

  // Fill required field
  await page.locator('#sf-title').fill(data.title)

  // Fill optional fields
  if (data.artist) {
    await page.locator('#sf-artist').fill(data.artist)
  }

  // Submit — deliberately NOT inside a retry block: re-clicking a submit that
  // did go through would add the song twice.
  await dialog.getByRole('button', { name: /^(add|save)$/i, exact: true }).click()

  // Wait for the dialog to close
  await expectDialogToClose(page)
}

/**
 * Waits for the SongForm dialog to close after a submit.
 *
 * When it does not, the reason is almost always the in-dialog `role="alert"`
 * (`Song already in your repertoire`, `Title is required.`, ...), which a bare
 * `toHaveCount` timeout hides. Surfacing that text makes the next fixture
 * regression name itself instead of reading as a mystery timeout.
 */
async function expectDialogToClose(page: Page) {
  const dialog = page.locator('dialog[open]')
  try {
    await expect(dialog).toHaveCount(0, { timeout: 8_000 })
  } catch (error) {
    const alert = dialog.locator('[role="alert"]')
    const message = (await alert.count()) > 0 ? (await alert.first().innerText()).trim() : ''
    if (message) {
      throw new Error(`The song dialog stayed open reporting: ${message}`)
    }
    throw error
  }
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

  await page.locator('dialog[open]').getByRole('button', { name: /^(save|add)$/i, exact: true }).click()
  await expectDialogToClose(page)
}

/**
 * Delete the song with the given title.
 * Filters the list down to it, clicks Delete and confirms the inline
 * confirmation.
 */
export async function deleteSong(page: Page, title: string) {
  // Find the song the way a user would. This is not cosmetic: the "Add song"
  // FAB is fixed to the bottom-right corner, so once the list is long enough to
  // put a card there, that card's Delete button sits underneath it and the
  // click is intercepted by the FAB. Filtering first puts the target row at the
  // top of the list, whatever the database already holds.
  const search = page.locator('#search-input')
  await search.fill(title)
  await expect(songCard(page, title)).toHaveCount(1)

  // Click the Delete button for this specific song
  await page
    .getByRole('button', { name: new RegExp(`Delete ${title}`, 'i') })
    .click()

  // Confirm the deletion (confirm button appears inline)
  await page
    .getByRole('button', { name: /confirm|yes/i })
    .first()
    .click()

  // Drop the filter again: the global catalog keeps the song even after it
  // leaves this repertoire, so a still-active search would offer it back under
  // "Add to your repertoire" and the caller's "it is gone" assertion would be
  // reading that card instead of the list.
  await search.clear()
}

/**
 * Returns a locator scoped to the song card identified by the given title.
 * Useful for asserting card-level attributes.
 */
export function songCard(page: Page, title: string) {
  return page.getByRole('article').or(page.getByRole('listitem')).filter({ hasText: title })
}
