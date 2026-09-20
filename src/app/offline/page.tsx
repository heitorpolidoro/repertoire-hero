import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Offline — Repertoire Hero',
}

/**
 * RH-78 — the offline shell.
 *
 * The service worker's `fallbacks` entry answers a failed navigation with this
 * precached document, so it MUST stay statically prerenderable: no `cookies`,
 * no `headers`, no `searchParams`, no `no-store` fetch. If it is not prerendered
 * there is no `.next/server/app/offline.html`, the `/offline` URL never enters
 * the precache manifest and the fallback has nothing to return.
 *
 * It is deliberately absent from the `src/proxy.ts` matcher: offline the proxy
 * does not run at all, so the page has to render with no session.
 *
 * RH-80 may replace or extend this with a real offline read path — this is the
 * floor, not the final answer.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div
        data-testid="offline-shell"
        className="max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold text-gray-900">You are offline</h1>
        <p className="mt-3 text-sm text-gray-600">
          Repertoire Hero could not reach the network. Reconnect and this page will
          load again — anything you already downloaded stays available.
        </p>
      </div>
    </main>
  )
}
