/**
 * RH-66 — the characterization net for `/playlists/[id]`.
 *
 * `src/app/playlists/[id]/page.tsx` is 1343 lines of UI with nothing under it,
 * and RH-67..RH-71 are about to move almost all of it into
 * `src/components/playlists/` and `src/hooks/`. A behaviour-preserving move with
 * no test is a rewrite, so this file drives the page through the ten behaviours
 * those five parts touch: opening a playlist, adding a catalog song through the
 * picker, removing one, cycling a mastery status, adding and removing a song
 * tag, adding a playlist tag, renaming inline, and both filters.
 *
 * Nothing here reaches for a `data-testid`: every locator is an accessible name
 * or a placeholder the page already carried before this file existed. That is
 * deliberate — those names are the contract parts 2-6 must keep alive when the
 * markup moves.
 *
 * Idempotency, RH-44 style: every fixture name is minted inside the first test
 * body with `uniqueFixtureName`, never at module scope (a retry runs in the same
 * worker process, so an import-time suffix would repeat), and the last test is
 * the teardown. A green run therefore leaves no playlist and no repertoire row
 * behind and can be repeated back to back against the same database. A run that
 * dies in the middle skips the teardown and leaks one playlist named after that
 * run — harmless by construction, and better than a best-effort `afterAll` that
 * turns a real product failure into a cleanup error.
 */

import { test, expect, type Page } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'
import {
  addSong,
  createPlaylist,
  deletePlaylistFromDetail,
  deleteSong,
  goHome,
  openPlaylist,
  uniqueFixtureName,
} from './helpers'

test.use({ storageState: AUTH_STATE_PATH })

// One journey through one fixture: each test builds on the state the previous
// one left in the database, so a failure must stop the group rather than report
// nine more failures with the same cause. The raised *test* timeout is for the
// same reason `bands-confirm.spec.ts` raises it — the first hit on a route pays
// the bundler's compile.
test.describe.configure({ mode: 'serial', timeout: 90_000 })

// ---------------------------------------------------------------------------
// Fixture state — every one of these is assigned inside a test body, never here
// ---------------------------------------------------------------------------

let songOneTitle = ''
let songTwoTitle = ''
let playlistName = ''
let playlistUrl = ''
let songTag = ''
let playlistTag = ''

/**
 * `handleAddSongTag` and `handleAddPlaylistTag` both lowercase what they store,
 * so a fixture tag is minted lowercase and hyphenated to make the string that
 * goes in the one that comes back out.
 */
function uniqueTag(prefix: string): string {
  return uniqueFixtureName(prefix).toLowerCase().replace(/\s+/g, '-')
}

// ---------------------------------------------------------------------------
// Locators for this one page. They stay here rather than in helpers.ts, which
// is shared by every spec.
// ---------------------------------------------------------------------------

/** The song list — `<section aria-label="Songs in this playlist">`. */
const songList = (page: Page) => page.getByRole('region', { name: 'Songs in this playlist' })

/** One row of that list, identified by the song title it renders. */
const songRow = (page: Page, title: string) =>
  songList(page).getByRole('listitem').filter({ hasText: title })

/** One row of the add-song picker's result list. */
const pickerRow = (page: Page, title: string) =>
  page.locator('ul[aria-live="polite"]').getByRole('listitem').filter({ hasText: title })

/**
 * The playlist-level tag bar, scoped through the one control only it carries.
 * `Remove tag <tag>` exists in the song rows too, so both uses are scoped.
 */
const playlistTagBar = (page: Page) =>
  page.getByRole('button', { name: 'Add tag to playlist' }).locator('xpath=..')

/**
 * Reopens the detail route, so every behaviour below is verified against a
 * freshly loaded page rather than against state an earlier test left in the DOM
 * — which is what makes this file useful to RH-71, where the page starts
 * loading differently.
 *
 * The route renders a loading state until its data resolves and the first hit
 * pays a bundler compile, so the first assertion after the navigation carries
 * 15 s, the value `server-pages.spec.ts` already uses for the same reason;
 * `playwright.config.ts` keeps the assertion default at 5 s.
 */
async function reopenPlaylist(page: Page) {
  await page.goto(playlistUrl)
  await expect(page.getByRole('heading', { name: playlistName })).toBeVisible({ timeout: 15_000 })
}

