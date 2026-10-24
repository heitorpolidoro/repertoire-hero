/**
 * RH-183 — the song titles of `/playlists/[id]` at a phone width.
 *
 * This file is run ONLY by the `mobile` project in playwright.config.ts (Pixel 5
 * emulation, narrowed here to the 375 × 812 viewport the task names); the
 * desktop `chromium` project ignores it.
 *
 * Before RH-183 a playlist song row was one flex line: the status notes, the
 * RH-158 "Practised" button, the duration and the remove button were all
 * `shrink-0` and took ~309px of the row's 317px, so the title collapsed to zero
 * width. The row now puts the status notes and "Practised" on a second line
 * below `sm`, and this file is the regression net for that: every title keeps a
 * visible, non-zero box, a 100-character title truncates with an ellipsis
 * without touching any control, and the controls stay clickable — in personal
 * and in band context.
 *
 * The band playlist and its two entries are the one fixture seeded straight
 * into the database (see `insertBandPlaylist` for why the UI cannot make it);
 * every other step goes through the UI.
 *
 * Idempotency, RH-44 / RH-66 style: every fixture name is minted inside a test
 * body with `uniqueFixtureName`, and the last test is the teardown (both
 * playlists, the band and the seeded songs).
 */

import { test, expect, type Locator, type Page } from '@playwright/test'
import { Client } from 'pg'
import { AUTH_STATE_PATH } from './global-setup'
import {
  addSong,
  createPlaylist,
  deletePlaylistFromDetail,
  deleteSong,
  goHome,
  openPlaylist,
  runPlaylistMenuAction,
  uniqueFixtureName,
  waitForPlaylistDetailHydrated,
} from './helpers'

test.use({ storageState: AUTH_STATE_PATH, viewport: { width: 375, height: 812 } })

// One journey through one fixture: the band test reuses the songs the personal
// test seeded and the teardown removes what both created, so a failure stops
// the group. Several cold routes plus UI-created fixtures: allow more than the
// 30s default rather than report a cold compile as a product failure.
test.describe.configure({ mode: 'serial', timeout: 180_000 })

// ---------------------------------------------------------------------------
// Fixture state — every one of these is assigned inside a test body, never here
// ---------------------------------------------------------------------------

let shortTitle = ''
let longTitle = ''
let personalPlaylistUrl = ''
let bandPlaylistUrl = ''
let bandUrl = ''

const LONG_TITLE_LENGTH = 100

type Box = { x: number; y: number; width: number; height: number }

// ---------------------------------------------------------------------------
// Locators and helpers for this one file
// ---------------------------------------------------------------------------

/** The song list — `<section aria-label="Songs in this playlist">`. */
const songList = (page: Page) => page.getByRole('region', { name: 'Songs in this playlist' })

/** One row of that list, identified by the song title it renders. */
const songRow = (page: Page, title: string) =>
  songList(page).getByRole('listitem').filter({ hasText: title })

/** The title line of a row — the `<p>` whose whole text is the title. */
const rowTitle = (page: Page, title: string) =>
  songRow(page, title).getByText(title, { exact: true })

/** One row of the add-song picker's result list. */
const pickerRow = (page: Page, title: string) =>
  page.locator('ul[aria-live="polite"]').getByRole('listitem').filter({ hasText: title })

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

async function boxOf(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox()
  expect(box, `${what} has a bounding box`).not.toBeNull()
  return box!
}

/**
 * Hides Next's dev overlay (`<nextjs-portal>`) for the current document, as
 * band-indicator-mobile.spec.ts does: under `npm run dev` it floats over the
 * page at a phone width and would fail a trial click on a dev-only element that
 * never ships. Every app element stays as rendered.
 */
async function hideNextDevOverlay(page: Page) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
}

/**
 * Adds each catalog song to the open playlist through the picker, then closes
 * it. The picker is toggled by the header menu's `Add songs` item (RH-172).
 */
