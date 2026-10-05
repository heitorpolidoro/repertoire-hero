/**
 * RH-80 — offline mode, end to end. **This is the acceptance test for the whole
 * offline feature** (RH-78 + RH-79 + RH-80), extended by RH-99 with the
 * read-only half: after the cold reload, every write control the document can
 * reach is asserted `disabled`.
 *
 * Nothing static can stand in for it: the claim is that a musician can download
 * a playlist, lose the network, *reload* the page, and still read the setlist,
 * the song and its chart. Without the reload the test proves only that a live
 * React tree kept working — cold start is the whole requirement.
 *
 * Production-only, exactly like `e2e/pwa-shell.spec.ts` (RH-78) and for the
 * same reason: `public/sw.js` is emitted by the `serwist build` stage of
 * `npm run build`, and `ServiceWorkerRegistrar` only registers when
 * `NODE_ENV === 'production'`. CI runs `npm run test:e2e` with neither
 * `E2E_PROD` nor `PLAYWRIGHT_WEB_SERVER`, so CI's outcome set is unchanged.
 *
 * Run it with:
 *
 *   npm run build && E2E_PROD=1 BETTER_AUTH_SECRET=<any non-empty value> \
 *     PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" \
 *     npx playwright test e2e/offline-mode.spec.ts --project=chromium
 *
 * `BETTER_AUTH_SECRET` must be exported in the shell: `.env.production.local`
 * carries an empty one that shadows `.env.local` under `next start`. Never edit
 * an `.env` file to work around that.
 *
 * **A run that reports either test as *skipped* is a configuration failure, not
 * a pass.**
 */

import { test, expect, type Page } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'
import { addSong, createPlaylist, goHome, openPlaylist, songCard, uniqueFixtureName } from './helpers'
import { OFFLINE_SCHEMA_VERSION } from '../src/lib/offlineSnapshot'
import type { OfflineSnapshotRecord } from '../src/lib/offlineStore'

test.use({ storageState: AUTH_STATE_PATH })

// Serial and generous: each test builds one playlist through the real UI, and
// the first hit on a route pays a cold server render.
test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.skip(
  !process.env.E2E_PROD,
  'Needs a production build: set E2E_PROD=1, BETTER_AUTH_SECRET and PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1".',
)

/**
 * Waits until the emitted worker is `activated` *and* controls this page.
 * Copied in shape from `e2e/pwa-shell.spec.ts`: precaching happens during
 * `install`, so an active worker means the manifest is already stored, and
 * `clientsClaim: true` is what makes the control part happen without a reload.
 */
async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration('/')
      return registration?.active?.state === 'activated'
    },
    undefined,
    { timeout: 30_000 },
  )
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, {
    timeout: 30_000,
  })
}

/** The Fast View URL the playlist row itself links to, so the ids are real. */
async function fastViewUrlFromPlaylist(page: Page, title: string): Promise<string> {
  const row = page
    .getByRole('region', { name: 'Songs in this playlist' })
    .getByRole('listitem')
    .filter({ hasText: title })
  await expect(row).toBeVisible({ timeout: 15_000 })
  const href = await row.locator('a[href*="/fast-view"]').first().getAttribute('href')
  expect(href, 'the playlist row must link to the Fast View').toBeTruthy()
  return href as string
}

/** The Fast View URL a home-page song card links to. */
async function fastViewUrlFromCard(page: Page, title: string): Promise<string> {
  const card = songCard(page, title)
  await expect(card).toBeVisible({ timeout: 15_000 })
  const href = await card.locator('a[href*="fast-view"]').first().getAttribute('href')
  expect(href, 'the song card must link to the Fast View').toBeTruthy()
  return href as string
}

/** Adds one catalog song to the open playlist through the real picker. */
async function addSongToOpenPlaylist(page: Page, title: string) {
  const pickerToggle = page.getByRole('button', { name: 'Add songs' })
  const pickerInput = page.getByPlaceholder('Search catalog and Spotify')

  await pickerToggle.click()
  await expect(pickerInput).toBeVisible()
  await pickerInput.fill(title)

  const pickerRow = page.locator('ul[aria-live="polite"]').getByRole('listitem').filter({ hasText: title })
  await expect(pickerRow).toBeVisible({ timeout: 20_000 })
  await pickerRow.getByRole('button', { name: 'Add', exact: true }).click()

  await pickerToggle.click()
  await expect(pickerInput).toHaveCount(0)
}

/** Clicks the real `Available offline` control and waits for the stored state. */
async function downloadPlaylist(page: Page) {
  await page.getByRole('button', { name: 'Available offline' }).click()
  // The downloaded state is the only one carrying these two affordances.
  await expect(page.getByRole('button', { name: 'Refresh offline copy' })).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByRole('button', { name: 'Remove offline copy' })).toBeVisible()
}

