/**
 * RH-70 — the panel state of `/playlists/[id]`.
 *
 * Before this task the page carried four independent booleans (`editing`,
 * `editName`, `confirmDelete`, `showSearch`), so a delete confirmation armed and
 * then left by a rename came back armed, and the add-song panel stayed open
 * underneath a rename. The union removes both by construction: there is no
 * value of `PlaylistPanel` that has two panels open.
 *
 * That is why the test that matters here is the exhaustive fold rather than a
 * list of cases — it walks every sequence of up to four actions drawn from the
 * whole alphabet and asserts the invariant of each resulting state.
 */

import { describe, it, expect } from 'vitest'
import {
  NO_PANEL,
  playlistPanelReducer,
  renameDraft,
  type PlaylistPanel,
  type PlaylistPanelAction,
} from '@/lib/playlistPanels'

/** The whole action alphabet, one representative of each variant. */
const ALPHABET: PlaylistPanelAction[] = [
  { type: 'open-rename', name: 'Set one' },
  { type: 'change-rename-draft', draft: 'typed' },
  { type: 'open-delete-confirm' },
  { type: 'toggle-picker' },
  { type: 'close' },
]

/** Folds a whole gesture over the reducer, starting from the initial state. */
function fold(actions: PlaylistPanelAction[], from: PlaylistPanel = NO_PANEL): PlaylistPanel {
  return actions.reduce(playlistPanelReducer, from)
}

/** Every sequence of `0..maxLength` actions drawn from the alphabet. */
function sequences(maxLength: number): PlaylistPanelAction[][] {
  let all: PlaylistPanelAction[][] = [[]]
  let frontier: PlaylistPanelAction[][] = [[]]
  for (let length = 0; length < maxLength; length++) {
    frontier = frontier.flatMap(prefix => ALPHABET.map(action => [...prefix, action]))
    all = [...all, ...frontier]
  }
  return all
}

describe('playlistPanelReducer', () => {
  it('starts from NO_PANEL, which is the none state', () => {
    expect(NO_PANEL).toEqual({ kind: 'none' })
    expect(fold([])).toBe(NO_PANEL)
  })

  it('opens the rename panel with the current name as its draft', () => {
    expect(fold([{ type: 'open-rename', name: 'Set one' }])).toEqual({
      kind: 'rename',
      draft: 'Set one',
    })
  })

  it('records what is typed into the rename draft', () => {
    const state = fold([
      { type: 'open-rename', name: 'Set one' },
      { type: 'change-rename-draft', draft: 'Set two' },
    ])

    expect(state).toEqual({ kind: 'rename', draft: 'Set two' })
  })

  it('ignores a draft change while the rename panel is closed', () => {
    expect(fold([{ type: 'change-rename-draft', draft: 'Set two' }])).toEqual(NO_PANEL)
    expect(fold([{ type: 'toggle-picker' }, { type: 'change-rename-draft', draft: 'x' }])).toEqual({
      kind: 'picker',
    })
  })

  it('opens the delete confirmation from any other panel', () => {
    for (const before of [[], [{ type: 'toggle-picker' } as const], [{ type: 'open-rename', name: 'Set one' } as const]]) {
      expect(fold([...before, { type: 'open-delete-confirm' }])).toEqual({ kind: 'delete-confirm' })
    }
  })

  it('toggles the picker open and closed again', () => {
    expect(fold([{ type: 'toggle-picker' }])).toEqual({ kind: 'picker' })
    expect(fold([{ type: 'toggle-picker' }, { type: 'toggle-picker' }])).toEqual(NO_PANEL)
  })

  it('switches directly from one panel to another without closing first', () => {
    expect(
      fold([
        { type: 'toggle-picker' },
        { type: 'open-rename', name: 'Set one' },
        { type: 'open-delete-confirm' },
      ]),
    ).toEqual({ kind: 'delete-confirm' })
    expect(fold([{ type: 'open-delete-confirm' }, { type: 'toggle-picker' }])).toEqual({
      kind: 'picker',
    })
  })

  it('closes back to none from every reachable panel', () => {
    const openings: PlaylistPanelAction[] = [
      { type: 'open-rename', name: 'Set one' },
      { type: 'open-delete-confirm' },
      { type: 'toggle-picker' },
    ]

    for (const opening of openings) {
      expect(fold([opening, { type: 'close' }])).toEqual(NO_PANEL)
    }
  })

  it('leaves at most one panel open after every sequence of up to four actions', () => {
    const kinds = ['none', 'rename', 'delete-confirm', 'picker']

    for (const sequence of sequences(4)) {
      const state = fold(sequence)
      const trace = JSON.stringify(sequence.map(action => action.type))

      expect(kinds, trace).toContain(state.kind)
      expect(Object.hasOwn(state, 'draft'), trace).toBe(state.kind === 'rename')
      expect(fold([...sequence, { type: 'close' }]), trace).toEqual(NO_PANEL)
    }
  })

  it('reports the rename draft only while the rename panel is open', () => {
    expect(renameDraft(NO_PANEL)).toBe('')
    expect(renameDraft({ kind: 'delete-confirm' })).toBe('')
    expect(renameDraft({ kind: 'picker' })).toBe('')
    expect(renameDraft({ kind: 'rename', draft: 'Set two' })).toBe('Set two')
  })
})