async function addThroughPicker(page: Page, titles: string[]) {
  const pickerInput = page.getByPlaceholder('Search catalog and Spotify')

  await runPlaylistMenuAction(page, 'Add songs')
  await expect(pickerInput).toBeVisible()

  for (const title of titles) {
    await pickerInput.fill(title)
    // The picker debounces for 500 ms before it queries the catalog; the
    // assertion timeout absorbs that, never a sleep.
    const row = pickerRow(page, title)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(songRow(page, title)).toHaveCount(1, { timeout: 15_000 })
  }

  await runPlaylistMenuAction(page, 'Add songs')
  await expect(pickerInput).toHaveCount(0)
}

/** Reloads the detail page and waits until it is hydrated with `count` rows. */
async function reloadDetail(page: Page, count: number) {
  await page.reload()
  await waitForPlaylistDetailHydrated(page)
  await expect(songList(page).getByRole('listitem')).toHaveCount(count, { timeout: 15_000 })
}

/** Every title is visible, non-empty text with a non-zero box. */
async function expectTitlesVisible(page: Page, titles: string[]) {
  for (const title of titles) {
    const titleText = rowTitle(page, title)
    await expect(titleText, `title of ${title}`).toBeVisible()
    await expect(titleText).toHaveText(title)
    const box = await boxOf(titleText, `title of ${title}`)
    expect(box.width, `title width of ${title}`).toBeGreaterThan(0)
    expect(box.height, `title height of ${title}`).toBeGreaterThan(0)
  }
}

/** Creates a band through the UI and returns its id, name and detail URL. */
async function createBand(page: Page): Promise<{ id: string; name: string; url: string }> {
  const name = uniqueFixtureName('RH183 Band')
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

/**
 * The database the server under test writes to. CI's `E2E Tests (Playwright)`
 * job exports `DATABASE_URL`; a local run falls back to the documented default
 * (`.env.example`, `vitest.config.ts`).
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/**
 * Inserts a playlist owned by `bandId`, holding the one version of each of
 * `titles` in that order, and returns its id.
 *
 * This is the one fixture the UI cannot make today, for two reasons outside
 * RH-183's scope:
 * - `+ New Playlist` always creates a personal playlist
 *   (`createPlaylistAction` inserts `user_id` only); the only path that writes
 *   a `band_id` is a Spotify import, which no e2e run can reach.
 * - On a band playlist, the picker's catalog add calls `addToRepertoire`
 *   (`addSongAction(songId)`), which writes the *user's* repertoire, so a song
 *   the user already holds fails on `uq_user_songs_user_version`.
 * So the rows are seeded here; reading them and deleting the playlist go
 * through the UI as a band admin. The band holds no repertoire row for either
 * version, which the page renders as `unknown` — a normal band playlist entry.
 */
async function insertBandPlaylist(bandId: string, name: string, titles: string[]): Promise<string> {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    const playlist = await client.query<{ id: string }>(
      'INSERT INTO playlists (band_id, name) VALUES ($1, $2) RETURNING id',
      [bandId, name],
    )
    const playlistId = playlist.rows[0].id
    for (const [position, title] of titles.entries()) {
      const inserted = await client.query(
        `INSERT INTO playlist_songs (playlist_id, version_id, position)
         SELECT $1, sv.id, $3
           FROM song_versions sv
           JOIN songs s ON s.id = sv.song_id
          WHERE s.title = $2`,
        [playlistId, title, position],
      )
      expect(inserted.rowCount, `one version of ${title}`).toBe(1)
    }
    return playlistId
  } finally {
    await client.end()
  }
}

/**
 * Puts the persisted context store on the band, as a returning session has it
 * (band-indicator-mobile.spec.ts): at a phone width the context switcher lives
 * in the hidden sidebar.
 */
