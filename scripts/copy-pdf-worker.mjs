/**
 * RH-19 — Copies the pdf.js web worker into `public/` so it is served from the
 * app's own origin instead of an external CDN.
 *
 * Wired into `postinstall`, `predev` and `prebuild` so every entry point
 * (`npm install`, `npm ci`, `npm run dev`, `npm run build`, Vercel, Docker, CI)
 * produces the artifact. The copy is gitignored; `src/lib/pdfWorker.ts` points
 * at it and `src/lib/__tests__/pdfWorkerAsset.test.ts` guards the coupling.
 *
 * Zero dependencies on purpose: this runs at `postinstall`, before anything is
 * built and before dev-only packages can be assumed usable.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const DEST = path.join(REPO_ROOT, 'public', 'pdf.worker.min.mjs')

/**
 * Resolves through `react-pdf` rather than from the repo root: the only correct
 * worker is the one belonging to the `pdfjs-dist` copy `react-pdf` itself
 * resolves. If a future bump ever produces a second, nested `pdfjs-dist`,
 * resolving from the root would silently copy the wrong build and pdf.js would
 * fail at runtime with a worker/API version mismatch.
 */
function resolveWorker() {
  const requireFromHere = createRequire(import.meta.url)
  const requireFromReactPdf = createRequire(requireFromHere.resolve('react-pdf'))
  return {
    workerPath: requireFromReactPdf.resolve('pdfjs-dist/build/pdf.worker.min.mjs'),
    packageJsonPath: requireFromReactPdf.resolve('pdfjs-dist/package.json'),
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

let resolved
try {
  resolved = resolveWorker()
} catch (error) {
  console.error(
    '[copy-pdf-worker] Could not resolve pdfjs-dist/build/pdf.worker.min.mjs through react-pdf.\n' +
      '[copy-pdf-worker] Stage Mode would ship a 404 worker. Run `npm install` and try again.',
  )
  console.error(error)
  process.exit(1)
}

const { workerPath, packageJsonPath } = resolved
const version = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version
const source = fs.readFileSync(workerPath)

if (fs.existsSync(DEST) && sha256(fs.readFileSync(DEST)) === sha256(source)) {
  console.log(`[copy-pdf-worker] public/pdf.worker.min.mjs up to date (pdfjs-dist ${version})`)
} else {
  fs.mkdirSync(path.dirname(DEST), { recursive: true })
  fs.writeFileSync(DEST, source)
  console.log(`[copy-pdf-worker] wrote public/pdf.worker.min.mjs (pdfjs-dist ${version})`)
}
