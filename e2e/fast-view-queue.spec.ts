/**
 * RH-109 — the Fast View is addressed by version and walks a queue, end to end.
 *
 * RH-132 (route by version), RH-133 (the `sessionStorage` song queue replaces
 * the old URL back-link) and RH-134 (the previous/current/next window and its write
 * invalidation) each have unit coverage; this file is the one place that walks
 * the three **together** against the real server: open the middle song of a
 * three-song playlist, move along the queue by key and by swipe, reload, open
 * the same address in a fresh tab, edit and revisit, lose a repertoire row
 * mid-queue, and name a band in the URL.
 *
 * The offline half of the same walk lives in `e2e/offline-mode.spec.ts`, which
 * is the only spec that has a production build and a service worker.
 *
 * One journey through one fixture, built in the first test (the e2e database is
 * never reset, so every name is minted inside a test body with
 * `uniqueFixtureName`, never at module scope).
 *
 * Viewport: the default desktop one, so the sidebar's `2 / 3` counter is the
 * visible chrome. The mobile strip (`SwipeHint`) is in the DOM at the same time
 * and is asserted by text, which does not depend on visibility.
 */

import { test, expect, type Page } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'
import {
  addSong,
  createPlaylist,
  deleteSong,
  goHome,
  openPlaylist,
  uniqueFixtureName,
  waitForPlaylistDetailHydrated,
} from './helpers'

test.use({ storageState: AUTH_STATE_PATH })

// Serial: each test builds on the state the previous one left. The raised
// timeout is the cold route compile, as in the other Fast View specs.
test.describe.configure({ mode: 'serial', timeout: 120_000 })

// ---------------------------------------------------------------------------
// Fixture state — assigned inside the first test body, never here
// ---------------------------------------------------------------------------

const titles: string[] = []
let playlistName = ''
let playlistUrl = ''
/** `/songs/<versionId>/fast-view` of each song, read from the playlist rows. */
const fastViewPaths: string[] = []

const FAST_VIEW_PATH = /^\/songs\/[0-9a-f-]{36}\/fast-view$/

// ---------------------------------------------------------------------------
// Locators and gestures
// ---------------------------------------------------------------------------

const songList = (page: Page) => page.getByRole('region', { name: 'Songs in this playlist' })
const songRow = (page: Page, title: string) =>
  songList(page).getByRole('listitem').filter({ hasText: title })

/** The desktop setlist column; its counter is the position indicator. */
const sidebar = (page: Page) => page.getByRole('complementary')

async function addSongToOpenPlaylist(page: Page, title: string) {
  const pickerToggle = page.getByRole('button', { name: 'Add songs' })
  const pickerInput = page.getByPlaceholder('Search catalog and Spotify')

  await pickerToggle.click()
  await expect(pickerInput).toBeVisible()
  await pickerInput.fill(title)

  const pickerRow = page.locator('ul[aria-live="polite"]').getByRole('listitem').filter({ hasText: title })
  await expect(pickerRow).toBeVisible({ timeout: 20_000 })
  await pickerRow.getByRole('button', { name: 'Add', exact: true }).click()
  // The row appears in the list once the add has landed.
  await expect(songRow(page, title)).toBeVisible({ timeout: 15_000 })

  await pickerToggle.click()
  await expect(pickerInput).toHaveCount(0)
}

/** Reopens the playlist, hydrated, so a row click writes the queue. */
async function reopenPlaylist(page: Page) {
  await page.goto(playlistUrl)
  await expect(page.getByRole('heading', { name: playlistName })).toBeVisible({ timeout: 15_000 })
  await waitForPlaylistDetailHydrated(page)
}

/** Opens a song the way a musician does: by clicking its playlist row. */
async function openFromPlaylist(page: Page, title: string) {
  await songRow(page, title).getByRole('link').click()
  await expectOnSong(page, title)
}

/** The Fast View is showing `title` and has finished hydrating the setlist. */
async function expectOnSong(page: Page, title: string) {
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 30_000 })
}

/** The address is `/songs/<versionId>/fast-view`, with no query at all. */
function expectBareFastViewAddress(page: Page) {
  const url = new URL(page.url())
  expect(url.pathname).toMatch(FAST_VIEW_PATH)
  expect(url.search).toBe('')
}

/**
 * A horizontal swipe: `dx < 0` is a finger moving left (next song), `dx > 0`
 * right (previous). Dispatched as real `TouchEvent`s on the `<main>` that owns
 * the handlers, because the Fast View reads `touches[0].clientX` and
 * `changedTouches[0].clientX` and nothing else.
 */
