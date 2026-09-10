/**
 * T4.5 — Authentication flow E2E tests
 *
 * DoD: Both production login and redirect-after-login paths are exercised;
 * CI run passes.
 *
 * These tests run WITHOUT the pre-authenticated storageState so we can
 * exercise the actual login screens and redirect behaviour.
 */

import { test, expect } from '@playwright/test'
import { E2E_USER_EMAIL, E2E_USER_PASSWORD } from './global-setup'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A route that really is private. `/` is the public landing page and is not in
 * the matcher of `src/proxy.ts`; `e2e/ssr-smoke.spec.ts` owns its behaviour
 * (`GET / signed out returns a 200 SSR document`) and nothing here may contradict
 * it. `/profile` is in that matcher, carries no per-test data, and answers a
 * cookie-less request with `307 -> /login?redirect=%2Fprofile`.
 */
const PRIVATE_ROUTE = '/profile'

async function fillAndSubmitLogin(
  page: import('@playwright/test').Page,
  email: string,
  password: string
) {
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
}

/**
 * Signs in with credentials that are expected to work and asserts where the app
 * puts the visitor afterwards.
 *
 * The submit is retried because Better Auth rate-limits `/sign-in/email` to a
 * handful of requests per ten seconds per address, and every test in this file —
 * plus `global-setup` — signs the same user in from the same address, so a
 * perfectly valid submit can come back `Too many requests. Please try again
 * later.` (visible against a production `next start`, where Better Auth enables
 * the limiter; the CI dev server does not). Waiting the window out is not a
 * weakened assertion: the destination asserted below is the same one, and a real
 * failure to honour it still fails once the retry budget runs out.
 */
async function signInAndLandOn(
  page: import('@playwright/test').Page,
  destination: string
) {
  await expect(async () => {
    await fillAndSubmitLogin(page, E2E_USER_EMAIL, E2E_USER_PASSWORD)
    await expect(page).toHaveURL(destination, { timeout: 5_000 })
  }).toPass({ timeout: 30_000 })
}

// ---------------------------------------------------------------------------
// Tests — intentionally NOT using storageState
// ---------------------------------------------------------------------------

test('valid credentials redirect to home', async ({ page }) => {
  await page.goto('/login')

  // After a successful login the app should redirect to the home page
  await signInAndLandOn(page, '/')
  await expect(page).toHaveURL('/')
})

test('invalid credentials show an error message', async ({ page }) => {
  await page.goto('/login')

  // Better Auth returns a generic "Invalid credentials" or similar message
  const errorLocator = page.locator('[role="alert"], .text-red-600, .text-destructive')

  // Retried for the same reason as `signInAndLandOn`: the rate limiter answers
  // "Too many requests" with an error banner of its own, which would satisfy
  // this test without the credentials ever being checked. Excluding that text
  // is what keeps the assertion about the credentials.
  await expect(async () => {
    await fillAndSubmitLogin(page, E2E_USER_EMAIL, 'wrong-password-123')
    await expect(errorLocator.first()).toBeVisible({ timeout: 5_000 })
    await expect(errorLocator.first()).not.toContainText(/too many requests/i)
  }).toPass({ timeout: 30_000 })

  // Stay on login
  await expect(page).toHaveURL(/\/login/)
})

test('unauthenticated visitor to a private route is redirected to /login', async ({ page }) => {
  // Navigate directly to a private page without a session
  await page.goto(PRIVATE_ROUTE)
  await page.waitForURL(/\/login/, { timeout: 8_000 })
  await expect(page).toHaveURL(/\/login/)

  // The bounce names the route that was asked for, so the login form knows
  // where to send the visitor back to.
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(PRIVATE_ROUTE)
})

test('redirect param is honoured after login', async ({ page }) => {
  // The proxy attaches ?redirect=<original-path> when bouncing to /login
  await page.goto(PRIVATE_ROUTE)
  await page.waitForURL(/\/login\?redirect=/, { timeout: 8_000 })

  // Should land on the originally requested page, not on /login or the home page
  await signInAndLandOn(page, PRIVATE_ROUTE)
  await expect(page).toHaveURL(PRIVATE_ROUTE)
})
