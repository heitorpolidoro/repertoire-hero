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
 */

import { test, expect } from '@playwright/test'
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
