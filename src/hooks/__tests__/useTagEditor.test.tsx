// @vitest-environment jsdom
/**
 * RH-69 — the shared tag-editing controller.
 *
 * This is the only place the properties that matter can be observed directly:
 * that the new list is applied **before** the Server Action is awaited (three
 * e2e tests wait on `serverActionResponse` because of it), that a rejection is
 * *not* rolled back (neither tag path reverts today, and adding a rollback
 * would change what `e2e/playlist-detail.spec.ts` sees), that each site keeps
 * its own failure message, and that one instance serves the playlist bar and
 * every song row.
 *
 * The options are hand-built `vi.fn()`s: the hook is handed `saveTags` closures
 * by the page, so nothing here imports a Server Action.
 */

import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useTagEditor, type TagEditorOptions } from '@/hooks/useTagEditor'

afterEach(cleanup)

type OptionSpies = {
  readTags: Mock
  applyTags: Mock
  saveTags: Mock
  onError: Mock
}

function setup(overrides: Partial<TagEditorOptions> = {}) {
  const spies: OptionSpies = {
    readTags: vi.fn((subject: string) => (subject === 'song-1' ? ['encore'] : ['slow'])),
    applyTags: vi.fn(),
    saveTags: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
  }
  const options: TagEditorOptions = {
    ...spies,
    addFailureMessage: 'Failed to add tag',
    removeFailureMessage: 'Failed to remove tag',
    ...overrides,
  }
  const view = renderHook(() => useTagEditor(options))
  return { ...view, ...spies, options }
}

type Rendered = { current: ReturnType<typeof useTagEditor> }

/** Opens the editor for `subject` and types `draft` into it. */
function type(result: Rendered, subject: string, draft: string) {
  act(() => result.current.open(subject))
  act(() => result.current.changeDraft(draft))
}

/** Opens, types and commits — the whole gesture the inline input performs. */
async function typeAndCommit(result: Rendered, subject: string, draft: string) {
  type(result, subject, draft)
  await act(async () => {
    await result.current.commitDraft(subject)
  })
}

