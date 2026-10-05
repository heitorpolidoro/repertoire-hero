/**
 * RH-78 — Node-level guards for the PWA shell.
 *
 * Three things are checked here that no browser is needed for:
 *
 * 1. `withSerwist` appears nowhere. It pulls `@serwist/webpack-plugin` and does
 *    not support Turbopack, which this repository runs everywhere (RH-72,
 *    `devBundler.test.ts`) because `pdfjs-dist` dies under the webpack dev
 *    runtime. Only the `@serwist/next/config` configurator mode is allowed.
 * 2. The two manifest icons exist at the declared dimensions, read straight out
 *    of the PNG IHDR with no image library. They are committed artefacts,
 *    regenerable with:
 *      sips -s format png -Z 192 src/app/icon.jpg --out public/icons/icon-192.png
 *      sips -s format png -Z 512 src/app/icon.jpg --out public/icons/icon-512.png
 * 3. The emitted `public/sw.js` — when it exists — carries the expected precache
 *    manifest. It is a build artefact (gitignored, produced by the `serwist
 *    build` stage of `npm run build`), so on a tree that has never been built
 *    those cases assert its absence instead and the suite stays green.
 *
 * The manifest assertions are the load-bearing ones. `Serwist` registers its
 * `PrecacheRoute` *before* the `runtimeCaching` routes and `findMatchingRoute`
 * returns the first match, so any precached document URL is answered from the
 * precache while online and bypasses `src/proxy.ts` entirely — a precached
 * `/profile` would hand a signed-out visitor the very spinner the proxy exists
 * to prevent. The manifest therefore has to stay an allow-list, and the check
 * reads the forbidden set out of `src/proxy.ts` rather than duplicating it, so a
 * newly added private route is covered automatically.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const swPath = path.join(root, 'public/sw.js')
const swExists = existsSync(swPath)
const sw = swExists ? readFileSync(swPath, 'utf8') : ''

/**
 * The injected manifest is the leading `var <id>=[{url:"…",revision:"…"},…];`
 * statement. Bounding to that first array literal matters: the literal
 * `"/offline"` also appears later, inside the compiled `fallbacks` entry.
 */
function precacheUrls(source: string): string[] {
  const start = source.indexOf('[')
  const end = source.indexOf('];', start)
  if (start === -1 || end === -1) return []
  return [...source.slice(start, end).matchAll(/url:"([^"]+)"/g)].map((m) => m[1])
}

