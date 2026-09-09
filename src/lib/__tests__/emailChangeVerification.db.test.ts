/**
 * RH-42 — the whole verified email-change flow, against the real database and
 * the real Better Auth endpoints.
 *
 * Nothing here is mocked except `@/lib/authEmail`, and that only so the links
 * can be read instead of printed: the user is created through
 * `auth.api.signUpEmail`, the session is the `set-cookie` that call returns, and
 * every state change afterwards goes through `auth.api`. This suite issues no
 * `UPDATE` against `"user"` and none against `profiles.email` - which is also
 * what keeps it green under `identityWriteGuard.test.ts`.
 *
 * The property it proves is the one F12 named: the auth row and the profile row
 * cannot disagree about who the user is, and neither moves until the link is
 * opened. The `profiles` write is not ours - it is
 * `migrations/0008_sync_profile_email.sql`'s trigger, running inside Better
 * Auth's own transaction.
 *
 * Failure is injected in Postgres, not by mocking, and the injecting trigger's
 * `WHEN` clause names exactly one fixture row: vitest runs files in parallel
 * workers and these tables are shared with the other `*.db.test.ts` suites.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'

const { captured } = vi.hoisted(() => ({
  captured: [] as Array<{ to: string; subject: string; url: string }>,
}))

vi.mock('@/lib/authEmail', () => ({
  sendAuthEmail: vi.fn(async (email: { to: string; subject: string; url: string }) => {
    captured.push({ to: email.to, subject: email.subject, url: email.url })
  }),
  renderAuthEmail: vi.fn(() => '<html></html>'),
}))

import { auth } from '@/lib/auth'
import { query } from '@/lib/db'
import { requestEmailChange } from '@/lib/emailChange'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const PASSWORD = 'rh42-correct-horse'

/** The token Better Auth put in the link it just "sent". */
const tokenOf = (url: string) => new URL(url).searchParams.get('token') as string

