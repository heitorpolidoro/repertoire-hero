import { describe, it, expect } from 'vitest'
import {
  MAX_TAB_FILE_BYTES,
  defaultTitleFromFileName,
  entryTabOrigin,
  mergeTabs,
  needsDestinationChoice,
  resolveDeleteTarget,
  resolveUploadTarget,
  tabUploadTitle,
  validateTabFile,
} from '../tabLibrary'
import type { RepertoireTab } from '@/types/database'

function tab(id: string, title: string, createdAt: string, repertoireId = 'rep-band'): RepertoireTab {
  return {
    id,
    repertoire_id: repertoireId,
    title,
    file_url: `https://blob.test/${id}.pdf`,
    created_at: createdAt,
  }
}

const BAND_TABS: RepertoireTab[] = [
  tab('t-1', 'Band chart', '2026-01-02T10:00:00.000Z'),
  tab('t-2', 'Band horns', '2026-01-04T10:00:00.000Z'),
]

const PERSONAL_TABS: RepertoireTab[] = [
  tab('p-1', 'My notes', '2026-01-03T10:00:00.000Z', 'rep-personal'),
]

describe('entryTabOrigin', () => {
  it('labels a band entry band and a personal entry personal', () => {
    expect(entryTabOrigin('band-1')).toBe('band')
    expect(entryTabOrigin(null)).toBe('personal')
    expect(entryTabOrigin(undefined)).toBe('personal')
  })
})

describe('mergeTabs', () => {
  it('labels the entry tabs with the entry origin and the personal tabs personal', () => {
    const merged = mergeTabs(BAND_TABS, PERSONAL_TABS, 'band')

    expect(merged.map((t) => [t.id, t.origin])).toEqual([
      ['t-2', 'band'],
      ['p-1', 'personal'],
      ['t-1', 'band'],
    ])
  })

  it('orders the merged list by creation date, newest first', () => {
    const merged = mergeTabs(BAND_TABS, PERSONAL_TABS, 'band')

    expect(merged.map((t) => t.id)).toEqual(['t-2', 'p-1', 't-1'])
  })

  it('returns an empty list when there are no tabs at all', () => {
    expect(mergeTabs([], [], 'personal')).toEqual([])
  })

  it('does not mutate the input arrays', () => {
    const entryTabs = [...BAND_TABS]
    const personalTabs = [...PERSONAL_TABS]

    mergeTabs(entryTabs, personalTabs, 'band')

    expect(entryTabs.map((t) => t.id)).toEqual(['t-1', 't-2'])
    expect(personalTabs.map((t) => t.id)).toEqual(['p-1'])
    expect(entryTabs[0]).not.toHaveProperty('origin')
  })
})

describe('needsDestinationChoice', () => {
  it('asks for a destination only in a band entry', () => {
    expect(needsDestinationChoice('band-1')).toBe(true)
    expect(needsDestinationChoice(null)).toBe(false)
  })
})

describe('resolveUploadTarget', () => {
  it('uploads to the entry itself and marks it personal outside a band', () => {
    const args = { entryId: 'rep-mine', entryBandId: null, personalRepertoireId: null }

    expect(resolveUploadTarget({ ...args, destination: 'personal' })).toEqual({
      repertoireId: 'rep-mine',
      isPersonal: true,
    })
    expect(resolveUploadTarget({ ...args, destination: 'band' })).toEqual({
      repertoireId: 'rep-mine',
      isPersonal: true,
    })
  })

  it('uploads to the band entry when the band destination is chosen', () => {
    expect(
      resolveUploadTarget({
        entryId: 'rep-band',
        entryBandId: 'band-1',
        personalRepertoireId: 'rep-personal',
        destination: 'band',
      }),
    ).toEqual({ repertoireId: 'rep-band', isPersonal: false })
  })

  it('uploads to the existing personal entry when the personal destination is chosen in a band', () => {
    expect(
      resolveUploadTarget({
        entryId: 'rep-band',
        entryBandId: 'band-1',
        personalRepertoireId: 'rep-personal',
        destination: 'personal',
      }),
    ).toEqual({ repertoireId: 'rep-personal', isPersonal: true })
  })

  it('asks for a personal entry to be created when the band member has none', () => {
    expect(
      resolveUploadTarget({
        entryId: 'rep-band',
        entryBandId: 'band-1',
        personalRepertoireId: null,
        destination: 'personal',
      }),
    ).toEqual({ repertoireId: null, isPersonal: true })
  })
})

describe('resolveDeleteTarget', () => {
  it('deletes a band tab from the entry and a personal tab from the personal entry', () => {
    expect(
      resolveDeleteTarget({ origin: 'band', entryId: 'rep-band', personalRepertoireId: 'rep-personal' }),
    ).toBe('rep-band')
    expect(
      resolveDeleteTarget({ origin: 'personal', entryId: 'rep-band', personalRepertoireId: 'rep-personal' }),
    ).toBe('rep-personal')
  })

  it('falls back to the entry when a personal tab has no personal entry', () => {
    expect(
      resolveDeleteTarget({ origin: 'personal', entryId: 'rep-band', personalRepertoireId: null }),
    ).toBe('rep-band')
    expect(
      resolveDeleteTarget({ origin: 'personal', entryId: null, personalRepertoireId: null }),
    ).toBeNull()
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
