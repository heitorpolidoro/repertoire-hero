# RH-129 — Clear the `npm run lint` baseline so the script exits 0

## Scope

`npm run lint` exits 1 today on a baseline of findings in files nobody is
working on, so every task in this repository has had to measure "no new finding
on top of the baseline" by hand instead of "lint passes". This task clears the
baseline **and makes the clean state enforceable**, so `npm run lint` becomes a
binary signal again.

Measured today with `npx eslint . --format json`: **8 errors and 9 warnings
across 11 files** (the board's ER text quotes an older, larger count — it is
stale, which is itself the argument for the gate).

| file | findings |
|---|---|
| `e2e/global-setup.ts` | 0e/1w |
| `scripts/migrate.mjs` | 0e/1w |
| `src/app/profile/page.tsx` | 1e/0w |
| `src/app/reset-password/page.tsx` | 1e/0w |
| `src/app/settings/page.tsx` | 2e/0w |
| `src/components/landing/LandingPage.tsx` | 1e/0w |
| `src/components/layout/AppLayout.tsx` | 2e/0w |
| `src/components/layout/LanguageSelector.tsx` | 1e/1w |
| `src/lib/__tests__/edge_cases.test.ts` | 0e/4w |
| `src/lib/__tests__/errors.test.ts` | 0e/1w |
| `src/lib/__tests__/i18n.test.ts` | 0e/1w |

Four of the seven behaviour-changing fixes land in files with **no unit test and
no Playwright spec** today (`src/app/reset-password/`, `src/app/settings/`,
`src/components/landing/` and `LanguageSelector.tsx` have no `__tests__`; `e2e/`
has no reset-password and no settings spec). Clearing a lint finding in an
untested file is a silent-breakage risk, so this task also adds the unit tests
that pin the behaviour each fix preserves — see §F. They are in scope: without
them "lint is green" and "the password reset still works" are unrelated facts.

Out of scope: any behavior change beyond what clearing a finding requires; the
`npm run audit` / `audit:all` split (RH-131, unchanged); any migration (this
task needs none); raising any complexity ceiling or adding any override entry.

## Approach

### A. The seven `react-hooks/set-state-in-effect` errors

Every one is fixed in code. No new `eslint-disable` for this rule: after this
task the only one in the tree is the pre-existing
`src/hooks/useBandAdmin.ts:190`.

- **`src/components/layout/AppLayout.tsx:49` and `:166`** — two copies of
  `useState(false)` + `useEffect(() => setMounted(true), [])`. The replacement
  already exists: `useHydrated()` in `src/hooks/useHydrated.ts`, whose
  docstring names these two sites as the baseline errors it was built to
  retire. Drop both `mounted` states and both effects; read `useHydrated()`
  instead.
- **`src/components/layout/LanguageSelector.tsx:17`** and
  **`src/components/landing/LandingPage.tsx:48`** — both read a client-only
  cookie into state on mount. Derive the locale during render, gated on
  `useHydrated()` so the SSR pass and the hydration render still agree (both
  must still produce the `'pt-BR'` default), and drop the state write.
  `LandingPage`'s effect keeps its dev-profile `fetch`: that `setDevProfiles`
  lives in a `.then` callback and the rule does not flag it — only the
  `setLocale` line in the effect body goes.
  `LanguageSelector`'s state has a **second**, non-effect writer:
  `setCurrentLocale(newLocale)` in `handleLanguageChange` (`:22`; `:21` is the
  cookie write). Dropping the
  state drops that line too. The consequence is acceptable and intended: the
  `<select>` shows the old value for the instant between the cookie write and
  the `window.location.reload()` on the next line.
- **`src/app/reset-password/page.tsx:21`** — `setToken(searchParams.get('token'))`
  is pure derivation from a hook value. Drop the state and the effect and read
  the token during render. The observable difference is an improvement: today
  the first render has `token === null`, so `isTokenMissing` (`:67`) is briefly
  true and the **missing-token** branch (`:82`–`:86`) paints before the effect
  flips it — the one headed **"Invalid Link"** (`:85`), whose body (`:86`)
  reads *"The password reset token is missing from the URL. Please request a
  new link from the forgot password page."* and which offers a "Request New
  Link" link instead of the
  form. After the fix the token is correct on the first render and that branch
  never appears for a URL that carries one.
  Note for §F/ER13: the *other* string in this file, `'Invalid or expired reset
  token. Please request a new link.'` (`:30`), is set by `setError` **inside
  `handleSubmit` only** and is never rendered on any first paint, before or
  after this change. Asserting on it would verify nothing. The branch to assert
  on is the "Invalid Link" / "missing from the URL" one above.
