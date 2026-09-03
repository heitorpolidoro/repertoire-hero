# RH-31 — Atualizar landing page com anotações no Stage Mode e catálogo compartilhado

> **Landing Page Rule (AGENTS.md):** this task **is** the landing-page update. It exists
> precisely to bring the marketing copy back in line with shipped selling points
> (RH-5 + RH-28 handwritten annotations, and the shared global catalog). No other task is
> expected to touch `landing.*` as part of this change.

## Scope

Rewrite two feature-card entries in the landing copy, in **both** dictionaries:

1. **`landing.f5Title` / `landing.f5Desc`** — today "PDF Tab & Sheet Uploads". Becomes the
   dedicated **handwritten annotations** card: draw over PDF tabs in Stage Mode with a finger
   or a pen, per page, saved automatically, drawing toggles on/off, works on tablets — while
   keeping the existing PDF-upload / band-sharing selling point in the same sentence.
2. **`landing.f1Desc`** — the "Song Catalog" card gains **one** sentence about the shared
   catalog: songs already catalogued by other musicians arrive pre-filled (title, artist,
   album, key, cover art, links).

Files touched: `src/i18n/dictionaries/en.json`, `src/i18n/dictionaries/pt-BR.json`, one new
vitest file, `package.json` (version bump), this spec.

**Not covered:** no change to `src/components/landing/LandingPage.tsx` (see *Approach*), no
new dictionary keys, no new card, no layout/design change, no emoji change, and nothing about
RH-8 (invite regenerate), RH-14 (i18n as a feature) or RH-27 (moderation queue).

## Background — what the code actually looks like

Read at `94b7054`:

- `src/components/landing/LandingPage.tsx` renders the feature grid as **six hand-written
  `<div>` cards**, not a loop: `f1Title/f1Desc` … `f6Title/f6Desc` are referenced literally at
  lines 141–199, inside
  `<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">` (line 135). Each
  card also hard-codes its emoji (📚 🎯 👥 ⚡ 📄 🎧).
  → **A 7th card requires editing the component**, and 7 cards orphan the last row at both
  `md` (2 cols) and `lg` (3 cols). Six is the only count that fills 1-, 2- and 3-column rows.
  → Rewriting the text of an existing card requires **no code change at all**: the JSON values
  are the only thing that moves.
- The dispatch offered "rewrite the Fast View card **or** add a dedicated card". This spec
  takes a third, strictly cheaper option inside the same spirit: **rewrite the `f5` card**
  (PDF tabs), because annotations are drawn *on* the PDF tabs that card already sells, while
  `f4` keeps owning setlist swiping / lyrics / Stage Mode. Grid stays at six cards, component
  stays untouched.
- `src/lib/i18n.ts:10` types the dictionary map as `Record<Locale, typeof ptBRDict>`, so the
  **pt-BR file is the type source**. A key present in pt-BR and missing in en is a compile
  error; a key present only in en is invisible to `dict.landing.*`. Practically: both files
  must stay symmetric. Today they are — 49 leaf keys each, zero asymmetry (verified by
  flattening both JSONs).
- **There is no key-parity test.** `src/lib/__tests__/i18n.test.ts` only covers
  `parseAcceptLanguage` / `resolveLocale` / `getDictionary('…').common.appName`. Nothing
  asserts the two dictionaries have the same keys, and nothing asserts any `landing.*` value.
  This task adds that guard (below), since "apply the same change to BOTH dictionaries" is
  otherwise unverifiable by machine.
- `vitest.config.ts` sets `environment: 'node'`; there is no jsdom/happy-dom and no
  `@testing-library/react` in `package.json`. **A component-render test for `LandingPage` is
  not available without adding dependencies — it is out of scope.** The new test asserts on
  dictionary content only, which is exactly what changes here.
- Locale selection: `LandingPage` reads the `NEXT_LOCALE` cookie client-side and defaults to
  `pt-BR` (`LandingPage.tsx:14–19, 23`). `LanguageSelector` writes the cookie and calls
  `window.location.reload()`. So QA switches languages either through the selector in the
  landing header or by setting `document.cookie = 'NEXT_LOCALE=en; path=/'` and reloading.

### Known environment hazard (RH-32) — read before the browser check

`/` **is** wrapped by `AppLayout`: `ConditionalLayout` only bypasses the shell for
`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/join/`. So the landing route
inherits the pre-existing RH-32 failure. Reproduced during this spec, on this machine, at
`94b7054`, with an untouched tree:

- `npm run dev` (webpack): `GET / -> 500`, `Invalid hook call … Cannot read properties of null
  (reading 'useRef') at AppLayout (src/components/layout/AppLayout.tsx:169)`.
