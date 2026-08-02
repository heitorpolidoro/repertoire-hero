/**
 * Global setup: runs once before all tests.
 *
 * Creates a authenticated session for the E2E test user and saves the browser
 * storage state to disk so every test can reuse it without re-logging in.
 *
 * Strategy:
 *  1. Sign up (idempotent — silently handles "already exists" errors)
 *  2. Sign in via the Better Auth email/password endpoint
 *  3. Save the resulting cookies to e2e/.auth/user.json
 */

import { chromium, request as apiRequest } from '@playwright/test'
import path from 'path'
import fs from 'fs'

export const E2E_USER_EMAIL = process.env.E2E_USER_EMAIL ?? 'e2e-test@example.com'
export const E2E_USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? 'E2eTestPassword1!'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
export const AUTH_STATE_PATH = path.join(__dirname, '.auth', 'user.json')

export default async function globalSetup() {
  // Ensure the .auth directory exists
  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true })

  // Use Playwright's API request context (no browser needed for auth)
  const ctx = await apiRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      Origin: BASE_URL,
      Referer: BASE_URL + '/',
    },
  })

  // 1. Try to sign up — ignore if user already exists
  const signUpRes = await ctx.post('/api/auth/sign-up/email', {
    data: {
      email: E2E_USER_EMAIL,
      password: E2E_USER_PASSWORD,
      name: 'E2E Test User',
    },
  })
  const signUpBody = await signUpRes.json().catch(() => ({}))
  const alreadyExists =
    !signUpRes.ok() &&
    (signUpBody?.code === 'USER_ALREADY_EXISTS' ||
      signUpBody?.error?.toLowerCase?.().includes('already') ||
      signUpBody?.message?.toLowerCase?.().includes('already'))
  if (!signUpRes.ok() && !alreadyExists) {
    console.warn('[global-setup] sign-up response:', signUpRes.status(), signUpBody)
  }

  // 2. Sign in to get session cookies
  const signInRes = await ctx.post('/api/auth/sign-in/email', {
    data: { email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD },
  })
  if (!signInRes.ok()) {
    const body = await signInRes.json().catch(() => ({}))
    throw new Error(
      `[global-setup] sign-in failed (${signInRes.status()}): ${JSON.stringify(body)}`
    )
  }

  // 3. Save storage state (cookies) for reuse across all tests
  await ctx.storageState({ path: AUTH_STATE_PATH })
  await ctx.dispose()
}
