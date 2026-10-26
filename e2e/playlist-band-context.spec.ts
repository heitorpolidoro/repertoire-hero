/**
 * RH-184 — `+ New Playlist` on `/playlists` creates for the active context.
 *
 * Run by the desktop `chromium` project. In band context the dialog names the
 * band (`#new-playlist-owner`) and the new playlist lands in that band's
 * section, still there after a reload; back in personal context the dialog
 * carries no owner cue and the next playlist lands under "My playlists".
 *
 * Band context is entered through the persisted `band-context` store, as
 * e2e/band-indicator-mobile.spec.ts does, and the `band-indicator` showing the
 * band proves `AppShell`'s reconciliation kept it. The band is created through
 * the UI, so the test user is its admin, and deleting it at the end removes its
 * playlist by cascade. Every fixture name comes from `uniqueFixtureName`.
 */

import { test, expect, type Locator, type Page } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'
import {
  createBand,
  deleteBand,
  deletePlaylistFromDetail,
  openNewPlaylistModal,
  openPlaylist,
  uniqueFixtureName,
} from './helpers'

test.use({ storageState: AUTH_STATE_PATH })

// A band created through the UI, four cold routes and a reload: allow more than
// the 30s default rather than report a cold compile as a product failure.
test.describe.configure({ timeout: 180_000 })

const OWNER_CUE = '#new-playlist-owner'

/** Puts the persisted context store on the band, as a returning session has it. */
async function enterBandContext(page: Page, band: { id: string; name: string }) {
  await page.evaluate(({ id, name }) => {
    localStorage.setItem(
      'band-context',
      JSON.stringify({ state: { context: { type: 'band', id, name } }, version: 0 }),
    )
  }, band)
}

const bandSection = (page: Page, bandName: string) =>
  page.locator(`section[aria-label="Band: ${bandName}"]`)

const personalSection = (page: Page) => page.locator('section[aria-label="My playlists"]')

const card = (scope: Locator, name: string) =>
  scope.getByRole('button', { name: `Open ${name}`, exact: true })

/** Types `name` into the open modal, presses Create and waits for it to close. */
async function submitNewPlaylist(page: Page, name: string) {
  const modal = page.getByRole('dialog', { name: 'New Playlist' })
  await modal.locator('#modal-playlist-name').fill(name)
  await modal.getByRole('button', { name: 'Create' }).click()
  await expect(modal).toHaveCount(0, { timeout: 15_000 })
}

test('+ New Playlist creates for the active band, and for the user in personal context', async ({
  page,
}) => {
  const band = await createBand(page, 'E2E Band Playlist Context')
  await enterBandContext(page, band)

  // Band context: the indicator proves the persisted band survived reconciliation.
  await page.goto('/playlists')
  const indicator = page.getByTestId('band-indicator')
  await expect(indicator).toBeVisible({ timeout: 30_000 })
  await expect(indicator).toContainText(band.name)

  const bandModal = await openNewPlaylistModal(page)
  await expect(bandModal.locator(OWNER_CUE)).toContainText(`Band playlist for ${band.name}`)
  await expect(bandModal).toHaveAccessibleDescription(`Band playlist for ${band.name}`)

  const bandPlaylist = uniqueFixtureName('E2E Band Context Playlist')
  await submitNewPlaylist(page, bandPlaylist)

  await expect(card(bandSection(page, band.name), bandPlaylist)).toBeVisible({ timeout: 15_000 })
  await expect(card(personalSection(page), bandPlaylist)).toHaveCount(0)

  await page.reload()
  await expect(card(bandSection(page, band.name), bandPlaylist)).toBeVisible({ timeout: 30_000 })
  await expect(card(personalSection(page), bandPlaylist)).toHaveCount(0)

  // Personal context: Exit goes home; the dialog no longer names an owner.
  await expect(indicator).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('band-indicator-exit').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(indicator).toHaveCount(0)

  await page.goto('/playlists')
  const personalModal = await openNewPlaylistModal(page)
  await expect(personalModal.locator(OWNER_CUE)).toHaveCount(0)

  const personalPlaylist = uniqueFixtureName('E2E Personal Context Playlist')
  await submitNewPlaylist(page, personalPlaylist)

  await expect(card(personalSection(page), personalPlaylist)).toBeVisible({ timeout: 15_000 })
  await expect(card(bandSection(page, band.name), personalPlaylist)).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Open ${personalPlaylist}`, exact: true })).toHaveCount(1)

  // Teardown: the personal playlist through the UI, then the band, whose
  // playlist goes with it by cascade.
  await openPlaylist(page, personalPlaylist)
  await deletePlaylistFromDetail(page)
  await deleteBand(page, band.url)
})
