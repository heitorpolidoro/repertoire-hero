// @vitest-environment jsdom
/**
 * RH-83 ER4 / ER15 — the band-or-personal choice dialog.
 *
 * The two disclosure assertions are the point of this file: QA sees only the
 * ER list, so without them the sentence that tells a musician a row will be
 * created in their repertoire could be deleted with every suite still green.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LyricsDestinationModal } from '../LyricsDestinationModal'

afterEach(cleanup)

const SEED_SENTENCE = "Private to you. Starts as a copy of the band's lyrics."
const DISCLOSURE = 'Adds this song to your personal repertoire when you save.'

describe('LyricsDestinationModal', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <LyricsDestinationModal
        open={false}
        personalRepertoireId={null}
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('offers the band version and the personal one, and reports the choice', () => {
    const onChoose = vi.fn()
    render(
      <LyricsDestinationModal
        open
        personalRepertoireId="personal-rep"
        onChoose={onChoose}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('👥 Band lyrics'))
    expect(onChoose).toHaveBeenCalledWith('band')

    fireEvent.click(screen.getByText('👤 My version'))
    expect(onChoose).toHaveBeenCalledWith('personal')
    expect(onChoose).toHaveBeenCalledTimes(2)
  })

  it('reports the cancel press', () => {
    const onCancel = vi.fn()
    render(
      <LyricsDestinationModal
        open
        personalRepertoireId="personal-rep"
        onChoose={vi.fn()}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('always says the personal version starts as a copy of the band lyrics (ER15)', () => {
    render(
      <LyricsDestinationModal
        open
        personalRepertoireId="personal-rep"
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(SEED_SENTENCE)).toBeDefined()
  })

  it('discloses the new repertoire row exactly when there is no personal row (ER15)', () => {
    // No personal row: the consequence of saving is stated, not buried.
    const fresh = render(
      <LyricsDestinationModal open personalRepertoireId={null} onChoose={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByText(DISCLOSURE)).toBeDefined()
    expect(screen.getByText(SEED_SENTENCE)).toBeDefined()
    fresh.unmount()

    // A row already exists: nothing would be created, so nothing is claimed.
    render(
      <LyricsDestinationModal
        open
        personalRepertoireId="personal-rep"
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByText(DISCLOSURE)).toBeNull()
  })
})