- **`src/app/settings/page.tsx:28`** — the effect calls a `useCallback`'d
  `loadSpotifyStatus` whose body sets state, and the rule follows the callback.
  Verified by probe: inlining the load as an async function **defined inside
  the effect** (with an `alive`/abort guard on the write) clears the rule with
  no suppression, so no suppression is acceptable here even though
  `useBandAdmin.ts:190` is precedent for one. `useCallback` then has no other
  reference in the file (it appears only twice, the import at `:3` and the wrap
  at `:13`; `:29` is the effect's dependency reference to the wrapped callback)
  and must come out of the import, or it becomes a tenth `no-unused-vars`
  warning.
- **`src/app/profile/page.tsx:612`** — the effect resets `activeTab` when the
  band context changes, and the tab is also user-switchable (`setActiveTab` at
  `:630` and `:641`), so it cannot simply be derived. See §A1 — the remedy needs
  a new file and an explicit key expression, and neither fits in a bullet.

#### A1. The profile tab: a new component, and the exact key

No component owns the tabbed subtree today. `activeTab` is read in four places
**inside `ProfilePage` itself** — the header title (`:620`), both switcher
buttons (`:632`, `:636`, `:643`) and the content switch (`:655`) — so "move the
tab state down" means **creating** the component that owns all of it. An in-file
extraction is rejected: it would plausibly raise `src/app/profile/page.tsx`'s
line count, which §D forbids.

Create **`src/components/profile/ProfileTabs.tsx`**. It takes the band context
(`BandContext`, exported from `@/store/bandContextStore`) plus the two panels as
`ReactNode` props, and owns the header, the switcher, the content slot and the
`activeTab` state:

- The file exports one component, `ProfileTabs`, which is a thin wrapper that
  renders the stateful inner component **with the key applied inside this
  file**. Keeping the key here, rather than in `page.tsx`, is what makes the
  reset mechanism reachable from a unit test (§F, ER5).
- **The key expression is `context.type`** — nothing else. Today's effect
  depends on `[context.type]`, so band→band does **not** reset the tab, and
  `key={context.id}` would change user-visible behaviour: a band→band switch
  would remount the band panel, discarding its loaded state and flashing a
  reload. `context.type` reproduces today's behaviour exactly, including
  "band A → band B keeps whichever tab the user had selected".
- Initial state is `context.type === 'band' ? 'band' : 'personal'`, matching
  `:604`.
- It may not import from `@/app/*` (F21, enforced by `no-restricted-imports`).
  It does not need to: `BandProfileView` and `PersonalProfileView` stay private
  to `page.tsx` and arrive as element props. React elements are lazy, so passing
  both costs nothing — only the selected one is placed in the tree.
- **The band panel prop must be written
  `context.type === 'band' ? <BandProfileView bandId={context.id} /> : null`.**
  `BandContext` is a discriminated union
  (`src/store/bandContextStore.ts:4-6`: `{ type: 'user' }` | `{ type: 'band';
  id: string; name: string; color?: string }`), so `context.id` exists only on
  the `band` arm. Today `page.tsx:656` reaches it *inside* the
  `activeTab === "band" && isBandMode` guard, which narrows it. Building the
  element eagerly as a prop moves the access outside that narrowing and will
  not typecheck without the ternary above. (`ProfileTabs` itself has the same
  obligation for `context.name`, which `page.tsx` reads at `:621` and `:638`:
  narrow on `context.type === 'band'` inside the component before reading it.)
- It carries **no** complexity-budget override entry: the extracted subtree is
  ~60 lines with no loop and a handful of ternaries, comfortably inside the base
  budget (complexity 15, 200 lines per function, 400 per file).

`page.tsx` keeps both panel components and renders `<ProfileTabs>` in place of
the header and content block; the `useEffect` import goes if nothing else in the
file uses it.

The documented React alternative — "adjust state during render", comparing the
last-seen context — was probed and also clears the rule, and is rejected: it
adds two branches to `ProfilePage` inside a file whose ceilings are a ratchet.

### B. The one `@next/next/no-html-link-for-pages` error

`src/app/settings/page.tsx:116` reaches `/api/auth/spotify/authorize` with a
plain `<a href>`. **Keep the `<a>`** and suppress with a single
`eslint-disable-next-line @next/next/no-html-link-for-pages` carrying the
reason, because the rule is wrong here and not merely inconvenient: the
destination is not a page. `src/app/api/auth/spotify/authorize/route.ts` is a
route handler that sets an httpOnly `spotify_oauth_state` CSRF cookie and
returns a redirect to `accounts.spotify.com` — it requires a full document
request, which is exactly what the rule wants replaced with a client-side
`next/link` transition. Probe confirmed a `<button>` + `window.location`
variant is lint-clean, and it is rejected: it would trade a link's
middle-click, open-in-new-tab and copy-link semantics for silence.

### C. The nine `@typescript-eslint/no-unused-vars` warnings

All nine are fixed in code; none is suppressed, and **no `argsIgnorePattern` is
added**. The config has no such option today (grepped) and the repository's
existing convention is a narrow `eslint-disable-next-line` where a binding must
survive (`src/app/profile/page.tsx:418`,
`src/components/songs/RepertoireDashboard.tsx:222` and `:238`) — but here every
binding can simply go.

- `e2e/global-setup.ts:13` — `chromium` is imported and never used (the file
  only uses `request as apiRequest`); drop it from the import.
- `scripts/migrate.mjs:63` — `catch (err)` never reads `err`; use an optional
  catch binding.
- `src/components/layout/LanguageSelector.tsx:4` — drop `SUPPORTED_LOCALES`
  from the `@/lib/i18n` import.
- `src/lib/__tests__/edge_cases.test.ts:2,3,5` — drop the unused
  `createPlaylist`, `updateProfile` and `addSongToRepertoire` imports.
- `src/lib/__tests__/i18n.test.ts:9` — drop the unused `type Locale` import.
- `src/lib/__tests__/edge_cases.test.ts:75` and
  `src/lib/__tests__/errors.test.ts:85` — the mock dispatcher's trailing
  `params?: any[]`. The operator flagged this as the case where the rule might
  be wrong; it is not. ESLint's default `args: "after-used"` is why the
  `_label` parameters all over `src/app/actions/__tests__/` go unreported, and
  these two are reported only because they are trailing. A shorter callback is
  assignable to `mockImplementation`'s parameter type, so **delete the
  parameter** rather than rename or suppress it. Removing it changes no
  assertion.

Plus the one §A creates and must not leave behind: `useCallback` in
`src/app/settings/page.tsx`.

### D. The complexity ratchet (do not disturb)

The block between `// BEGIN:complexity-budget-overrides` and
`// END:complexity-budget-overrides` in `eslint.config.mjs` holds **14
entries** against `MAX_OVERRIDES = 17` in
`src/lib/__tests__/complexityBudget.test.ts`, and may only shrink.
`complexityBudget.test.ts` fails if a ceiling is **not exactly** its file's
current worst number, and separately fails any ceiling that is `<=` the base
budget — so a ceiling that a fix brings down to the base must be **deleted**
from the entry, not lowered. Precedent: RH-128 dropped `complexity` from the
`TabDrawingStage.tsx` entry when the component function fell from 21 to 14.

Four touched files carry an entry. **Re-measure all four; expect only
`profile/page.tsx`'s `max-lines` to move:**

- `src/app/profile/page.tsx` — `complexity: 22`, `max-lines-per-function: 365`,
  `max-lines: 663`. Measured per function: the 22 and the 365 are both
  **`BandProfileView`** (`:48`), which this task does not touch; `ProfilePage`
  itself is complexity 11 over 64 lines. So `complexity` stays **22** and
  `max-lines-per-function` stays **365** after the §A1 extraction — neither key
  may be deleted or lowered on the strength of ProfilePage shrinking. Only
  `max-lines` drops, to the file's new exact length.
- `src/components/layout/AppLayout.tsx` — `complexity: 21` only, and the file is
  341 lines with no `max-lines` entry. Swapping `mounted` for `useHydrated()`
  removes two trivial arrow functions and changes no branch in the worst
  function, so the entry is unchanged.
- `src/lib/__tests__/edge_cases.test.ts` (`complexity: 32`) and
  `src/lib/__tests__/errors.test.ts` (`complexity: 16`) — complexity-only
  ceilings. Dropping an import and dropping a trailing parameter change no
  branch, so both are unchanged.

No ceiling may go up, no entry may be added (in particular none for
`ProfileTabs.tsx` or any new test file), and `MAX_OVERRIDES` may not be raised.

### E. Making the clean state stick

1. **`package.json`'s `lint` script gains `--max-warnings=0`.** Today it is
   bare `eslint`, which exits 0 on warnings — nine of today's seventeen
   findings would not fail the gate even after the errors are cleared, and a
   new warning would regrow the baseline silently.
2. **A CI job runs `npm run lint`.** `.github/workflows/ci.yml` has a job per
   lint tool (`dead-code`, `duplication`, `audit`) and conspicuously none for
   eslint; add one in the `dead-code` shape (checkout, Node 24.x, install, run —
   no database). This is the thing that blocks a PR. Adding it falsifies three
   "No CI job runs eslint" claims, which must be corrected with it (§E.4).
3. **A new vitest guard, `src/lib/__tests__/lintGate.test.ts`,** with four
   halves. Halves (b) and (c) assert on **resolved severities and the resolved
   file universe**, obtained from the ESLint Node API — not on the source text
   of `eslint.config.mjs`. Round 2 changed this, and §E.3-bis says why.

   a. **A full-project ESLint run.** Shaped exactly like
      `complexityBudget.test.ts`'s `reports no budget violation anywhere under
      src` (`new ESLint({ cwd: ROOT })`, `lintFiles([...])`, a 120 s timeout),
      but over the whole project and asserting that **no result carries any
      message of any severity**. Severity 1 and 2 are both failures, which makes
      this half independent of the `--max-warnings=0` flag. Because it runs
      inside the existing `coverage` CI job, the finding half of the gate bites
      in CI whether or not §E.2's job survives a future workflow edit.

   b. **Resolved severities, for the rules that matter.** Via
      `calculateConfigForFile(path)`, which answers with the **last-wins
      resolution** of the whole array for that path — so it is blind to how a
      severity was written (`"off"`, `'off'`, `0`), to which config object wrote
      it, and to whether that object's `rules` were spread in from another
      module. Two assertions:

      - **The three rules this task clears stay on.** For each of the six
        touched component/page files, resolved `react-hooks/set-state-in-effect`
        and `@next/next/no-html-link-for-pages` are severity **2**; and for all
        eleven of today's baseline files, resolved
        `@typescript-eslint/no-unused-vars` is severity **1** and never 0.
        (Measured today: all three resolve exactly so. `no-unused-vars` is
        `warn` from the preset — `--max-warnings=0` is what makes it bite, which
        is why §E.1 is load-bearing and not cosmetic.)
      - **The set of rules the repository itself declares is exactly today's
        seven, at exactly today's severities.** Take the exported array, drop
        the two vendored preset spreads (`eslint-config-next/core-web-vitals`
        and `.../typescript`, importable and sliceable by length), and collect
        every rule id the remaining objects declare. It must be exactly
        `@typescript-eslint/no-explicit-any`, `no-restricted-imports`,
        `complexity`, `max-depth`, `max-lines-per-function`, `max-params`,
        `max-lines` — an eighth id fails whatever it is set to. Then check the
        resolution: on `src/components/layout/LanguageSelector.tsx` (a
        `src/components` file with no override) `complexity` is
        `[2, 15]`, `max-depth` 4, `max-lines-per-function` 200,
        `max-params` 4, `max-lines` 400, and `no-restricted-imports` and
        `@typescript-eslint/no-explicit-any` are severity 2; on
        `src/lib/__tests__/errors.test.ts` the only two zeros **among these seven** appear —
        `@typescript-eslint/no-explicit-any` severity 0 and
        `max-lines-per-function` severity 0 — alongside `max-lines`
        `[2, 800]` and `complexity` `[2, 16]`. All eight numbers
        measured today.

   c. **The resolved file universe: nothing silently leaves the run.** Assert
      that `lintFiles(['.'])` returns a result for **every** git-tracked
      lintable path — `git ls-files` filtered to
      `.js/.jsx/.mjs/.cjs/.ts/.tsx`, with the set difference required to be
      empty. Measured today: 435 tracked lintable paths, 435 linted, zero
      excluded (the 7 `globalIgnores` entries all name untracked or generated
      paths, `next-env.d.ts` included). Expressed as a derived set difference
      and not a count, so the six new test files are covered the moment they
      exist and no number needs maintaining. This is what closes the
      exclusion mechanisms *behaviourally*: a second `globalIgnores([...])`
      call, an added `ignores:` key on any config object, a bare
      `{ ignores: [...] }` object, or a source file moved under an already
      ignored glob all leave a tracked file unlinted and fail here — none of
      them is a severity, so (b) would not see any of them.

   d. **A text read of `package.json` and the disable comments.** Only where
      text is the thing being asserted:
      - the `lint` script contains `--max-warnings=0`; still lints the whole
        project (no path argument narrower than `.`); and contains none of
        `--quiet`, `|| true`, `--no-error-on-unmatched-pattern`,
        `--ignore-pattern`, `--config`, `--rulesdir` or `--flag`;
      - `eslint.config.mjs` imports only from `eslint/config`,
        `eslint-config-next/core-web-vitals` and
        `eslint-config-next/typescript`, contains no `process.env`
        reference, and declares no `linterOptions` key (there is none today).
        The `linterOptions` clause is not redundant with (b): it is not a rule
        declaration, so lowering `reportUnusedDisableDirectives` through it
        would leave every resolved severity untouched. Neither is strictly needed given (b) and (c) — a smuggled
        rules object resolves like any other — but it keeps the config
        environment-independent, so the severities vitest resolves are the
        severities CI's `npm run lint` resolves;
      - no file under `src/`, `e2e/` or `scripts/` carries a **whole-file**
        `/* eslint-disable ... */` block comment (with or without a rule list)
        or an **inline config comment** of the `/* eslint <rule>: 0 */` form.
        There are none of either today: all eleven `eslint-disable` hits in the
        tree are `-next-line` directives, and the single `/* eslint-disable`
        block-comment hit is the JSX-wrapped `-next-line` at
        `src/components/fastview/TabViewer.tsx:125`. Per-rule counts for the
        three rules at stake are pinned by ER3, ER6 and ER7, not here.

   The `rules` objects **and `files` arrays** of `complexity-budget/base` and
   `complexity-budget/tests` are **not** re-asserted here:
   `complexityBudget.test.ts:112` and `:127` already pin both by `toEqual`, including
   the sorted `files` arrays — which is also what closes "narrow a budget
   block's glob until it matches nothing". That test is the artifact QA should
   cite for them; duplicating it would mean two files to update on the next
   legitimate budget change.

#### E.3-bis. Why resolved severities, and not a count of `"off"` literals

Round 1 of this spec asked half (b) to count string literals in
`eslint.config.mjs` — exactly two `"off"`, zero `"warn"`, and a `rules: {`
block count tied to the override count. Review demonstrated the hole by
exploiting it: inserting one line into the existing F21 block, before
`"no-restricted-imports"`,

```
"react-hooks/set-state-in-effect": 0,
```

takes the baseline from 8 errors to 4 — `AppLayout.tsx:49`, `:166`,
`LanguageSelector.tsx:17` and `LandingPage.tsx:48` all silenced — while every
one of those text assertions stays true: still two `"off"` literals, still zero
`"warn"`, still 18 `rules: {` blocks for 14 overrides. (Reproduced here before
rewriting: 8 errors → 4 errors, literal counts unchanged at 2 / 0 / 18.) ESLint
accepts `0`, `1`, `2` as severities, and a text scan that greps for words cannot
see a number. The same hole admits `'off'` in single quotes, a second
`globalIgnores([...])` call, and a `rules` object imported from a new module and
spread in.

The round-1 objection to walking the config (B2) was real but mis-aimed: the
array spreads in `eslint-config-next/core-web-vitals`, which contributes 87 rule
**entries** across 66 unique rules, 38 of them `warn` and 5 `off`, so a blanket
"nothing is off anywhere" assertion fails on its first run. The distinction that
dissolves it is the one half (b) now draws: **rules the repository declares in
its own config objects** (seven, all known, two legitimately off) versus **rules
inherited from the vendored preset** (never enumerated, only probed by name for
the three this task cares about). Neither assertion ever walks the preset.

#### E.3-ter. Every suppression mechanism flat config offers, and what closes it

The table is the deliverable here, not decoration: F1 was the second round in
which a guard closed the mechanism the spec named and not the one an implementer
reaches for. An implementation that reaches lint-green must trip at least one
row.

| mechanism | closed by |
|---|---|
| `"off"` / `'off'` / `0` on a repo-declared rule | ER8 (b): resolved severity, and the declared-id set must be exactly the 7 |
| `"off"` / `0` on a **preset-inherited** rule (the F1 exploit) | ER8 (a): the three named rules must resolve to 2 / 2 / 1 |
| `"warn"` / `1` downgrade instead of a fix | ER1 (any severity fails) + ER2 (`--max-warnings=0`) + ER8 (a) |
| a `rules` object imported from a new module and spread in | ER8: resolution is source-agnostic; ER10 half (d) also bars the import |
| a later config object re-declaring a rule more loosely | ER8: `calculateConfigForFile` returns the last-wins value |
| plugin re-registered under a new name so the id stops resolving | ER8: an absent rule is not severity 2 |
| a second `globalIgnores([...])` call, or entries added to the first | ER10 half (c): the excluded file is still git-tracked and now unlinted |
| a config object's own `ignores:` key **alongside a `files` key** (the file stays in the run) | ER8 (b): every budget rule then resolves `undefined` on that file — **not** half (c) |
| a bare `{ ignores: [...] }` object with no `files` key (a global ignore) | ER10 half (c), and half (b) throws because `calculateConfigForFile` returns `undefined` |
| moving a source file under an ignored glob (`public/**`, `build/**`) | ER10 half (c) |
| narrowing a budget block's `files` glob until it matches nothing | `complexityBudget.test.ts:112` and `:127` `files` deep equality (cited in ER8) |
| `// eslint-disable-next-line` / `-line` for the three rules | ER3 (exactly 1 `set-state-in-effect`), ER7 (no new `no-unused-vars` suppression), ER6 (exactly the one justified `no-html-link-for-pages`) |
| whole-file `/* eslint-disable */`, with or without a rule list | ER10 half (d) |
| inline config comment `/* eslint <rule>: 0 */` | ER10 half (d) |
| CLI escapes: `--quiet`, `\|\| true`, `--ignore-pattern`, `--config`, `--rulesdir`, `--flag`, `--no-error-on-unmatched-pattern` | ER2 + ER10 half (d), bite-checked by ER11 |
| `--max-warnings` raised back above 0 later | ER2, plus ER10 half (a), which fails on any severity and so is flag-independent |
| deleting the CI lint job in a later edit | ER10 half (a) runs in the `coverage` job, which gates coverage |
| a `linterOptions` key (e.g. `reportUnusedDisableDirectives: 'off'`), which is not a rule declaration and so is invisible to ER8 | ER10 half (d): `eslint.config.mjs` declares no `linterOptions` key (none today) |
| env-conditional config (strict under vitest, loose under `npm run lint`) | ER10 half (d): no `process.env` in `eslint.config.mjs` |
| `.skip`-ing or deleting the gate test itself | ER16 pins `1 skipped` exactly, and the file list by name |
| deleting the offending code instead of fixing it | ER4–ER7 name each file and remedy; ER13–ER15 pin the behaviour that must survive |

4. **Four stale claims, not three.** Adding the CI job falsifies "No CI job runs
   eslint" in `AGENTS.md:97`, in the comment above `complexity-budget/base` in
   `eslint.config.mjs` (`:39`) and in the header docblock of
   `complexityBudget.test.ts` (`:9`). A fourth claim is stale **already**, and
   sits inside the same `AGENTS.md:97` sentence the implementer is editing: it
   says the list fails "on the list growing past **18** entries" while
   `MAX_OVERRIDES = 17`. Correct it in the same edit. The same off-by-one lives
   in the test's own title at `complexityBudget.test.ts:138` — `'lists at most
   18 per-file overrides, each naming a file that exists'` — in a file ER12
   already touches; correct it to 17 there too.
   (`AGENTS.md:100`, the `npm audit` bullet, is a *different* bullet and is
   RH-131's debt — leaving it alone is deliberate. See Out of Scope.)

### F. Tests for the four untested fixes

Each of the four fixes below lands in a file with no test of any kind. Each gets
one new unit test file, jsdom, in the style of
`src/components/layout/__tests__/AppLayout.test.tsx` (hoisted `vi.fn()` spies,
`vi.mock` for `next/navigation` and the auth client, explicit
`afterEach(cleanup)` — `globals: false`, so cleanup does not self-register).
`AppLayout.test.tsx:51-54` is the precedent for mocking the router hooks
(`vi.mock('next/navigation', () => ({ usePathname, useRouter }))`) and is the
one to copy for `useSearchParams`.
`src/app/join/__tests__/joinPage.test.tsx` is a precedent for unit-testing a
*page* file, but a narrower one than round 1 claimed: it tests an **async
Server Component** and mocks `redirect` only — no router hooks. Cite it for the
page-import shape, not for the hooks.
None of these paths is in the coverage universe, so none moves the coverage
number; they exist to make the behaviour checkable.

- **`src/app/reset-password/__tests__/resetPasswordPage.test.tsx`** — with
  `useSearchParams` answering `token=abc`, the **missing-token** branch is
  absent on the **first** render (assert on the heading "Invalid Link" and the
  body text "The password reset token is missing from the URL", `:85`/`:86` —
  **not** on "Invalid or expired reset token", which is `setError`'s
  submit-time string at `:30` and never paints on a first render either way,
  so it would pass identically before and after the fix), and submitting two
  matching passwords of 8+ characters calls `authClient.resetPassword` with
  that exact token; with **no** `token` param, the "Invalid Link" /
  "missing from the URL" branch **is** shown and the password form is not.
- **`src/app/settings/__tests__/settingsPage.test.tsx`** — `fetch` is stubbed.
  On `{ connected: false }` the "Connect your Spotify account" region appears
  with an `<a href="/api/auth/spotify/authorize">`; on an array response the
  "Connected to Spotify" region appears; in both cases the "Checking Spotify
  connection..." spinner is gone once the load settles. This is what catches a
  botched inline-async + `alive` guard leaving `spotifyConnected` at `null`.
- **`src/components/layout/__tests__/LanguageSelector.test.tsx`** and
  **`src/components/landing/__tests__/LandingPage.test.tsx`** — the
  hydration-safety pair. Both set the locale cookie to `en` and compare the
  SSR-shaped render (`renderToStaticMarkup`, where `useHydrated()` answers
  `false` because `useHydrated` is `useSyncExternalStore` with
  `getServerSnapshot = () => false`, and `renderToStaticMarkup` takes that
  path) against the client `render()`. **What each asserts differs, because
  the two components expose the locale differently:**

  - `LandingPage` renders `dict.landing.*` throughout, and **all 26
    `landing.*` keys** differ between `pt-BR.json` and `en.json` (47 of 51
    keys differ overall), so the two renders are textually distinct: assert
    the SSR markup carries the `pt-BR` copy and the client render carries the
    `en` copy.
  - `LanguageSelector` must **not** be asserted that way. Its two `<option>`
    labels are hardcoded at `:29-37` and rendered unconditionally, and
    `common.portuguese` / `common.english` are *identical* in both
    dictionaries ("Português (BR)" and "English"), so the locale reaches the
    DOM only through `<select value={…}>` — which React sets as a DOM
    **property**, not an attribute. The client `en` render is therefore
    byte-identical to the client `pt-BR` render, and "produces the `en`
    output" is undefined for it. Assert instead: on the **client** render the
    select element's `value` property is `'en'` (e.g.
    `(screen.getByLabelText('Language selector') as HTMLSelectElement).value`),
    while the **SSR** markup from `renderToStaticMarkup` carries `selected` on
    the `pt-BR` option and not on the `en` one — which is how the server pass
    serialises a `<select value>` and the only place the SSR locale is visible.

  That pairing is what a cookie read on the SSR pass fails; a hydration
  mismatch is otherwise invisible to a test. `LanguageSelector`'s test also
  stubs `window.location.reload` and asserts a change writes the cookie.
- **`src/components/profile/__tests__/ProfileTabs.test.tsx`** — the §A1 key.
  Re-rendering with a different band (same `type`) keeps the selected tab,
  including after the user has clicked "Personal"; re-rendering with
  `{ type: 'user' }` shows the personal panel and no switcher. The first of
  those fails under `key={context.id}`, which is the whole point.

### G. Size, and the seam this task does not take

Review flagged the size — 17 ERs, 6 new test files, 11 edited source files, a
CI job, four doc corrections — as at the top of what one PR should carry, while
explicitly not asking for a split, because the gate work is inseparable from
the clearing work: a cleared baseline with no gate regrows, and a gate added
over a dirty baseline fails on its first run.

**Round 2 does not take the seam, and adds nothing substantial.** The F1 fix
*replaces* §E.3's text-scan assertions with resolved-severity ones in the same
single test file — a different implementation of the same half, not an extra
deliverable. F2 and F3 rewrite assertion strings inside tests that were already
in scope. The one ER added (ER11) is ER10's bite-check list
split out so QA can tick each mechanism separately — not new work.

For the record, the seam if a future round forces one: **§E (the gate)** —
`--max-warnings=0`, the CI job, `lintGate.test.ts` and the four stale claims —
split from **§§A–C (the clearing)** and their §F tests. That ordering is
forced: the clearing part must land first, or §E.3's half (a) fails on the
8 errors it inherits.

### Files touched

- `e2e/global-setup.ts` — drop the unused `chromium` import.
- `scripts/migrate.mjs` — optional catch binding at the connect fallback.
- `src/app/profile/page.tsx` — delete the tab-sync effect, the header switcher
  and the content switch; render `<ProfileTabs>` with the two panels as props;
  drop the `useEffect` import if nothing else needs it.
- **`src/components/profile/ProfileTabs.tsx`** — NEW (§A1): owns `activeTab`,
  the header, the switcher and the content slot, and applies `key={context.type}`
  internally. No override entry.
- `src/app/reset-password/page.tsx` — derive the token, drop state and effect.
- `src/app/settings/page.tsx` — inline the status load inside the effect with an
  `alive` guard; drop `useCallback` from the import; keep the `<a>` with a
  justified one-line disable.
- `src/components/landing/LandingPage.tsx` — derive the locale behind
  `useHydrated()`, keep the dev fetch.
- `src/components/layout/AppLayout.tsx` — both `mounted` flags become `useHydrated()`.
- `src/components/layout/LanguageSelector.tsx` — derive the locale behind
  `useHydrated()`; drop the state and its `handleLanguageChange` writer; drop the
  unused `SUPPORTED_LOCALES` import.
- `src/lib/__tests__/edge_cases.test.ts`, `src/lib/__tests__/errors.test.ts`,
  `src/lib/__tests__/i18n.test.ts` — drop unused imports and the trailing
  `params` parameter; no assertion changes.
- `eslint.config.mjs` — re-pin `profile/page.tsx`'s `max-lines`; correct the
  "No CI job runs eslint" comment. No rule change, no `ignores` change.
- `src/lib/__tests__/complexityBudget.test.ts` — header docblock and the
  `18`→`17` test title. `MAX_OVERRIDES` only if an entry is removed.
- `src/lib/__tests__/lintGate.test.ts` — NEW guard (§E.3).
- `src/app/reset-password/__tests__/resetPasswordPage.test.tsx`,
  `src/app/settings/__tests__/settingsPage.test.tsx`,
  `src/components/layout/__tests__/LanguageSelector.test.tsx`,
  `src/components/landing/__tests__/LandingPage.test.tsx`,
  `src/components/profile/__tests__/ProfileTabs.test.tsx` — NEW (§F).
- `.github/workflows/ci.yml` — new lint job.
- `AGENTS.md` — the complexity-budget bullet (`:97`): eslint is now CI-enforced,
  and 18→17.
- `package.json` — `lint` script and the version bump.

### Test criteria

`npx eslint . --format json` reports an empty `messages` array for every file;
`npm run lint` exits 0 and exits non-zero again once any unused variable is
introduced anywhere; `RUN_DB_TESTS=1 npx vitest run` is green (0 failed, 1
skipped, no pre-existing assertion removed) with the six new files;
`npm run test:coverage`, `npm run lint:dead` and `npm run lint:dup` pass;
`complexityBudget.test.ts` passes with no entry added and no ceiling raised;
`lintGate.test.ts` fails on each row of §E.3-ter's mechanism table, the
numeric `"react-hooks/set-state-in-effect": 0` included, and passes again on
revert; clicking "Connect Spotify" on `/settings` still reaches Spotify's
consent screen; `/reset-password?token=…` still completes a reset and
`/reset-password` with no token shows the "Invalid Link" panel.

## Expected Results

- [ ] ER1 — `npx eslint . --format json` returns an empty `messages` array for every file (0 errors, 0 warnings, any severity, whole project), and `npm run lint` exits 0.
- [ ] ER2 — `package.json`'s `lint` script fails on a single warning: it passes `--max-warnings=0` to eslint, still lints the whole project (no path argument narrower than `.`), and contains none of `--quiet`, `|| true`, `--no-error-on-unmatched-pattern`, `--ignore-pattern`, `--config`, `--rulesdir` or `--flag`. Verify by introducing one unused variable in any file under `src/` and confirming `npm run lint` exits non-zero.
- [ ] ER3 — The seven `react-hooks/set-state-in-effect` errors are gone, fixed in code and not silenced: `grep -rn "eslint-disable.*set-state-in-effect" src` returns exactly one hit, the pre-existing `src/hooks/useBandAdmin.ts:190`.
- [ ] ER4 — `src/components/layout/AppLayout.tsx` declares no `mounted` `useState` and no effect that sets one; both former sites (previously lines 49 and 166) read `useHydrated()` from `src/hooks/useHydrated.ts`. `src/components/layout/__tests__/AppLayout.test.tsx` passes with no assertion deleted or weakened.
- [ ] ER5 — `src/app/profile/page.tsx` contains no `useEffect` that calls `setActiveTab` and no `activeTab` state; a new file `src/components/profile/ProfileTabs.tsx` owns that state, the tab switcher and the content slot, receives the band context plus the two panels as props, imports nothing from `@/app/*`, and applies `key={context.type}` (not `context.id`) inside its own module. A new `src/components/profile/__tests__/ProfileTabs.test.tsx` passes and asserts all three: re-rendering with a different band of the same `type` keeps the tab the user selected (including "Personal"), re-rendering with `{ type: 'user' }` shows the personal panel with no switcher, and a band context shows the band tab selected on first render.
- [ ] ER6 — `src/app/settings/page.tsx` still reaches `/api/auth/spotify/authorize` through a plain `<a href>` (no `next/link`, no `window.location` replacement), preceded by a single `eslint-disable-next-line @next/next/no-html-link-for-pages` whose comment states that the destination is a route handler that sets an httpOnly state cookie and redirects to `accounts.spotify.com` and therefore needs a document request. Clicking "Connect Spotify" still lands on Spotify's consent screen.
- [ ] ER7 — All `@typescript-eslint/no-unused-vars` warnings are fixed in code with no suppression and no `argsIgnorePattern` added to `eslint.config.mjs`: `chromium` gone from `e2e/global-setup.ts`'s import, an optional catch binding in `scripts/migrate.mjs`, `SUPPORTED_LOCALES` gone from `src/components/layout/LanguageSelector.tsx`, the three unused imports gone from `src/lib/__tests__/edge_cases.test.ts`, `type Locale` gone from `src/lib/__tests__/i18n.test.ts`, the trailing unused `params` parameter removed from the mock dispatcher in both `src/lib/__tests__/edge_cases.test.ts` and `src/lib/__tests__/errors.test.ts`, and `useCallback` gone from `src/app/settings/page.tsx`'s React import. No test assertion changed in any of those files.
- [ ] ER8 — Lint was not made green by weakening a rule, and the check is on **resolved severities**, not on the source text of `eslint.config.mjs` (a text scan cannot see `"react-hooks/set-state-in-effect": 0`, which silences four of today's eight errors). Via the ESLint Node API's `calculateConfigForFile`: (a) the three rules this task clears still resolve to their current severities — `react-hooks/set-state-in-effect` **2** and `@next/next/no-html-link-for-pages` **2** on each of the six touched component/page files, and `@typescript-eslint/no-unused-vars` **1** (never 0) on each of the eleven baseline files; (b) the set of rule ids declared by `eslint.config.mjs`'s **own** config objects — the exported array minus the two `eslint-config-next` preset spreads — is exactly these seven and no eighth: `@typescript-eslint/no-explicit-any`, `no-restricted-imports`, `complexity`, `max-depth`, `max-lines-per-function`, `max-params`, `max-lines`; and their resolution is unchanged — on `src/components/layout/LanguageSelector.tsx`, `complexity` `[2, 15]`, `max-depth` 4, `max-lines-per-function` 200, `max-params` 4, `max-lines` 400, `no-restricted-imports` and `@typescript-eslint/no-explicit-any` severity 2, while on `src/lib/__tests__/errors.test.ts` the only two zeros **among these seven declared ids** are the intended ones, `@typescript-eslint/no-explicit-any` and `max-lines-per-function`, with `max-lines` `[2, 800]` and `complexity` `[2, 16]`. These assertions hold however a severity is spelled (`"off"`, `'off'`, `0`), in whichever config object, and whether or not its `rules` were spread in from another module. The `rules` objects and sorted `files` arrays of `complexity-budget/base` and `complexity-budget/tests` are **not** re-asserted here: `src/lib/__tests__/complexityBudget.test.ts:107-135` already pins both by `toEqual`, and that is the artifact that proves them.
- [ ] ER9 — The block between `// BEGIN:complexity-budget-overrides` and `// END:complexity-budget-overrides` in `eslint.config.mjs` holds at most 14 entries, with no entry added for `src/components/profile/ProfileTabs.tsx` or any new test file. The `src/app/profile/page.tsx` entry still carries `complexity: 22` and `max-lines-per-function: 365` (both are `BandProfileView`'s numbers and this task does not touch it) with `max-lines` lowered to the file's new exact length; the `AppLayout.tsx`, `edge_cases.test.ts` and `errors.test.ts` entries are unchanged after re-measurement. No ceiling is higher than before, `MAX_OVERRIDES` is still 17 or lower, and `src/lib/__tests__/complexityBudget.test.ts` passes.
- [ ] ER10 — A new `src/lib/__tests__/lintGate.test.ts` passes and has four halves: (a) an ESLint Node API run over the whole project asserting that no result carries any message of **any** severity; (b) the resolved-severity assertions of ER8; (c) **no file silently leaves the run** — `lintFiles(['.'])` returns a result for every git-tracked lintable path (`git ls-files` filtered to `.js/.jsx/.mjs/.cjs/.ts/.tsx`; the set difference must be empty — 435 of 435 today), asserted as a derived set difference and not a count; (d) a text read asserting ER2's `lint`-script properties, that `eslint.config.mjs` imports only from `eslint/config`, `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`, contains no `process.env` reference and declares no `linterOptions` key (there is none today, so `reportUnusedDisableDirectives` cannot be quietly lowered — a `linterOptions` key is not a rule declaration and is invisible to ER8), and that no file under `src/`, `e2e/` or `scripts/` carries a whole-file `/* eslint-disable ... */` block comment (with or without a rule list) or an inline `/* eslint <rule>: 0 */` config comment.
- [ ] ER11 — The gate bites on every suppression mechanism, each verified by making the change, running `npx vitest run src/lib/__tests__/lintGate.test.ts`, seeing it fail, and reverting: inserting `"react-hooks/set-state-in-effect": 0` into any config object's `rules` (the **numeric** severity — this is the case a literal count of `"off"` misses, and it silences four of today's eight errors on its own) fails half (b); so do `'off'` in single quotes, `"warn"`, and a `rules` object imported from a new module and spread into the array; adding a second `globalIgnores([...])` call, adding an `ignores:` key to any config object, and moving a tracked source file under an ignored glob each fail half (c); introducing one unused variable fails half (a); adding `--quiet` to the `lint` script and adding a whole-file `/* eslint-disable */` to any file under `src/` each fail half (d).
- [ ] ER12 — `.github/workflows/ci.yml` contains a job that runs `npm run lint` and fails the workflow when it exits non-zero, and four stale claims are corrected: "No CI job runs eslint" in `AGENTS.md`, in the comment above `complexity-budget/base` in `eslint.config.mjs` and in the header docblock of `src/lib/__tests__/complexityBudget.test.ts`; plus the 18→17 override-limit figure, both in that same `AGENTS.md` bullet and in the `complexityBudget.test.ts` test title that reads "lists at most 18 per-file overrides". Outside `docs/` (which quotes the old wording on purpose), `grep -rn "No CI job runs eslint" AGENTS.md eslint.config.mjs src` and `grep -rn "18 per-file overrides\|past 18 entries" AGENTS.md src` both return nothing.
- [ ] ER13 — A new `src/app/reset-password/__tests__/resetPasswordPage.test.tsx` passes and asserts the missing-token branch by the text that branch actually renders — the heading **"Invalid Link"** and the body **"The password reset token is missing from the URL"** (`src/app/reset-password/page.tsx:85` and `:86`), **not** the string "Invalid or expired reset token", which `setError` writes inside `handleSubmit` only (`:30`) and which never appears on a first render before or after this change. Three assertions: with `useSearchParams` answering `?token=abc`, that branch is absent on the **first** render and the password form is present; submitting two matching 8+ character passwords calls `authClient.resetPassword` with `token: 'abc'`; with no `token` param, that branch **is** rendered and the password form is not.
- [ ] ER14 — A new `src/app/settings/__tests__/settingsPage.test.tsx` passes and asserts, with `fetch` stubbed, that a `{ connected: false }` response renders the "Connect your Spotify account" region containing `<a href="/api/auth/spotify/authorize">`, that an array response renders the "Connected to Spotify" region, and that in both cases the "Checking Spotify connection..." spinner is gone once the load settles.
- [ ] ER15 — Two new tests pin the locale derivation as hydration-safe, each asserting an output that component actually emits. With the locale cookie set to `en`: `src/components/landing/__tests__/LandingPage.test.tsx` asserts that the server-shaped render (`renderToStaticMarkup`, where `useHydrated()` answers `false`) still carries the `pt-BR` copy while a client `render()` carries the `en` copy — valid because all 26 `landing.*` dictionary keys differ between `pt-BR.json` and `en.json`. `src/components/layout/__tests__/LanguageSelector.test.tsx` asserts instead that the **client** render's select element has `value === 'en'` as a DOM property, and that the **`renderToStaticMarkup`** output carries `selected` on the `pt-BR` option and not on the `en` one — because that component's two `<option>` labels are hardcoded and rendered unconditionally and `common.portuguese`/`common.english` are identical in both dictionaries, so its client `en` and client `pt-BR` markup are byte-identical and "produces the `en` output" would assert nothing. The `LanguageSelector` test additionally asserts that selecting a language writes the cookie, with `window.location.reload` stubbed.
- [ ] ER16 — `RUN_DB_TESTS=1 npx vitest run` (Postgres on port 54322) reports 0 failed, 1 skipped and at least 2197 passed, including the six new test files; no pre-existing test was deleted, skipped, or had an assertion removed or weakened. `npm run test:coverage`, `npm run lint:dead` and `npm run lint:dup` also pass.
- [ ] ER17 — `package.json`'s version is bumped per the AGENTS.md rule (patch increment plus a `YYYYMMDDHHmm` suffix, strictly above `0.1.147-202610070115`).

## Out of Scope

- `npm run audit` / `audit:all` (RH-131) — unchanged. `AGENTS.md:100`'s audit
  bullet still describes the pre-RH-131 full-tree behavior; it is a separate
  bullet from the one ER12 edits, and correcting it is not this task.
- Any migration.
- Lowering a complexity ceiling beyond what a fix in this task actually earns.
- Playwright coverage for `/reset-password` and `/settings`: §F's unit tests pin
  the behaviour these fixes could break. A full e2e flow for either is its own
  task.
