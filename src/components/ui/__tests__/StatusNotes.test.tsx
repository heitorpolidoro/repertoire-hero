// @vitest-environment jsdom
/**
 * RH-102 — the four-note mastery control, the one status control everywhere a
 * status is shown.
 *
 * The shape is the contract: four `<button>` elements in every state, named
 * after the outcome of pressing them, `aria-pressed` on all four, and three
 * greys as the whole colour surface. The decisions themselves are covered in
 * `src/lib/__tests__/statusNotes.test.ts`; what is checked here is that the DOM
 * never changes shape and never gains a colour.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StatusNotes } from '@/components/ui/StatusNotes'
import { ALL_STATUSES } from '@/lib/statusConfig'
import { filledNoteCount } from '@/lib/statusNotes'
import type { SongStatus } from '@/types/database'

afterEach(cleanup)

const group = () => screen.getByRole('group', { name: 'Mastery status' })
const notes = () => screen.getAllByRole('button')

describe('StatusNotes shape', () => {
  it('renders four notes and the stage name inside one named group, at every status', () => {
    for (const status of ALL_STATUSES) {
      render(<StatusNotes status={status} onChange={vi.fn()} />)
      expect(notes()).toHaveLength(4)
      expect(group().textContent).toContain(
        status === 'unknown' ? 'Unknown' : status[0].toUpperCase() + status.slice(1),
      )
      cleanup()
    }
  })

  it('keeps the four notes in every prop combination', () => {
    for (const readOnly of [false, true]) {
      for (const busy of [false, true]) {
        for (const size of ['row', 'stage'] as const) {
          render(
            <StatusNotes
              status="practicing"
              onChange={vi.fn()}
              readOnly={readOnly}
              busy={busy}
              size={size}
            />,
          )
          expect(notes()).toHaveLength(4)
          cleanup()
        }
      }
    }
  })

  it('puts the stage name in a fixed-width slot, so the notes never shift', () => {
    const widths = new Set<string>()
    for (const status of ALL_STATUSES) {
      render(<StatusNotes status={status} onChange={vi.fn()} />)
      const label = group().querySelector('[data-status-label]')
      expect(label).not.toBeNull()
      const width = [...(label as HTMLElement).classList].filter((cls) => cls.startsWith('w-'))
      expect(width).toHaveLength(1)
      widths.add(width[0])
      cleanup()
    }
    expect(widths.size).toBe(1)
  })

  it('selects the row size and the Fast View size', () => {
    render(<StatusNotes status="learning" onChange={vi.fn()} size="row" />)
    expect(group().querySelector('svg')?.getAttribute('height')).toBe('17')
    cleanup()

    render(<StatusNotes status="learning" onChange={vi.fn()} size="stage" />)
    expect(group().querySelector('svg')?.getAttribute('height')).toBe('32')
  })
})

describe('StatusNotes filled notes and names', () => {
  it('fills one note per stage reached and reports it through aria-pressed', () => {
    for (const status of ALL_STATUSES) {
      render(<StatusNotes status={status} onChange={vi.fn()} />)
      const pressed = notes().map((note) => note.getAttribute('aria-pressed'))
      expect(pressed).toEqual(
        [0, 1, 2, 3].map((index) => (index < filledNoteCount(status) ? 'true' : 'false')),
      )
      cleanup()
    }
  })

  it('names each note after the outcome of pressing it', () => {
    render(<StatusNotes status="practicing" onChange={vi.fn()} />)
    expect(notes().map((note) => note.getAttribute('aria-label'))).toEqual([
      'Set status to Learning',
      'Drop status to Learning',
      'Set status to Polishing',
      'Set status to Mastered',
    ])
  })

  it('names the first note Clear status while the row is learning', () => {
    render(<StatusNotes status="learning" onChange={vi.fn()} />)
    expect(screen.getByLabelText('Clear status')).toBeTruthy()
  })

  it('keeps every name and every aria-pressed value when read-only and when busy', () => {
    for (const props of [{ readOnly: true }, { busy: true }, { readOnly: true, busy: true }]) {
      render(<StatusNotes status="polishing" onChange={vi.fn()} {...props} />)
      expect(notes().map((note) => note.getAttribute('aria-label'))).toEqual([
        'Set status to Learning',
        'Set status to Practicing',
        'Drop status to Practicing',
        'Set status to Mastered',
      ])
      expect(notes().map((note) => note.getAttribute('aria-pressed'))).toEqual([
        'true',
        'true',
        'true',
        'false',
      ])
      cleanup()
    }
  })
})

describe('StatusNotes taps', () => {
  const tap = (status: SongStatus, name: string) => {
    const onChange = vi.fn()
    render(<StatusNotes status={status} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText(name))
    cleanup()
    return onChange
  }

  it('sets the tapped stage upwards', () => {
    expect(tap('learning', 'Set status to Mastered')).toHaveBeenCalledExactlyOnceWith('mastered')
  })

  it('sets the tapped stage downwards', () => {
    expect(tap('mastered', 'Set status to Learning')).toHaveBeenCalledExactlyOnceWith('learning')
  })

  it('drops one stage on a tap on the current note', () => {
    expect(tap('polishing', 'Drop status to Practicing')).toHaveBeenCalledExactlyOnceWith('practicing')
  })

  it('clears the status on the first note of a learning row', () => {
    expect(tap('learning', 'Clear status')).toHaveBeenCalledExactlyOnceWith('unknown')
  })

  it('enables all four notes when neither readOnly nor busy is set', () => {
    render(<StatusNotes status="practicing" onChange={vi.fn()} />)
    expect(notes().every((note) => (note as HTMLButtonElement).disabled)).toBe(false)
    expect(notes().some((note) => (note as HTMLButtonElement).disabled)).toBe(false)
  })

  it('disables all four and fires nothing when readOnly, when busy and when both', () => {
    for (const props of [{ readOnly: true }, { busy: true }, { readOnly: true, busy: true }]) {
      const onChange = vi.fn()
      render(<StatusNotes status="practicing" onChange={onChange} {...props} />)
      expect(notes()).toHaveLength(4)
      expect(notes().every((note) => (note as HTMLButtonElement).disabled)).toBe(true)
      for (const note of notes()) fireEvent.click(note)
      expect(onChange).not.toHaveBeenCalled()
      cleanup()
    }
  })
})

describe('StatusNotes is monochrome', () => {
  const COLOUR_WORDS = ['blue', 'yellow', 'orange', 'green', 'emerald']

  it('paints a filled note gray-900 and an unfilled note gray-400', () => {
    render(<StatusNotes status="practicing" onChange={vi.fn()} />)
    const classes = notes().map((note) => note.className)
    expect(classes[0]).toContain('text-gray-900')
    expect(classes[1]).toContain('text-gray-900')
    expect(classes[2]).toContain('text-gray-400')
    expect(classes[3]).toContain('text-gray-400')
    expect(classes.join(' ')).not.toContain('text-gray-700')
  })

  it('paints the stage name gray-700, and gray-400 while unassessed', () => {
    render(<StatusNotes status="mastered" onChange={vi.fn()} />)
    expect(group().querySelector('[data-status-label]')?.className).toContain('text-gray-700')
    cleanup()

    render(<StatusNotes status="unknown" onChange={vi.fn()} />)
    expect(group().querySelector('[data-status-label]')?.className).toContain('text-gray-400')
  })

  it('renders no other colour in any status, on a note or on a stem', () => {
    for (const status of ALL_STATUSES) {
      render(<StatusNotes status={status} onChange={vi.fn()} />)
      const markup = group().outerHTML
      for (const word of COLOUR_WORDS) expect(markup).not.toContain(word)
      expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      // The glyphs paint from `currentColor` only, so the three grey text
      // classes are the whole colour surface.
      expect(markup).not.toMatch(/fill="(?!none|currentColor)/)
      expect(markup).not.toMatch(/stroke="(?!none|currentColor)/)
      cleanup()
    }
  })

  it('reads no colour out of statusConfig in either source file', () => {
    const sources = [
      join(process.cwd(), 'src/components/ui/StatusNotes.tsx'),
      join(process.cwd(), 'src/lib/statusNotes.ts'),
    ].map((path) => readFileSync(path, 'utf8'))

    for (const source of sources) {
      for (const word of COLOUR_WORDS) expect(source).not.toContain(word)
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(source).not.toContain('bgColor')
      expect(source).not.toContain('textColor')
    }

    // The component reads nothing from `statusConfig.ts` at all; the lib module
    // reads the mastery order and the labels, and no colour.
    expect(sources[0]).not.toContain('statusConfig')
    expect(sources[1]).toMatch(/import \{ STATUS_CONFIG, STATUS_ORDER \} from '@\/lib\/statusConfig'/)
  })
})