describe.skipIf(!SERVICE_ROLE_KEY)('verified email change (real database)', () => {
  const suffix = Date.now()
  const address = (label: string) => `rh42-${label}-${suffix}@example.com`

  const ORIGINAL = address('original')
  const SECOND = address('second')
  const MOVED = address('moved')
  const VERIFIED_MOVE = address('verified-move')
  const ROLLED_BACK = address('rolled-back')

  let userId: string
  let otherUserId: string
  let sessionHeaders: Headers

  const installedTriggers: string[] = []

  const one = async (sql: string, params: unknown[] = []) => {
    const res = await query(sql, params as never)
    return res.rows[0]
  }

  const emailsOf = async (id: string) => ({
    user: (await one('SELECT email FROM "user" WHERE id = $1', [id])).email as string,
    profile: (await one('SELECT email FROM profiles WHERE id = $1', [id])).email as string,
  })

  /**
   * Signs a fixture user up through the real endpoint and returns its id plus a
   * `Headers` carrying the session cookie the endpoint issued.
   */
  const signUp = async (email: string) => {
    const { headers, response } = await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: 'RH-42 Fixture' },
      returnHeaders: true,
    })
    const setCookie = headers.get('set-cookie') ?? ''
    const cookie = setCookie
      .split(/,(?=\s*[A-Za-z0-9_.-]+=)/)
      .map((part) => part.trim().split(';')[0])
      .join('; ')
    return { id: response.user.id, headers: new Headers({ cookie }) }
  }

  const injectProfilesFailure = async (name: string, rowId: string) => {
    await query(
      `CREATE TRIGGER ${name} BEFORE UPDATE ON profiles
       FOR EACH ROW WHEN (OLD.id = '${rowId}') EXECUTE FUNCTION rh42_raise()`,
    )
    installedTriggers.push(name)
  }

  beforeAll(async () => {
    await query(
      `CREATE OR REPLACE FUNCTION rh42_raise() RETURNS trigger AS $fn$
       BEGIN RAISE EXCEPTION 'RH-42 injected failure'; END;
       $fn$ LANGUAGE plpgsql`,
    )

    const primary = await signUp(ORIGINAL)
    userId = primary.id
    sessionHeaders = primary.headers

    const other = await signUp(SECOND)
    otherUserId = other.id
  })

  afterEach(async () => {
    while (installedTriggers.length > 0) {
      await query(`DROP TRIGGER IF EXISTS ${installedTriggers.pop()!} ON profiles`)
    }
  })

  afterAll(async () => {
    for (const id of [userId, otherUserId]) {
      if (id) await query('DELETE FROM "user" WHERE id = $1', [id])
    }
    await query('DROP FUNCTION IF EXISTS rh42_raise() CASCADE')
  })

  it('installs the sync trigger on the auth user table', async () => {
    const res = await query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = '"user"'::regclass AND NOT tgisinternal`,
    )
    expect(res.rows.map((row) => row.tgname)).toContain('sync_profile_email_on_user_update')
  })

  it('(a) leaves both identity rows on the original address and mails the new one', async () => {
    captured.length = 0

    await expect(requestEmailChange(sessionHeaders, MOVED)).resolves.toBeUndefined()

    const after = await emailsOf(userId)
    expect(after.user).toBe(ORIGINAL)
    expect(after.profile).toBe(ORIGINAL)

    expect(captured).toHaveLength(1)
    expect(captured[0].to).toBe(MOVED)
  })

  it('(b) moves both rows, and marks the address verified, only when the link is opened', async () => {
    const token = tokenOf(captured[0].url)

    await auth.api.verifyEmail({ query: { token } })

    const row = await one('SELECT email, "emailVerified" FROM "user" WHERE id = $1', [userId])
    expect(row.email).toBe(MOVED)
    expect(row.emailVerified).toBe(true)

    // Written by the trigger, in Better Auth's own transaction: no application
    // code touched this row.
    const profile = await one('SELECT email FROM profiles WHERE id = $1', [userId])
    expect(profile.email).toBe(MOVED)
  })

  it('(d) answers a taken address with a silent success, no mail and no write', async () => {
    captured.length = 0
    const before = await emailsOf(userId)
    const otherBefore = await emailsOf(otherUserId)

    await expect(requestEmailChange(sessionHeaders, SECOND)).resolves.toBeUndefined()

    // Deliberate: `update-user.mjs` L431-435 mints a token, sends nothing and
    // returns `{ status: true }` so the endpoint is not an enumeration oracle.
    expect(captured).toHaveLength(0)
    expect(await emailsOf(userId)).toEqual(before)
    expect(await emailsOf(otherUserId)).toEqual(otherBefore)
  })

  it('(e) warns the current address first once it is verified, and moves the row only on the second link', async () => {
    captured.length = 0

    await requestEmailChange(sessionHeaders, VERIFIED_MOVE)

    expect(captured).toHaveLength(1)
    expect(captured[0].to).toBe(MOVED) // the CURRENT address - the hijack alarm
    expect(await emailsOf(userId)).toEqual({ user: MOVED, profile: MOVED })

    await auth.api.verifyEmail({ query: { token: tokenOf(captured[0].url) } })

    expect(captured).toHaveLength(2)
    expect(captured[1].to).toBe(VERIFIED_MOVE) // now the NEW address
    expect(await emailsOf(userId)).toEqual({ user: MOVED, profile: MOVED })

    await auth.api.verifyEmail({ query: { token: tokenOf(captured[1].url) } })

    expect(await emailsOf(userId)).toEqual({ user: VERIFIED_MOVE, profile: VERIFIED_MOVE })
  })

  it('(c) rolls the auth row back when the profile row cannot follow', async () => {
    captured.length = 0

    await requestEmailChange(sessionHeaders, ROLLED_BACK)
    await auth.api.verifyEmail({ query: { token: tokenOf(captured[0].url) } })
    expect(captured).toHaveLength(2)

    await injectProfilesFailure('rh42_fail_profiles', userId)

    await expect(
      auth.api.verifyEmail({ query: { token: tokenOf(captured[1].url) } }),
    ).rejects.toThrow(/RH-42 injected failure/)

    expect(await emailsOf(userId)).toEqual({ user: VERIFIED_MOVE, profile: VERIFIED_MOVE })
  })
})
