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

async function fillAndSubmitLogin(
  page: import('@playwright/test').Page,
  email: string,
  password: string
) {
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
}

// ---------------------------------------------------------------------------
// Tests — intentionally NOT using storageState
// ---------------------------------------------------------------------------

test('valid credentials redirect to home', async ({ page }) => {
  await page.goto('/login')
  await fillAndSubmitLogin(page, E2E_USER_EMAIL, E2E_USER_PASSWORD)

  // After a successful login the app should redirect to the home page
  await page.waitForURL('/', { timeout: 10_000 })
  await expect(page).toHaveURL('/')
})

test('invalid credentials show an error message', async ({ page }) => {
  await page.goto('/login')
  await fillAndSubmitLogin(page, E2E_USER_EMAIL, 'wrong-password-123')

  // Stay on login; an error message should appear
  await expect(page).toHaveURL(/\/login/)
  // Better Auth returns a generic "Invalid credentials" or similar message
  const errorLocator = page.locator('[role="alert"], .text-red-600, .text-destructive')
  await expect(errorLocator.first()).toBeVisible({ timeout: 5_000 })
})

test('unauthenticated user is redirected to /login', async ({ page }) => {
  // Navigate directly to a protected page without a session
  await page.goto('/')
  await page.waitForURL(/\/login/, { timeout: 8_000 })
  await expect(page).toHaveURL(/\/login/)
})

test('redirect param is honoured after login', async ({ page }) => {
  // The middleware attaches ?redirect=<original-path> when bouncing to /login
  await page.goto('/')
  await page.waitForURL(/\/login\?redirect=/, { timeout: 8_000 })

  await fillAndSubmitLogin(page, E2E_USER_EMAIL, E2E_USER_PASSWORD)

  // Should land on the originally requested page (/) not /login
  await page.waitForURL('/', { timeout: 10_000 })
  await expect(page).toHaveURL('/')
})
