/**
 * RH-78 — the PWA shell, end to end.
 *
 * This is the one assertion in the task that no amount of static analysis can
 * stand in for: that the emitted worker actually installs and actually answers
 * a navigation that has no network with the precached `/offline` document,
 * rather than letting the browser paint its own error page.
 *
 * It is production-only, and deliberately so. `public/sw.js` is emitted by the
 * `serwist build` stage of `npm run build`, and `ServiceWorkerRegistrar` only
 * registers when `NODE_ENV === 'production'` — under `npm run dev` (which is
 * what `npm run test:e2e` and the CI e2e job start) there is no worker to test
 * and the file would 404. So the spec skips unless `E2E_PROD` is set, which
 * keeps every existing e2e outcome, CI included, exactly where it was.
 *
 * Run it with:
 *
 *   npm run build && E2E_PROD=1 \
 *     PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1" \
 *     npx playwright test e2e/pwa-shell.spec.ts --project=chromium
 *
 * A run that reports this spec as *skipped* is a configuration failure, not a
 * pass.
 */

import { test, expect } from '@playwright/test'

test.describe('PWA shell (production build only)', () => {
  test.skip(
    !process.env.E2E_PROD,
    'Needs a production build: set E2E_PROD=1 and PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1".',
  )

  test('answers an offline navigation with the precached /offline shell', async ({
    page,
    context,
  }) => {
    await page.goto('/')

    // The registrar fires in an effect; wait for the worker to reach `activated`
    // (precaching happens during `install`, so an active worker means the
    // manifest is already in the cache) and to control this page —
    // `clientsClaim: true` is what makes the second part happen without a reload.
    await page.waitForFunction(
      async () => {
        const registration = await navigator.serviceWorker.getRegistration('/')
        return registration?.active?.state === 'activated'
      },
      undefined,
      { timeout: 20_000 },
    )
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, {
      timeout: 20_000,
    })

    await context.setOffline(true)

    // A Fast View URL: a real application route, in the `src/proxy.ts` matcher,
    // and not itself precached. Nothing but the fallback can answer it.
    await page.goto('/songs/00000000-0000-0000-0000-000000000000/fast-view')

    await expect(page.locator('[data-testid="offline-shell"]')).toBeVisible()
    await expect(page.getByText('You are offline')).toBeVisible()

    await context.setOffline(false)
  })

  test('still reaches the network for a normal navigation while online', async ({ page }) => {
    // The other half of the guarantee: the document-scoped NetworkOnly entry
    // stores nothing, so an online navigation must not be answered from the
    // worker's cache. `/login` is one of the seven prerendered documents the
    // allow-list keeps out of the precache.
    const response = await page.goto('/login')

    expect(response?.status()).toBe(200)
    await expect(page.locator('[data-testid="offline-shell"]')).toHaveCount(0)
  })
})
