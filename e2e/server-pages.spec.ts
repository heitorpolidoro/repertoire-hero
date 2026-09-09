/**
 * RH-62 — `/bands` and `/admin/moderation` are Server Components.
 *
 * These assert on the raw HTTP document with no JavaScript executed, in the
 * style of `ssr-smoke.spec.ts`. Before the conversion both routes were
 * prerendered static shells whose documents carried a client-side loading
 * placeholder ("Loading bands..." / "Loading moderation queue...") and no data;
 * after it the server reads through `@/lib` and ships the finished markup, so
 * the placeholders can no longer appear in the response body.
 *
 * The e2e user is a non-admin (`profiles.is_system_admin` defaults to false),
 * which is exactly the fixture the Access Denied branch needs.
 *
 * RH-63 adds `/playlists`. That route had no loading placeholder to look for —
 * its prerendered shell simply carried no playlist at all — so the assertion is
 * the stronger one: a playlist created through the UI has to be *in* the raw
 * document of the very next request, which can only happen if the server read
 * it. The second test pins the delete path, its `router.refresh()` and the
 * absence of a browser dialog behind the `Sure? / Yes / No` affordance.
 */

import { test, expect, type Page } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'

const ERROR_DOCUMENT_MARKER = 'id="__next_error__"'

test.use({ storageState: AUTH_STATE_PATH })

test('GET /bands signed in is server-rendered with no loading placeholder', async ({ request }) => {
  const res = await request.get('/bands')

  expect(res.status()).toBe(200)

  const body = await res.text()
  expect(body).not.toContain('Loading bands...')
  expect(body).not.toContain(ERROR_DOCUMENT_MARKER)
})

test('GET /admin/moderation signed in as a non-admin renders Access Denied', async ({ request }) => {
  const res = await request.get('/admin/moderation')

  expect(res.status()).toBe(200)

  const body = await res.text()
  expect(body).toContain('Access Denied')
  expect(body).not.toContain('Loading moderation queue...')
  expect(body).not.toContain(ERROR_DOCUMENT_MARKER)
})

/** Creates a uniquely named playlist through the modal and returns its name. */
async function createPlaylist(page: Page): Promise<string> {
  const name = `E2E Server Playlist ${Date.now()}`

  await page.goto('/playlists')

  const newPlaylistButton = page.getByRole('button', { name: '+ New Playlist' })
  const nameInput = page.getByLabel('Playlist name')

  // The header paints before React hydrates, so a click can be swallowed on a
  // cold route. Retry opening the modal until the name field actually appears.
  await expect(newPlaylistButton).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    await newPlaylistButton.click()
    await expect(nameInput).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })

  await nameInput.fill(name)
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByRole('button', { name: `Open ${name}` })).toBeVisible({ timeout: 15_000 })
  return name
}

/** Deletes a playlist through the inline `Sure? / Yes` affordance. */
async function deletePlaylist(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Delete ${name}` }).click()
  await page.getByRole('button', { name: 'Yes' }).click()
  await expect(page.getByRole('button', { name: `Open ${name}` })).toHaveCount(0)
}

test('GET /playlists signed in is server-rendered with the playlist rows in the document', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  const name = await createPlaylist(page)

  const res = await request.get('/playlists')

  expect(res.status()).toBe(200)

  const body = await res.text()
  expect(body).toContain(name)
  expect(body).not.toContain(ERROR_DOCUMENT_MARKER)

  // Leave no stray playlist behind for the next run.
  await deletePlaylist(page, name)
})

test('deleting a playlist through the inline confirmation removes it from the server-rendered document', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)

  // Playwright auto-dismisses native dialogs, so a `confirm()` would silently
  // resolve to false. Recording them proves the affordance is in-page.
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    dialog.dismiss().catch(() => undefined)
  })

  const name = await createPlaylist(page)
  await deletePlaylist(page, name)

  const res = await request.get('/playlists')

  expect(res.status()).toBe(200)

  const body = await res.text()
  expect(body).not.toContain(name)
  expect(body).not.toContain(ERROR_DOCUMENT_MARKER)
  expect(dialogs).toEqual([])
})
