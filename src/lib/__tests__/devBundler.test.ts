/**
 * RH-72 — guard for the `dev` script's bundler in `package.json`.
 *
 * Next.js 16 runs Turbopack by default for both `next dev` and `next build`; `--webpack` is an
 * opt-in flag. Under the webpack dev runtime `pdfjs-dist`'s ESM build fails module evaluation with
 * "TypeError: Object.defineProperty called on non-object", and because
 * `src/app/songs/[id]/fast-view/page.tsx` imports `FastViewOverlays` -> `PdfStageOverlay` ->
 * `TabDrawingStage` -> `react-pdf` eagerly, that failure takes down the whole Fast View client
 * module graph: the route renders Next.js's client error shell instead of the song. Re-adding
 * `--webpack` to `dev` therefore breaks Fast View for everyone running `npm run dev` and turns the
 * `E2E Tests (Playwright)` job red, since it starts the server with that very script.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const packageJsonPath = fileURLToPath(new URL('../../../package.json', import.meta.url))
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  scripts?: Record<string, string>
}
const devScript = packageJson.scripts?.dev ?? ''

describe('package.json dev script bundler', () => {
  it('does not select the webpack bundler (RH-72)', () => {
    expect(devScript).not.toMatch(/--webpack\b/)
    expect(devScript).not.toMatch(/--turbopack=false\b/)
  })

  it('still binds the dev server to 127.0.0.1 (RH-72)', () => {
    expect(devScript).toContain('--hostname 127.0.0.1')
  })
})
