import { describe, expect, it, beforeEach } from 'vitest'
import { useSetlistPlayerStore } from '../setlistPlayerStore'

describe('useSetlistPlayerStore countdown', () => {
  beforeEach(() => {
    useSetlistPlayerStore.getState().reset()
  })

  it('initializes countdown to null', () => {
    expect(useSetlistPlayerStore.getState().countdown).toBeNull()
  })

  it('allows patching countdown to a number', () => {
    useSetlistPlayerStore.getState().patch({ countdown: 5 })
    expect(useSetlistPlayerStore.getState().countdown).toBe(5)
  })

  it('resets countdown to null on begin', () => {
    useSetlistPlayerStore.getState().patch({ countdown: 3 })
    useSetlistPlayerStore.getState().begin([], 0, null)
    expect(useSetlistPlayerStore.getState().countdown).toBeNull()
  })

  it('resets countdown to null on reset', () => {
    useSetlistPlayerStore.getState().patch({ countdown: 2 })
    useSetlistPlayerStore.getState().reset()
    expect(useSetlistPlayerStore.getState().countdown).toBeNull()
  })
})
