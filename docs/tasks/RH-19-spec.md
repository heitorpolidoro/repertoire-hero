# RH-19 — Host the pdf.js worker locally instead of from an external CDN

## Scope

Stage Mode's PDF renderer (`react-pdf` / `pdfjs-dist`) currently loads its web
worker from `unpkg.com`. This task makes the worker a **first-party static
asset served from the app's own origin**, removes the unpkg reference entirely,
and makes the version coupling between the served worker and the installed
`pdfjs-dist` **mechanically enforced by a test** rather than by a template
literal that happens to interpolate `pdfjs.version`.

In scope:

1. A build-time copy step (`scripts/copy-pdf-worker.mjs`) that places
   `pdf.worker.min.mjs` into `public/`, wired into `postinstall`, `predev` and
   `prebuild` so every entry point (`npm install`, `npm ci`, `npm run dev`,
   `npm run build`, Vercel, Docker, CI) produces it.
1b. A one-line `Dockerfile` change (`COPY scripts ./scripts` in the `deps`
   stage, before `RUN npm ci`) without which the new `postinstall` hook aborts
   the image build — see §2.
2. `src/lib/pdfWorker.ts` pointing `GlobalWorkerOptions.workerSrc` at the
   same-origin path.
3. Treating the copied worker as a build artifact: gitignored, and excluded
   from ESLint so `npx eslint .` does not start parsing a 1 MB minified bundle.
4. Excluding the worker path from the session-gating middleware matcher in
   `src/proxy.ts`, so the asset is served statically instead of behind a
   session `fetch` that can redirect it to `/login`.
5. A vitest guard (`src/lib/__tests__/pdfWorkerAsset.test.ts`) covering
   version drift, the absence of the CDN URL, the npm-script wiring and the
   middleware matcher.
6. A one-line correction to `docs/plans/mobile-app-analysis.md` §1.6, which
   currently documents the CDN worker as an open blocker.

Not in scope: offline support (RH-29), any change to Stage Mode's rendering,
zoom, annotation or gesture behaviour, and the pre-existing `next dev
--webpack` pdf.js failure (see Out of Scope).

**Landing Page Rule** (`AGENTS.md`): this task is explicitly **not a selling
point**. It changes where a script byte-for-byte identical to today's is
downloaded from; a musician cannot perceive it, and nobody chooses the app for
it. It is infrastructure/reliability work of the same class as error handling
or i18n plumbing. `src/components/landing/LandingPage.tsx` and the `landing.*`
copy in `src/i18n/dictionaries/en.json` / `pt-BR.json` **must not be touched**,
and an expected result asserts that.

## Current state (verified at `36ee59b`)

- `src/lib/pdfWorker.ts:17` —
  `pdfjs.GlobalWorkerOptions.workerSrc = \`https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs\``
- Sole consumer: `src/components/tabs/TabDrawingStage.tsx:5` (`import '@/lib/pdfWorker'`),
  which is rendered only from the Stage Mode overlay in
  `src/app/songs/[id]/fast-view/page.tsx:1478-1517`. Nothing else imports it.
- `pdfjs-dist` is **not** a direct dependency. `react-pdf@10.5.0` pins it
  exactly (`"pdfjs-dist": "5.4.296"`), and it hoists to
  `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` (~1 MB).
- Bundlers really are split: `dev` is `next dev --webpack`, `build` is plain
  `next build` (Turbopack by default in Next 16; `next.config.ts` declares
  `turbopack: {}`).
- `public/` currently holds only five SVGs — no build artifacts, no gitignore
  entry for it.
- **There is no CSP anywhere** in the repo (`next.config.ts` defines no
  `headers()`, `vercel.json` sets none, no meta CSP in any layout). So nothing
  blocks the worker today and nothing needs relaxing. If a CSP is added later,
  `worker-src 'self'` is all this design needs — which is precisely the point
  of the change.
- pdf.js 5.4.296 instantiates the worker as `new Worker(url, {type:"module"})`
  and performs its own same-origin check; a same-origin `.mjs` is loaded
  directly, without the `_createCDNWrapper` blob shim it uses today.

## Approach

### 1. `scripts/copy-pdf-worker.mjs` (new)

Plain Node ESM, **zero dependencies** (it runs at `postinstall`, before
anything is built), matching the existing style of `scripts/migrate.mjs`.

Resolution must go **through `react-pdf`**, not through the repo root:

