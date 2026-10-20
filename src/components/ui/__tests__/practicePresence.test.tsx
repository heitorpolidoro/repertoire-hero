// @vitest-environment jsdom
/** RH-119 — the "Who was there" checklist in the review list. */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PracticeReviewList } from '@/components/ui/PracticeReviewList'
import { usePracticeReview, type PracticePresence } from '@/hooks/usePracticeReview'

afterEach(cleanup)

const ROWS = [{ versionId: 'v0', title: 'Alpha', artist: 'A' }]
const PRESENCE: PracticePresence = {
  selfId: 'me',
  members: [
    { userId: 'me', name: 'Heitor' },
    { userId: 'ana', name: 'Ana' },
    { userId: 'bru', name: 'Bruno' },
  ],
}

function Harness({ recordPractice, presence }: { recordPractice: never; presence?: PracticePresence }) {
  const review = usePracticeReview({
    rows: ROWS,
    recordPractice,
    bandId: presence ? 'band' : null,
    presence,
    setError: vi.fn(),
    onRefresh: vi.fn(),
  })
  return <PracticeReviewList review={review} rows={ROWS} levels={new Map()} readOnly={false} onClose={vi.fn()} />
}

function setup(presence?: PracticePresence) {
  const recordPractice = vi.fn().mockResolvedValue(undefined)
  render(<Harness recordPractice={recordPractice as never} presence={presence} />)
  return recordPractice
}

describe('Who was there', () => {
  it('renders no checklist without presence and sends two arguments as today', async () => {
    const record = setup()
    expect(screen.queryByText('Who was there')).toBeNull()
    fireEvent.click(screen.getByLabelText('Practised Alpha'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    expect(record).toHaveBeenCalledWith([{ versionId: 'v0' }], null)
  })

  it('lists every member, the admin ticked and disabled, others unticked', () => {
    setup(PRESENCE)
    expect(screen.getByText('Who was there')).toBeTruthy()
    const me = screen.getByLabelText(/Heitor/) as HTMLInputElement
    expect(me.checked).toBe(true)
    expect(me.disabled).toBe(true)
    expect((screen.getByLabelText('Ana') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('button', { name: 'Confirm (1 present)' })).toBeTruthy()
  })

  it('sends the ticked ids (never the admin) with the batch', async () => {
    const record = setup(PRESENCE)
    fireEvent.click(screen.getByLabelText('Practised Alpha'))
    fireEvent.click(screen.getByLabelText('Ana'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm (2 present)' }))
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    expect(record).toHaveBeenCalledWith([{ versionId: 'v0' }], 'band', ['ana'])
  })

  it('sends no third argument when nobody else is ticked', async () => {
    const record = setup(PRESENCE)
    fireEvent.click(screen.getByLabelText('Practised Alpha'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm (1 present)' }))
    await waitFor(() => expect(record).toHaveBeenCalledTimes(1))
    expect(record).toHaveBeenCalledWith([{ versionId: 'v0' }], 'band')
  })

  it('unticking a member removes them again', () => {
    setup(PRESENCE)
    const ana = screen.getByLabelText('Ana') as HTMLInputElement
    fireEvent.click(ana)
    fireEvent.click(ana)
    expect(ana.checked).toBe(false)
  })
})