async function enterBandContext(page: Page, band: { id: string; name: string }) {
  await page.evaluate(({ id, name }) => {
    localStorage.setItem(
      'band-context',
      JSON.stringify({ state: { context: { type: 'band', id, name } }, version: 0 }),
    )
  }, band)
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

test('personal: every title keeps a visible box at 375px and the controls stay usable', async ({
  page,
  viewport,
}) => {
  expect(viewport?.width).toBe(375)

  shortTitle = uniqueFixtureName('RH183 Song')
  // No spaces in the padding, so nothing can be trimmed off the stored title.
  longTitle = uniqueFixtureName('RH183 Long').padEnd(LONG_TITLE_LENGTH, '-take')
  expect(longTitle).toHaveLength(LONG_TITLE_LENGTH)

  // The picker searches the global catalog, so the fixture songs are seeded
  // through the home page the way a user would first meet them.
  await goHome(page)
  await addSong(page, { title: shortTitle, artist: 'RH183 Artist' })
  await addSong(page, { title: longTitle, artist: 'RH183 Artist' })

  const playlistName = uniqueFixtureName('RH183 Playlist')
  await createPlaylist(page, playlistName)
  personalPlaylistUrl = await openPlaylist(page, playlistName)

  await addThroughPicker(page, [shortTitle, longTitle])
  await reloadDetail(page, 2)

  await expectTitlesVisible(page, [shortTitle, longTitle])

  // The long title: truncated with an ellipsis, and clear of every control.
  const row = songRow(page, longTitle)
  const titleText = rowTitle(page, longTitle)
  const truncation = await titleText.evaluate((el) => ({
    textOverflow: getComputedStyle(el).textOverflow,
    clipped: el.scrollWidth > el.clientWidth,
  }))
  expect(truncation.textOverflow).toBe('ellipsis')
  expect(truncation.clipped, 'the long title is actually clipped').toBe(true)

  const notes = row.getByRole('group', { name: 'Mastery status' })
  const practised = row.getByRole('button', { name: `Mark ${longTitle} as practised` })
  const remove = row.getByRole('button', { name: `Remove ${longTitle} from playlist` })
  for (const control of [notes, practised, remove]) {
    await expect(control).toHaveCount(1)
    await expect(control).toBeVisible()
  }

  const titleBox = await boxOf(titleText, 'long title')
  const notesBox = await boxOf(notes, 'status notes')
  const practisedBox = await boxOf(practised, 'Practised button')
  const removeBox = await boxOf(remove, 'remove button')
  expect(intersects(titleBox, notesBox), 'title overlaps the status notes').toBe(false)
  expect(intersects(titleBox, practisedBox), 'title overlaps Practised').toBe(false)
  expect(intersects(titleBox, removeBox), 'title overlaps the remove button').toBe(false)
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(removeBox.x)

  const overflow = await row.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(overflow.scrollWidth, 'the row overflows horizontally').toBeLessThanOrEqual(
    overflow.clientWidth,
  )

  // A trial click runs every actionability check - visible, stable, enabled
  // and not covered by another element - without acting.
  await hideNextDevOverlay(page)
  await remove.click({ trial: true })
  await practised.click({ trial: true })
  await notes.getByRole('button').first().click({ trial: true })
})

test('band: every title of a band playlist keeps a visible box at 375px', async ({
  page,
  viewport,
}) => {
  expect(viewport?.width).toBe(375)

  const band = await createBand(page)
  bandUrl = band.url
  await enterBandContext(page, band)

  const playlistName = uniqueFixtureName('RH183 Band Playlist')
  const playlistId = await insertBandPlaylist(band.id, playlistName, [shortTitle, longTitle])
  await page.goto(`/playlists/${playlistId}`)
  await expect(page.getByRole('heading', { name: playlistName })).toBeVisible({ timeout: 30_000 })
  await waitForPlaylistDetailHydrated(page)
  bandPlaylistUrl = page.url()
  // Still in band context after the navigation: the indicator says so.
  await expect(page.getByTestId('band-indicator')).toContainText(band.name)
  await expect(songList(page).getByRole('listitem')).toHaveCount(2, { timeout: 15_000 })

  // A band playlist renders its status read-only — proof this is the band's.
  await expect(
    songRow(page, shortTitle)
      .getByRole('group', { name: 'Mastery status' })
      .getByRole('button')
      .first(),
  ).toBeDisabled()

  await expectTitlesVisible(page, [shortTitle, longTitle])
})

test('deletes both playlists, the band and the seeded songs', async ({ page }) => {
  for (const url of [bandPlaylistUrl, personalPlaylistUrl]) {
    await page.goto(url)
    await waitForPlaylistDetailHydrated(page)
    await deletePlaylistFromDetail(page)
  }

  await page.goto(bandUrl)
  await page.getByTitle('Delete band').click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await page.waitForURL(/\/bands$/, { timeout: 15_000 })

  await goHome(page)
  for (const title of [shortTitle, longTitle]) {
    await deleteSong(page, title)
  }
})