/**
 * Resolves when the next Server Action this page posts comes back.
 *
 * `handleStatusCycle`, `handleAddSongTag`, `handleRemoveSongTag` and
 * `handleTagsChange` all write their optimistic state *before* awaiting the
 * server, so the chip appearing (or the badge flipping, or the chip vanishing)
 * proves nothing about persistence, and a `page.reload()` fired straight after
 * it races the write still in flight — the browser tears the request down and
 * the reloaded page shows the pre-write row. Next.js posts a Server Action to
 * the URL of the page that called it, so a POST to `playlistUrl` is that write
 * landing.
 *
 * Call this *before* the interaction that triggers the write, so the listener is
 * attached in time, and `await` the returned promise before reloading.
 */
function serverActionResponse(page: Page) {
  return page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().startsWith(playlistUrl),
  )
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

test('creates a playlist and opens it from the playlists page', async ({ page }) => {
  songOneTitle = uniqueFixtureName('RH66 Song A')
  songTwoTitle = uniqueFixtureName('RH66 Song B')
  playlistName = uniqueFixtureName('RH66 Playlist')

  // The picker searches the global catalog, so the fixture songs are seeded
  // through the home page the way a user would first meet them.
  await goHome(page)
  await addSong(page, { title: songOneTitle, artist: 'RH66 Artist' })
  await addSong(page, { title: songTwoTitle, artist: 'RH66 Artist' })

  await createPlaylist(page, playlistName)
  playlistUrl = await openPlaylist(page, playlistName)

  expect(playlistUrl).toMatch(/\/playlists\/[^/]+$/)
  await expect(page.getByRole('heading', { name: playlistName })).toBeVisible()
  await expect(page.getByText('No songs yet')).toBeVisible({ timeout: 15_000 })
})

test('adds two catalog songs to the playlist through the picker', async ({ page }) => {
  await reopenPlaylist(page)

  const pickerToggle = page.getByRole('button', { name: 'Add songs' })
  const pickerInput = page.getByPlaceholder('Search catalog and Spotify')

  await pickerToggle.click()
  await expect(pickerInput).toBeVisible()

  for (const title of [songOneTitle, songTwoTitle]) {
    await pickerInput.fill(title)
    // The picker debounces for 500 ms and then queries the catalog. That wait is
    // absorbed by the assertion timeout below, never by a sleep.
    const row = pickerRow(page, title)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(songRow(page, title)).toBeVisible({ timeout: 15_000 })
  }

  await pickerToggle.click()
  await expect(pickerInput).toHaveCount(0)
  await expect(songList(page).getByRole('listitem')).toHaveCount(2)

  // ...and the adds were persisted, not just applied to local state.
  await page.reload()
  await expect(songList(page).getByRole('listitem')).toHaveCount(2, { timeout: 15_000 })
})

test('cycles the mastery status of a playlist song', async ({ page }) => {
  await reopenPlaylist(page)

  const statusButton = (label: string) =>
    songRow(page, songOneTitle).getByRole('button', { name: label, exact: true })

  await expect(statusButton('Status: Unknown. Click to advance.')).toBeVisible({ timeout: 15_000 })

  // `handleStatusCycle` writes the optimistic state *before* awaiting
  // `updateSongStatus`, so the flip below proves nothing about persistence and a
  // reload fired straight after it would race the in-flight Server Action.
  const statusWrite = serverActionResponse(page)
  await statusButton('Status: Unknown. Click to advance.').click()
  await expect(statusButton('Status: Learning. Click to advance.')).toBeVisible()
  await statusWrite

  await page.reload()
  await expect(statusButton('Status: Learning. Click to advance.')).toBeVisible({ timeout: 15_000 })
})

