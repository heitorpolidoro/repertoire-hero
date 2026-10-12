// @vitest-environment jsdom
/**
 * RH-111 — the requester's correction-outcome banner.
 *
 * Presentational: the acknowledge action is injected. Pins the three outcomes
 * rendering distinctly (a replaced field is never worded as refused and shows
 * no reason), dismiss calling the action with exactly the listed ids, and the
 * banner rendering nothing when there is nothing to tell.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import enDict from '@/i18n/dictionaries/en.json'
import type { SuggestionOutcomeGroup } from '@/types/database'
import SuggestionOutcomeBanner from '../SuggestionOutcomeBanner'

afterEach(cleanup)

const COPY = enDict.suggestionOutcomes

const GROUPS: SuggestionOutcomeGroup[] = [
  {
    group_id: 'g1',
    song_id: 's1',
    title: 'Blackbird',
    artist: 'The Beatles',
    fields: [
      { id: 'f1', column: 'title', outcome: 'approved', reason: null },
      { id: 'f2', column: 'artist', outcome: 'refused', reason: 'Wrong spelling' },
      { id: 'f3', column: 'album', outcome: 'replaced', reason: null },
    ],
  },
  {
    group_id: 'g2',
    song_id: 's2',
    title: 'Yesterday',
    artist: 'The Beatles',
    fields: [{ id: 'f4', column: 'standard_key', outcome: 'refused', reason: null }],
  },
]

describe('SuggestionOutcomeBanner', () => {
  it('renders nothing when there are no outcomes', () => {
    const { container } = render(
      <SuggestionOutcomeBanner groups={[]} copy={COPY} actions={{ acknowledge: vi.fn() }} />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('lists each submission under its song with one line per field', () => {
    render(<SuggestionOutcomeBanner groups={GROUPS} copy={COPY} actions={{ acknowledge: vi.fn() }} />)

    expect(screen.getByText(COPY.title)).toBeTruthy()
    expect(screen.getByText(/Blackbird/)).toBeTruthy()
    expect(screen.getByText(/Yesterday/)).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('tells approved, refused and replaced apart', () => {
    render(<SuggestionOutcomeBanner groups={GROUPS} copy={COPY} actions={{ acknowledge: vi.fn() }} />)

    const approved = screen.getByTestId('outcome-f1')
    const refused = screen.getByTestId('outcome-f2')
    const replaced = screen.getByTestId('outcome-f3')

    expect(approved.textContent).toContain(COPY.approved)
    expect(refused.textContent).toContain(COPY.refused)
    expect(replaced.textContent).toContain(COPY.replaced)
    expect(new Set([approved.className, refused.className, replaced.className]).size).toBe(3)
  })

  it('shows the refusal reason when one was given and never on a replaced field', () => {
    render(<SuggestionOutcomeBanner groups={GROUPS} copy={COPY} actions={{ acknowledge: vi.fn() }} />)

    expect(screen.getByTestId('outcome-f2').textContent).toContain('Wrong spelling')
    expect(screen.getByTestId('outcome-f2').textContent).toContain(COPY.reasonLabel)
    // A refusal with no reason shows no reason line.
    expect(screen.getByTestId('outcome-f4').textContent).not.toContain(COPY.reasonLabel)
    // A replaced field is not worded as a refusal and carries no reason.
    const replaced = screen.getByTestId('outcome-f3').textContent ?? ''
    expect(replaced).not.toContain(COPY.refused)
    expect(replaced).not.toContain(COPY.reasonLabel)
  })

  it('names the field with the dictionary label and falls back to the column', () => {
    const groups: SuggestionOutcomeGroup[] = [
      {
        ...GROUPS[0],
        fields: [
          { id: 'x1', column: 'standard_key', outcome: 'approved', reason: null },
          { id: 'x2', column: 'mystery_column', outcome: 'approved', reason: null },
        ],
      },
    ]
    render(<SuggestionOutcomeBanner groups={groups} copy={COPY} actions={{ acknowledge: vi.fn() }} />)

    expect(screen.getByTestId('outcome-x1').textContent).toContain(COPY.fields.standard_key)
    expect(screen.getByTestId('outcome-x2').textContent).toContain('mystery_column')
  })

  it.each([
    ['Got it', COPY.gotIt],
    ['dismiss', COPY.dismiss],
  ])('acknowledges exactly the listed ids through the %s control, then disappears', async (_label, name) => {
    const acknowledge = vi.fn().mockResolvedValue(4)
    const { container } = render(
      <SuggestionOutcomeBanner groups={GROUPS} copy={COPY} actions={{ acknowledge }} />,
    )

    fireEvent.click(screen.getByRole('button', { name }))

    await waitFor(() => expect(container.innerHTML).toBe(''))
    expect(acknowledge).toHaveBeenCalledTimes(1)
    expect(acknowledge).toHaveBeenCalledWith(['f1', 'f2', 'f3', 'f4'])
  })

  it('keeps the banner when the acknowledge fails, so it can be retried', async () => {
    const acknowledge = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(4)
    render(<SuggestionOutcomeBanner groups={GROUPS} copy={COPY} actions={{ acknowledge }} />)

    fireEvent.click(screen.getByRole('button', { name: COPY.gotIt }))
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1))

    expect(screen.getByText(COPY.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: COPY.gotIt }))
    await waitFor(() => expect(screen.queryByText(COPY.title)).toBeNull())
  })
})