```js
import { createRequire } from 'node:module'
const requireFromHere = createRequire(import.meta.url)
const requireFromReactPdf = createRequire(requireFromHere.resolve('react-pdf'))
const src = requireFromReactPdf.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
```

Rationale: the only worker that is *correct* is the one belonging to the
`pdfjs-dist` copy `react-pdf` itself resolves. If a future dependency bump ever
produces a second, nested `pdfjs-dist`, resolving from the repo root would
silently copy the wrong build and pdf.js would fail at runtime with a worker
version mismatch. (Verified working: this chain resolves to
`node_modules/pdfjs-dist/build/pdf.worker.min.mjs`; `pdfjs-dist` publishes no
`exports` map, so subpath resolution is unrestricted.)

Behaviour:
- Copy to `<repoRoot>/public/pdf.worker.min.mjs`, creating `public/` if absent.
- **Idempotent**: if the destination already exists and its bytes are identical
  to the source, skip the write and log `up to date`.
- Log the resolved `pdfjs-dist` version (read from the same resolution chain's
  `pdfjs-dist/package.json`) on every run.
- On resolution failure, exit with a non-zero code and a message naming
  `react-pdf` / `pdfjs-dist` and suggesting `npm install` — a silent success
  here would produce a 404 worker in production.

### 2. npm lifecycle wiring (`package.json`)

```json
"postinstall": "node scripts/copy-pdf-worker.mjs",
"predev":      "node scripts/copy-pdf-worker.mjs",
"prebuild":    "node scripts/copy-pdf-worker.mjs",
```

Three hooks, because several independent paths must all work:

| Path | Covered by |
|---|---|
| Vercel (`installCommand: npm install` then `buildCommand: npm run build`, per `vercel.json`) | `postinstall`, then `prebuild` |
| CI (`.github/workflows/ci.yml` → `npm ci`) | `postinstall` |
| Docker | `prebuild` in the `builder` stage — **and only that**; see §2.1, which also requires a `Dockerfile` edit for `postinstall` not to break the `deps` stage |
| Local `npm run dev` (`next dev --webpack` serves `public/` from disk per request) | `predev` |
| A bare `npx next build` | already produced by the preceding install |

`prebuild` runs *before* the existing
`node scripts/migrate.mjs && node scripts/deduplicate-songs.mjs && next build`
chain; do not modify that chain itself.

### 2.1 `Dockerfile` — required, or `postinstall` breaks the image build

Adding `postinstall` is **not** free for Docker. The `deps` stage today is:

```dockerfile
FROM node:24-alpine AS deps
...
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
```

Only `package.json` and the lockfile exist at that point — `scripts/` is not
copied until the `builder` stage's `COPY . .`. So `npm ci` would fire the root
package's new `postinstall`, run `node scripts/copy-pdf-worker.mjs` against a
path that does not exist, Node would exit 1, and npm would abort the install:
the image build fails outright, at the first stage, before anything is built.
(Reproduced twice: by the spec reviewer against this repo's `Dockerfile`, and
in isolation — a package whose only script is
`"postinstall": "node scripts/copy-pdf-worker.mjs"` fails `npm ci` with
`npm error code 1 / command failed / command sh -c node
scripts/copy-pdf-worker.mjs` when `scripts/` is absent, and installs cleanly as
soon as `scripts/` exists.)

**Chosen mitigation: copy `scripts/` into the `deps` stage.** Edit the `deps`
stage to:

```dockerfile
COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm ci
```

This is the only change to `Dockerfile`; the `builder` and `runner` stages are
untouched. Note the repo has **no `.dockerignore`**, so `scripts/` is part of
the build context and this `COPY` needs nothing else.

Why this one and not the alternatives:

