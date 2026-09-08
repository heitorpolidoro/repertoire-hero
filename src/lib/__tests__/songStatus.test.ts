import { describe, it, expect } from 'vitest'
import { STATUS_OPTIONS, statusUpdatedMessage } from '@/lib/songStatus'
import { STATUS_CONFIG } from '@/lib/statusConfig'
import type { SongStatus } from '@/types/database'

describe('songStatus', () => {
  it('STATUS_OPTIONS lists the five statuses in mastery order', () => {
    expect(STATUS_OPTIONS.map(o => o.status)).toEqual([
      'unknown',
      'learning',
      'practicing',
      'polishing',
      'mastered',
    ])
  })

  it('STATUS_OPTIONS carries the label and the badge colour of each status', () => {
    for (const option of STATUS_OPTIONS) {
      expect(option.label).toBe(STATUS_CONFIG[option.status].label)
      expect(option.bgColor).toBe(STATUS_CONFIG[option.status].bgColor)
    }
    expect(STATUS_OPTIONS[4]).toEqual({ status: 'mastered', label: 'Mastered', bgColor: 'bg-green-100' })
  })

  it('statusUpdatedMessage names the label of the new status', () => {
    expect(statusUpdatedMessage('mastered')).toBe('Status updated to Mastered')
    expect(statusUpdatedMessage('learning')).toBe('Status updated to Learning')
  })

  it('statusUpdatedMessage falls back to the raw status when it has no config', () => {
    expect(statusUpdatedMessage('retired' as SongStatus)).toBe('Status updated to retired')
  })
})
