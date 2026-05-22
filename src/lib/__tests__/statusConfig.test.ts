import { describe, it, expect } from 'vitest'
import { STATUS_CONFIG, STATUS_ORDER, nextStatus } from '../statusConfig'
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
  })

  describe('STATUS_ORDER', () => {
    it('should contain all statuses in the correct order', () => {
      const expectedOrder: SongStatus[] = [
        'unknown',
        'learning',
        'practicing',
        'polishing',
        'mastered',
      ]
      expect(STATUS_ORDER).toEqual(expectedOrder)
    })
  })

  describe('nextStatus', () => {
    it('should transition to the next status in order', () => {
      expect(nextStatus('unknown')).toBe('learning')
      expect(nextStatus('learning')).toBe('practicing')
      expect(nextStatus('practicing')).toBe('polishing')
      expect(nextStatus('polishing')).toBe('mastered')
    })

    it('should wrap around to the first status from the last status', () => {
      expect(nextStatus('mastered')).toBe('unknown')
    })
  })
})