test('reads a downloaded playlist after a cold reload with no network', async ({ page, context }) => {
  const songTitle = uniqueFixtureName('RH80 Song')
  // A second song, deliberately left out of the playlist: it is what ER5's
  // "in no downloaded snapshot" state is asserted against.
  const strandedTitle = uniqueFixtureName('RH80 Stranded')
  const playlistName = uniqueFixtureName('RH80 Playlist')

  await goHome(page)
  await addSong(page, { title: songTitle, artist: 'RH80 Artist' })
  await addSong(page, { title: strandedTitle, artist: 'RH80 Artist' })
  const strandedUrl = await fastViewUrlFromCard(page, strandedTitle)
  await createPlaylist(page, playlistName)
  await openPlaylist(page, playlistName)
  await addSongToOpenPlaylist(page, songTitle)

  await waitForServiceWorker(page)
  await downloadPlaylist(page)

  const fastViewUrl = await fastViewUrlFromPlaylist(page, songTitle)

  // Both pages are opened online first. The worker stores the Fast View
  // *document* per URL (`src/app/sw.ts`), so this is what makes the reload
  // below a genuine cold start rather than a `/offline` shell — and it is the
  // honest shape of the shipped feature, not a trick: a document that was never
  // fetched online cannot be replayed offline.
  await page.goto(strandedUrl)
  await expect(page.getByRole('heading', { level: 1, name: strandedTitle })).toBeVisible({
    timeout: 20_000,
  })

  await page.goto(fastViewUrl)
  await expect(page.getByRole('heading', { level: 1, name: songTitle })).toBeVisible({
    timeout: 20_000,
  })
  // ER3's other half: online there is no banner at all.
  await expect(page.getByTestId('offline-read-only-banner')).toHaveCount(0)

  await context.setOffline(true)
  await page.reload()

  // The setlist came from the snapshot, not from the network.
  await expect(page.getByRole('heading', { level: 1, name: songTitle })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByTestId('offline-read-only-banner')).toBeVisible()

  // The setlist itself is snapshot data: the playlist name and the song's
  // position come from `getPlaylistDetailsWithEntries`, answered offline.
  const setlist = page.getByRole('complementary')
  await expect(setlist.getByRole('heading', { name: playlistName })).toBeVisible()
  await expect(setlist.getByRole('button', { name: new RegExp(songTitle) })).toBeVisible()

  // ER4 — both edit controls are refused, not merely failing.
  const statusTrigger = page
    .getByRole('region', { name: 'Song details' })
    .getByRole('button')
    .first()
  await expect(statusTrigger).toBeDisabled()
  const lyricsEdit = page
    .getByRole('region', { name: 'Lyrics' })
    .getByRole('button', { name: /^(Edit|Add)$/ })
  await expect(lyricsEdit).toBeDisabled()

  // ER5 — a real song that is in no downloaded playlist says exactly that,
  // rather than the misleading "Song not found".
  await page.goto(strandedUrl)
  await expect(page.getByTestId('offline-unavailable')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Song not found')).toHaveCount(0)

  await context.setOffline(false)
})

test('renders a downloaded chart from the worker cache and never the gview iframe', async ({
  page,
  context,
}) => {
  const songTitle = uniqueFixtureName('RH80 Tab Song')
  const playlistName = uniqueFixtureName('RH80 Tab Playlist')

  await goHome(page)
  await addSong(page, { title: songTitle, artist: 'RH80 Artist' })
  await createPlaylist(page, playlistName)
  const playlistUrl = await openPlaylist(page, playlistName)
  await addSongToOpenPlaylist(page, songTitle)
  await waitForServiceWorker(page)

  const fastViewUrl = await fastViewUrlFromPlaylist(page, songTitle)
  const repertoireId = fastViewUrl.split('/')[2]
  const playlistId = playlistUrl.split('/').pop() as string

  await page.goto(fastViewUrl)
  await expect(page.getByRole('heading', { level: 1, name: songTitle })).toBeVisible({
    timeout: 20_000,
  })

  // The snapshot is seeded rather than downloaded here: attaching a real tab
  // needs a Vercel Blob token this suite does not have, and the worker route
  // under test (`/__offline-tab/**`, CacheOnly) is indifferent to which of the
  // two wrote the bytes. `schemaVersion` mirrors the running app's — a wrong
  // one makes `readOfflineSnapshot` answer `null`, and the failure would read
  // as "not downloaded" rather than as a bad seed.
  const tabId = '11111111-1111-1111-1111-111111111111'
  const cacheKey = `/__offline-tab/${playlistId}/${tabId}`
  const record: OfflineSnapshotRecord = {
    playlistId,
    playlistName,
    savedAt: new Date().toISOString(),
    bytes: 1024,
    schemaVersion: OFFLINE_SCHEMA_VERSION,
    snapshot: {
      schemaVersion: OFFLINE_SCHEMA_VERSION,
      playlistId,
      playlistName,
      bandId: null,
      savedAt: new Date().toISOString(),
      songs: [
        {
          repertoireId,
          entry: { repertoireId, songId: repertoireId, title: songTitle, artist: 'RH80 Artist' },
          repertoire: {
            id: repertoireId,
            user_id: null,
            band_id: null,
            song_id: repertoireId,
            personal_key: null,
            status: 'learning',
            tags: [],
            last_practiced: null,
            lyrics: null,
            // RH-99 ER7: one link, so the per-link `Delete link` button exists
            // offline and its disabled state can be asserted.
            song: {
              id: repertoireId,
              title: songTitle,
              artist: 'RH80 Artist',
              links: [{ label: 'Chords', url: 'https://example.invalid/chords' }],
            },
          },
          // Required since the RH-83 schema bump (v2): `isSongSnapshot` rejects a
          // song that merely *omits* it, because "absent" would otherwise be
          // read as "this member has no version of their own". Without it the
          // whole seeded record fails validation and Fast View reports the song
          // as not downloaded.
          personalRepertoire: null,
          tabs: [
            {
              id: tabId,
              repertoireId,
              title: 'Seeded Chart',
              fileUrl: 'https://blob.invalid/seeded.pdf',
              createdAt: new Date().toISOString(),
              cacheKey,
              bytes: 1024,
            },
          ],
        },
      ],
    },
  } as unknown as OfflineSnapshotRecord

  await page.evaluate(
    async ({ seeded, key, pdfBase64 }) => {
      // The database may not exist yet in this browser profile, so the object
      // store is created here rather than assumed.
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('repertoire-hero-offline', 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('snapshots')) {
            db.createObjectStore('snapshots', { keyPath: 'playlistId' })
          }
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('snapshots', 'readwrite')
          tx.objectStore('snapshots').put(seeded)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })

      const bytes = Uint8Array.from(atob(pdfBase64), (char) => char.charCodeAt(0))
      const cache = await caches.open('rh-offline-tabs-v1')
      await cache.put(
        key,
        new Response(bytes, { headers: { 'content-type': 'application/pdf' } }),
      )
    },
    { seeded: record as unknown as Record<string, unknown>, key: cacheKey, pdfBase64: ONE_PAGE_PDF_BASE64 },
  )

  await context.setOffline(true)
  await page.reload()

  // The tab list is the snapshot's, and selecting the tab opens the inline card.
  const tabSection = page.getByRole('region', { name: 'Tabs' })
  await expect(tabSection.getByText('Seeded Chart')).toBeVisible({ timeout: 20_000 })
  await tabSection.getByText('Seeded Chart').click()

  // ER11 end to end: the panel, and no cross-origin viewer at all.
  await expect(page.getByTestId('tab-viewer-offline')).toBeVisible()
  await expect(page.locator('iframe[src*="docs.google.com"]')).toHaveCount(0)

  // RH-99 ER7 — every write control this document can reach with no network is
  // *disabled*, not refused: nothing is queued and nothing is retried.
  const linksSection = page.getByRole('region', { name: 'Links' })
  await expect(linksSection.getByRole('button', { name: '+ Add Link' })).toBeDisabled()
  await expect(linksSection.getByRole('button', { name: 'Delete link' }).first()).toBeDisabled()

  // The `Upload PDF` submit is also disabled with no file chosen, which is its
  // own rule — so the title input, whose only disabling condition offline is
  // `readOnly`, is asserted beside it.
  await expect(tabSection.getByPlaceholder(/Tab Title/)).toBeDisabled()
  await expect(tabSection.getByRole('button', { name: 'Upload PDF' })).toBeDisabled()
  await expect(tabSection.getByRole('button', { name: 'Delete tab' }).first()).toBeDisabled()

  // Stage Mode is the offline renderer, and it reads the same-origin cache key
  // the worker's CacheOnly route answers.
  await page.getByRole('button', { name: /Stage/ }).first().click()
  await expect(page.locator('canvas.react-pdf__Page__canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Failed to load PDF.')).toHaveCount(0)
  // react-pdf's own page-level failure message, which a Document that parsed
  // but could not paint would show instead.
  await expect(page.getByText('Failed to load the page.')).toHaveCount(0)

  // RH-99 ER7, the last control: drawing is never enterable offline, so no
  // annotation save can be scheduled. The PDF itself keeps rendering above.
  const drawingToggle = page.getByRole('button', { name: 'Toggle drawing' })
  await expect(drawingToggle).toBeDisabled()
  await expect(drawingToggle).toHaveAttribute('aria-pressed', 'false')

  await context.setOffline(false)
})

/**
 * A minimal, valid one-page PDF. Inline so the suite needs no fixture file and
 * no network: the point is only that `react-pdf` can parse and paint it.
 */
const ONE_PAGE_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW' +
  '5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEg' +
  'Pj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaW' +
  'FCb3ggWzAgMCAyMDAgMjAwXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+' +
  'PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0Zvbn' +
  'QgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAg' +
  'b2JqCjw8IC9MZW5ndGggMzcgPj4Kc3RyZWFtCkJUCi9GMSAyNCBUZgoyMCAxMDAgVGQKKF' +
  'JILTgwKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1' +
  'MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMD' +
  'AxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzExIDAwMDAwIG4g' +
  'CnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMzk3CiUlRU' +
  '9GCg=='