- `npx next dev --turbopack`: identical, `GET / -> 500`, same digest-level error.
- The 500 body is Next's `__next_error__` document — the SSR HTML does **not** contain the
  landing copy. Per `.meridian/reports/RH-16-qa_review-1.md`, the affected routes *recover on
  the client* and render in a real browser; only `curl` sees the error document.

The expected results below therefore state the browser check *and* two dependency-free
fallbacks, so RH-31 can never be blocked by RH-32.

## Approach

### 1. Copy — exact strings (no wording decisions left to the developer)

Replace exactly these values. Everything else in `landing.*` stays byte-for-byte identical.

**`src/i18n/dictionaries/en.json`**

`landing.f1Desc`:

```
Catalog songs with title, artist, album, key, cover art, duration, and external links to Spotify, YouTube, or Cifra Club. Songs other musicians have already catalogued arrive pre-filled — title, artist, album, key, cover art and links — so you add them in one tap.
```

`landing.f5Title`:

```
Handwritten Notes on PDF Tabs
```

`landing.f5Desc`:

```
Attach PDF chord charts and tablatures to any song, yours or shared with your band, and write straight on them in Stage Mode with your finger or a pen. Annotations are saved per page automatically, drawing toggles on and off so you can still turn pages, and it works great on a tablet.
```

**`src/i18n/dictionaries/pt-BR.json`**

`landing.f1Desc`:

```
Catalogue músicas com título, artista, álbum, tom, capa, duração e links externos para Spotify, YouTube ou Cifra Club. Músicas que outros músicos já catalogaram chegam preenchidas — título, artista, álbum, tom, capa e links — e você adiciona em um toque.
```

`landing.f5Title`:

```
Anotações à Mão nas Tabs em PDF
```

`landing.f5Desc`:

```
Anexe cifras e tablaturas em PDF a qualquer música, suas ou compartilhadas com a banda, e escreva por cima delas no Stage Mode com o dedo ou uma caneta. As anotações são salvas automaticamente, página por página, o modo de desenho liga e desliga para você continuar virando as páginas, e funciona muito bem no tablet.
```

Notes for the developer:

- The em dashes (`—`) and accented characters are literal UTF-8 in the JSON, matching the
  existing file style (the dictionaries already contain `©`, `→`, accented Portuguese).
- Do **not** introduce `\u` escapes; do not reformat unrelated lines; keep 2-space indentation
  and the existing key order so the diff is four changed lines total across the two files.
- The words "moderation"/"moderação", "approval"/"aprovação", "correct"/"corrigir" must not
  appear anywhere in `landing.*` — the shared catalog is sold as *convenience*, never as a
  correction/review workflow (operator constraint).
- Wording is grounded in shipped behaviour: RH-5 delivered per-page strokes over a `react-pdf`
  canvas with debounced autosave, pen/erase/pan, colours, undo and clear-page; RH-28 added the
  `Draw: On / Draw: Off` toggle (`TabDrawingStage.tsx:659–666`) and the tablet-viewport fixes.
  Nothing in the copy over-promises.

### 2. Regression guard — `src/lib/__tests__/landingCopy.test.ts` (new)

Plain vitest, node environment, imports the two JSON files directly (no React, no DOM):

```ts
import en from '@/i18n/dictionaries/en.json'
import ptBR from '@/i18n/dictionaries/pt-BR.json'
```

Six `it(...)` cases, with these exact names:

1. `both dictionaries expose the same key set` — recursively flatten both objects to dotted
   leaf paths and assert the sorted arrays are equal (this is the parity guard the repo lacks;
   it must hold for the whole dictionary, not just `landing.*`).
2. `EN f5 card sells handwritten annotations in Stage Mode` — `en.landing.f5Title` matches
   `/handwritten/i` and `/pdf/i`; `en.landing.f5Desc` matches, case-insensitively, each of
   `annotat`, `draw`, `tablet`, `pen`, `finger`, `stage mode`.
3. `PT f5 card sells handwritten annotations in Stage Mode` — `ptBR.landing.f5Title` matches
   `/anota[çc]/i` and `/pdf/i`; `ptBR.landing.f5Desc` matches, case-insensitively, each of
   `anotaç`, `desenho`, `tablet`, `caneta`, `dedo`, `stage mode`.
4. `EN catalog card mentions the shared catalog` — `en.landing.f1Desc` matches
   `/other musicians/i` and `/pre-filled/i`.
5. `PT catalog card mentions the shared catalog` — `ptBR.landing.f1Desc` matches
   `/outros músicos/i` and `/preenchid/i`.
6. `landing copy never mentions moderation or corrections` — for every string value under
   `landing.*` in both dictionaries, assert it does **not** match
   `/moderat|moderaç|aprovaç|approval|corrig|correct/i`.

