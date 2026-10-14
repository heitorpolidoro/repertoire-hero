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
  markPrimaryTab,
  resolvePrimaryTab,
  withoutTab,
  tabUploadTitle,
  validateTabFile,
} from '../tabLibrary'
import type { SongFile } from '@/types/database'

function file(id: string, createdAt: string, isPrimary?: boolean): SongFile {
  return {
    id,
    user_id: 'u',
    song_id: 's',
    title: id,
    file_url: `https://blob.test/${id}.pdf`,
    created_at: createdAt,
    ...(isPrimary === undefined ? {} : { is_primary: isPrimary }),
  }
}

describe('resolvePrimaryTab (RH-147)', () => {
  const NEWEST = file('newest', '2026-03-01T00:00:00Z', false)
  const MIDDLE = file('middle', '2026-02-01T00:00:00Z', false)
  const OLDEST = file('oldest', '2026-01-01T00:00:00Z', false)

  it('answers null only for an empty list', () => {
    expect(resolvePrimaryTab([])).toBeNull()
  })

  it('answers the only file of a one-file list, designated or not', () => {
    expect(resolvePrimaryTab([file('solo', '2026-01-01T00:00:00Z')])?.id).toBe('solo')
    expect(resolvePrimaryTab([file('solo', '2026-01-01T00:00:00Z', true)])?.id).toBe('solo')
  })

  it('answers the designated file wherever it falls in the list', () => {
    const designated = { ...MIDDLE, is_primary: true }
    expect(resolvePrimaryTab([NEWEST, designated, OLDEST])).toBe(designated)
  })

  it('falls back to the oldest file, never undefined, when nothing is designated', () => {
    const result = resolvePrimaryTab([NEWEST, MIDDLE, OLDEST])
    expect(result).toBe(OLDEST)
  })

  it('falls back to the oldest file when the flag is absent from every file', () => {
    const bare = [file('b', '2026-02-01T00:00:00Z'), file('a', '2026-01-01T00:00:00Z')]
    expect(resolvePrimaryTab(bare)?.id).toBe('a')
  })

  it('orders Postgres-style timestamps as instants, not as strings', () => {
    const later = file('later', '2026-01-01 10:00:00+00')
    const earlier = file('earlier', '2026-01-01 12:00:00+02')
    expect(resolvePrimaryTab([later, earlier])?.id).toBe('earlier')
  })

  it('breaks a created_at tie by id', () => {
    const tie = [file('b', '2026-01-01T00:00:00Z'), file('a', '2026-01-01T00:00:00Z')]
    expect(resolvePrimaryTab(tie)?.id).toBe('a')
  })

  it('answers the same file in listTabs order (newest first) or reversed', () => {
    const listed = [NEWEST, MIDDLE, OLDEST]
    expect(resolvePrimaryTab(listed)?.id).toBe(resolvePrimaryTab([...listed].reverse())?.id)
    const designated = [NEWEST, { ...MIDDLE, is_primary: true }, OLDEST]
    expect(resolvePrimaryTab(designated)?.id).toBe(resolvePrimaryTab([...designated].reverse())?.id)
  })
})

describe('markPrimaryTab and withoutTab (RH-147)', () => {
  const NEWEST = file('newest', '2026-03-01T00:00:00Z', false)
  const MIDDLE = file('middle', '2026-02-01T00:00:00Z', true)
  const OLDEST = file('oldest', '2026-01-01T00:00:00Z', false)

  it('moves the designation without reordering the list', () => {
    const marked = markPrimaryTab([NEWEST, MIDDLE, OLDEST], 'newest')
    expect(marked.map((tab) => [tab.id, tab.is_primary])).toEqual([
      ['newest', true],
      ['middle', false],
      ['oldest', false],
    ])
  })

  it('promotes the oldest remaining file when the primary is removed', () => {
    const rest = withoutTab([NEWEST, MIDDLE, OLDEST], 'middle')
    expect(rest.map((tab) => [tab.id, tab.is_primary])).toEqual([
      ['newest', false],
      ['oldest', true],
    ])
  })

  it('leaves the designation alone when a non-primary file is removed', () => {
    const rest = withoutTab([NEWEST, MIDDLE, OLDEST], 'newest')
    expect(rest.map((tab) => [tab.id, tab.is_primary])).toEqual([
      ['middle', true],
      ['oldest', false],
    ])
  })

  it('answers an empty list when the last file is removed', () => {
    expect(withoutTab([MIDDLE], 'middle')).toEqual([])
  })
})

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
