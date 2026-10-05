import { describe, it, expect } from 'vitest'
import * as statusConfig from '../statusConfig'
import { ALL_STATUSES, STATUS_CONFIG, STATUS_ORDER } from '../statusConfig'
import type { SongStatus } from '@/types/database'

describe('statusConfig', () => {
  describe('STATUS_CONFIG', () => {
    it('should have entries for all SongStatus types', () => {
      const statuses: SongStatus[] = ['unknown', 'learning', 'practicing', 'polishing', 'mastered']

      statuses.forEach((status) => {
        const config = STATUS_CONFIG[status]
        expect(config).toBeDefined()
        expect(config).toHaveProperty('label')
        expect(config).toHaveProperty('color')
        expect(config).toHaveProperty('bgColor')
        expect(config).toHaveProperty('textColor')

        expect(typeof config.label).toBe('string')
        expect(typeof config.color).toBe('string')
        expect(typeof config.bgColor).toBe('string')
        expect(typeof config.textColor).toBe('string')
      })
    })

    it('keeps the five labels and the five colours the pickers render', () => {
      expect(ALL_STATUSES.map((status) => STATUS_CONFIG[status].label)).toEqual([
        'Unknown',
        'Learning',
        'Practicing',
        'Polishing',
        'Mastered',
      ])
      expect(ALL_STATUSES.map((status) => STATUS_CONFIG[status].color)).toEqual([
        'gray',
        'blue',
        'yellow',
        'orange',
        'green',
      ])
    })
  })

  describe('STATUS_ORDER', () => {
    // RH-102: `unknown` is the absence of a stage, not the first one — it is
    // zero notes filled, so it sits outside the order the notes enumerate.
    it('is the four real mastery stages, without unknown', () => {
      const expectedOrder: SongStatus[] = [
        'learning',
        'practicing',
        'polishing',
        'mastered',
      ]
      expect(STATUS_ORDER).toEqual(expectedOrder)
    })
  })

  describe('ALL_STATUSES', () => {
    it('is unknown followed by the four stages, for the five-value pickers', () => {
      expect(ALL_STATUSES).toEqual(['unknown', ...STATUS_ORDER])
    })
  })

  it('exports no nextStatus — nothing cycles any more (RH-102)', () => {
    expect('nextStatus' in statusConfig).toBe(false)
  })
})
