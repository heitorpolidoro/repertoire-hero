/**
 * Client-only pdf.js worker initialization for react-pdf.
 *
 * Given the dual-bundler constraint (Webpack in dev via `next dev --webpack`,
 * Turbopack in `next build`), we deliberately avoid any bundler-specific
 * worker-asset wiring (e.g. Webpack's `new URL(...)` worker pattern) and
 * instead point `pdfjs-dist`'s `GlobalWorkerOptions.workerSrc` at a CDN URL
 * pinned to the exact installed `pdfjs-dist` version. This works identically
 * under both bundlers and needs no build-time asset copying.
 *
 * Import this module only from client components that render a PDF via
 * react-pdf (currently just `TabDrawingStage`), not at the app root — it has
 * no effect on the server and no need to run there.
 */
import { pdfjs } from 'react-pdf'

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
