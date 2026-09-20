'use client'

import { useEffect } from 'react'
import { logger } from '@/lib/logger'

/**
 * RH-78 — registers the PWA service worker, and nothing else.
 *
 * It renders `null` and lives beside `<Analytics />` in `src/app/layout.tsx`
 * rather than inside `<AppShell>`: `AppShell` delegates to `ConditionalLayout`,
 * which strips the chrome on the landing and auth routes, so a registrar
 * mounted inside it would not run on every route.
 *
 * The effect writes no state — `react-hooks/set-state-in-effect` is an error
 * under this repository's eslint config — it only calls `register`.
 *
 * `updateViaCache: 'none'` keeps the worker script itself out of the HTTP
 * cache, so a new build's `sw.js` is always byte-compared against the installed
 * one and a stuck user recovers on the next navigation.
 *
 * `public/sw.js` only exists after the Serwist stage of `npm run build`, so the
 * production guard is what keeps `npm run dev` from requesting a 404.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to register the service worker', err)
      })
  }, [])

  return null
}
