import { describe, it, expect } from 'vitest'
import * as songStatus from '@/lib/songStatus'
import { statusUpdatedMessage } from '@/lib/songStatus'
import type { SongStatus } from '@/types/database'

describe('songStatus', () => {
  // RH-102: `STATUS_OPTIONS` and `SongStatusOption` existed only so Fast View's
  // status dropdown could map a `SongStatus`-typed array. The dropdown is gone,
  // replaced by the four-note control, and so are they.
  it('exports no dropdown option list any more', () => {
    expect('STATUS_OPTIONS' in songStatus).toBe(false)
  })

  it('statusUpdatedMessage names the label of the new status', () => {
    expect(statusUpdatedMessage('mastered')).toBe('Status updated to Mastered')
    expect(statusUpdatedMessage('learning')).toBe('Status updated to Learning')
  })

  it('statusUpdatedMessage falls back to the raw status when it has no config', () => {
    expect(statusUpdatedMessage('retired' as SongStatus)).toBe('Status updated to retired')
  })
})
