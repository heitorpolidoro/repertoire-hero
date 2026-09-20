import type { MetadataRoute } from 'next'

/**
 * RH-78 — the web app manifest, served at `/manifest.webmanifest` by the Next.js
 * file convention (`src/app/manifest.ts`). It is what makes the app
 * installable; the service worker registered by `ServiceWorkerRegistrar` is the
 * other half.
 *
 * The two icons are committed PNGs under `public/icons/`, derived once from
 * `src/app/icon.jpg` (which stays the favicon) with:
 *
 *     sips -s format png -Z 192 src/app/icon.jpg --out public/icons/icon-192.png
 *     sips -s format png -Z 512 src/app/icon.jpg --out public/icons/icon-512.png
 *
 * They are deliberately not generated at build time: `sharp` is only present
 * transitively and fails to load on Node 24 here, so a build-time dependency
 * would add a native-binary failure mode for two assets that change ~never.
 * `src/lib/__tests__/pwaShell.test.ts` reads the PNG IHDR to keep them honest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Repertoire Hero',
    short_name: 'Repertoire',
    description: 'Manage your music repertoire',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#111827',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
