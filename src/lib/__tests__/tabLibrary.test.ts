/**
 * Unit suite for `@/lib/tabLibrary`.
 *
 * RH-123 deleted the band/personal half of this module — `entryTabOrigin`,
 * `mergeTabs`, `needsDestinationChoice`, `resolveUploadTarget` and
 * `resolveDeleteTarget` — and their tests went with them: every one existed to
 * answer "band or personal?", which a file keyed by `(user_id, song_id)` never
 * asks. What is left is the title derivation and the size check.
 */

import { describe, it, expect } from 'vitest'
import {
  MAX_TAB_FILE_BYTES,
  defaultTitleFromFileName,
  tabUploadTitle,
  validateTabFile,
} from '../tabLibrary'

describe('defaultTitleFromFileName', () => {
  it('strips the last extension only', () => {
    expect(defaultTitleFromFileName('Black Dog.pdf')).toBe('Black Dog')
    expect(defaultTitleFromFileName('setlist.v2.pdf')).toBe('setlist.v2')
    expect(defaultTitleFromFileName('chart')).toBe('chart')
  })
})

describe('tabUploadTitle', () => {
  it('uses the trimmed typed title when there is one', () => {
    expect(tabUploadTitle('  Guitar Solo  ', 'whatever.pdf')).toBe('Guitar Solo')
  })

  it('falls back to the file name without its extension', () => {
    expect(tabUploadTitle('', 'Rosanna.pdf')).toBe('Rosanna')
    expect(tabUploadTitle('   ', 'Rosanna.pdf')).toBe('Rosanna')
  })
})

describe('validateTabFile', () => {
  it('accepts a file within the size limit', () => {
    expect(validateTabFile({ size: 0 })).toEqual({ ok: true })
    expect(validateTabFile({ size: MAX_TAB_FILE_BYTES })).toEqual({ ok: true })
  })

  it('rejects a file larger than the 10MB limit with the size message', () => {
    expect(MAX_TAB_FILE_BYTES).toBe(10 * 1024 * 1024)
    expect(validateTabFile({ size: MAX_TAB_FILE_BYTES + 1 })).toEqual({
      ok: false,
      message: 'File size exceeds the 10MB limit',
    })
  })

  it('accepts a file whose browser-reported type is not a PDF, leaving that check to the server', () => {
    const picked = { size: 1024, name: 'chart', type: 'application/octet-stream' }

    expect(validateTabFile(picked)).toEqual({ ok: true })
  })
})