test('adds a tag to a playlist song', async ({ page }) => {
  songTag = uniqueTag('rh66songtag')

  await reopenPlaylist(page)

  const row = songRow(page, songOneTitle)
  await expect(row).toBeVisible({ timeout: 15_000 })

  // `Add tag` is a prefix of `Add tag to playlist`, so this one is matched
  // exactly *and* scoped to its row.
  await row.getByRole('button', { name: 'Add tag', exact: true }).click()
  const tagInput = row.getByPlaceholder('new tag')
  await expect(tagInput).toBeVisible()
  await tagInput.fill(songTag)
  // `handleAddSongTag` is optimistic like `handleStatusCycle`: it puts the chip
  // in `repertoireMap` before it awaits `updateSongTags`.
  const tagWrite = serverActionResponse(page)
  await tagInput.press('Enter')

  await expect(row).toContainText(songTag)
  await expect(row.getByRole('button', { name: `Remove tag ${songTag}` })).toBeVisible()
  // The chip's only descendant button is `Remove tag <tag>`, so a button named
  // exactly the tag can only be the filter bar's.
  await expect(page.getByRole('button', { name: songTag, exact: true })).toBeVisible()

  await tagWrite
  await page.reload()
  const reloadedRow = songRow(page, songOneTitle)
  await expect(reloadedRow.getByRole('button', { name: `Remove tag ${songTag}` })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('button', { name: songTag, exact: true })).toBeVisible()
})

test('filters the playlist by title text', async ({ page }) => {
  await reopenPlaylist(page)
  await expect(songList(page).getByRole('listitem')).toHaveCount(2, { timeout: 15_000 })

  // The real placeholder ends in `...`; `getByPlaceholder` matches a substring.
  const filter = page.getByPlaceholder('Filter playlist by title or artist')

  await filter.fill(songOneTitle)
  await expect(songList(page).getByRole('listitem')).toHaveCount(1)
  await expect(songRow(page, songTwoTitle)).toHaveCount(0)

  const noMatch = `${songOneTitle} nothing-matches-this`
  await filter.fill(noMatch)
  await expect(songList(page).getByRole('listitem')).toHaveCount(0)
  await expect(page.getByText(`No songs matching "${noMatch}".`)).toBeVisible()

  await filter.fill('')
  await expect(songList(page).getByRole('listitem')).toHaveCount(2)
})

test('filters the playlist by tag', async ({ page }) => {
  await reopenPlaylist(page)
  await expect(songList(page).getByRole('listitem')).toHaveCount(2, { timeout: 15_000 })

  // The filter bar's clear control reads `× clear`; the name match is a substring.
  const clearFilter = page.getByRole('button', { name: 'clear' })

  await page.getByRole('button', { name: songTag, exact: true }).click()
  await expect(songList(page).getByRole('listitem')).toHaveCount(1)
  await expect(songRow(page, songOneTitle)).toBeVisible()
  await expect(clearFilter).toBeVisible()

  await clearFilter.click()
  await expect(songList(page).getByRole('listitem')).toHaveCount(2)
  await expect(clearFilter).toHaveCount(0)
})

test('removes the tag from the playlist song', async ({ page }) => {
  await reopenPlaylist(page)

  const row = songRow(page, songOneTitle)
  const removeTag = row.getByRole('button', { name: `Remove tag ${songTag}` })

  // The remove buttons are `opacity-0 group-hover:opacity-100`. Playwright
  // treats an `opacity: 0` element with a bounding box as visible and
  // clickable, so no hover step is needed.
  await expect(removeTag).toBeVisible({ timeout: 15_000 })
  // `handleRemoveSongTag` drops the chip from `repertoireMap` before it awaits
  // `updateSongTags`, so the reload below has to wait for the write, not the UI.
  const tagWrite = serverActionResponse(page)
  await removeTag.click()

  await expect(row).not.toContainText(songTag)
  await expect(row.getByRole('button', { name: `Remove tag ${songTag}` })).toHaveCount(0)
  await expect(page.getByRole('button', { name: songTag, exact: true })).toHaveCount(0)

  await tagWrite
  await page.reload()
  const reloadedRow = songRow(page, songOneTitle)
  await expect(reloadedRow).toBeVisible({ timeout: 15_000 })
  await expect(reloadedRow.getByRole('button', { name: `Remove tag ${songTag}` })).toHaveCount(0)
  await expect(page.getByRole('button', { name: songTag, exact: true })).toHaveCount(0)
})