/** The `config.matcher` entries of `src/proxy.ts`, as matching regexes. */
function proxyMatcherPatterns(): RegExp[] {
  const proxy = readFileSync(path.join(root, 'src/proxy.ts'), 'utf8')
  const matcherBlock = proxy.slice(proxy.indexOf('matcher: ['))
  const patterns = [...matcherBlock.slice(0, matcherBlock.indexOf(']')).matchAll(/'([^']+)'/g)].map(
    (m) => m[1],
  )
  expect(patterns.length).toBeGreaterThanOrEqual(12)
  expect(patterns).toContain('/songs/(.*)')
  // The matcher entries are literal paths plus the one wildcard form `(.*)`.
  // Escaping the literal chunks and splicing `.*` between them is done in one
  // pass, deliberately: escaping first and then un-escaping the wildcard is the
  // shape that silently produces a regex matching nothing.
  return patterns.map(
    (pattern) =>
      new RegExp(
        `^${pattern
          .split('(.*)')
          .map((chunk) => chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      ),
  )
}

function sourceFilesUnderSrc(dir = path.join(root, 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    // `__tests__` is skipped: this guard file names the forbidden symbol.
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFilesUnderSrc(full)
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : []
  })
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const FORBIDDEN_URLS = [
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/profile',
  '/settings',
]

describe('PWA shell — the bundler rule (ER2, ER3)', () => {
  it('never uses withSerwist, in next.config.ts or anywhere under src', () => {
    expect(stripComments(readFileSync(path.join(root, 'next.config.ts'), 'utf8'))).not.toContain(
      'withSerwist',
    )
    expect(readFileSync(path.join(root, 'serwist.config.js'), 'utf8')).toContain(
      '@serwist/next/config',
    )

    const offenders = sourceFilesUnderSrc().filter((file) =>
      stripComments(readFileSync(file, 'utf8')).includes('withSerwist'),
    )
    expect(offenders).toEqual([])
  })

  it('runs the serwist CLI as the last stage of build, and leaves dev alone', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(pkg.scripts.build).toContain('serwist build serwist.config.js')
    expect(pkg.scripts.build.indexOf('next build')).toBeLessThan(
      pkg.scripts.build.indexOf('serwist build'),
    )
    expect(pkg.scripts.dev).not.toContain('serwist')
  })
})

describe('PWA shell — the worker source (ER7)', () => {
  // Comments are stripped: the prose in `sw.ts` names both of the options it
  // deliberately does *not* use, and saying why must not fail the guards below.
  const source = stripComments(readFileSync(path.join(root, 'src/app/sw.ts'), 'utf8'))

  it('declares both a Strategy-handled runtimeCaching entry and the fallbacks entry', () => {
    // `serwist@9.5.12` reads `fallbacks` only inside
    // `if (runtimeCaching !== undefined)`, and discards it silently otherwise.
    expect(source).toMatch(/runtimeCaching:\s*\[/)
    expect(source).toContain('new NetworkOnly()')
    expect(source).toMatch(/fallbacks:\s*\{/)
    expect(source).toContain("url: '/offline'")
  })

  it('does not use precacheOptions.navigateFallback', () => {
    // It registers a precache-first NavigationRoute that answers *every*
    // navigation — online included — with /offline.
    expect(source).not.toContain('navigateFallback')
  })

  it('writes nothing to a runtime cache', () => {
    expect(source).not.toContain('defaultCache')
  })
})

describe('PWA shell — the manifest icons (ER8)', () => {
  it.each([
    ['public/icons/icon-192.png', 192],
    ['public/icons/icon-512.png', 512],
  ])('%s is a PNG of exactly %ix%i', (file, size) => {
    const bytes = readFileSync(path.join(root, file))

    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')
    expect(bytes.readUInt32BE(16)).toBe(size)
    expect(bytes.readUInt32BE(20)).toBe(size)
  })

  it('is declared by src/app/manifest.ts as a standalone app', () => {
    const source = readFileSync(path.join(root, 'src/app/manifest.ts'), 'utf8')

    expect(source).toContain("display: 'standalone'")
    expect(source).toContain("start_url: '/'")
    expect(source).toContain("sizes: '192x192'")
    expect(source).toContain("sizes: '512x512'")
  })
})

describe('PWA shell — the emitted worker (ER4, ER5)', () => {
  it('translates the proxy matcher into regexes that actually match its routes', () => {
    // Without this the allow-list assertion below could pass vacuously.
    const patterns = proxyMatcherPatterns()

    for (const route of ['/login', '/profile', '/songs/abc/fast-view', '/playlists/abc']) {
      expect(patterns.some((p) => p.test(route)), `${route} is matched`).toBe(true)
    }
    for (const safe of ['/offline', '/_next/static/chunk.js', '/icons/icon-192.png']) {
      expect(patterns.some((p) => p.test(safe)), `${safe} is not matched`).toBe(false)
    }
  })

  it('only exists as a build artefact, and is gitignored when it does', () => {
    expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain('/public/sw.js')
  })

  it.runIf(swExists)('carries a non-empty precache manifest including /offline', () => {
    const urls = precacheUrls(sw)

    expect(urls.length).toBeGreaterThan(0)
    expect(urls).toContain('/offline')
    expect(urls.some((u) => u.startsWith('/_next/static/'))).toBe(true)
  })

  it.runIf(swExists)('wired both the runtime-caching route and the fallback plugin', () => {
    expect(sw).toContain('registerCapture')
    expect(sw).toContain('handlerDidError')
  })

  it.runIf(swExists)('precaches no application document other than /offline', () => {
    const urls = precacheUrls(sw)

    for (const forbidden of FORBIDDEN_URLS) {
      expect(urls).not.toContain(forbidden)
    }
    for (const pattern of proxyMatcherPatterns()) {
      const matched = urls.filter((u) => pattern.test(u))
      expect(matched, `precached URLs match the proxy matcher ${pattern}`).toEqual([])
    }
  })

  it.skipIf(swExists)('has not been built in this tree, so the manifest cannot be checked', () => {
    expect(existsSync(swPath)).toBe(false)
  })
})
