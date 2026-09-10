import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { addTag, removeTag as withoutTag } from '@/lib/tagEditor'

/**
 * How one editing site reaches its tags. A "subject" is whatever that site keys
 * them by — the playlist id for the playlist tag bar, the song id for a song
 * row — which is what lets a single instance serve every row of the list.
 *
 * `saveTags` is a closure the page hands down with the playlist id or the
 * repertoire entry id already bound, so this hook imports no Server Action and
 * the import-direction rule (F21) holds with no actions bundle.
 *
 * All four are read on the render that commits, never memoised across renders:
 * a second tag added to the same subject therefore sees the list the first one
 * left, not the one captured when the editor opened.
 */
export interface TagEditorOptions {
  /** The subject's tags now, or `null` when there is nothing to edit. */
  readTags: (subject: string) => string[] | null
  /** Applies the new list locally — optimistically, before the save is awaited. */
  applyTags: (subject: string, tags: string[]) => void
  /** Persists the new list. Rejections are reported, never rolled back. */
  saveTags: (subject: string, tags: string[]) => Promise<void>
  /** The page's error banner. */
  onError: (message: string) => void
  /** Reported when a rejected add carries no message of its own. */
  addFailureMessage: string
  /** Reported when a rejected remove carries no message of its own. */
  removeFailureMessage: string
}

/**
 * Commands only, no setters: a consumer opens, closes, types, commits or
 * removes, and cannot drive the state behind the hook's back.
 */
export interface TagEditorController {
  /** The subject whose inline input is open, or `null` when none is. */
  openFor: string | null
  /** What has been typed into that input. */
  draft: string
  /** Attached to the inline input, so opening focuses it. */
  inputRef: RefObject<HTMLInputElement | null>
  open: (subject: string) => void
  close: () => void
  changeDraft: (value: string) => void
  /** Adds the drafted tag to `subject`, and closes the input either way. */
  commitDraft: (subject: string) => Promise<void>
  removeTag: (subject: string, tag: string) => Promise<void>
}

/**
 * RH-69 — the controller both tag editors of `/playlists/[id]` run on: which
 * subject's inline input is open, what is typed into it, the focus-on-open, and
 * the write path.
 *
 * Both writes are optimistic in the order the page already used: the new list
 * is applied locally **before** the save is awaited, and a rejection surfaces
 * through `onError` without reverting. That absence of a rollback is today's
 * behaviour and is preserved deliberately — `e2e/playlist-detail.spec.ts`
 * observes the optimistic chip before the Server Action lands.
 */
export function useTagEditor({
  readTags,
  applyTags,
  saveTags,
  onError,
  addFailureMessage,
  removeFailureMessage,
}: TagEditorOptions): TagEditorController {
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (openFor !== null) inputRef.current?.focus()
  }, [openFor])

  const open = useCallback((subject: string) => {
    setOpenFor(subject)
    setDraft('')
  }, [])

  const close = useCallback(() => {
    setOpenFor(null)
    setDraft('')
  }, [])

  const changeDraft = useCallback((value: string) => setDraft(value), [])

  /** Applies the list, then persists it; reports a rejection, never reverts. */
  const write = useCallback(
    async (subject: string, tags: string[], failureMessage: string) => {
      applyTags(subject, tags)
      try {
        await saveTags(subject, tags)
      } catch (error) {
        onError(error instanceof Error ? error.message : failureMessage)
      }
    },
    [applyTags, saveTags, onError],
  )

  const commitDraft = useCallback(
    async (subject: string) => {
      const current = readTags(subject)
      const next = current === null ? null : addTag(current, draft)
      close()
      if (next === null) return
      await write(subject, next, addFailureMessage)
    },
    [readTags, draft, close, write, addFailureMessage],
  )

  const removeTag = useCallback(
    async (subject: string, tag: string) => {
      const current = readTags(subject)
      if (current === null) return
      await write(subject, withoutTag(current, tag), removeFailureMessage)
    },
    [readTags, write, removeFailureMessage],
  )

  return { openFor, draft, inputRef, open, close, changeDraft, commitDraft, removeTag }
}
