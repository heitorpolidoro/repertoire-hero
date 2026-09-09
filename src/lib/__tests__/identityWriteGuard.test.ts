/**
 * RH-42 — Guardrail: no raw SQL write of the login identity anywhere in `src/`.
 *
 * `"user".email` is what an account signs in with, and `profiles.email` is the
 * copy the app displays. F12 was a two-statement transaction that rewrote both
 * with no verification and no validation. Since RH-42 the only sanctioned path
 * is `requestEmailChange` (`src/lib/emailChange.ts`) -> `auth.api.changeEmail`,
 * with `profiles.email` following through the
 * `sync_profile_email_on_user_update` trigger
 * (`migrations/0008_sync_profile_email.sql`). This suite fails if either raw
 * statement comes back.
 *
 * KNOWN LIMITATION - do not over-trust this guard. `findViolations` splits the
 * source on `\n` before testing, so both patterns are line-scoped, and
 * `updateProfile` in `src/lib/profile.ts` already shows the shape that evades
 * them: a template literal with `UPDATE profiles` on one line and `SET ...` on
 * the next. A re-introduced raw identity write formatted that way would not be
 * caught. This is a ratchet against the exact statement that was deleted and
 * against a careless re-add - it is not a proof that no such write exists.
 *
 * As in `errorHandlingStyle.test.ts`, every sample below is built by string
 * concatenation, so a plain `grep` for the banned text does not flag this file.
 */

import { describe, it, expect } from 'vitest'
import { stripComments, findViolations, formatViolations } from './test-helpers'

const SELF = 'src/lib/__tests__/identityWriteGuard.test.ts'

/** Any write to the Better Auth user table. Quoted or not, any case. */
const USER_TABLE_WRITE = /\bUPDATE\s+"?user"?\s+SET\b/i

/**
 * A write to `profiles` that touches the email column. Column-scoped on
 * purpose: `UPDATE profiles SET is_system_admin = true WHERE id = $1` appears in
 * three existing test files and is not an identity write.
 */
const PROFILE_EMAIL_WRITE = /\bUPDATE\s+profiles\s+SET\b[^\n]*\bemail\b/i

const PATTERNS = [USER_TABLE_WRITE, PROFILE_EMAIL_WRITE]

/**
 * Returns one entry per line of `source` that writes an identity row directly.
 * Each entry is the offending line, trimmed. Comments are ignored.
 */
export function findIdentityWrites(source: string): string[] {
  return stripComments(source)
    .split('\n')
    .filter((line) => PATTERNS.some((pattern) => pattern.test(line)))
    .map((line) => line.trim())
}

// Built by concatenation so the literal banned text never appears in this file.
const UPD = 'UPDATE'
const SET = 'SET'
const USER_ROW = `${UPD} "user" ${SET} email = $1, "updatedAt" = now() WHERE id = $2::uuid`
const USER_ROW_LOWER = `${UPD.toLowerCase()} user ${SET.toLowerCase()} email = 'x'`
const PROFILE_ROW = `${UPD} profiles ${SET} email = $1 WHERE id = $2::uuid`
const ADMIN_FLAG = `${UPD} profiles ${SET} is_system_admin = true WHERE id = $1`
const USER_INSERT = 'INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)'
const COMMENTED_USER_ROW = `// ${USER_ROW}`

describe('findIdentityWrites (detector)', () => {
  it('flags the auth-row rewrite deleted from src/lib/profile.ts', () => {
    expect(findIdentityWrites(USER_ROW)).toHaveLength(1)
  })

  it('flags a lowercase, unquoted write to the user table', () => {
    expect(findIdentityWrites(USER_ROW_LOWER)).toHaveLength(1)
  })

  it('flags the profile-row rewrite deleted alongside it', () => {
    expect(findIdentityWrites(PROFILE_ROW)).toHaveLength(1)
  })

  it('flags both statements when they appear together', () => {
    expect(findIdentityWrites(`${USER_ROW}\n${PROFILE_ROW}`)).toHaveLength(2)
  })

  it('does not flag a non-identity column on profiles', () => {
    expect(findIdentityWrites(ADMIN_FLAG)).toEqual([])
  })

  it('does not flag the fixture INSERT into the user table', () => {
    expect(findIdentityWrites(USER_INSERT)).toEqual([])
  })

  it('does not flag the banned statement inside a line comment', () => {
    expect(findIdentityWrites(COMMENTED_USER_ROW)).toEqual([])
  })
})

describe('src/ tree', () => {
  it('contains no raw write of either identity row', () => {
    const found = PATTERNS.flatMap((pattern) => findViolations(pattern, { skip: SELF }))
    const violations = formatViolations(found)

    expect(
      violations,
      `The login identity may not be written with raw SQL (see AGENTS.md, ` +
        `"Identity fields change only through Better Auth's verified flows"). ` +
        `Route the change through \`requestEmailChange\` -> ` +
        `\`auth.api.changeEmail\`; \`profiles.email\` follows through the ` +
        `\`sync_profile_email_on_user_update\` trigger. Offending locations:\n` +
        violations.join('\n'),
    ).toEqual([])
  })
})
