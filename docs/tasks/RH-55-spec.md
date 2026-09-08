# RH-55 - query tipado parte 2/5: validar o payload de moderacao

Parent: RH-40 (part 2 of 5). Depends on RH-54 (`done`, merged as `f92c0f3`).
Source finding: RH-25 F17 (`docs/plans/code-quality-review.md`, "F17 - Moderation
payload fields reach SQL without type narrowing") and part 2 of the decomposition
in `.meridian/reports/RH-40-spec-1.md`.

## Scope

This task closes F17 and nothing else.

In scope:

- A new module `src/lib/globalSongEditPayload.ts` exporting one type
  `GlobalSongEditPayload` covering the seven `global_songs` columns a moderation
  edit may propose (`title`, `artist`, `album`, `standard_key`, `cover_url`,
  `duration_seconds`, `links`) and exactly one validator
  `parseGlobalSongEditPayload(data: unknown): GlobalSongEditPayload`.
- Calling that validator in `submitGlobalSongEdit` (so a bad payload is rejected
  before the INSERT) and again in `reviewGlobalSongEdit` before the approval
  UPDATE (so a historical `global_song_edits` row is covered too).
- Deleting the ad-hoc narrowing block in `reviewGlobalSongEdit`
  (`src/lib/moderation.ts:116-157`), including its `values: any[]` and the
  `eslint-disable-next-line @typescript-eslint/no-explicit-any` above it, and
  building the approval UPDATE from the parsed payload instead.
- Per-field accept/reject table tests, two new unit tests in
  `src/lib/__tests__/moderation.test.ts`, and a new real-database test file
  proving (a) an invalid submission never reaches the INSERT and (b) a
  hand-inserted historical row with a bad `proposed_data` is refused at approval
  with the catalog row untouched and the edit still `pending`.
- The complexity-budget consequence: `src/lib/moderation.ts` drops from a worst
  function complexity of 19 to 13, which is below the base budget of 15, so its
  per-file override entry is removed from `eslint.config.mjs` and the ratchet
  bound in `src/lib/__tests__/complexityBudget.test.ts` and in AGENTS.md is
  lowered from 24 to 23.

Not in scope (see Out of Scope for the full list): parts 3, 4 and 5 of RH-40
(typing songs/tabs rows, bands/playlists/profile rows, Spotify rows), any schema
change, and any change to the Server Actions, the correction modal or the admin
queue page.

## Audit at f92c0f3

`git log --oneline -1` prints
`f92c0f3 refactor(RH-54): type the query helper with a DbRow default and a row-type home`.
`node -p "require('./package.json').version"` prints `0.1.83-202609080015`.

### The columns and the current narrowing

`migrations/0001_initial_schema.sql` declares the mutable columns of
`global_songs` as `title text NOT NULL`, `artist text NOT NULL`, `album text`,
`standard_key text`, `cover_url text`, `duration_seconds integer` and
`links jsonb NOT NULL DEFAULT '[]'` (an array of `{label, url}`; the domain type
is `SongLink` in `src/types/database.ts:8`).

`reviewGlobalSongEdit` (`src/lib/moderation.ts:116-157`) treats those seven
columns three different ways:

| column | current check | what gets through |
|---|---|---|
| `title` | `typeof proposed.title === 'string'`, then `sanitizeSongTitle` | an empty string, or a string that sanitizes to empty |
| `artist` | `typeof proposed.artist === 'string'`, then `.trim()` | an all-whitespace string |
| `album` | `!== undefined`, then `typeof === 'string' ? sanitizeAlbumName(...) : null` | a number silently becomes `null` |
| `standard_key` | `!== undefined` only | any JSON value, straight into a `text` column |
| `cover_url` | `!== undefined` only | any JSON value, including a non-URL string |
| `duration_seconds` | `!== undefined` only | `"abc"` reaches an `integer` column and fails with an opaque `22P02` |
| `links` | `!== undefined` only, `JSON.stringify` unless already a string | `42`, or an array of anything |

The parameter array is `const values: any[] = []` behind an
`eslint-disable-next-line @typescript-eslint/no-explicit-any`
(`src/lib/moderation.ts:118-119`). `rtk proxy npx eslint src/lib/moderation.ts`
prints nothing today, so that disabled `any` contributes **zero** of the 8
baseline eslint errors: removing it does not move the repo-wide total.

`submitGlobalSongEdit` (`src/lib/moderation.ts:6-24`) performs no validation at
all: it stores `JSON.stringify(data)` verbatim into `proposed_data`.

`src/lib/moderation.ts:116` also holds `edit.proposed_data as Record<string, unknown>`,
a redundant cast (the field is already declared `Record<string, unknown>` in
`GlobalSongEdit`) that this task deletes. The one `.rows[0] as GlobalSongEdit`
cast RH-54 deliberately left at `src/lib/moderation.ts:177` is on a line this
task does not touch, so it stays.

### Every caller and the shape it submits

- `src/app/actions/moderation.ts:11` `submitGlobalSongEditAction(songId, data: Record<string, unknown>)`
  is a thin A2 action with no try/catch; it forwards to `submitGlobalSongEdit`.
- `src/components/songs/CorrectionModal.tsx:52` submits
  `{ title: string, artist: string, album: string | null, standard_key: string | null, reason: string | null }`.
  `title` and `artist` are non-empty (the modal blocks empty ones at
  `CorrectionModal.tsx:43`); `album` and `standard_key` are `trim() || null`.
  **`reason` is not a `global_songs` column** and rides along inside `data`.
  The modal is wired through `src/components/songs/SongForm.tsx:596` and
  `src/app/page.tsx:109`.
- `src/lib/songs.ts:477` (RH-34, `updateSongLinksAction` path) submits
  `{ links: processedLinks }` when a link edit is destructive; `processedLinks`
  is a `SongLink[]` and may legitimately be `[]` (the user removed every link).
- `src/app/admin/moderation/page.tsx:163,178` renders `Object.entries(proposed)`
  verbatim in the "Proposed Edits" column, so today the admin sees the
  requester's `reason` next to the proposed columns. That must keep working.

Consequence for the design: unknown keys cannot be rejected (the modal would
break) and `proposed_data` cannot be replaced by the parsed payload at
submission time (the admin would lose the `reason`). They are **ignored** by the
validator, and the approval UPDATE is built only from the seven known fields,
which is already true today.

### Tests that cover this code today

- `src/lib/__tests__/moderation.test.ts` (10 tests, `vi.mock('@/lib/db')`):
  2 for `submitGlobalSongEdit`, 3 for `getPendingGlobalSongEdits`, 5 for
  `reviewGlobalSongEdit`. The approval test asserts the third `query` call is
  `UPDATE global_songs` with `expect.arrayContaining(['Plush', 'Core', 'Stone Temple Pilots', 'E', 'song-1'])`.
  Order-independent, so the parsed-payload rewrite keeps it green.
- `src/app/actions/__tests__/authzRepertoire.db.test.ts:217-290` (RH-34 ER9, real
  DB): additive link write goes straight through; a removal routes to the queue
  with `proposed_data.links` equal to `[ADDED_LINK]`; a system admin approving it
  applies the removal. `ORIGINAL_LINK` and `ADDED_LINK` are
  `{label: 'Chords', url: 'https://tabs.example/rh34-original'}` and
  `{label: 'Video', url: 'https://youtu.be/rh34'}`, both valid under the new rules.
- `src/lib/__tests__/transactionAtomicity.db.test.ts:111,192` inserts a
  `global_song_edits` row with `proposed_data` `{ title: 'RH-36 Proposed <suffix>' }`
  and approves it under injected failure. Valid under the new rules.
- `src/app/actions/__tests__/thinActions.test.ts`,
  `src/app/actions/__tests__/actionSessionGuard.test.ts` and
  `src/components/songs/__tests__/SongForm.test.tsx` mock at the module boundary
  or submit `{ title: 'x' }`, so none of them is affected.

I checked every payload any existing test submits: all of them validate under
the rules below, so no existing test needs editing.

## Approach

### 1. `src/lib/globalSongEditPayload.ts` (new)

Exports exactly two symbols:

```ts
export interface GlobalSongEditPayload {
  title?: string
  artist?: string
  album?: string | null
  standard_key?: string | null
  cover_url?: string | null
  duration_seconds?: number | null
  links?: SongLink[]
}

export function parseGlobalSongEditPayload(data: unknown): GlobalSongEditPayload
```

Every field is optional (an edit proposes a subset), and at least one must be
present. The module imports `sanitizeSongTitle` and `sanitizeAlbumName` from
`@/lib/songSanitizer` and `SongLink` from `@/types/database`. It imports nothing
from `@/app/*` (F21) and contains no `any` and no `eslint-disable`.

Per-field rules and the exact message thrown on rejection (every message starts
with `Invalid global song edit: ` and names the field):

| field | accepted | normalized to | message on reject |
|---|---|---|---|
| `title` | a string that is non-empty after `trim()` **and** after `sanitizeSongTitle` | `sanitizeSongTitle(value.trim())` | `Invalid global song edit: title must be a non-empty string` |
| `artist` | a string that is non-empty after `trim()` | `value.trim()` | `Invalid global song edit: artist must be a non-empty string` |
| `album` | a string, or `null` | `sanitizeAlbumName(value.trim())` (which returns `null` for an empty result), `null` stays `null` | `Invalid global song edit: album must be a string or null` |
| `standard_key` | a string, or `null` | `value.trim() \|\| null` | `Invalid global song edit: standard_key must be a string or null` |
| `cover_url` | `null`, or a string matching `/^https?:\/\/\S+$/i` after `trim()` | the trimmed string, or `null` | `Invalid global song edit: cover_url must be null or an http(s) URL` |
| `duration_seconds` | `null`, or a `number` that is an integer `>= 0` | the number, or `null` | `Invalid global song edit: duration_seconds must be a non-negative integer or null` |
| `links` | an array (possibly empty) whose every element is an object with a `string` `label` and a `string` `url` matching the same http(s) pattern | the array itself | `Invalid global song edit: links must be an array of {label, url} objects with http(s) urls` |

Two payload-level rules:

- `data` that is not a plain object (`null`, a primitive, or an array) throws
  `Invalid global song edit: payload must be a plain object`.
- A payload where none of the seven keys is present (or all seven are
  `undefined`) throws
  `Invalid global song edit: at least one of title, artist, album, standard_key, cover_url, duration_seconds, links must be present`.

**Unknown keys are ignored, never rejected**, and never appear in the returned
object: `parseGlobalSongEditPayload({ title: 'A', reason: 'typo' })` returns
`{ title: 'A' }`. This is what keeps `CorrectionModal`'s `reason` working.

Shape suggestion (measured: `parseGlobalSongEditPayload` complexity 12, every
helper 5 or less, all under the base budget of 15, so the new file needs no
override entry):

```ts
export function parseGlobalSongEditPayload(data: unknown): GlobalSongEditPayload {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${PREFIX}: payload must be a plain object`)
  }
  const source: Record<string, unknown> = { ...data }
  const payload: GlobalSongEditPayload = {}
  if (source.title !== undefined) payload.title = parseTitle(source.title)
  if (source.artist !== undefined) payload.artist = parseArtist(source.artist)
  // ... one line per column, in column order ...
  if (Object.keys(payload).length === 0) throw new Error(`${PREFIX}: at least one of ...`)
  return payload
}
```

Building the object field by field in column order (rather than through a loop
over a table) is deliberate: it keeps the result fully typed with no cast, and
it makes `Object.entries(payload)` deterministic, which the approval UPDATE
relies on. The `links` guard needs no cast either:

```ts
function parseLinks(value: unknown): SongLink[] {
  if (Array.isArray(value)) {
    const links = value.filter(isSongLink)
    if (links.length === value.length) return links
  }
  throw new Error(`${PREFIX}: links must be an array of {label, url} objects with http(s) urls`)
}
```

with `isSongLink(value: unknown): value is SongLink` reading `label` and `url`
through the scoped structural cast the E1 convention already sanctions. I
verified this whole shape compiles: `./node_modules/.bin/tsc --noEmit` exits 0
against it.

### 2. `submitGlobalSongEdit` (`src/lib/moderation.ts`)

The signature does not change (`data: Record<string, unknown>`), so no caller
moves. The validator is called **before** the wrapping `try`, following the L1a
convention already used at `src/lib/songs.ts:460` ("Outside the wrapper: the UI
shows this message verbatim"), so the message reaches `CorrectionModal`'s error
banner unprefixed, and so no INSERT can possibly have run:

```ts
// Outside the wrapper (convention L1a): the UI shows this message verbatim.
// Validation only - `proposed_data` is stored verbatim so the moderation queue
// keeps the requester's `reason` (see src/app/admin/moderation/page.tsx).
parseGlobalSongEditPayload(data)
```

The return value is deliberately discarded and the comment above says why.

### 3. `reviewGlobalSongEdit` (`src/lib/moderation.ts`)

The whole `116-157` block is replaced by:

```ts
const payload = parseGlobalSongEditPayload(edit.proposed_data)
const setClauses: string[] = []
const values: (string | number | null)[] = []
for (const [column, value] of Object.entries(payload)) {
  setClauses.push(`${column} = $${values.length + 1}`)
  values.push(Array.isArray(value) ? JSON.stringify(value) : value)
}
```

`values` is typed, not `any[]`, so the `eslint-disable` goes away with it. The
`if (setClauses.length > 0)` guard inside the transaction goes away too: the
validator guarantees at least one field, so the UPDATE always has a SET list.
Inside the transaction the song id is appended and the placeholder becomes
`$${values.length}`.

The parse happens inside the existing `try` (it needs the row that the SELECT
just returned), so the catch's re-throw allowlist gains one clause, exactly as
L1a prescribes:

```ts
err.message.startsWith('Invalid global song edit') ||
```

so the validation message survives verbatim instead of being wrapped in
`Failed to review global song edit: ...`.

The reject branch is untouched: rejecting an edit never validates the payload,
because refusing a bad proposal must always be possible.

### 4. Complexity budget consequence

Measured with the ESLint API against the shape above:

| function | before | after |
|---|---|---|
| `submitGlobalSongEdit` | 3 | 3 |
| `checkSystemAdmin` | 4 | 4 |
| `getPendingGlobalSongEdits` | 4 | 4 |
| `reviewGlobalSongEdit` | **19** | **13** |
| the `withTransaction` arrow | 2 | 1 |

13 is below the base budget of 15, and
`src/lib/__tests__/complexityBudget.test.ts` fails any override whose ceiling is
`<= BASE[rule]` ("relaxes only the five budget rules, and never below the base
threshold"). So the override cannot be re-pinned to 13: the entry
`{ ... files: ["src/lib/moderation.ts"], rules: { complexity: ["error", 19] } }`
must be **deleted** from the `complexity-budget-overrides` block. That takes the
list from 24 entries to 23, and the guard's own comment says "Lower this number
when an override is removed; never raise it": set `MAX_OVERRIDES = 23`, update
that test's title from "lists at most 24 per-file overrides" to
"lists at most 23 per-file overrides", and update AGENTS.md line 94 from
"the list growing past 24 entries" to "the list growing past 23 entries".

### 5. Test plan

**`src/lib/__tests__/globalSongEditPayload.test.ts` (new, 17 tests).** Pure unit
tests, no mocks, no DB. Exactly these `it` names:

1. `accepts a title and sanitizes the remaster suffix` - `{ title: 'Plush (2017 Remaster)' }` returns `{ title: 'Plush' }`.
2. `rejects a title that is not a non-empty string` - `{ title: 42 }` and `{ title: '   ' }` both throw `Invalid global song edit: title must be a non-empty string`.
3. `accepts an artist and trims it` - `{ artist: '  Stone Temple Pilots  ' }` returns `{ artist: 'Stone Temple Pilots' }`.
4. `rejects an artist that is not a non-empty string` - `{ artist: null }` and `{ artist: '' }` both throw `Invalid global song edit: artist must be a non-empty string`.
5. `accepts an album as a string or null` - `{ album: 'Core (Super Deluxe Edition)' }` returns `{ album: 'Core' }`; `{ album: null }` returns `{ album: null }`.
6. `rejects an album that is neither a string nor null` - `{ album: 7 }` throws `Invalid global song edit: album must be a string or null`.
7. `accepts a standard_key as a string or null` - `{ standard_key: 'Am' }` returns `{ standard_key: 'Am' }`; `{ standard_key: null }` returns `{ standard_key: null }`.
8. `rejects a standard_key that is neither a string nor null` - `{ standard_key: ['A'] }` throws `Invalid global song edit: standard_key must be a string or null`.
9. `accepts a cover_url that is an http(s) URL or null` - `{ cover_url: 'https://img.example/a.jpg' }` returns it unchanged; `{ cover_url: null }` returns `{ cover_url: null }`.
10. `rejects a cover_url that is not an http(s) URL` - `{ cover_url: 'javascript:alert(1)' }` and `{ cover_url: 12 }` both throw `Invalid global song edit: cover_url must be null or an http(s) URL`.
11. `accepts a duration_seconds that is a non-negative integer or null` - `{ duration_seconds: 217 }`, `{ duration_seconds: 0 }` and `{ duration_seconds: null }` all round-trip.
12. `rejects a duration_seconds that is not a non-negative integer` - `{ duration_seconds: 'abc' }`, `{ duration_seconds: -1 }` and `{ duration_seconds: 3.5 }` all throw `Invalid global song edit: duration_seconds must be a non-negative integer or null`.
13. `accepts links as an array of label/url objects with http(s) urls` - `{ links: [{ label: 'Chords', url: 'https://tabs.example/1' }] }` round-trips and `{ links: [] }` returns `{ links: [] }`.
14. `rejects links that are not an array of label/url objects` - `{ links: 42 }`, `{ links: [{ label: 'x' }] }` and `{ links: [{ label: 'x', url: 'ftp://a/b' }] }` all throw `Invalid global song edit: links must be an array of {label, url} objects with http(s) urls`.
15. `ignores keys that are not global_songs columns` - `{ title: 'Plush', reason: 'typo in the title' }` returns exactly `{ title: 'Plush' }` (asserted with `toEqual`, so the absence of `reason` is part of the assertion).
16. `rejects a payload with no proposable field` - `{}` and `{ reason: 'typo' }` both throw `Invalid global song edit: at least one of title, artist, album, standard_key, cover_url, duration_seconds, links must be present`.
17. `rejects a payload that is not a plain object` - `null`, `'x'` and `[]` all throw `Invalid global song edit: payload must be a plain object`.

Rejection assertions use `expect(() => parseGlobalSongEditPayload(x)).toThrowError(new Error('<exact message>'))`, which compares the message for equality rather than substring.

**`src/lib/__tests__/moderation.test.ts` (2 tests added, 10 existing untouched).**

- `rejects an invalid payload at submission without touching the database`:
  `await expect(submitGlobalSongEdit('user-1', 'song-1', { duration_seconds: 'abc' })).rejects.toThrowError(new Error('Invalid global song edit: duration_seconds must be a non-negative integer or null'))`
  and `expect(query).not.toHaveBeenCalled()`.
- `rejects a historical proposed_data that no longer validates before updating global_songs`:
  admin check and edit lookup mocked as in the existing approval test, with
  `proposed_data: { duration_seconds: 'abc' }`; the call rejects with the same
  `toThrowError(new Error(...))` (verbatim, not wrapped in
  `Failed to review global song edit:`) and `expect(query).toHaveBeenCalledTimes(2)`
  proves no UPDATE was issued.

**`src/lib/__tests__/moderationPayload.db.test.ts` (new, 2 tests, real DB).**
Follows the pattern of `src/lib/__tests__/transactionAtomicity.db.test.ts`:
`const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''`,
`const admin = createAdminTestClient()`,
`describe.skipIf(!SERVICE_ROLE_KEY)('global song edit payload validation (real database)', ...)`.
`beforeAll` creates a requester and an admin with `createTestUser`, runs
`UPDATE profiles SET is_system_admin = true WHERE id = $1` for the admin, and
inserts one `global_songs` row
(`INSERT INTO global_songs (title, artist, duration_seconds) VALUES ($1, $2, 217) RETURNING id`)
with a `Date.now()` suffix in the title, because vitest runs files in parallel
workers against shared tables. `afterAll` deletes the edits, the song and both
users (`deleteTestUser`). No `BEGIN`/`COMMIT`/`ROLLBACK` literal anywhere
(`transactionGuard.test.ts`).

- `refuses an invalid payload at submission and inserts no edit row`: read
  `SELECT count(*) FROM global_song_edits WHERE song_id = $1` before, call
  `submitGlobalSongEdit(userId, songId, { duration_seconds: 'abc' })`, expect the
  verbatim `Invalid global song edit: duration_seconds must be a non-negative integer or null`,
  then assert the same count after.
- `refuses a historical edit row whose proposed_data no longer validates`: insert
  the row directly with
  `INSERT INTO global_song_edits (song_id, requested_by, proposed_data, status) VALUES ($1, $2, $3, 'pending') RETURNING id`
  and `JSON.stringify({ duration_seconds: 'abc' })`; call
  `reviewGlobalSongEdit(adminUserId, editId, 'approve')`; expect the same
  verbatim message; then assert
  `SELECT title, duration_seconds FROM global_songs WHERE id = $1` still returns
  the seeded title and `217`, and
  `SELECT status FROM global_song_edits WHERE id = $1` still returns `pending`.

## Expected Results

ER1 - the validator module exists with exactly one type and one function, and it is clean. From the repo root, `test -f src/lib/globalSongEditPayload.ts` succeeds; `grep -c "export interface GlobalSongEditPayload" src/lib/globalSongEditPayload.ts` prints `1`; `grep -c "export function parseGlobalSongEditPayload(data: unknown)" src/lib/globalSongEditPayload.ts` prints `1`; `grep -c "^export " src/lib/globalSongEditPayload.ts` prints `2` (nothing else is exported); `grep -cE "(title|artist|album|standard_key|cover_url|duration_seconds|links)\?:" src/lib/globalSongEditPayload.ts` prints `7` (one optional field per `global_songs` column); `grep -c ": any\|any\[\]\|eslint-disable\|@ts-expect-error\|@ts-ignore" src/lib/globalSongEditPayload.ts` prints `0`; and `grep -c "@/app/" src/lib/globalSongEditPayload.ts` prints `0`. `./node_modules/.bin/tsc --noEmit` prints nothing and exits 0.

ER2 - `src/lib/moderation.ts` calls the validator on both paths and the ad-hoc block is gone. `grep -c "parseGlobalSongEditPayload(" src/lib/moderation.ts` prints `2` (once in `submitGlobalSongEdit`, once in `reviewGlobalSongEdit`); `grep -c "from '@/lib/globalSongEditPayload'" src/lib/moderation.ts` prints `1`; `grep -c "eslint-disable\|any\[\]" src/lib/moderation.ts` prints `0`; `grep -c "!== undefined" src/lib/moderation.ts` prints `0`; `grep -c "typeof proposed" src/lib/moderation.ts` prints `0`; `grep -c "as Record<string, unknown>" src/lib/moderation.ts` prints `0`; `grep -c "sanitizeSongTitle\|sanitizeAlbumName" src/lib/moderation.ts` prints `0` while `grep -c "sanitizeSongTitle\|sanitizeAlbumName" src/lib/globalSongEditPayload.ts` prints at least `2`; `grep -c "startsWith('Invalid global song edit')" src/lib/moderation.ts` prints `1`; and `grep -c "rows\[0\] as " src/lib/moderation.ts` prints `1` (the single cast RH-54 left behind is on a line this task does not touch and must remain).

ER3 - the per-field table test exists and passes. `rtk proxy npx vitest run src/lib/__tests__/globalSongEditPayload.test.ts --reporter=verbose` reports `Test Files 1 passed (1)`, `Tests 17 passed (17)` and `0 failed`, and its output contains these 17 test names verbatim: `accepts a title and sanitizes the remaster suffix`, `rejects a title that is not a non-empty string`, `accepts an artist and trims it`, `rejects an artist that is not a non-empty string`, `accepts an album as a string or null`, `rejects an album that is neither a string nor null`, `accepts a standard_key as a string or null`, `rejects a standard_key that is neither a string nor null`, `accepts a cover_url that is an http(s) URL or null`, `rejects a cover_url that is not an http(s) URL`, `accepts a duration_seconds that is a non-negative integer or null`, `rejects a duration_seconds that is not a non-negative integer`, `accepts links as an array of label/url objects with http(s) urls`, `rejects links that are not an array of label/url objects`, `ignores keys that are not global_songs columns`, `rejects a payload with no proposable field`, `rejects a payload that is not a plain object`. The seven reject messages asserted in that file are exactly `Invalid global song edit: title must be a non-empty string`, `Invalid global song edit: artist must be a non-empty string`, `Invalid global song edit: album must be a string or null`, `Invalid global song edit: standard_key must be a string or null`, `Invalid global song edit: cover_url must be null or an http(s) URL`, `Invalid global song edit: duration_seconds must be a non-negative integer or null` and `Invalid global song edit: links must be an array of {label, url} objects with http(s) urls`, plus the two payload-level messages `Invalid global song edit: payload must be a plain object` and `Invalid global song edit: at least one of title, artist, album, standard_key, cover_url, duration_seconds, links must be present`; `grep -c "Invalid global song edit:" src/lib/__tests__/globalSongEditPayload.test.ts` prints at least `9`.

ER4 - the mocked moderation unit tests cover both wiring points and the existing ten still pass. `rtk proxy npx vitest run src/lib/__tests__/moderation.test.ts --reporter=verbose` reports `Test Files 1 passed (1)`, `Tests 12 passed (12)` and `0 failed`, and its output contains the two new names verbatim: `rejects an invalid payload at submission without touching the database` and `rejects a historical proposed_data that no longer validates before updating global_songs`. `grep -c "expect(query).not.toHaveBeenCalled()" src/lib/__tests__/moderation.test.ts` prints at least `1` (the submission test proves the INSERT never ran) and `grep -c "toThrowError(new Error('Invalid global song edit: duration_seconds must be a non-negative integer or null'))" src/lib/__tests__/moderation.test.ts` prints `2` (both messages are asserted for equality, so a message wrapped in `Failed to submit global song edit:` or `Failed to review global song edit:` would fail).

ER5 - the real-database test proves an invalid submission never inserts and a historical bad row is refused at approval. With Postgres live at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, `rtk proxy npx vitest run src/lib/__tests__/moderationPayload.db.test.ts --reporter=verbose` reports `Test Files 1 passed (1)`, `Tests 2 passed (2)`, `0 failed` and `0 skipped`, and its output contains the names `refuses an invalid payload at submission and inserts no edit row` and `refuses a historical edit row whose proposed_data no longer validates`. `grep -c "BEGIN\|COMMIT\|ROLLBACK" src/lib/__tests__/moderationPayload.db.test.ts` prints `0`. Running the same command a second time also reports `Tests 2 passed (2)` (the fixtures clean up after themselves).

ER6 - nothing outside the data layer changed and every dependent suite is still green. `git diff f92c0f3 -- src/app src/components src/hooks src/store src/types src/i18n migrations` prints nothing. With the database precondition of ER5 satisfied, `rtk proxy npx vitest run src/app/actions/__tests__/authzRepertoire.db.test.ts src/lib/__tests__/transactionAtomicity.db.test.ts src/lib/__tests__/songs.test.ts src/app/actions/__tests__/repertoire.test.ts src/app/actions/__tests__/thinActions.test.ts src/app/actions/__tests__/actionSessionGuard.test.ts src/components/songs/__tests__/SongForm.test.tsx` reports `Test Files 7 passed (7)`, `0 failed` and `0 skipped`, and its output contains the four RH-34 link-flow names `writes an additive change straight through`, `routes a removal to the moderation queue and leaves the catalog untouched`, `applies the removal once a system admin approves it` and `passes the injected submitGlobalSongEdit down to the correction modal`.

ER7 - the static gates hold and the complexity ratchet tightened by one entry. `rtk proxy npx eslint .` ends with the summary line `22 problems (8 errors, 14 warnings)`, unchanged from `f92c0f3`, and `rtk proxy npx eslint src/lib/moderation.ts src/lib/globalSongEditPayload.ts src/lib/__tests__/globalSongEditPayload.test.ts src/lib/__tests__/moderationPayload.db.test.ts` prints nothing and exits 0. `rtk proxy npx eslint --rule '{"complexity":["error",14]}' src/lib/moderation.ts` prints nothing and exits 0 (the worst function complexity in that file was 19 at `f92c0f3` and is 13 after this change). `grep -c "src/lib/moderation.ts" eslint.config.mjs` prints `0` (the override entry is deleted, not re-pinned: a ceiling of 13 would be at or below the base budget of 15, which `complexityBudget.test.ts` rejects); `grep -c "complexity-budget/override" eslint.config.mjs` prints `23`; `grep -c "const MAX_OVERRIDES = 23" src/lib/__tests__/complexityBudget.test.ts` prints `1` and `grep -c "lists at most 23 per-file overrides" src/lib/__tests__/complexityBudget.test.ts` prints `1`; `grep -c "past 23 entries" AGENTS.md` prints `1` and `grep -c "past 24 entries" AGENTS.md` prints `0`. `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` reports `Tests 6 passed (6)` and `0 failed`. `npm run lint:dead` prints no file or symbol list and exits 0; `npm run lint:dup` exits 0 and its `Total:` row shows a duplicated-lines percentage of at most `1.00%` (baseline `229 (0.68%)` over 18 clones); `npm run audit` prints `found 0 vulnerabilities`.

ER8 - the whole suite and the coverage gate stay green, and the new module is covered. With Postgres live at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, `rtk proxy npx vitest run` reports at least `Test Files 92 passed (92)` and at least `Tests 1064 passed (1064)`, with `0 failed` and `0 skipped` (the baseline at `f92c0f3` is 90 files / 1043 tests, plus the 17 of ER3, the 2 of ER4 and the 2 of ER5). `npm run test:coverage` exits 0, prints no line containing `does not meet threshold`, and its `All files` row shows statements >= 80, branches >= 65, functions >= 78 and lines >= 80; in the same output the row for `globalSongEditPayload.ts` shows statements, branch, funcs and lines each >= 90.

ER9 - the app still builds and renders server-side. `npx next build` exits 0 and prints `Compiled successfully`. `PLAYWRIGHT_WEB_SERVER='npx next start -p 3000 -H 127.0.0.1' npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed`.

ER10 - the version was bumped and the landing page was not touched. `node -p "require('./package.json').version"` prints a string matching `^0\.1\.84-[0-9]{12}$`, which sorts strictly after the `f92c0f3` value `0.1.83-202609080015`. `git diff f92c0f3 -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json` prints nothing: payload validation for the admin moderation queue is an internal correctness fix, not a selling point, so the Landing Page Rule requires no copy change.

ER11 - the diff stays inside a closed whitelist. `git diff --name-only f92c0f3 | grep -v "^\.meridian/" | sort` lists only paths drawn from this set: `AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/RH-55-spec.md`, `eslint.config.mjs`, `package.json`, `package-lock.json`, `src/lib/__tests__/complexityBudget.test.ts`, `src/lib/__tests__/globalSongEditPayload.test.ts`, `src/lib/__tests__/moderation.test.ts`, `src/lib/__tests__/moderationPayload.db.test.ts`, `src/lib/globalSongEditPayload.ts`, `src/lib/moderation.ts`. Any other path fails this result. In particular `git diff --name-only f92c0f3 -- src/lib/songs.ts src/lib/db.ts src/lib/dbRows.ts src/lib/songSanitizer.ts` prints nothing.

## Out of Scope

- **Parts 3, 4 and 5 of RH-40**: typing the rows of `src/lib/songs.ts` and
  `src/lib/tabs.ts`, of `src/lib/bands*.ts` / `src/lib/playlists.ts` /
  `src/lib/profile.ts`, and of the Spotify modules and route handlers. This task
  touches `src/lib/moderation.ts` only.
- **The remaining `.rows[0] as GlobalSongEdit` cast** at `src/lib/moderation.ts:177`.
  RH-54 deliberately left exactly one there; the approval-UPDATE rewrite does not
  touch that line, so it stays and ER2 pins it at `1`. A later part may retire it.
- **Any schema change.** No migration is added. A CHECK constraint on
  `global_songs`, or a `jsonb` schema constraint on `global_song_edits.proposed_data`,
  is a different task with a different risk profile (existing rows).
- **The Server Actions, `CorrectionModal`, `SongForm` and the admin queue page.**
  Unknown keys are ignored rather than rejected precisely so none of them has to
  change; ER6 pins that with an empty diff.
- **Changing what `submitGlobalSongEdit` stores.** `proposed_data` keeps holding
  the submitted object verbatim, including `reason`, so the moderation queue
  keeps rendering it.
- **The reject path of `reviewGlobalSongEdit`.** Refusing a proposal must stay
  possible even when its payload is invalid, so it never parses.
- **`src/lib/songSanitizer.ts`.** `sanitizeSongTitle` and `sanitizeAlbumName` are
  reused as they are; their behaviour is not revisited.

## Post-merge checks (orchestrator)

- After merge, `docs/plans/code-quality-review.md` F17 can be marked resolved; the
  `## Suggestions` section of `.meridian/reports/RH-55-spec-1.md` lists the two
  follow-ups worth capturing as new tasks (a `duration_seconds >= 0` CHECK
  constraint, and rejecting unknown keys once `CorrectionModal` stops sending
  `reason` inside `data`).