describe('useTagEditor', () => {
  it('starts closed with an empty draft', () => {
    const { result } = setup()

    expect(result.current.openFor).toBeNull()
    expect(result.current.draft).toBe('')
    expect(result.current.inputRef.current).toBeNull()
  })

  it('opens for a subject and clears the draft', () => {
    const { result } = setup()
    act(() => result.current.changeDraft('leftover'))

    act(() => result.current.open('song-1'))

    expect(result.current.openFor).toBe('song-1')
    expect(result.current.draft).toBe('')
  })

  it('closes and clears the draft', () => {
    const { result } = setup()
    type(result, 'song-1', 'encore')

    act(() => result.current.close())

    expect(result.current.openFor).toBeNull()
    expect(result.current.draft).toBe('')
  })

  it('records what is typed into the draft', () => {
    const { result } = setup()

    act(() => result.current.changeDraft('enc'))
    expect(result.current.draft).toBe('enc')

    act(() => result.current.changeDraft('encore'))
    expect(result.current.draft).toBe('encore')
  })

  it('applies the new tag list before the save is awaited', async () => {
    const { result, applyTags, saveTags } = setup()
    let release = () => {}
    saveTags.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    type(result, 'song-1', 'fast')

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.commitDraft('song-1')
    })

    // The save is still in flight, and the list is already applied locally.
    expect(applyTags).toHaveBeenCalledWith('song-1', ['encore', 'fast'])
    expect(saveTags).toHaveBeenCalledWith('song-1', ['encore', 'fast'])
    await act(async () => {
      release()
      await pending
    })
  })

  it('saves the normalised tag and closes the input', async () => {
    const { result, applyTags, saveTags } = setup()

    await typeAndCommit(result, 'song-1', '  Fast,, ')

    expect(applyTags).toHaveBeenCalledWith('song-1', ['encore', 'fast'])
    expect(saveTags).toHaveBeenCalledWith('song-1', ['encore', 'fast'])
    expect(result.current.openFor).toBeNull()
    expect(result.current.draft).toBe('')
  })

  it('writes nothing and closes when the draft normalises to empty', async () => {
    const { result, applyTags, saveTags } = setup()

    await typeAndCommit(result, 'song-1', '  ,, ')

    expect(applyTags).not.toHaveBeenCalled()
    expect(saveTags).not.toHaveBeenCalled()
    expect(result.current.openFor).toBeNull()
  })

  it('writes nothing and closes when the subject already carries the tag', async () => {
    const { result, applyTags, saveTags } = setup()

    // `encore` is already on `song-1`, and the case does not hide it.
    await typeAndCommit(result, 'song-1', 'ENCORE')

    expect(saveTags).not.toHaveBeenCalled()
    expect(applyTags).not.toHaveBeenCalled()
    expect(result.current.draft).toBe('')
    expect(result.current.openFor).toBeNull()
  })

  it('writes nothing when the subject has no tags to edit', async () => {
    const { result, applyTags, saveTags } = setup({ readTags: vi.fn().mockReturnValue(null) })

    await typeAndCommit(result, 'song-1', 'fast')
    await act(async () => {
      await result.current.removeTag('song-1', 'encore')
    })

    expect(applyTags).not.toHaveBeenCalled()
    expect(saveTags).not.toHaveBeenCalled()
  })

  it('keeps the optimistic list and reports the rejection message through onError', async () => {
    const { result, applyTags, onError } = setup()
    const saveTags = vi.fn().mockRejectedValue(new Error('offline'))
    const failing = setup({ saveTags })

    await typeAndCommit(failing.result, 'song-1', 'fast')

    expect(failing.applyTags).toHaveBeenCalledTimes(1)
    expect(failing.applyTags).toHaveBeenCalledWith('song-1', ['encore', 'fast'])
    expect(failing.onError).toHaveBeenCalledWith('offline')
    // No rollback: the page keeps the optimistic list, exactly as it does today.
    expect(applyTags).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(result.current.openFor).toBeNull()
  })

  it('falls back to the add message when the rejection is not an Error', async () => {
    const { result, onError } = setup({ saveTags: vi.fn().mockRejectedValue('nope') })

    await typeAndCommit(result, 'song-1', 'fast')

    expect(onError).toHaveBeenCalledWith('Failed to add tag')
  })

  it('removes a tag optimistically and saves the shortened list', async () => {
    const { result, applyTags, saveTags } = setup({
      readTags: vi.fn().mockReturnValue(['encore', 'fast']),
    })

    await act(async () => {
      await result.current.removeTag('song-1', 'encore')
    })

    expect(applyTags).toHaveBeenCalledWith('song-1', ['fast'])
    expect(saveTags).toHaveBeenCalledWith('song-1', ['fast'])
    expect(result.current.openFor).toBeNull()
  })

  it('reports a failed remove with the remove message', async () => {
    const { result, onError, applyTags } = setup({
      saveTags: vi.fn().mockRejectedValue('nope'),
    })

    await act(async () => {
      await result.current.removeTag('song-1', 'encore')
    })

    expect(applyTags).toHaveBeenCalledWith('song-1', [])
    expect(onError).toHaveBeenCalledWith('Failed to remove tag')
  })

  it('focuses the input when the editor opens', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const { result } = setup()
    result.current.inputRef.current = input

    act(() => result.current.open('song-1'))

    expect(document.activeElement).toBe(input)
    input.remove()
  })

  it('serves two subjects one at a time from a single instance', async () => {
    const { result, saveTags } = setup()

    type(result, 'song-1', 'fast')
    expect(result.current.openFor).toBe('song-1')

    act(() => result.current.open('song-2'))
    expect(result.current.openFor).toBe('song-2')
    expect(result.current.draft).toBe('')

    await typeAndCommit(result, 'song-2', 'quiet')

    expect(saveTags).toHaveBeenCalledTimes(1)
    expect(saveTags).toHaveBeenCalledWith('song-2', ['slow', 'quiet'])
    expect(result.current.openFor).toBeNull()
  })
})
