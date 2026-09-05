/**
 * RH-32 — guard for `next.config.ts`'s `serverExternalPackages`.
 *
 * `serverExternalPackages` leaves a package unbundled, so it is loaded at runtime by plain Node
 * resolution and picks up `node_modules/react` instead of Next's vendored SSR React. A package that
 * ships React hooks (`better-auth` did, via `better-auth/react`) therefore runs its hooks against a
 * React copy whose dispatcher is null, and every SSR render dies with
 * "Cannot read properties of null (reading 'useRef')". Only Node-only packages belong in this list.
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import nextConfig from '../../../next.config'

const require_ = createRequire(import.meta.url)

describe('next.config.ts serverExternalPackages', () => {
  const pkgs = nextConfig.serverExternalPackages ?? []

  it('does not externalize better-auth (RH-32)', () => {
    expect(pkgs).not.toContain('better-auth')
  })

  it('externalizes no package that ships a React entrypoint (RH-32)', () => {
    const withReactEntry = pkgs.filter((pkg) => {
      try {
        require_.resolve(`${pkg}/react`)
        return true
      } catch {
        // No `./react` subpath — safe to leave unbundled.
        return false
      }
    })
    expect(withReactEntry).toEqual([])
  })
})
