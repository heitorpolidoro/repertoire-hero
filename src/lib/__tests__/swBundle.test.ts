/**
 * RH-80 — the guard that `src/app/sw.ts` still bundles for a browser.
 *
 * `npm run typecheck:sw` is **not** sufficient: `tsc -p tsconfig.sw.json`
 * resolves types without bundling, so it exits 0 on a worker that `serwist
 * build` cannot emit. Measured on this repository: appending
 * `import { OFFLINE_TAB_CACHE } from '@/lib/offlineStore'` to `sw.ts` keeps
 * `typecheck:sw` green while an esbuild browser bundle fails with three
 * `Could not resolve` errors for `fs`, `stream` and `zlib`, reached through
 * `offlineStore` → `@/lib/logger` → `@sentry/nextjs` → `next/constants`.
 *
 * `serwist build` is the last stage of `npm run build`, so that import would
 * break the production build outright. This test runs the same thing the build
 * does — a real `bundle: true, platform: 'browser'` esbuild pass — and is
 * therefore the only mechanical check that catches it.
 *
 * Shaped after `src/lib/__tests__/devBundler.test.ts` (RH-72): a config guard
 * that owns one build-level invariant.
 */

import { describe, it, expect } from 'vitest'
import { build } from 'esbuild'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Imported rather than written out, so this file is not itself a second
// occurrence of the literal it is asserting is unique.
import { OFFLINE_TAB_CACHE } from '@/lib/offlineCacheNames'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/** Every tracked source file under `src`, so the grep below is exhaustive. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

describe('service worker bundle (RH-80)', () => {
  it('bundles src/app/sw.ts for the browser, as `serwist build` does', async () => {
    const result = await build({
      absWorkingDir: repoRoot,
      entryPoints: ['src/app/sw.ts'],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      tsconfig: 'tsconfig.sw.json',
      write: false,
      logLevel: 'silent',
    })

    expect(result.errors).toEqual([])
    expect(result.outputFiles?.[0]?.contents.length).toBeGreaterThan(0)
  }, 60_000)

  it('keeps the offline tab cache name defined exactly once', () => {
    const quoted = `'${OFFLINE_TAB_CACHE}'`
    const matches = sourceFiles(join(repoRoot, 'src')).filter((file) =>
      readFileSync(file, 'utf8').includes(quoted),
    )

    expect(matches.map((file) => file.slice(repoRoot.length))).toEqual([
      'src/lib/offlineCacheNames.ts',
    ])
  })

  it('never lets the worker reach @/lib/offlineStore, whose graph needs node builtins', () => {
    const worker = readFileSync(join(repoRoot, 'src/app/sw.ts'), 'utf8')

    expect(worker).not.toMatch(/from '@\/lib\/offlineStore'/)
    expect(worker).toMatch(/from '@\/lib\/offlineCacheNames'/)
  })
})
