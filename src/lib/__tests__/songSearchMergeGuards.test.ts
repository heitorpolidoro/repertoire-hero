/**
 * RH-108 — the three source-tree rules the merge leaves behind.
 *
 * Each asserts the *absence* of something anywhere under `src/`, which no
 * single case of `songSearchMerge.test.ts` can establish:
 *
 *  - **ER1** — the merge module stays pure and client-safe. It is imported by
 *    `useSongPicker`, so one `@/lib/db` import would pull `pg` into the
 *    browser bundle, and `namingConventions.test.ts` fails the run for a
 *    server-only import reaching client code.
 *  - **ER23** — `SpotifyTrack` is declared once. The route carried a second,
 *    identical copy that nothing imported.
 *  - **ER24** — no "in catalog" affordance was added to the picker row. That
 *    is the operator's answer to this task's one open question, option B, and
 *    it is asserted unconditionally rather than left to a reviewer's reading.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { findViolations, formatViolations } from './test-helpers'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')

describe('RH-108 ER1 — the merge module stays pure and client-safe', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'lib', 'songSearchMerge.ts'),
    'utf8',
  )

  it('exports exactly two functions, and both by the names the contract names', () => {
    const exported = [...source.matchAll(/^export function (\w+)/gm)].map((m) => m[1])

    expect(exported.sort()).toEqual(['mergeSongSearchResults', 'withoutHeldVersions'])
  })

  it('imports nothing but @/lib/songTitle and type-only modules', () => {
    const valueImports = [...source.matchAll(/^import (?!type )[^\n]*from '([^']+)'/gm)].map(
      (m) => m[1],
    )

    expect(valueImports).toEqual(['@/lib/songTitle'])
  })

  it('reaches for no server-only module, no react and no localeCompare', () => {
    expect(source).not.toContain('@/lib/db')
    expect(source).not.toContain('@/lib/songIdentity')
    expect(source).not.toMatch(/from 'react'/)
    // `localeCompare` depends on the runtime's ICU data, so two environments
    // could disagree about an order this module calls deterministic.
    expect(source).not.toContain('localeCompare')
  })
})

describe('RH-108 ER23 — SpotifyTrack is declared once under src/', () => {
  it('finds the one declaration, in src/lib/spotify.ts', () => {
    const violations = findViolations(/^\s*(export\s+)?(interface|type)\s+SpotifyTrack\b/).filter(
      (v) => v.file !== 'src/lib/spotify.ts',
    )

    // The route carried an identical copy nothing imported — one definition,
    // one fewer `jscpd` candidate.
    expect(formatViolations(violations)).toEqual([])
  })
})

describe('RH-108 ER24 — no catalog affordance was added to the picker row', () => {
  it('names "In catalog" nowhere under src/components/', () => {
    const violations = findViolations(/In catalog/).filter((v) =>
      v.file.startsWith('src/components/'),
    )

    // Option B, the operator's answer: a catalog row and a Spotify row are
    // drawn identically, as they were at HEAD. Collapsing the duplicate rows
    // removed no such signal, because there was none.
    expect(formatViolations(violations)).toEqual([])
  })
})

describe('RH-108 ER25 — the raw-title dedup helpers are gone', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'lib', 'songPicker.ts'), 'utf8')

  it('exports none of the four helpers the merge module subsumed', () => {
    for (const name of [
      'pickerDedupKey',
      'pickerCatalogKeys',
      'visiblePickerSpotify',
      'visiblePickerCatalog',
    ]) {
      expect(source).not.toContain(`export function ${name}`)
    }
  })

  it('declares one results array and one addRow on the controller', () => {
    expect(source).toMatch(/\n {2}results: SongSearchRow\[\]\n/)
    expect(source).toMatch(/\n {2}addRow: \(row: SongSearchRow\) => Promise<void>\n/)
    expect(source).not.toContain('catalogResults')
    expect(source).not.toContain('spotifyResults')
  })
})
