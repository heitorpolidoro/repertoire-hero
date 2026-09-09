# RH-42 — Exigir verificacao para troca de e-mail

Resolves **F12** of `docs/plans/code-quality-review.md` ("updateEmail rewrites
the login identity with no verification and no validation", section at line 334)
and closes **T9** ("Require verification for email changes", section 5), whose
only covered finding is F12.

Baseline commit for every measurement below: **890a27b**, tree clean.

## Scope

This task makes the login identity unchangeable without proof of control over
the target address, and makes it impossible for the two rows that hold that
identity to disagree.

In scope:

- Delete the raw identity write (`updateEmail` in `src/lib/profile.ts`, its
  `updateEmailAction` wrapper) and replace it with Better Auth's own
  `changeEmail` flow, configured in `src/lib/auth.ts`.
- Validate the submitted address (format, empty, same-as-current) in a new
  `src/lib/emailChange.ts`, in the house error style.
- Actually send the mail: extract the Resend/dev-echo plumbing that today only
  serves `sendResetPassword` into `src/lib/authEmail.ts` and reuse it for the
  two new auth mails.
- Make `profiles.email` follow `"user".email` in the same transaction, through a
  Postgres trigger in a new migration - because the row that flips the address
  is written by Better Auth's `/api/auth/verify-email` handler, which is not
  application code and cannot be asked to update a second table.
- Rework the email section of `/profile` into a small client island with honest
  copy (today it promises a confirmation email that is never sent).
- Guard the regression: a vitest scan that fails on any `UPDATE "user" SET ...`
  or `UPDATE profiles SET ... email ...` re-appearing under `src/`.
- Documentation: an AGENTS.md rule, the F12 and T9 `Status:` lines, the version
  bump.

Not in scope: see **Out of Scope** at the end (admin-side email edit, e-mail
verification at sign-up, i18n of profile copy, landing copy, F13/F11).

## Audit at 890a27b

### What the code does today

`src/app/profile/page.tsx:493` calls `updateEmailAction`
(`src/app/actions/profile.ts:22-25`), which resolves the session with
`getRequiredUserId()` and delegates to `updateEmail`
(`src/lib/profile.ts:71-84`). That function opens a `withTransaction` and issues
two statements:

```
UPDATE "user" SET email = $1, "updatedAt" = now() WHERE id = $2::uuid
UPDATE profiles SET email = $1 WHERE id = $2::uuid
```

Its own comment (`src/lib/profile.ts:68-70`) records that this "bypasses" Better
Auth's verification "for admin use", and the only caller is the user-facing
settings form. Nothing checks that the string is an email, that it differs from
the current address, or that it is unused; the `UNIQUE` constraint on
`"user".email` (`migrations/0001_initial_schema.sql:35`) is the only thing
standing between a user and another account's address, and it surfaces as an
opaque `Failed to update email: duplicate key ...`.

The UI already lies. `src/app/profile/page.tsx:638-641` renders "A confirmation
link will be sent to {newEmail}", and line 495 reports "Confirmation email sent
to X. Check your inbox to complete the change." No email is sent by any code
path: the change is already committed when that banner appears.

F4's atomicity half was fixed by RH-36, so the two statements are genuinely in
one transaction today; F12 is the other half - verification and validation.

### How the app sends email today

One place only: `sendResetPassword` in `src/lib/auth.ts:28-65`. It reads
`RESEND_API_KEY` and `EMAIL_FROM`; when the key is absent it prints two
`console.log` lines (the address and the reset URL) and returns, which is the
documented exception in AGENTS.md's error-handling section. With a key it
`await import('resend')`, sends an inline HTML template, and swallows a failure
through `logger.error`. `.env.local` (keys inspected, values never read) holds
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `SPOTIFY_*` and `VERCEL_OIDC_TOKEN` - **no
`RESEND_API_KEY` and no `EMAIL_FROM`**. Locally, therefore, the console echo is
not a fallback, it is the only path, and it is the precedent this task follows
for the two new mails.

### The installed Better Auth (1.6.22) - read from `node_modules`, not memory

`node_modules/better-auth/dist/api/routes/update-user.mjs:375-491` is the
`/change-email` endpoint. The semantics that matter here:

- It is gated on `options.user.changeEmail.enabled` (L409) and refuses a
  same-address change with `Email is the same` (L414-417).
- `updateEmailWithoutVerification` (default `false`, per
  `node_modules/@better-auth/core/src/types/init-options.ts:844-848`) is the
  **only** way the row is written without a verification round trip, and it
  applies exactly when `session.user.emailVerified !== true` (L424, L439-460).
  Every account this app creates is unverified (`requireEmailVerification:
  false` and nothing sends a sign-up verification), so leaving that flag on
  would let today's hole back in through the front door. It must be set to
  `false` explicitly.
- If the address already belongs to another user, the endpoint mints a token,
  sends nothing, and returns `{ status: true }` (L431-435). That is deliberate
  enumeration protection, and it is why this task does **not** add its own
  uniqueness pre-check (see Approach).
- For a **verified** current address, `user.changeEmail.sendChangeEmailConfirmation`
  is called with `{ user, newEmail, url, token }` and the mail goes to the
  **current** address (L468).
- Otherwise `emailVerification.sendVerificationEmail` is called with
  `user = { ...session.user, email: newEmail }` (L482), i.e. the mail goes to
  the **new** address.
- The option is named `sendChangeEmailConfirmation` in this version. There is no
  `sendChangeEmailVerification` anywhere in the installed package - `grep -rl
  sendChangeEmailConfirmation node_modules/better-auth/` prints exactly one file.

`node_modules/better-auth/dist/api/routes/email-verification.mjs:123-234` is the
`/verify-email` endpoint that consumes the token. The token is a **signed JWT**
(`createEmailVerificationToken`, L12-18; verified with `jwtVerify` at L175) - no
`verification` table row is involved, so no migration is needed for token
storage (the table exists anyway, `migrations/0001_initial_schema.sql:69-76`).
On `requestType: "change-email-confirmation"` it mints a second token and sends
it to the new address (L191-205); on `change-email-verification` it calls
`internalAdapter.updateUserByEmail` with `{ email: updateTo, emailVerified: true
}` (L216-219) and refreshes the session cookie.

Two consequences for this task:

1. **The row that changes the login identity is written by Better Auth, inside
   its own handler, with no application code on the stack.** `profiles.email`
   cannot be updated "next to it" by our code. `updateUserByEmail` does go
   through `updateWithHooks` (`node_modules/better-auth/dist/db/internal-adapter.mjs:517-527`),
   so a `databaseHooks.user.update.after` would fire - but it would fire *after*
   the user row is already committed-visible to that statement, so a failure
   there re-creates exactly the divergence F12 warns about. A Postgres trigger
   runs in the same transaction as Better Auth's `UPDATE` and cannot diverge.
2. Sign-up behaviour does not change by enabling `emailVerification`:
   `node_modules/better-auth/dist/api/routes/sign-up.mjs:241` sends only when
   `emailVerification.sendOnSignUp ?? emailAndPassword.requireEmailVerification`
   is truthy, and both stay `undefined` / `false`.

`auth.options` is the literal options object on the returned instance
(`node_modules/better-auth/dist/auth/base.mjs:36`), so the configuration is
assertable from a unit test.

### Schema

`"user"` has `email text NOT NULL UNIQUE` and `"emailVerified" boolean NOT NULL
DEFAULT false`; `profiles.email` is `text NOT NULL` and is seeded by the
`databaseHooks.user.create.after` INSERT in `src/lib/auth.ts:84-89`. Latest
migration is `migrations/0007_add_playlist_song_position_unique.sql`; the next
number is `0008` and `src/lib/__tests__/migrationsSingleSource.test.ts` enforces
contiguous four-digit numbering in the one `migrations/` directory.

### What currently references the code being deleted

`grep -rn "updateEmail" src` prints **23** lines at 890a27b, across:
`src/lib/profile.ts`, `src/app/actions/profile.ts`, `src/app/profile/page.tsx`,
`src/app/actions/__tests__/actionSessionGuard.test.ts` (table entry, L159),
`src/app/actions/__tests__/thinActions.test.ts` (mock + delegation row),
`src/lib/__tests__/profile.test.ts` (two tests, L103-120),
`src/lib/__tests__/transactionAtomicity.db.test.ts` (import L19 + the
`updateEmail leaves the user row untouched ...` test, L179-190) and one comment
in `src/lib/__tests__/errors.test.ts:453`.

The `transactionAtomicity.db.test.ts` case is an expected result of RH-36
(recorded in `docs/tasks/RH-36-spec.md` ER3(b)). It is removed here rather than
preserved, because the function it exercises ceases to exist; the property it
asserted - the auth row and the profile row never disagree - is asserted more
strongly by this task's new database test, which drives the real Better Auth
write and proves the trigger rolls the `"user"` row back when the `profiles`
write fails. The removal is called out in `docs/suggestions-log.md`.

### Budgets and gates at 890a27b

- `rtk proxy npx eslint .` -> `22 problems (8 errors, 14 warnings)`.
- `npm run lint:dup` -> `Found 18 clones.`, total `231 (0.64 %)`.
- `rtk proxy npx vitest run` -> `Test Files 100 passed (100)`, `Tests 1148
  passed (1148)`, exit 0 (with Postgres up and `SUPABASE_SERVICE_ROLE_KEY` set).
- `./node_modules/.bin/tsc --noEmit` -> exit 0, no output.
- `eslint.config.mjs` override block: **20 entries**, i.e. exactly at
  `MAX_OVERRIDES = 20` (`src/lib/__tests__/complexityBudget.test.ts:49`). **No
  new override may be added by this task** - every new file must be under the
  base budget (complexity 15, max-depth 4, 200 lines per function, 400 lines per
  file; test files get 800 lines and no per-function limit).
- `src/app/profile/page.tsx` is pinned at `complexity 23`,
  `max-lines-per-function 385`, `max-lines 714`. Measured per function:
  complexity 23 and 385 lines both belong to `BandProfileView` (L34), which this
  task does not touch; `PersonalProfileView` (L423) is complexity 14 / 224
  lines; the file is 714 lines. So the binding number here is `max-lines`, and
  the ceiling test requires it to equal the file's new line count exactly.
- Line counts: `src/lib/profile.ts` 84, `src/app/actions/profile.ts` 25,
  `src/lib/auth.ts` 94, `src/app/profile/page.tsx` 714.
- The Coverage CI job (`.github/workflows/ci.yml:125-131`) sets `DATABASE_URL`
  and `SUPABASE_SERVICE_ROLE_KEY` but **not** `BETTER_AUTH_SECRET`; the e2e job
  (L39-41) does. Better Auth falls back to its default secret outside
  production, so the new tests would pass either way, but the fallback is not
  something to depend on - this task adds the variable to the Coverage job.
- E2E green files: `e2e/server-pages.spec.ts` (4), `e2e/ssr-smoke.spec.ts` (4),
  `e2e/auth.spec.ts --grep credentials` (2), `e2e/bands-confirm.spec.ts` (4,
  `--retries=1` allowed). `e2e/songs-crud.spec.ts` and
  `e2e/fast-view-mobile.spec.ts` are red at 890a27b (RH-44) and stay out of
  scope. No e2e file covers `/profile`, so this task adds none.
- i18n: `src/i18n/dictionaries/{en,pt-BR}.json` carry only `common`, `nav`,
  `status` and `landing`. Profile copy is hard-coded English everywhere in
  `src/app/profile/page.tsx` (F25 records that the dictionary reaches 2 of 29
  components). This task follows its neighbours and adds **no** dictionary keys.

## Approach

### 1. Migration `migrations/0008_sync_profile_email.sql`

A trigger function plus an `AFTER UPDATE OF email ON "user"` row trigger,
`WHEN (OLD.email IS DISTINCT FROM NEW.email)`, that runs
`UPDATE profiles SET email = NEW.email WHERE id = NEW.id`. Name the trigger
`sync_profile_email_on_user_update`, mirroring the existing
`sync_band_repertoire_on_member_update`. Guard both objects so re-running the
migration is a no-op (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`
before `CREATE TRIGGER`). Finish with a one-shot backfill of any pre-existing
drift:

```sql
UPDATE profiles p SET email = u.email
FROM "user" u WHERE p.id = u.id AND p.email IS DISTINCT FROM u.email;
```

This is what makes the design safe: whoever writes `"user".email` - Better
Auth's verify-email handler, a future admin tool, a psql session during an
incident - the profile row follows atomically, because it is the same
transaction. It also removes the need for the deleted two-statement transaction.

### 2. `src/lib/authEmail.ts` (new)

One sender for all three auth mails, so the HTML template exists once (today's
template is a 20-line literal inside `sendResetPassword`; two more copies would
be a jscpd clone).

```ts
export interface AuthEmail {
  to: string
  subject: string
  greeting: string   // "Hello, Jane!"
  body: string       // one sentence of context
  ctaLabel: string   // "Reset password" / "Confirm new email" / "Verify email"
  url: string
  footnote: string   // "If you didn't request this, you can safely ignore this email."
}

export function renderAuthEmail(email: AuthEmail): string      // pure, unit-tested
export async function sendAuthEmail(email: AuthEmail): Promise<void>
```

`sendAuthEmail` keeps the existing behaviour verbatim: with no `RESEND_API_KEY`
it prints `[AUTH] <subject> for <to>` and `[AUTH] URL: <url>` via `console.log`
and returns (the deliberate, documented non-Sentry echo - this is the local dev
path, and the way a developer or QA completes a change with no mail provider);
with a key it `await import('resend')`, sends with `from = EMAIL_FROM ||
'onboarding@resend.dev'`, and swallows a failure through `logger.error` (never
`console.error`) so a send failure cannot turn into a 500 or an enumeration
oracle.

`sendResetPassword` in `src/lib/auth.ts` is rewritten to call it; **its
observable behaviour must not change**, and ER4 is what holds that: the callback
must still hand the mail to the address it was given, carry the same `url`, keep
a subject naming the password reset, and never reject. Because all three mail
callbacks in `src/lib/auth.ts` are awaited by Better Auth
(`runInBackgroundOrAwait` awaits whenever `advanced.backgroundTasks.handler` is
unset, `node_modules/better-auth/dist/context/create-context.mjs:211-224`), a rejection there would surface as a 500 on
`/forget-password` and, on `/change-email`, as a timing/status difference between
the taken and free case - the very oracle the design avoids. So the three
callbacks do not call `sendAuthEmail` directly; they go through one small
non-rejecting wrapper local to `src/lib/auth.ts`:

```ts
async function mailOrLog(email: AuthEmail): Promise<void> {
  try {
    await sendAuthEmail(email)
  } catch (error) {
    logger.error('Failed to send auth email', error instanceof Error ? error : new Error(String(error)))
  }
}
```

One `catch`, narrowed per AGENTS.md, in the file that already swallows a Resend
failure exactly this way today (`src/lib/auth.ts:59-64`). It is also what makes
ER4's second test meaningful: with `@/lib/authEmail` mocked to reject, the
configured `sendResetPassword` still resolves.

### 3. `src/lib/auth.ts` configuration

```ts
user: {
  changeEmail: {
    enabled: true,
    // Every account here is unverified (requireEmailVerification: false and no
    // sign-up verification mail), so leaving this true would restore exactly
    // the unverified rewrite RH-42 removes. See update-user.mjs L424/L439.
    updateEmailWithoutVerification: false,
    sendChangeEmailConfirmation: ({ user, newEmail, url }) =>
      mailOrLog({ to: user.email, /* CURRENT address */ ... }),
  },
},
emailVerification: {
  sendVerificationEmail: ({ user, url }) =>
    mailOrLog({ to: user.email, /* the NEW address on the change path */ ... }),
  expiresIn: 3600,
},
```

**Which address gets the mail, and why.** Verification always ends at the
**new** address, because that is the only thing that proves control of it -
without it a user can move their login onto an address they do not own, which is
F12's actual risk. Both options are configured because 1.6.22 picks the branch
from `session.user.emailVerified`: an unverified current address (every account
today) goes straight to the new-address verification (L480), while a verified
one first gets a **confirmation to the current address** (L465) whose link then
triggers the new-address verification (email-verification.mjs L191-205). The
second branch is a hijack alarm - it tells the address that is losing the
account that something is happening - and it becomes reachable for every user
the first time they complete a change, since `verify-email` sets
`emailVerified: true`. `requireEmailVerification` stays `false` and
`sendOnSignUp` stays unset, so sign-in and sign-up are untouched.

### 4. `src/lib/emailChange.ts` (new)

```ts
export const EMAIL_CHANGE_CALLBACK = '/profile'

export function normalizeEmail(raw: string): string           // trim + toLowerCase
export function validateEmailChange(currentEmail: string, raw: string): string
export async function requestEmailChange(requestHeaders: Headers, raw: string): Promise<void>
```

`validateEmailChange` is pure and returns the normalized address or throws a
user-facing message (thrown **outside** any wrapping `try`, per AGENTS.md L1a,
so the text survives verbatim to the banner):

- empty/whitespace -> `Enter an email address`
- fails the format check -> `Enter a valid email address`
- equals the current address after normalizing -> `That is already your email address`

`requestEmailChange` resolves the session itself from the headers it is handed
(`auth.api.getSession({ headers: requestHeaders })`, throwing `Not
authenticated` when there is none - defence in depth behind the action's own
`getRequiredUserId()`), validates against `session.user.email`, then calls
`auth.api.changeEmail({ body: { newEmail, callbackURL: EMAIL_CHANGE_CALLBACK },
headers: requestHeaders })` inside an L1 `try/catch` that logs and rethrows
`Failed to request email change: ${err.message}`. Taking `Headers` as a
parameter rather than calling `next/headers` internally is deliberate: it keeps
`next/headers` out of `src/lib`, and it is what lets the database test drive the
real flow with a real session cookie and no module mocking.

**No uniqueness pre-check.** The remediation text asks for one; it is
deliberately not implemented, because a "that address is taken" response is an
account-enumeration oracle on a public endpoint, and 1.6.22 already answers the
taken case with a silent `{ status: true }` and no mail (update-user.mjs
L431-435). Uniqueness is enforced where it belongs: the `UNIQUE` constraint on
`"user".email`. The UI copy is therefore identical for the taken and the
not-taken case.

### 5. `src/app/actions/profile.ts`

`updateEmailAction` is deleted and replaced by:

```ts
export async function requestEmailChangeAction(newEmail: string): Promise<void> {
  await getRequiredUserId()
  return requestEmailChange(await headers(), newEmail)
}
```

It stays an A2 thin action - no `try/catch`, no data access - and it keeps the
literal `getRequiredUserId()` call that
`src/app/actions/__tests__/actionAuthorizationGuard.test.ts` requires, so no
allowlist entry is added there.

`updateEmail` is deleted from `src/lib/profile.ts` together with its
`withTransaction` import; `getProfile` and `updateProfile` are untouched.

**Deviation from F12's remediation.** F12 suggests keeping the direct write
behind `checkSystemAdmin`. It is deleted outright instead: there is no admin
caller today and none is planned in this task, `npm run lint:dead` (knip) fails
on an export nobody imports, and a privileged raw-identity write kept alive "for
later" is exactly what the new guard test exists to prevent. If an admin email
edit is ever needed it goes through `auth.api.changeEmail` / `auth.api.updateUser`
with an admin check, not through SQL. Recorded in `docs/suggestions-log.md`.

### 6. UI: `src/components/profile/EmailChangeSection.tsx` (new island)

The email section moves out of `PersonalProfileView` into a `"use client"`
component under `src/components/profile/` (next to the existing
`InstrumentPicker`), receiving `currentEmail` and an injected
`{ requestEmailChange(newEmail: string): Promise<void> }` actions object as
props - the page owns the Server Action and passes it down, per the F21 import
direction. This is also what keeps `src/app/profile/page.tsx` under its pinned
`max-lines` ceiling: the file must shrink, and its override entry is then
re-pinned downward to the new count (the ratchet allows shrinking only, and
`complexityBudget.test.ts` requires the ceiling to equal the current worst
number exactly).

Behaviour and copy (exact strings, so they can be grepped):

- Idle: the input is pre-filled with the current address; the button reads
  `Change`, disabled while the value is empty or equal to the current address.
- Before submit, under the field, when the value differs:
  `We will email a confirmation link to <value>. Your sign-in address stays <current> until you open it.`
- While submitting the button reads `Sending...`.
- After a successful request the section switches to a pending state:
  `Confirmation link sent to <value>. Your sign-in address is still <current> and only changes when you open that link.`
  followed by the recourse line
  `If it does not arrive, check your spam folder and try again.`
  The same copy is used whether or not the address was already taken - which is
  also why the recourse line is worth its two lines of markup: in the
  already-taken case no mail is ever sent (`update-user.mjs` L431-435) and this
  sentence is the only guidance the user gets, while leaking nothing about
  whether the address exists.
- On rejection the message from the action is surfaced through the existing
  `AlertBanner` (tone `error`), not a toast, matching the section's neighbours.
- The line `A confirmation link will be sent to ...` is deleted - it is the
  false promise F12 names.
- No `alert()` / `confirm()` (`src/lib/__tests__/noBrowserDialogs.test.ts`).

The pending state is **client-only and not persisted**: the token is a JWT and
there is no pending-change row anywhere to read. After a reload the section is
idle again and shows the still-current address; after the link is opened, Better
Auth redirects to `/profile` (the `callbackURL`) with a refreshed session, and
the section shows the new address because `getProfileAction` reads the
trigger-synced `profiles` row. Say so in the component's header comment.

No i18n keys, and no landing-page change: a verified email change is account
security plumbing, not a reason a musician picks this app, so the Landing Page
Rule resolves to "not a selling point" and `src/components/landing` must be
byte-identical.

### 7. Guard: `src/lib/__tests__/identityWriteGuard.test.ts` (new)

Modelled on `src/lib/__tests__/errorHandlingStyle.test.ts`: a detector half with
its sample strings built by concatenation (so a plain grep for the banned text
does not flag this file) and a tree half that runs `findViolations` from
`src/lib/__tests__/test-helpers.ts` over every `.ts`/`.tsx` under `src/` with
comments stripped, skipping only its own path, and expects zero violations.

Patterns: `/\bUPDATE\s+"?user"?\s+SET\b/i` and
`/\bUPDATE\s+profiles\s+SET\b[^\n]*\bemail\b/i`. The second is column-scoped on
purpose: `UPDATE profiles SET is_system_admin = true WHERE id = $1` appears in
three existing test files and must keep passing.

**Known limitation, to be written into the suite's header comment.**
`findViolations` splits the source on `\n` before testing, so both patterns are
line-scoped, and `updateProfile` in `src/lib/profile.ts` already shows the shape
that evades them: a template literal with `UPDATE profiles` on one line and
`SET ...` on the next. A re-introduced raw identity write formatted that way
would not be caught. The guard is a ratchet against the exact statement that was
deleted and against a careless re-add, not a proof; say so in the header comment
so the next reader does not over-trust it.

### 8. Tests

| File | Kind | What it proves |
| --- | --- | --- |
| `src/lib/__tests__/emailChange.test.ts` | unit (`@/lib/auth` mocked) | validation table; delegation shape; L1 wrapping |
| `src/lib/__tests__/authEmail.test.ts` | unit | dev echo with no key; Resend path with a key; swallowed send failure |
| `src/lib/__tests__/authConfig.test.ts` | unit (`@/lib/authEmail` mocked) | `auth.options` really carries the change-email flow; `sendResetPassword` still mails the same thing after the extraction (ER4) |
| `src/lib/__tests__/emailChangeVerification.db.test.ts` | real database | the whole flow, end to end |
| `src/lib/__tests__/identityWriteGuard.test.ts` | source scan | the raw UPDATE cannot come back |
| `src/components/profile/__tests__/EmailChangeSection.test.tsx` | jsdom | pending copy, error banner, disabled button |
| `src/lib/__tests__/profile.test.ts` | edit | drop the two `updateEmail` tests |
| `src/lib/__tests__/transactionAtomicity.db.test.ts` | edit | drop the `updateEmail` case and its import |
| `src/app/actions/__tests__/{thinActions,actionSessionGuard}.test.ts` | edit | retarget the table row at `requestEmailChangeAction` (more than a rename - see below) |

The database test creates its user through the real endpoint -
`auth.api.signUpEmail({ body: {...}, returnHeaders: true })` returns
`{ headers, response }` (`node_modules/better-auth/dist/types/api.d.mts:20-24`),
and `headers.get('set-cookie')` is the session cookie to hand to
`requestEmailChange` as a `Headers` object. It mocks `@/lib/authEmail` so
`sendAuthEmail` calls are captured (recipient + URL) instead of being printed,
extracts `token` from the captured URL, and consumes it with
`auth.api.verifyEmail({ query: { token } })`. It follows the house shape for
DB suites (`describe.skipIf(!SERVICE_ROLE_KEY)`, unique per-run email suffixes,
fixtures deleted in `afterAll`, failure injected by a `BEFORE UPDATE` trigger
whose `WHEN` clause names exactly one fixture row and which is dropped
afterwards). It issues no raw `UPDATE` against `"user"` or `profiles.email` -
every state change goes through `auth.api`, which is also what keeps it green
under the new guard.

`src/app/actions/__tests__/actionSessionGuard.test.ts` mocks `@/lib/db` to
throw; the new action reaches `@/lib/emailChange` -> `@/lib/auth`, so add
`vi.mock('next/headers', ...)` returning an empty `Headers` and a
`vi.mock('@/lib/emailChange', ...)` whose `requestEmailChange` throws "the email
change must not be requested without a session", in the same spirit as the
existing database mock. The action must still reject before reaching it.

`src/app/actions/__tests__/thinActions.test.ts` needs more than a rename. Its
`updateEmailAction` row today mocks `@/lib/profile` and asserts
`toHaveBeenCalledWith(USER_ID, 'new@example.com')` under the title "$name passes
the resolved session user id through to src/lib" - but the new action passes no
user id at all, it passes `(Headers, newEmail)`. So the row gets: a new mock
target (`vi.mock('@/lib/emailChange', () => ({ requestEmailChange: vi.fn() }))`),
a `vi.mock('next/headers', ...)` returning an empty `Headers`, and an `expected`
of `[expect.any(Headers), 'new@example.com']`. `updateEmail` leaves the
`@/lib/profile` mock factory and the import list with it. The other two
`it.each` cases (L1 error propagation, missing session) need no change: the new
action still returns the delegate's value and still rejects before delegating
when `getRequiredUserId` throws.

### 9. Documentation

- **AGENTS.md**, a new bullet in "Key architectural decisions":
  "**Identity fields change only through Better Auth's verified flows (RH-42).**
  `"user".email` is the login identity: no SQL under `src/` may `UPDATE` the
  `"user"` table, and no application code writes `profiles.email`. A user-facing
  change goes through `requestEmailChange` (`src/lib/emailChange.ts`) ->
  `auth.api.changeEmail`, which mails a verification link and leaves the row
  untouched until the link is opened at `/api/auth/verify-email`;
  `profiles.email` follows automatically through the
  `sync_profile_email_on_user_update` trigger
  (`migrations/0008_sync_profile_email.sql`), in the same transaction as the
  write, so the two identity rows cannot diverge. Enforced by
  `src/lib/__tests__/identityWriteGuard.test.ts`."
- **AGENTS.md**, error-handling exceptions: the `console.log` dev echo now lives
  in `src/lib/authEmail.ts` and covers every auth mail, not only the
  password-reset URL - update that sentence.
- **AGENTS.md**, stack list: `resend` is transactional email for "password reset
  and email-change verification".
- **`docs/plans/code-quality-review.md`**: a `**Status:**` line on F12 and on T9
  (section 5), naming RH-42 and its commit, stating what replaced the raw write,
  which address receives which mail and why, that the uniqueness pre-check was
  deliberately not added, and naming the guard.
- **`docs/suggestions-log.md`**: an RH-42 entry recording the two deviations
  (no admin-only raw write, no uniqueness pre-check) and the removal of RH-36's
  `updateEmail` atomicity case.
- **`package.json`**: `0.1.97-YYYYMMDDHHmm` with a real local timestamp, above
  `0.1.96-202609091801`.

### Whitelist

Exactly these paths may change (the ER14 closed set):

`.github/workflows/ci.yml`, `AGENTS.md`, `docs/plans/code-quality-review.md`,
`docs/suggestions-log.md`, `docs/tasks/RH-42-spec.md`, `eslint.config.mjs`,
`migrations/0008_sync_profile_email.sql`, `package.json`,
`src/app/actions/__tests__/actionSessionGuard.test.ts`,
`src/app/actions/__tests__/thinActions.test.ts`, `src/app/actions/profile.ts`,
`src/app/profile/page.tsx`, `src/components/profile/EmailChangeSection.tsx`,
`src/components/profile/__tests__/EmailChangeSection.test.tsx`,
`src/lib/__tests__/authConfig.test.ts`, `src/lib/__tests__/authEmail.test.ts`,
`src/lib/__tests__/emailChange.test.ts`,
`src/lib/__tests__/emailChangeVerification.db.test.ts`,
`src/lib/__tests__/errors.test.ts`,
`src/lib/__tests__/identityWriteGuard.test.ts`,
`src/lib/__tests__/profile.test.ts`,
`src/lib/__tests__/transactionAtomicity.db.test.ts`, `src/lib/auth.ts`,
`src/lib/authEmail.ts`, `src/lib/emailChange.ts`, `src/lib/profile.ts`.

## Expected Results

ER1 - The raw identity write is gone from the application. At 890a27b `grep -rnw "updateEmail" src` prints 17 lines (across `src/lib/profile.ts`, `src/app/actions/profile.ts`, `src/app/profile/page.tsx`, `src/app/actions/__tests__/thinActions.test.ts`, `src/lib/__tests__/profile.test.ts`, `src/lib/__tests__/transactionAtomicity.db.test.ts` and the comment at `src/lib/__tests__/errors.test.ts:453`); after this task `grep -rnw "updateEmail" src` prints nothing at all. At 890a27b `grep -rn "updateEmailAction" src` prints 7 lines; after this task it prints nothing at all. The word-boundary form `-w` is deliberate and must not be relaxed to a plain substring grep: `updateEmailWithoutVerification`, the Better Auth option ER3 requires `src/lib/auth.ts` to set to `false`, contains `updateEmail` as a substring, so a substring grep would contradict ER3 and the only way to satisfy both would be to drop the explicit `false` - which is exactly the unverified rewrite this task removes. `grep -rnw "updateEmail" src` does not match `updateEmailWithoutVerification` and is the check that has force here. `grep -c "withTransaction" src/lib/profile.ts` prints `0` (it printed `1` at 890a27b, on the import line). `grep -c "" src/lib/profile.ts` prints a number less than or equal to `67` (it printed `84`). The two surviving exports are intact: `grep -c "export async function getProfile\|export async function updateProfile" src/lib/profile.ts` prints `2`. `grep -rn "A confirmation link will be sent" src` prints nothing at all (it printed one line, `src/app/profile/page.tsx:640`, the confirmation that was promised but never sent).

ER2 - A source guard makes the raw write unable to return. `test -f src/lib/__tests__/identityWriteGuard.test.ts` exits `0` (the file does not exist at 890a27b) and `rtk proxy npx vitest run src/lib/__tests__/identityWriteGuard.test.ts` exits `0` reporting `Test Files 1 passed (1)`, `Tests` at least `8` passed, `0 failed` and `0 skipped`. The suite has a detector half whose sample strings are built by concatenation (so a plain grep for the banned text does not flag the file itself) proving the matcher flags `UPDATE "user" SET email = $1, "updatedAt" = now() WHERE id = $2::uuid` (the statement deleted from `src/lib/profile.ts:76`), flags a lowercase unquoted `update user set email = 'x'`, flags `UPDATE profiles SET email = $1 WHERE id = $2::uuid` (deleted line 77), and does NOT flag `UPDATE profiles SET is_system_admin = true WHERE id = $1` (which appears in three test files today), does NOT flag `INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)` (`src/lib/__tests__/test-helpers.ts:230`) and does NOT flag the same statement inside a `//` comment. It also has a tree half that scans every `.ts` and `.tsx` file under `src/` with comments stripped, skipping only its own path, and asserts the violation list is empty.

ER3 - Better Auth is configured for a verified change, and sign-up is untouched. `test -f src/lib/__tests__/authConfig.test.ts` exits `0` and `rtk proxy npx vitest run src/lib/__tests__/authConfig.test.ts` exits `0` reporting `Test Files 1 passed (1)`, `Tests` at least `8` passed, `0 failed` and `0 skipped` (six configuration assertions below, plus the two password-reset tests of ER4, which live in this same file). The suite imports `auth` from `@/lib/auth` and asserts on `auth.options`: `user.changeEmail.enabled` is exactly `true`; `user.changeEmail.updateEmailWithoutVerification` is exactly `false` (not merely absent - with the app's unverified accounts a `true` here restores the pre-RH-42 behaviour, see `node_modules/better-auth/dist/api/routes/update-user.mjs` lines 424 and 439); `typeof user.changeEmail.sendChangeEmailConfirmation` is `'function'`; `typeof emailVerification.sendVerificationEmail` is `'function'`; `emailVerification.expiresIn` is exactly `3600`, so a verification link lives one hour rather than the package default; `emailAndPassword.requireEmailVerification` is `false` and `emailVerification.sendOnSignUp` is `undefined`, so sign-up still mails nothing (`node_modules/better-auth/dist/api/routes/sign-up.mjs:241`). Separately, `grep -c "RESEND_API_KEY" src/lib/auth.ts` prints `0` (it printed `1` at 890a27b) and `grep -c "RESEND_API_KEY" src/lib/authEmail.ts` prints a number greater than or equal to `1`.

ER4 - Password reset, the app's only live mail flow, still sends the same mail after its plumbing moves. This is asserted in `src/lib/__tests__/authConfig.test.ts` (the suite of ER3, whose test count of at least `8` includes these two), with `@/lib/authEmail` mocked so nothing is sent: calling `auth.options.emailAndPassword.sendResetPassword({ user: { email: 'reset-target@example.com', name: 'Jane' }, url: 'https://example.com/reset?token=abc' })` resolves, and calls the mocked `sendAuthEmail` exactly once with an argument whose `to` is exactly `reset-target@example.com` (the address the callback was handed, not `EMAIL_FROM` and not the session user), whose `url` is exactly `https://example.com/reset?token=abc`, and whose `subject` contains `password` case-insensitively - the three properties that make the mail usable, and the three a careless extraction drops. A second test proves the callback cannot turn a mail failure into a request failure: with the mocked `sendAuthEmail` rejecting, the same call still resolves and does not reject, matching the behaviour at 890a27b where `src/lib/auth.ts:59-64` swallows a Resend failure through `logger.error`. `grep -rl "sendResetPassword" src | sort` prints exactly two paths after this task - `src/lib/auth.ts` (the definition) and `src/lib/__tests__/authConfig.test.ts` (the invocations) - where at 890a27b `grep -rn "sendResetPassword" src` printed exactly one line and `grep -rl` exactly one path (`src/lib/auth.ts:28`, with no test anywhere and `src/lib/auth.ts` excluded from the coverage universe by `vitest.config.ts:67`, which is why this result exists).

ER5 - One new migration installs the trigger that keeps the two identity rows equal. `ls migrations` lists exactly eight files, the new one being `migrations/0008_sync_profile_email.sql` (890a27b has seven, the last being `0007_add_playlist_song_position_unique.sql`), and `rtk proxy npx vitest run src/lib/__tests__/migrationsSingleSource.test.ts` exits `0` with `0 failed`. With Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `npm run db:migrate` exits `0` and applies it. Re-runnability is proved by applying the file itself twice rather than through the runner - `psql -v ON_ERROR_STOP=1 "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f migrations/0008_sync_profile_email.sql` exits `0` on both runs (with `ON_ERROR_STOP` set, psql exits `3` on the first failing statement, so a migration lacking `CREATE OR REPLACE FUNCTION` / `DROP TRIGGER IF EXISTS` would exit `3` on the second run) - because `scripts/migrate.mjs` records applied filenames in `_migrations` and prints `Skipping migration: ... (already executed)` on a second pass, so running the runner twice would never re-execute the file and would prove nothing about `CREATE OR REPLACE FUNCTION` and `DROP TRIGGER IF EXISTS`. The trigger's existence and name are asserted from the database test of ER6, which reads `SELECT tgname FROM pg_trigger WHERE tgrelid = '"user"'::regclass AND NOT tgisinternal` and finds `sync_profile_email_on_user_update` among the rows.

ER6 - The real flow, against the real database: the login identity does not move until the link is opened. `test -f src/lib/__tests__/emailChangeVerification.db.test.ts` exits `0`, and with Postgres up, `npm run db:migrate` having exited `0` so `migrations/0008_sync_profile_email.sql` is applied, plus a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, `rtk proxy npx vitest run src/lib/__tests__/emailChangeVerification.db.test.ts` exits `0` reporting `Test Files 1 passed (1)`, `Tests` at least `6` passed, `0 failed` and `0 skipped`. The suite creates its user through `auth.api.signUpEmail({ body: {...}, returnHeaders: true })` and reuses the returned `set-cookie` as the session, mocks `@/lib/authEmail` to capture recipients and URLs instead of sending, and drives every state change through `auth.api` (it contains no `UPDATE` statement against `"user"` or against `profiles.email`, which is also what keeps it green under ER2). It proves, as separate named tests: (a) after `requestEmailChange(headers, newAddress)` resolves, `SELECT email FROM "user" WHERE id = <user>` still returns the ORIGINAL address and `SELECT email FROM profiles WHERE id = <user>` still returns the ORIGINAL address, while exactly one mail was captured and its recipient is the NEW address; (b) consuming the captured token with `auth.api.verifyEmail({ query: { token } })` makes `SELECT email, "emailVerified" FROM "user" WHERE id = <user>` return the NEW address and `true`, and `SELECT email FROM profiles WHERE id = <user>` return the NEW address as well, with no application code having written the profile row; (c) with a `BEFORE UPDATE` trigger on `profiles` scoped by a `WHEN` clause to that one fixture row and dropped afterwards, `auth.api.verifyEmail` on a fresh token rejects and `SELECT email FROM "user" WHERE id = <user>` still returns the address it had before the call, so the auth row and the profile row cannot diverge; (d) requesting a change to an address that already belongs to a second fixture user resolves without throwing, captures ZERO mails and leaves both users' `"user".email` and `profiles.email` unchanged (Better Auth answers the taken case with a silent success to avoid account enumeration - `update-user.mjs` lines 431 to 435); (e) a user whose current address is verified - which is the state test (b) leaves behind - gets the next confirmation at the CURRENT address, not the new one, the row is still unchanged after opening it, a second mail then arrives at the NEW address, and only consuming that second token moves the row.

ER7 - Validation and delegation are unit-tested. `test -f src/lib/__tests__/emailChange.test.ts` exits `0` and `rtk proxy npx vitest run src/lib/__tests__/emailChange.test.ts` exits `0` reporting `Test Files 1 passed (1)`, `Tests` at least `10` passed, `0 failed` and `0 skipped`. With `@/lib/auth` mocked, the suite proves: `validateEmailChange` returns the trimmed lowercased address for `  Jane@Example.COM  `; it throws exactly `Enter an email address` for an empty or whitespace-only input; exactly `Enter a valid email address` for `jane`, `jane@`, `@example.com` and `jane example@x.com`; exactly `That is already your email address` when the input normalizes to the session's current address (including a differing-case variant); `requestEmailChange` throws `Not authenticated` when `auth.api.getSession` resolves to `null` and never calls `auth.api.changeEmail`; on the happy path it calls `auth.api.changeEmail` exactly once with `body.newEmail` normalized and `body.callbackURL` equal to `/profile`, forwarding the same `Headers` instance it was given; and when `auth.api.changeEmail` rejects, it calls `logger.error` and rejects with a message matching `/^Failed to request email change: /`.

ER8 - The mail plumbing exists once and still works with no provider configured. `test -f src/lib/authEmail.ts` exits `0`, `test -f src/lib/__tests__/authEmail.test.ts` exits `0`, and `rtk proxy npx vitest run src/lib/__tests__/authEmail.test.ts` exits `0` reporting `Test Files 1 passed (1)`, `Tests` at least `5` passed, `0 failed` and `0 skipped`. The suite proves: with `RESEND_API_KEY` unset (which is the state of `.env.local` in this repo, so it is the local path, not a fallback), `sendAuthEmail` resolves, writes the URL to `console.log`, and never constructs a Resend client; with the key set, it calls Resend's `emails.send` exactly once with the recipient, the subject, a `from` of `EMAIL_FROM` or `onboarding@resend.dev`, and an HTML body containing the URL; a rejecting send resolves anyway and is reported through `logger.error`, never `console.error`; and `renderAuthEmail` embeds the URL and the CTA label in its output. `grep -rn "console.error" src/lib/authEmail.ts` prints nothing at all, and `rtk proxy npx vitest run src/lib/__tests__/errorHandlingStyle.test.ts` exits `0` with `0 failed`.

ER9 - The email UI is an island with honest copy and no browser dialogs. `test -f src/components/profile/EmailChangeSection.tsx` exits `0` (the file does not exist at 890a27b) and `head -1 src/components/profile/EmailChangeSection.tsx` prints exactly `"use client";`. `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing at all, so the section receives its Server Action as an injected prop rather than importing it. `grep -rnE "(^|[^A-Za-z.])(alert|confirm)\(" src/components/profile src/app/profile/page.tsx` prints nothing at all. The four copy strings are present verbatim in `src/components/profile/EmailChangeSection.tsx`: `We will email a confirmation link to`, `Your sign-in address stays`, `Confirmation link sent to`, and `check your spam folder`. `test -f src/components/profile/__tests__/EmailChangeSection.test.tsx` exits `0` and `rtk proxy npx vitest run src/components/profile/__tests__/EmailChangeSection.test.tsx` exits `0` reporting `Test Files 1 passed (1)`, `Tests` at least `5` passed, `0 failed` and `0 skipped`, proving that the button is disabled while the field is empty or equals the current address, that a successful submit renders the `Confirmation link sent to <new address>` copy while the current address is still displayed as the sign-in address, that the same copy is rendered regardless of the address submitted, and that a rejected submit renders the thrown message in an error banner and does NOT render the sent copy.

ER10 - The profile page shrank and its complexity override was re-pinned downward. `grep -c "" src/app/profile/page.tsx` prints a number less than or equal to `700` (it printed `714` at 890a27b) and `grep -c "EmailChangeSection" src/app/profile/page.tsx` prints a number greater than or equal to `1`. In `eslint.config.mjs`, the block between `// BEGIN:complexity-budget-overrides` and `// END:complexity-budget-overrides` still contains exactly `20` entries and no new one (`MAX_OVERRIDES` is 20 and the list is already at the cap, so any new file must be under the base budget); the entry for `src/app/profile/page.tsx` keeps `complexity 23` and `max-lines-per-function 385` (both belong to `BandProfileView`, which this task does not touch) and its `max-lines` equals the file's new line count exactly. `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits `0` reporting `0 failed`, which is what proves the ceiling is exact rather than merely lower.

ER11 - The action layer renamed cleanly and every existing guard still holds. `grep -c "requestEmailChangeAction" src/app/actions/profile.ts` prints `1`; `grep -c "getRequiredUserId()" src/app/actions/profile.ts` prints `3`; `grep -cE "query\(|@/lib/db" src/app/actions/profile.ts` prints `0`; `grep -c "try {" src/app/actions/profile.ts` prints `0` (the file has no catch blocks - it is A2 thin). `rtk proxy npx vitest run src/app/actions/__tests__ src/lib/__tests__/profile.test.ts src/lib/__tests__/transactionAtomicity.db.test.ts` exits `0` reporting `0 failed` and `0 skipped`, with `requestEmailChangeAction` present in the `actionSessionGuard` table (its key-set assertion makes an untabulated action impossible) and failing closed when the session cannot be resolved. `src/lib/__tests__/transactionAtomicity.db.test.ts` no longer imports `@/lib/profile` and its remaining tests, including the idle-in-transaction check, still pass.

ER12 - No gate moved backwards. `./node_modules/.bin/tsc --noEmit` exits `0` and prints nothing (same as 890a27b). `rtk proxy npx eslint .` reports at most `22 problems`, with exactly `8 errors` and at most `14 warnings` - the same 8 errors as 890a27b, none of them in a file this task created. With Postgres up and `SUPABASE_SERVICE_ROLE_KEY` non-empty, `rtk proxy npx vitest run` exits `0` reporting `Test Files` passed at least `106` (was 100; six new suites), `Tests` passed at least `1180` (was 1148), `0 failed` and `0 skipped`. `npm run test:coverage` exits `0` with all four thresholds met (statements at least 80, branches at least 65, functions at least 78, lines at least 80), and per-file coverage read out of the artefact this repo emits - `node -e "const c=require('./coverage/coverage-final.json');const pct=a=>a.length?Math.round(1000*a.filter(x=>x>0).length/a.length)/10:100;for (const k of Object.keys(c)) if (k.endsWith('/src/lib/emailChange.ts')||k.endsWith('/src/lib/authEmail.ts')) console.log(k.split('/src/').pop(), pct(Object.values(c[k].s)), pct(Object.values(c[k].f)))"` - prints exactly two lines, `lib/emailChange.ts` and `lib/authEmail.ts` in some order, each followed by a statement percentage and a function percentage of at least `85`. `npm run lint:dup` reports at most `18` clones and at most `0.64 %` (equal at 890a27b), and `npm run lint:dead` exits `0`.

ER13 - The application still builds and the green end-to-end specs stay green. `npm run build` exits `0`. Then, with `BETTER_AUTH_SECRET` exported from `.env.local` before `next start`, all four green specs pass unchanged: `e2e/server-pages.spec.ts` (4 passed), `e2e/ssr-smoke.spec.ts` (4 passed), `e2e/auth.spec.ts --grep credentials` (2 passed - this one matters most, because sign-up and sign-in run through the auth configuration this task edits) and `e2e/bands-confirm.spec.ts` (4 passed, `--retries=1` allowed). `e2e/songs-crud.spec.ts` and `e2e/fast-view-mobile.spec.ts` are red at 890a27b for unrelated reasons (RH-44) and are not part of this result. `.github/workflows/ci.yml` gains `BETTER_AUTH_SECRET` in the Coverage job's `env:` block, which at 890a27b sets only `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN`, so the new auth tests do not depend on Better Auth's default-secret fallback.

ER14 - Documentation, the finding close-out and release hygiene. `AGENTS.md` gains a named rule whose text contains `Identity fields change only through` and `identityWriteGuard`, and its two existing sentences are corrected. The error-handling exception at `AGENTS.md:200` no longer points at the old location: `grep -c "password-reset URL in \`src/lib/auth.ts\`" AGENTS.md` prints `0` where it printed `1` at 890a27b, `grep -c "dev echo" AGENTS.md` still prints `1` (the exception is rewritten, not deleted), and `grep -c "src/lib/authEmail.ts" AGENTS.md` prints a number greater than or equal to `1` where it printed `0` at 890a27b, so the sentence now names the file the echo actually lives in and says it covers every auth mail rather than the password-reset URL alone. The `resend` stack bullet names the email-change use as well. In `docs/plans/code-quality-review.md`, the F12 section (heading `### F12 - updateEmail rewrites the login identity with no verification and no validation`) and the T9 section (`### T9 - Require verification for email changes`) each gain a `**Status:**` line naming RH-42 and its commit hash and stating what replaced the raw write, which address receives which mail, and that the uniqueness pre-check was deliberately omitted to avoid account enumeration; `grep -c "^\*\*Status:\*\*" docs/plans/code-quality-review.md` prints `16` (it printed `14` at 890a27b). `docs/suggestions-log.md` gains an `## [RH-42]` entry. `package.json` version is `0.1.97-YYYYMMDDHHmm` with a real local timestamp, sorting above `0.1.96-202609091801`. `git diff 890a27b -- src/components/landing src/i18n/dictionaries` prints nothing at all (account security is not a selling point, so the Landing Page Rule resolves to no landing change). And `git diff --name-only 890a27b | sort` lists only paths drawn from this closed set and no others: `.github/workflows/ci.yml`, `AGENTS.md`, `docs/plans/code-quality-review.md`, `docs/suggestions-log.md`, `docs/tasks/RH-42-spec.md`, `eslint.config.mjs`, `migrations/0008_sync_profile_email.sql`, `package.json`, `src/app/actions/__tests__/actionSessionGuard.test.ts`, `src/app/actions/__tests__/thinActions.test.ts`, `src/app/actions/profile.ts`, `src/app/profile/page.tsx`, `src/components/profile/EmailChangeSection.tsx`, `src/components/profile/__tests__/EmailChangeSection.test.tsx`, `src/lib/__tests__/authConfig.test.ts`, `src/lib/__tests__/authEmail.test.ts`, `src/lib/__tests__/emailChange.test.ts`, `src/lib/__tests__/emailChangeVerification.db.test.ts`, `src/lib/__tests__/errors.test.ts`, `src/lib/__tests__/identityWriteGuard.test.ts`, `src/lib/__tests__/profile.test.ts`, `src/lib/__tests__/transactionAtomicity.db.test.ts`, `src/lib/auth.ts`, `src/lib/authEmail.ts`, `src/lib/emailChange.ts`, `src/lib/profile.ts` - any other path fails this result. In particular that list contains no `src/lib/db.ts`, no `src/lib/moderation.ts`, no `src/proxy.ts`, no second migrations directory and no `e2e/` file.

## Out of Scope

- **An admin-facing email edit.** F12's remediation suggests keeping the raw
  write behind `checkSystemAdmin`. Deleted instead, with the reasoning in
  Approach section 5; if the need appears it is a new task and it goes through
  `auth.api`, not SQL.
- **Email verification at sign-up.** `requireEmailVerification` stays `false` and
  `sendOnSignUp` stays unset. Turning either on would lock out every existing
  unverified account and is a product decision, not a security fix for F12.
- **A uniqueness pre-check with a distinct error message.** Deliberately
  omitted: it is an account-enumeration oracle. See Approach section 4.
- **A pending-change record.** The token is a JWT; no table stores an in-flight
  change, so there is nothing to list, cancel or expire in the UI. Adding one is
  a separate feature.
- **i18n for the profile page.** F25 (the dictionary reaches 2 of 29 components)
  is T10's, not this task's; the new copy is hard-coded English like every
  string around it.
- **F13 and F11.** The derived-state pair and the 1344-line playlist page belong
  to RH-53. `src/app/playlists/[id]/page.tsx` is not touched here.
- **New end-to-end coverage for `/profile`.** No green e2e spec covers that
  route today, and the flow needs a mailbox; the database test carries the
  behaviour instead.
