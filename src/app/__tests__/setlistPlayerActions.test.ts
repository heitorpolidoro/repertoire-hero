import { describe, expect, it, vi } from 'vitest'
import { SETLIST_PLAYER_ACTIONS } from '@/app/setlistPlayerActions'
import * as repertoireActions from '@/app/actions/repertoire'

describe('SETLIST_PLAYER_ACTIONS.getSongDetails', () => {
  it('queries getSongWindowAction and returns tuning and valid custom fields', async () => {
    vi.spyOn(repertoireActions, 'getSongWindowAction').mockResolvedValueOnce([
      {
        versionId: 'v1',
        entry: { tuning: 'Eb' } as never,
        files: [],
        customFields: [
          { fieldId: 'f1', name: 'Capo', value: '2' },
          { fieldId: 'f2', name: 'Preset', value: 'Clean' },
          { fieldId: 'f3', name: 'Empty', value: '' },
          { fieldId: 'f4', name: 'Blank', value: '   ' },
        ],
      },
    ])

    const details = await SETLIST_PLAYER_ACTIONS.getSongDetails?.('v1', 'b1')
    expect(repertoireActions.getSongWindowAction).toHaveBeenCalledWith(['v1'], 'b1')
    expect(details).toEqual({
      tuning: 'Eb',
      customFields: [
        { name: 'Capo', value: '2' },
        { name: 'Preset', value: 'Clean' },
      ],
    })
  })

  it('handles empty response or missing record', async () => {
    vi.spyOn(repertoireActions, 'getSongWindowAction').mockResolvedValueOnce([])

    const details = await SETLIST_PLAYER_ACTIONS.getSongDetails?.('v2', null)
    expect(details).toEqual({
      tuning: null,
      customFields: [],
    })
  })

  it('catches errors from getSongWindowAction and returns fallback', async () => {
    vi.spyOn(repertoireActions, 'getSongWindowAction').mockRejectedValueOnce(new Error('Network error'))

    const details = await SETLIST_PLAYER_ACTIONS.getSongDetails?.('v3', null)
    expect(details).toEqual({
      tuning: null,
      customFields: [],
    })
  })
})