async function swipe(page: Page, dx: number) {
  await page.locator('main').evaluate((main, delta) => {
    const touch = (clientX: number) =>
      new Touch({ identifier: 1, target: main, clientX, clientY: 200 })
    const startX = 300
    const endX = startX + delta
    main.dispatchEvent(
      new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true,
        touches: [touch(startX)],
        changedTouches: [touch(startX)],
      }),
    )
    main.dispatchEvent(
      new TouchEvent('touchend', {
        bubbles: true,
        cancelable: true,
        touches: [],
        changedTouches: [touch(endX)],
      }),
    )
  }, dx)
}

/** Waits for the slide-out push to land on `title`. */
async function expectArrivedAt(page: Page, title: string, position: string) {
  await expectOnSong(page, title)
  await expect(sidebar(page)).toContainText(position)
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

test('opens song 2 of 3 from a playlist and walks the queue by key and swipe', async ({ page }) => {
  titles.push(
    uniqueFixtureName('RH109 Song A'),
    uniqueFixtureName('RH109 Song B'),
    uniqueFixtureName('RH109 Song C'),
  )
  playlistName = uniqueFixtureName('RH109 Playlist')

  await goHome(page)
  for (const title of titles) await addSong(page, { title, artist: 'RH109 Artist' })
  await createPlaylist(page, playlistName)
  playlistUrl = await openPlaylist(page, playlistName)
  for (const title of titles) await addSongToOpenPlaylist(page, title)

  for (const title of titles) {
    const href = await songRow(page, title).getByRole('link').getAttribute('href')
    expect(href, 'a personal playlist row links to the bare version address').toMatch(FAST_VIEW_PATH)
    fastViewPaths.push(href as string)
  }

  await openFromPlaylist(page, titles[1])

  // Position 2 of 3, at the version address, with no back-link param (or any query).
  await expect(sidebar(page)).toContainText('2 / 3')
  expectBareFastViewAddress(page)
  expect(new URL(page.url()).pathname).toBe(fastViewPaths[1])
  expect(page.url()).not.toContain('returnTo')

  // Mid-queue both neighbours exist.
  await expect(page.getByRole('button', { name: 'Previous song' })).toBeVisible()
  await expect(page.getByText('← prev')).toHaveCount(1)
  await expect(page.getByText('next →')).toHaveCount(1)

  // Arrow key to song 1: it is the start, so there is no prev.
  await page.keyboard.press('ArrowLeft')
  await expectArrivedAt(page, titles[0], '1 / 3')
  expect(new URL(page.url()).pathname).toBe(fastViewPaths[0])
  await expect(page.getByRole('button', { name: 'Previous song' })).toHaveCount(0)
  await expect(page.getByText('← prev')).toHaveCount(0)
  await expect(page.getByText('next →')).toHaveCount(1)

  // No wraparound at the start: another ArrowLeft stays put.
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(800)
  expect(new URL(page.url()).pathname).toBe(fastViewPaths[0])
  await expect(sidebar(page)).toContainText('1 / 3')

  // Swipe left (finger moves left) goes forward, to song 2, then to song 3.
  await swipe(page, -200)
  await expectArrivedAt(page, titles[1], '2 / 3')
  await swipe(page, -200)
  await expectArrivedAt(page, titles[2], '3 / 3')
  expect(new URL(page.url()).pathname).toBe(fastViewPaths[2])
  expectBareFastViewAddress(page)

  // The end: no next, and neither key nor swipe wraps around.
  await expect(page.getByText('next →')).toHaveCount(0)
  await expect(page.getByText('← prev')).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  await swipe(page, -200)
  await page.waitForTimeout(800)
  expect(new URL(page.url()).pathname).toBe(fastViewPaths[2])
  await expect(sidebar(page)).toContainText('3 / 3')

  // Swipe right goes back, to song 2.
  await swipe(page, 200)
  await expectArrivedAt(page, titles[1], '2 / 3')
})

test('keeps the chrome across a reload, drops it in a fresh tab, and Back returns to the playlist', async ({
  page,
  context,
}) => {
  await reopenPlaylist(page)
  await openFromPlaylist(page, titles[1])
  await expect(sidebar(page)).toContainText('2 / 3')

  // A reload keeps the tab's sessionStorage, so the setlist is still there.
  await page.reload()
  await expectOnSong(page, titles[1])
  await expect(sidebar(page)).toContainText('2 / 3')
  expectBareFastViewAddress(page)

  // A new tab on the very same address has its own sessionStorage: a song
  // opened alone, with no setlist chrome at all.
  const fresh = await context.newPage()
  await fresh.goto(page.url())
  await expectOnSong(fresh, titles[1])
  // Hydrated once the lyrics control is live (the chrome would appear with it).
  await expect(fresh.getByRole('region', { name: 'Lyrics' }).getByRole('button', { name: /^(Edit|Add)$/ })).toBeEnabled()
  await expect(fresh.getByRole('complementary')).toHaveCount(0)
  await expect(fresh.getByRole('button', { name: /^Setlist/ })).toHaveCount(0)
  await fresh.close()

  // Back goes to the origin the queue recorded, not through history.
  await page.getByRole('button', { name: 'Back' }).click()
  await page.waitForURL(playlistUrl, { timeout: 15_000 })
})

test('shows the edited lyrics, never the old text, after walking away and back', async ({ page }) => {
  await reopenPlaylist(page)
  await openFromPlaylist(page, titles[1])
  await expect(sidebar(page)).toContainText('2 / 3')

  const lyrics = page.getByRole('region', { name: 'Lyrics' })
  const oldText = 'No lyrics added yet.'
  const newText = `RH109 edited lyrics ${Date.now()}`
  await expect(lyrics).toContainText(oldText)

  await lyrics.getByRole('button', { name: 'Add' }).click()
  await lyrics.getByPlaceholder('Paste or type the lyrics here...').fill(newText)
  await lyrics.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(lyrics).toContainText(newText)

  // Away to song 3 and back to song 2, through the real queue controls.
  await page.keyboard.press('ArrowRight')
  await expectArrivedAt(page, titles[2], '3 / 3')
  await page.keyboard.press('ArrowLeft')
  await expectArrivedAt(page, titles[1], '2 / 3')

  await expect(lyrics).toContainText(newText)
  await expect(lyrics).not.toContainText(oldText)
})

test('a queue entry with no repertoire row stays in the queue and renders at defaults', async ({ page }) => {
  // Song 2 leaves the repertoire; its playlist entry stays (RH-125).
  await goHome(page)
  await deleteSong(page, titles[1])
  await expect(page.getByRole('article').or(page.getByRole('listitem')).filter({ hasText: titles[1] })).toHaveCount(0)

  await reopenPlaylist(page)
  await openFromPlaylist(page, titles[0])
  await expect(sidebar(page)).toContainText('1 / 3')

  // Walk into the entry that has no row: the chrome must not vanish.
  await page.keyboard.press('ArrowRight')
  await expectArrivedAt(page, titles[1], '2 / 3')
  expectBareFastViewAddress(page)
  // The entry is the current row of the setlist (a queue entry carries no
  // repertoire field, so the "Not in repertoire" chip is not drawn here).
  await expect(sidebar(page).getByRole('button', { name: new RegExp(`${titles[1]}.*NOW`) })).toBeVisible()

  // Version defaults: the lyrics the owner row had written are gone with it.
  const lyrics = page.getByRole('region', { name: 'Lyrics' })
  await expect(lyrics).toContainText('No lyrics added yet.')
  await expect(lyrics).not.toContainText('RH109 edited lyrics')

  // And the queue is still walkable past it.
  await page.keyboard.press('ArrowRight')
  await expectArrivedAt(page, titles[2], '3 / 3')
})

test('?bandId= in the URL wins over the queue owner when the walk pushes', async ({ page }) => {
  // A real band the signed-in user belongs to, so the URL names a legitimate owner.
  const bandName = uniqueFixtureName('RH109 Band')
  await page.goto('/bands')
  const newBandButton = page.getByRole('button', { name: '+ New Band' })
  const nameInput = page.getByPlaceholder('The Rolling Stones')
  await expect(newBandButton).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    await newBandButton.click()
    await expect(nameInput).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await nameInput.fill(bandName)
  await page.getByRole('button', { name: 'Create Band' }).click()
  await page.waitForURL(/\/bands\/[^/]+$/, { timeout: 15_000 })
  const bandId = page.url().split('/').pop() as string

  try {
    // The queue is built by the personal playlist, so its recorded owner is personal.
    await reopenPlaylist(page)
    await openFromPlaylist(page, titles[0])
    await expect(sidebar(page)).toContainText('1 / 3')

    // The same address, now naming the band: the URL is the owner the page reads.
    await page.goto(`${fastViewPaths[0]}?bandId=${bandId}`)
    await expectOnSong(page, titles[0])
    await expect(sidebar(page)).toContainText('1 / 3')

    await page.keyboard.press('ArrowRight')
    await page.waitForURL(`**${fastViewPaths[1]}?bandId=${bandId}`, { timeout: 15_000 })
  } finally {
    // Leave no band behind.
    await page.goto(`/bands/${bandId}`)
    await page.getByTitle('Delete band').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
    await page.waitForURL(/\/bands$/, { timeout: 15_000 })
  }
})
