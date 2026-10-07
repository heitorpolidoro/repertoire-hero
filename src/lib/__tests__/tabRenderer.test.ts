/**
 * RH-128 ER9 — the one decision that tells an image tab from a PDF one.
 *
 * `isImageTab` is the whole of the branch the viewer and the stage take, so it
 * is tested over every value a stored `content_type` can actually hold: the
 * three types RH-127's ingest can produce, `application/pdf`, the two absent
 * readings (`undefined` from a row written before RH-127 and from an offline
 * snapshot, `null` from a defensive caller) and a string nobody recognises.
 *
 * The module must also stay client-safe: it is imported by `'use client'`
 * components, so it may not reach `src/lib/fileIngest.ts`, which pulls in
 * `sharp`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IMAGE_TAB_CONTENT_TYPES, isImageTab } from '@/lib/tabRenderer'

describe('isImageTab (RH-128)', () => {
  it('answers true for every image type the ingest can produce', () => {
    expect(isImageTab('image/jpeg')).toBe(true)
    expect(isImageTab('image/png')).toBe(true)
    expect(isImageTab('image/webp')).toBe(true)
  })

  it('answers false for a PDF', () => {
    expect(isImageTab('application/pdf')).toBe(false)
  })

  it('reads an absent content type as a PDF', () => {
    expect(isImageTab(undefined)).toBe(false)
    expect(isImageTab(null)).toBe(false)
  })

  it('reads an unknown content type as a PDF', () => {
    expect(isImageTab('image/heic')).toBe(false)
  })

  it('exports exactly the three ingested image types', () => {
    expect([...IMAGE_TAB_CONTENT_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })

  it('imports nothing at all, and in particular not the sharp-bound ingest', () => {
    // Statements only: the module's docblock names `fileIngest` on purpose,
    // to say why it is not imported.
    const source = readFileSync(resolve(__dirname, '../tabRenderer.ts'), 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\brequire\s*\(/)
    expect(source).not.toMatch(/\bfrom\s+['"]/)
  })
})