test('adds a tag to the playlist itself', async ({ page }) => {
  playlistTag = uniqueTag('rh66playlisttag')

  await reopenPlaylist(page)

  // The `new tag` placeholder is shared by this input and the per-song one, and
  // both are conditionally rendered — so the order is click, then count, then
  // type. Asserted before the click the count would be 0; asserted after it, a
  // regression that leaves a song input open fails here instead of silently
  // typing into the wrong field.
  await page.getByRole('button', { name: 'Add tag to playlist' }).click()
  const tagInput = page.getByPlaceholder('new tag')
  await expect(tagInput).toHaveCount(1)
  await tagInput.fill(playlistTag)
  // `handleAddPlaylistTag` delegates to `handleTagsChange`, which sets
  // `playlist.tags` before it awaits `updatePlaylist` — optimistic again.
  const tagWrite = serverActionResponse(page)
  await tagInput.press('Enter')

  const chipRemove = playlistTagBar(page).getByRole('button', { name: `Remove tag ${playlistTag}` })
  await expect(chipRemove).toBeVisible()

  await tagWrite
  await page.reload()
  await expect(page.getByRole('heading', { name: playlistName })).toBeVisible({ timeout: 15_000 })
  await expect(
    playlistTagBar(page).getByRole('button', { name: `Remove tag ${playlistTag}` }),
  ).toBeVisible()
})

test('renames the playlist inline', async ({ page }) => {
  await reopenPlaylist(page)

  const renamedPlaylist = `${playlistName} Renamed`

  await page.getByRole('button', { name: 'Rename playlist' }).click()
  const nameBox = page.getByRole('textbox', { name: 'Playlist name' })
  await expect(nameBox).toBeVisible()
  await nameBox.fill(renamedPlaylist)
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(page.getByRole('heading', { name: renamedPlaylist })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: renamedPlaylist })).toBeVisible({ timeout: 15_000 })

  // So the teardown deletes the card the playlist now answers to.
  playlistName = renamedPlaylist
})

test('removes a song from the playlist', async ({ page }) => {
  await reopenPlaylist(page)
  await expect(songList(page).getByRole('listitem')).toHaveCount(2, { timeout: 15_000 })

  await songList(page)
    .getByRole('button', { name: `Remove ${songTwoTitle} from playlist` })
    .click()

  await expect(songList(page).getByRole('listitem')).toHaveCount(1)

  await page.reload()
  await expect(songList(page).getByRole('listitem')).toHaveCount(1, { timeout: 15_000 })
  await expect(songRow(page, songTwoTitle)).toHaveCount(0)
})

test('deletes the playlist and the seeded songs', async ({ page }) => {
  await reopenPlaylist(page)

  await deletePlaylistFromDetail(page)
  // First assertion after a navigation, so it carries the file's 15 s: the
  // redirect lands on `/playlists`, which renders every playlist this database
  // holds — including any leaked by a run that died before reaching here.
  await expect(page.getByRole('button', { name: `Open ${playlistName}` })).toHaveCount(0, {
    timeout: 15_000,
  })

  await goHome(page)
  const homeUrl = page.url()
  const search = page.locator('#search-input')

  /**
   * Asserts that `title` has left the repertoire, on a home page freshly loaded
   * for the purpose.
   *
   * The list the home page renders is a client store filled by the
   * `getRepertoire` Server Action, and the mount effect fires that action twice
   * under React's dev-mode double invoke. Both requests are issued before the
   * delete, so whichever resolves *last* wins — and with a few hundred rows in
   * this database the slow one can land after the delete and put the row back
   * in the store, where it then stays, because nothing reloads the list again.
   * Reloading first sidesteps that: every request the new page makes is issued
   * after the delete, so both answers agree.
   *
   * Awaiting that load's own response — the `serverActionResponse` doctrine the
   * tag tests above use, aimed at the home route this time — is what keeps the
   * assertion honest. Without it, `toHaveCount(0)` is satisfied by the empty
   * list this page server-renders *before* it has fetched anything.
   *
   * The assertion is on the button rather than on `songCard`: the deleted song
   * stays in the global catalog, so the filtered page still shows its "Add to
   * your repertoire" card and `songCard` would match that `<li>` too. Only a
   * repertoire row carries `Delete <title>`. Filtering rather than reading the
   * whole list also bounds the wait no matter how many rows a run that died
   * before this teardown left behind.
   */
  async function expectSongRemoved(title: string) {
    const repertoireLoad = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url() === homeUrl,
      { timeout: 30_000 },
    )
    await goHome(page)
    await repertoireLoad

    await search.fill(title)
    await expect(
      page.getByRole('button', { name: new RegExp(`Delete ${title}`, 'i') }),
    ).toHaveCount(0, { timeout: 15_000 })
  }

  for (const title of [songOneTitle, songTwoTitle]) {
    await deleteSong(page, title)
    await expectSongRemoved(title)
  }
})
