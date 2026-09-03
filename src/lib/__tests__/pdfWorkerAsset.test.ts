/**
 * RH-19 — Guardrail: the pdf.js worker is a first-party static asset.
 *
 * Stage Mode's PDF renderer used to pull its web worker from `unpkg.com`. The
 * worker is now copied out of `node_modules` into `public/` at build time by
 * `scripts/copy-pdf-worker.mjs` and served from the app's own origin.
 *
 * Nothing about that arrangement is self-enforcing: the copy is a build
 * artifact, so a `react-pdf` / `pdfjs-dist` bump that is not accompanied by a
 * fresh copy would leave a stale worker in `public/` and pdf.js would fail at
 * runtime with "worker version does not match API version". This test is what
 * makes the coupling mechanical — it compares the two files byte-for-byte and
 * names the fix in its failure message.
 *
 * Self-exclusion: the CDN-absence scan below looks for the literal `unpkg`
 * under `src/`, and this file necessarily contains that literal while living
 * under `src/`. Following the precedent of `noBrowserDialogs.test.ts`, the scan
 * skips this file by absolute path (`SELF`) rather than obfuscating the string.
 * So `grep -rn "unpkg" src/ | grep -v pdfWorkerAsset.test.ts` must print
 * nothing, while a bare `grep -rn "unpkg" src/` is expected to match this file
 * and only this file.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { createRequire } from 'node:module'
import { config as proxyConfig } from '@/proxy'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const SRC_DIR = path.join(REPO_ROOT, 'src')
const SELF = path.join(SRC_DIR, 'lib', '__tests__', 'pdfWorkerAsset.test.ts')

const PUBLIC_WORKER = path.join(REPO_ROOT, 'public', 'pdf.worker.min.mjs')
const COPY_SCRIPT = 'scripts/copy-pdf-worker.mjs'

/**
 * Resolves the worker that ships with the exact `pdfjs-dist` copy `react-pdf`
 * itself resolves — the same chain `scripts/copy-pdf-worker.mjs` uses.
 */
function resolveInstalledWorker(): string {
  const requireFromHere = createRequire(import.meta.url)
  const requireFromReactPdf = createRequire(requireFromHere.resolve('react-pdf'))
  return requireFromReactPdf.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** Recursively lists every file under `dir`. */
function listFiles(dir: string): string[] {
  const files: string[] = []
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      files.push(...listFiles(full))
    } else {
      files.push(full)
    }
  }
  return files
}

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8')
}

/** Compiles a Next.js middleware matcher string into an anchored RegExp. */
function matcherToRegExp(matcher: string): RegExp {
  return new RegExp(`^${matcher}$`)
}

describe('pdf.js worker is a first-party asset (RH-19)', () => {
  it('ships public/pdf.worker.min.mjs', () => {
    expect(
      fs.existsSync(PUBLIC_WORKER),
      `public/pdf.worker.min.mjs is missing. Run \`node ${COPY_SCRIPT}\`.`,
    ).toBe(true)
  })

  it('keeps the copied worker byte-identical to the installed pdfjs-dist build', () => {
    const source = resolveInstalledWorker()
    expect(fs.existsSync(PUBLIC_WORKER), `public/pdf.worker.min.mjs is missing. Run \`node ${COPY_SCRIPT}\`.`).toBe(true)
    expect(
      sha256(PUBLIC_WORKER),
      `public/pdf.worker.min.mjs does not match ${path.relative(REPO_ROOT, source)}. ` +
        `The served worker has drifted from the installed pdfjs-dist build; ` +
        `run \`node ${COPY_SCRIPT}\` to refresh it.`,
    ).toBe(sha256(source))
  })

  it('points workerSrc at a root-relative path and holds no absolute URL', () => {
    const source = readRepoFile('src/lib/pdfWorker.ts')
    const assignment = /workerSrc\s*=\s*[`'"]([^`'"]+)[`'"]/.exec(source)
    expect(assignment, 'src/lib/pdfWorker.ts must assign GlobalWorkerOptions.workerSrc').not.toBeNull()
    expect(assignment![1]).toMatch(/^\/pdf\.worker\.min\.mjs/)
    expect(source, 'src/lib/pdfWorker.ts must not reference any absolute URL').not.toMatch(/https?:\/\//)
  })

  it('has no CDN reference left anywhere under src/', () => {
    const needle = 'unpkg'
    const offenders = listFiles(SRC_DIR)
      .filter((file) => file !== SELF)
      .filter((file) => fs.readFileSync(file, 'utf8').includes(needle))
      .map((file) => path.relative(REPO_ROOT, file))

    expect(
      offenders,
      `The pdf.js worker is served from public/; no source file may reference the CDN. ` +
        `Offending files:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('wires postinstall, predev and prebuild to the copy script', () => {
    const pkg = JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> }
    for (const hook of ['postinstall', 'predev', 'prebuild']) {
      expect(pkg.scripts[hook], `package.json must wire "${hook}" to ${COPY_SCRIPT}`).toContain(COPY_SCRIPT)
    }
  })

  it('gitignores the copied worker', () => {
    expect(readRepoFile('.gitignore')).toContain('/public/pdf.worker.min.mjs')
  })

  it('exempts the worker path from the session-gating middleware matcher', () => {
    const patterns = proxyConfig.matcher.map(matcherToRegExp)
    expect(
      patterns.some((re) => re.test('/pdf.worker.min.mjs')),
      'src/proxy.ts must not session-gate /pdf.worker.min.mjs',
    ).toBe(false)
    expect(
      patterns.some((re) => re.test('/songs/1/fast-view')),
      'src/proxy.ts must still session-gate application routes',
    ).toBe(true)
  })
})
