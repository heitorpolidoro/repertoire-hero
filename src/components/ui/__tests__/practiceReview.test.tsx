// @vitest-environment jsdom
/**
 * RH-159 — the whole-playlist "Review practice" list, driven through the real
 * controller hook with an injected action.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PracticeReviewList } from '@/components/ui/PracticeReviewList'
import { usePracticeReview } from '@/hooks/usePracticeReview'
import { practiceReviewRows } from '@/lib/practiceReviewRows'
import type { PlaylistSong, Repertoire } from '@/types/database'

afterEach(cleanup)

const TITLES = ['Alpha', 'Bravo', 'Charlie', 'Delta']
const SONGS = TITLES.map(
  (title, i) =>
    ({
      id: `ps-${i}`,
      playlist_id: 'pl',
      version_id: `v${i}`,
      position: i,
      song: { id: `s${i}`, title, artist: 'Artist' },
    }) as unknown as PlaylistSong,
)
const ROWS = practiceReviewRows(SONGS)
const REPERTOIRE = new Map<string, Repertoire>([['v0', { id: 'r0', status: 'learning' } as unknown as Repertoire]])

function Harness({
  recordPractice,
  onClose,
  readOnly = false,
}: {
  recordPractice: (items: { versionId: string; status?: string }[], bandId?: string | null) => Promise<void>
  onClose: () => void
  readOnly?: boolean
}) {
  const review = usePracticeReview({
    rows: ROWS,
    recordPractice: recordPractice as never,
    bandId: null,
    setError: vi.fn(),
    onRefresh: vi.fn(),
    onClose,
  })
  return (
    <PracticeReviewList
      review={review}
      rows={ROWS}
      levels={REPERTOIRE}
      readOnly={readOnly}
      onClose={onClose}
    />
  )
}

function setup(recordPractice = vi.fn().mockResolvedValue(undefined), readOnly = false) {
  const onClose = vi.fn()
  render(<Harness recordPractice={recordPractice} onClose={onClose} readOnly={readOnly} />)
  return { recordPractice, onClose }
}

const boxes = () => screen.getAllByRole('checkbox') as HTMLInputElement[]
const confirmButton = () => screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement

describe('PracticeReviewList', () => {
  it('opens with every row unticked and Confirm disabled', () => {
    setup()
    expect(boxes()).toHaveLength(4)
    expect(boxes().every(b => !b.checked)).toBe(true)
    expect(confirmButton().disabled).toBe(true)
  })

  it('the single control ticks all, then unticks all, flipping its label', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Tick all' }))
    expect(boxes().every(b => b.checked)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Untick all' }))
    expect(boxes().every(b => !b.checked)).toBe(true)
  })

  it('with some ticked the control still ticks every row', () => {
    setup()
    fireEvent.click(boxes()[1])
    fireEvent.click(screen.getByRole('button', { name: 'Tick all' }))
    expect(boxes().every(b => b.checked)).toBe(true)
  })

  it('Confirm with two of four ticked writes exactly those two, without status', async () => {
    const { recordPractice, onClose } = setup()
    fireEvent.click(boxes()[0])
    fireEvent.click(boxes()[2])
    fireEvent.click(confirmButton())
    await waitFor(() => expect(recordPractice).toHaveBeenCalledTimes(1))
    expect(recordPractice).toHaveBeenCalledWith([{ versionId: 'v0' }, { versionId: 'v2' }], null)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('a changed level shows on the row and is sent for that row only', async () => {
    const { recordPractice } = setup()
    fireEvent.click(boxes()[0])
    fireEvent.click(boxes()[1])
    const first = screen.getAllByRole('group', { name: 'Mastery status' })[0]
    expect(within(first).getByText('Learning')).toBeDefined()
    fireEvent.click(within(first).getAllByRole('button')[3])
    expect(within(first).getByText('Mastered')).toBeDefined()
    fireEvent.click(confirmButton())
    await waitFor(() => expect(recordPractice).toHaveBeenCalled())
    expect(recordPractice).toHaveBeenCalledWith([{ versionId: 'v0', status: 'mastered' }, { versionId: 'v1' }], null)
  })

  it('RH-169: a row missing from the lookup renders as unassessed, a present one at its level', () => {
    setup()
    const groups = screen.getAllByRole('group', { name: 'Mastery status' })
    expect(within(groups[0]).getByText('Learning')).toBeDefined()
    expect(within(groups[1]).getByText('Unknown')).toBeDefined()
  })

  it('on a band playlist the level controls are read-only', () => {
    setup(undefined, true)
    for (const note of screen.getAllByRole('group', { name: 'Mastery status' }).flatMap(g => within(g).getAllByRole('button'))) {
      expect((note as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('Cancel calls the close handler and writes nothing', () => {
    const { recordPractice, onClose } = setup()
    fireEvent.click(boxes()[0])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(recordPractice).not.toHaveBeenCalled()
  })

  it('a rejected confirm keeps the list open with ticks intact', async () => {
    const { recordPractice, onClose } = setup(vi.fn().mockRejectedValue(new Error('nope')))
    fireEvent.click(boxes()[0])
    fireEvent.click(confirmButton())
    await waitFor(() => expect(recordPractice).toHaveBeenCalled())
    await waitFor(() => expect(confirmButton().disabled).toBe(false))
    expect(onClose).not.toHaveBeenCalled()
    expect(boxes()[0].checked).toBe(true)
  })
})
