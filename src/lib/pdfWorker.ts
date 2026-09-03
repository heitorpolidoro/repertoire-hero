/**
 * Client-only pdf.js worker initialization for react-pdf.
 *
 * The worker is a build artifact: `scripts/copy-pdf-worker.mjs` copies it out
 * of the `pdfjs-dist` that `react-pdf` resolves into `public/`, on
 * `postinstall`, `predev` and `prebuild`. It is therefore served from the app's
 * own origin as a plain static file, with no bundler-specific worker-asset
 * wiring (e.g. Webpack's `new URL(...)` pattern) — which is what keeps it
 * working identically under the Webpack dev server and the Turbopack build.
 *
 * The `?v=` query is cache-busting insurance: it comes from the same `pdfjs`
 * object the API uses, so a browser holding a stale worker cannot trigger
 * pdf.js's "worker version does not match API version" error after an upgrade.
 * `src/lib/__tests__/pdfWorkerAsset.test.ts` guards the version coupling
 * between the copy in `public/` and the installed `pdfjs-dist`.
 *
 * Import this module only from client components that render a PDF via
 * react-pdf (currently just `TabDrawingStage`), not at the app root — it has
 * no effect on the server and no need to run there.
 */
import { pdfjs } from 'react-pdf'

pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs?v=${pdfjs.version}`
