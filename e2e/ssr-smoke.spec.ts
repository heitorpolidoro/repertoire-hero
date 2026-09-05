/**
 * RH-32 — SSR smoke tests.
 *
 * These assert on the raw server response, not on the hydrated DOM. The bug this file guards
 * against ("better-auth" in serverExternalPackages → two React instances during SSR → null hook
 * dispatcher in AppLayout.useSession) made every server response for `/` and `/profile` a 500,
 * while the page still hydrated fine in a browser — so no existing DOM-level test could see it.
 *
 * The `request` fixture performs plain HTTP requests with no JavaScript execution, which is
 * exactly the audience (crawlers, non-JS clients, uptime probes) the 500 was breaking.
 */

import { test, expect } from '@playwright/test'
import { AUTH_STATE_PATH } from './global-setup'

const ERROR_DOCUMENT_MARKER = 'id="__next_error__"'
const HOOK_CRASH_MARKER = 'Cannot read properties of null'

test('GET / signed out returns a 200 SSR document', async ({ request }) => {
  const res = await request.get('/')

  expect(res.status()).toBe(200)

  const body = await res.text()
  expect(body).not.toContain(ERROR_DOCUMENT_MARKER)
  expect(body).not.toContain(HOOK_CRASH_MARKER)
  expect(body).toContain('Repertoire Hero')
})

test('signed-out / renders the landing page in a browser', async ({ page }) => {
  const res = await page.goto('/')

  expect(res!.status()).toBe(200)
  // The authenticated app shell must be absent for a signed-out visitor.
  await expect(page.locator('nav[aria-label="Main navigation"]')).toHaveCount(0)
  // Landing-only element. `.first()` keeps the locator strict-mode safe.
  await expect(page.locator('a[href="/signup"]').first()).toBeVisible()
})

test.describe('signed in', () => {
  test.use({ storageState: AUTH_STATE_PATH })

  test('GET /profile signed in returns a 200 SSR document', async ({ request }) => {
    const res = await request.get('/profile')

    expect(res.status()).toBe(200)

    const body = await res.text()
    expect(body).not.toContain(ERROR_DOCUMENT_MARKER)
    expect(body).not.toContain(HOOK_CRASH_MARKER)
  })

  test('/profile renders the app shell in a browser', async ({ page }) => {
    const res = await page.goto('/profile')

    expect(res!.status()).toBe(200)
    // `nav[aria-label="Main navigation"]` matches 2 elements when signed in (desktop sidebar +
    // mobile bottom bar), so `.first()` is required to avoid a strict mode violation.
    await expect(page.locator('nav[aria-label="Main navigation"]').first()).toBeVisible()
  })
})