Assertions are on **substrings/regexes**, never on whole sentences, so a later copy polish
does not break the suite (or QA).

### 3. Version bump

`package.json` `version` goes from `0.1.60-202609030504` to `0.1.61-<YYYYMMDDHHmm>` (local
time at commit). Per AGENTS.md the version may only ever go **up**; `0.1.60-202609030504` is
the highest used so far.

## Expected Results

- [ ] `src/i18n/dictionaries/en.json` `landing.f5Title` matches `/handwritten/i` and `/pdf/i`;
      `landing.f5Desc` contains, case-insensitively, all of `annotat`, `draw`, `tablet`, `pen`,
      `finger`, `stage mode`.
- [ ] `src/i18n/dictionaries/pt-BR.json` `landing.f5Title` matches `/anota[çc]/i` and `/pdf/i`;
      `landing.f5Desc` contains, case-insensitively, all of `anotaç`, `desenho`, `tablet`,
      `caneta`, `dedo`, `stage mode`.
- [ ] `en.json` `landing.f1Desc` matches `/other musicians/i` and `/pre-filled/i`;
      `pt-BR.json` `landing.f1Desc` matches `/outros músicos/i` and `/preenchid/i`; both still
      list title, artist, album, key/tom, cover/capa and links.
- [ ] No string under `landing.*` in either dictionary matches
      `/moderat|moderaç|aprovaç|approval|corrig|correct/i`.
- [ ] Both dictionaries still have identical flattened key sets and no `landing.*` key was
      added or removed (still `f1`…`f6`, 49 leaf keys per file).
- [ ] `src/lib/__tests__/landingCopy.test.ts` exists with the six named cases and passes.
- [ ] `npx vitest run` exits 0 — 24 test files, ≥ 243 tests, 0 failures — and the only test
      file added/changed is `landingCopy.test.ts`.
- [ ] `src/components/landing/LandingPage.tsx` is byte-identical to `94b7054`; the change set
      contains no file under `src/components/` or `src/app/`.
- [ ] `npx eslint .` reports no more than the pre-existing 24 errors / 20 warnings, and
      `npx eslint src/lib/__tests__/landingCopy.test.ts` exits 0 with empty output;
      `npx tsc --noEmit` exits 0.
- [ ] Browser check (an RH-31 criterion that does not depend on RH-32 being fixed): load `/` in
      a browser and assert, first in pt-BR (the default) and then in EN (choose "English" in the
      language selector in the landing header, or set the cookie with
      `document.cookie = 'NEXT_LOCALE=en; path=/'` and reload): the fifth feature card's title
      (`landing.f5Title`) matches `/handwritten/i` in EN and `/anota[çc]/i` in PT-BR; the first
      feature card's description (`landing.f1Desc`) contains the shared-catalog sentence,
      matching `/other musicians/i` in EN and `/outros músicos/i` in PT-BR;
      `document.querySelector("div.grid").children.length === 6`; and
      `getComputedStyle(document.querySelector("div.grid")).gridTemplateColumns` resolves to 1
      track at a 375 px viewport and 3 tracks at 1280 px. If `GET /` returns HTTP 500 / Next's
      `__next_error__` document from the server, that is the pre-existing RH-32 failure
      ("Invalid hook call" / "Cannot read properties of null (reading 'useRef')" in
      `src/components/layout/AppLayout.tsx`) and is NOT an RH-31 failure; in that case use
      either fallback: (a) run `npx next build && npx next start`, load `/` in a browser and run
      the same assertions above; or (b) run `npx next build`, then confirm
      `grep -rl "Handwritten Notes on PDF Tabs" .next/static/chunks` and
      `grep -rl "Anotações à Mão nas Tabs em PDF" .next/static/chunks` each return at least one
      file, and `grep -c "f[1-6]Title" src/components/landing/LandingPage.tsx` returns 6,
      showing the grid still renders exactly six cards from those keys.
- [ ] `package.json` version is `0.1.61-<YYYYMMDDHHmm>` or higher, strictly above
      `0.1.60-202609030504`.

## Out of Scope

- Adding a 7th feature card, changing the grid, or changing any card emoji (📄 stays on `f5`).
- Any edit to `src/components/landing/LandingPage.tsx`, `src/lib/i18n.ts` or
  `LanguageSelector.tsx`.
- New dictionary keys, new locales, or i18n plumbing (RH-14).
- Fixing the RH-32 SSR 500 on `/` — QA works around it via the documented fallbacks.
- Landing copy for RH-8 (invite regenerate) and RH-27 (moderation queue): internal/operational,
  explicitly *not* selling points per the AGENTS.md Landing Page Rule.
- Adding jsdom / `@testing-library/react` to run component render tests.
- e2e/Playwright coverage of the landing page (the webServer probe itself is blocked by RH-32).