| Rejected mitigation | Why not |
|---|---|
| `RUN npm ci --ignore-scripts` in `deps` | Silently disables *every* dependency's install scripts in the image, not just ours, diverging the image's `node_modules` from what CI and Vercel install. It would happen to work here (the `builder` stage's `prebuild` still writes the worker before `COPY --from=builder /app/public ./public`), but it fixes a one-line path problem with a global behaviour change. |
| Make `copy-pdf-worker.mjs` exit 0 when its inputs are missing | Directly contradicts §1: a silent success is exactly how a 404 worker reaches production. The script must stay loud; it is the only thing standing between a `react-pdf` bump and a broken Stage Mode. |

What still guarantees the worker is *in the image*: the `builder` stage runs
`npm run build`, whose `prebuild` writes `/app/public/pdf.worker.min.mjs`, and
the `runner` stage's existing `COPY --from=builder /app/public ./public`
carries it into the final image. The `deps` stage's `postinstall` run is
incidental — its `public/` output is discarded with the stage. The `Dockerfile`
edit exists so that hook *succeeds* rather than to produce the artifact.

### 3. `src/lib/pdfWorker.ts`

```ts
import { pdfjs } from 'react-pdf'

pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs?v=${pdfjs.version}`
```

- Root-relative, so it is same-origin under any host (localhost, preview
  deployments, production) with no env var and no bundler involvement.
- The `?v=` query is cache-busting insurance: if `pdfjs-dist` is ever upgraded,
  a browser holding a cached copy of the old worker would otherwise hit pdf.js's
  "worker version does not match API version" error. The version comes from the
  same `pdfjs` object the API uses, so it cannot drift from it.
- Rewrite the file's header comment: the current one documents the CDN choice
  as a deliberate dual-bundler workaround, and is now actively misleading. The
  replacement should state that the worker is a build artifact copied into
  `public/` by `scripts/copy-pdf-worker.mjs`, that no bundler-specific
  asset wiring is used (so it still works identically under both Webpack dev
  and the Turbopack build), and that `src/lib/__tests__/pdfWorkerAsset.test.ts`
  guards the version coupling.
- No change to `TabDrawingStage.tsx` or `fast-view/page.tsx`.

### 4. `.gitignore`

Add:

```
# Build artifact: copied from node_modules by scripts/copy-pdf-worker.mjs
/public/pdf.worker.min.mjs
```

The worker is **not** committed. Committing a 1 MB minified vendor blob would
reintroduce the exact drift risk this task exists to remove (it would have to
be re-copied by hand on every `react-pdf` bump, with nothing failing if you
forget until a user opens a tab).

### 5. `eslint.config.mjs` — required, not cosmetic

ESLint's flat-config defaults lint `**/*.mjs`, and this repo's config ignores
only `.next`, `out`, `build`, `next-env.d.ts` and `.claude`. Confirmed at
baseline: `npx eslint .` lints 118 files including `scripts/*.mjs` and even
`coverage/block-navigation.js`. Dropping a 1 MB minified ES module into
`public/` would therefore be linted, and would blow up the error/warning
totals. Add `"public/**"` to the existing `globalIgnores([...])` list.

### 6. `src/proxy.ts` — exclude the worker from session gating

Today's matcher excludes `_next/static`, `_next/image`, `favicon.ico` and
raster/SVG image extensions — but **not** `.mjs`. A request for
`/pdf.worker.min.mjs` would therefore run the middleware, which does a blocking
`fetch` to `/api/auth/get-session` (3 s abort) on every worker load, and — if
that check flakes or times out — returns a **307 redirect to `/login`**. The
browser would then try to instantiate a module worker from an HTML login page
and Stage Mode would fail with an opaque MIME/module error. That is strictly
worse than the CDN it replaces, so it must be fixed in this task.

Change the matcher to:

```
'/((?!_next/static|_next/image|favicon.ico|pdf\\.worker\\.min\\.mjs|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
```

Verified against the compiled pattern: `/pdf.worker.min.mjs` no longer matches,
while `/songs/1/fast-view`, `/login` and every other app route still do.

### 7. `src/lib/__tests__/pdfWorkerAsset.test.ts` (new)

Node-environment vitest (matching the project default), pure `fs` + `crypto`,
no DB.

**Self-exclusion (decided, not optional).** Case 4 below scans `src/` for the
literal `unpkg`, and the test file that performs the scan necessarily contains
that literal and itself lives under `src/`. Follow the repo's existing
precedent, `src/lib/__tests__/noBrowserDialogs.test.ts:23`: declare a `SELF`
constant holding this test file's own absolute path and `continue` past it
while walking the tree. Do **not** split or obfuscate the literal, and do not
relocate the guard outside `src/`. Consequently the CDN-absence check run by
hand is `grep -rn "unpkg" src/ | grep -v pdfWorkerAsset.test.ts`, which must
print nothing; a bare `grep -rn "unpkg" src/` is *expected* to match this one
test file and only this one.

Cases:

1. `public/pdf.worker.min.mjs` exists.
2. Its SHA-256 equals the SHA-256 of the worker resolved through the
   `react-pdf` → `pdfjs-dist` chain described in §1. **This is the version-drift
   guard**: any `react-pdf`/`pdfjs-dist` bump that is not accompanied by a fresh
   copy fails the suite. The failure message must name
   `node scripts/copy-pdf-worker.mjs` as the fix.
3. `src/lib/pdfWorker.ts` assigns `workerSrc` to a root-relative path matching
   `/^\/pdf\.worker\.min\.mjs/` and contains no `http://` or `https://` URL.
4. No file under `src/` other than this test file itself contains the string
   `unpkg` (self-excluded via the `SELF` constant described above).
5. `package.json` wires `postinstall`, `predev` and `prebuild` to
   `scripts/copy-pdf-worker.mjs`.
6. `.gitignore` contains `/public/pdf.worker.min.mjs`.
7. The `config.matcher` pattern exported by `src/proxy.ts` does not match
   `/pdf.worker.min.mjs`, and still matches `/songs/1/fast-view`.

### 8. `docs/plans/mobile-app-analysis.md`

§1.6 ("PDF handling — a hard external CDN dependency", lines ~88-100) and the
prioritised-blocker entry at ~line 320 describe the unpkg worker as current
reality. Add a short note that RH-19 resolved it and the worker is now served
from `public/`. Do **not** rewrite `docs/tasks/RH-5-spec.md` — it is the
historical record of the decision that is being superseded.

### Alternatives considered and rejected

| Option | Why not |
|---|---|
| `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` | Requires the *bundler* to emit the worker asset, and this repo runs two different bundlers (Webpack for `dev`, Turbopack for `build`) whose asset emission differs. pdf.js already misbehaves under `next dev --webpack` (`docs/suggestions-log.md`: `Object.defineProperty called on non-object` from `pdfjs-dist/build/pdf.mjs`), so the webpack path is the least trustworthy place to add new bundler-specific wiring. A build-time file copy is bundler-independent by construction — the same property that made the CDN attractive, minus the third party. |
| Committing `public/pdf.worker.min.mjs` to git | 1 MB vendor blob in the repo, and drift becomes a human responsibility again. |
| A route handler streaming the worker from `node_modules` | Puts a serverless function on the critical path of a 1 MB asset, depends on Next's output file tracing picking up a `node_modules` binary asset, and is slower and more fragile than a static file for zero benefit. |
| Adding `pdfjs-dist` as a direct dependency | Not needed — resolution goes through `react-pdf`, which pins the version exactly. Declaring a second range invites a duplicated/nested copy on a future bump, which is the failure mode §1 is designed to avoid. |

## Expected Results

- [ ] `src/lib/pdfWorker.ts` sets `pdfjs.GlobalWorkerOptions.workerSrc` to the same-origin path `` `/pdf.worker.min.mjs?v=${pdfjs.version}` ``, and `grep -rn "unpkg" src/ | grep -v pdfWorkerAsset.test.ts` prints nothing (the guard test is the only file under `src/` allowed to contain that string).
- [ ] `scripts/copy-pdf-worker.mjs` exists; `node scripts/copy-pdf-worker.mjs` exits 0 and leaves `public/pdf.worker.min.mjs` byte-identical (SHA-256) to `node_modules/pdfjs-dist/build/pdf.worker.min.mjs`; running it a second time also exits 0.
- [ ] `package.json` wires `postinstall`, `predev` and `prebuild` to that script; deleting `public/pdf.worker.min.mjs` and running `npm install` recreates it.
- [ ] `Dockerfile`'s `deps` stage contains `COPY scripts ./scripts` on a line between `COPY package.json package-lock.json* ./` and `RUN npm ci`, and `docker build --target deps .` exits 0 (without this line the new `postinstall` aborts `npm ci` and the image build fails at its first stage).
- [ ] `.gitignore` contains `/public/pdf.worker.min.mjs`; after the copy script runs, `git ls-files public/pdf.worker.min.mjs` prints nothing and `git status --porcelain -- public/` prints nothing.
- [ ] `src/lib/__tests__/pdfWorkerAsset.test.ts` exists and asserts all seven of: (1) `public/pdf.worker.min.mjs` exists; (2) its SHA-256 equals that of the worker resolved through the `react-pdf` → `pdfjs-dist` chain, failing with a message naming `node scripts/copy-pdf-worker.mjs`; (3) `src/lib/pdfWorker.ts` assigns `workerSrc` to a path matching `/^\/pdf\.worker\.min\.mjs/` and contains no `http://` or `https://` URL; (4) no file under `src/` other than this test file itself contains the string `unpkg`; (5) `package.json` wires `postinstall`, `predev` and `prebuild` to `scripts/copy-pdf-worker.mjs`; (6) `.gitignore` contains `/public/pdf.worker.min.mjs`; (7) the `config.matcher` pattern exported by `src/proxy.ts` does not match `/pdf.worker.min.mjs` and still matches `/songs/1/fast-view`.
- [ ] Appending a byte to `public/pdf.worker.min.mjs` makes `npx vitest run src/lib/__tests__/pdfWorkerAsset.test.ts` fail with a message naming `scripts/copy-pdf-worker.mjs`; re-running `node scripts/copy-pdf-worker.mjs` makes it pass again.
- [ ] `npx vitest run` reports 22 test files passed and at least 210 tests passed, 0 failed.
- [ ] `src/proxy.ts`'s `config.matcher` no longer matches `/pdf.worker.min.mjs` while still matching `/songs/1/fast-view`.
- [ ] `eslint.config.mjs` ignores `public/**`; `npx eslint .` reports at most 24 errors and 20 warnings in total, and zero errors/warnings in files added or changed by this task.
- [ ] `npx next build` exits 0.
- [ ] Against a production build (`npx next build` then `npx next start`), Stage Mode renders a PDF and DevTools Network shows `GET /pdf.worker.min.mjs?v=5.4.296` → 200 with a JavaScript content type from the app's own origin, zero requests to `unpkg.com` or any third-party CDN, and no worker-related console errors.
- [ ] `curl -sI http://localhost:3000/pdf.worker.min.mjs` with no cookies returns `200`, not a 307 to `/login`.
- [ ] `package.json` version is above `0.1.58` with a `YYYYMMDDHHmm` suffix.
- [ ] `git diff --stat 36ee59b -- src/components/landing/LandingPage.tsx src/i18n/dictionaries/en.json src/i18n/dictionaries/pt-BR.json` prints nothing.
- [ ] `docs/plans/mobile-app-analysis.md` no longer presents the unpkg worker as current behaviour: its "PDF handling" section and its prioritised-blocker entry both state that RH-19 resolved it and the worker is served from `public/`.

## Out of Scope

- **Offline Stage Mode (RH-29).** This task removes the blocker; it does not add
  a service worker, precaching, or offline PDF storage.
- **The pre-existing `next dev --webpack` pdf.js failure.** `docs/suggestions-log.md`
  records that at `HEAD`, the Fast View route already crashes client-side under
  the webpack dev server with `TypeError: Object.defineProperty called on
  non-object` from `pdfjs-dist/build/pdf.mjs` (it does not reproduce under
  Turbopack), and that `serverExternalPackages: ["better-auth"]` independently
  500s every `AppLayout` render in dev. Both predate this task and neither is
  caused or fixed by it — which is why the browser-observable criterion is
  written against a production build (`npx next build` + `npx next start`)
  rather than `npm run dev`. Fixing the dev server deserves its own task.
- **Playwright coverage of Stage Mode PDF rendering.** An e2e assertion would
  need an authenticated session *and* a real PDF in Vercel Blob attached to a
  repertoire entry; CI has no Blob credentials. The browser criterion stays a
  manual QA step; the vitest guard covers the parts that can be automated.
- **A full `docker build .` as an acceptance gate.** The Docker expected result
  stops at `--target deps` because that is the stage this task changes and the
  only stage the new `postinstall` can break. Building `builder` additionally
  runs `next build` inside the image, which is slow and orthogonal to RH-19
  (`scripts/migrate.mjs` and `scripts/deduplicate-songs.mjs` both warn-and-skip
  without `DATABASE_URL`, so no DB is required — but any unrelated pre-existing
  build failure would surface here and is not this task's to fix). A full image
  build remains a welcome extra check, not a required one.
- **Cache-Control tuning for `public/`.** The `?v=` query already prevents a
  stale-worker/API version mismatch; custom headers are a separate concern.
- **Any change to Stage Mode UI, zoom, annotations, or gestures** (RH-5, RH-28).
- **Self-hosting other third-party assets** (fonts, analytics, Sentry).
