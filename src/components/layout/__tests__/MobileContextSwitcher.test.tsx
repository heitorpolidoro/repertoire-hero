// @vitest-environment jsdom
/**
 * RH-181 — the mobile context control: the personal-mode bar and the sheet
 * listing Personal and every band. The switch itself is `useContextSwitch`'s
 * job (its own suite pins the store write), so it is mocked here to prove the
 * sheet goes through it and through nothing else.
 */
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { BandOption } from '@/types/database'
import type { BandContext } from '@/store/bandContextStore'

const { switchToSpy } = vi.hoisted(() => ({ switchToSpy: vi.fn() }))

vi.mock('@/hooks/useContextSwitch', () => ({
  useContextSwitch: () => ({ switchTo: switchToSpy }),
}))

import { MobileContextSwitcher } from '../MobileContextSwitcher'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

const BANDS: BandOption[] = [
  { id: 'band-alpha', name: 'Alpha Quartet', color: '#1d4ed8' },
  { id: 'band-beta', name: 'Beta Ensemble', color: null },
]

const PERSONAL: BandContext = { type: 'user' }
const ALPHA: BandContext = { type: 'band', id: 'band-alpha', name: 'Alpha Quartet', color: '#1d4ed8' }

/** Owns the open state the way AppLayout does, so a test can drive it. */
function Harness({
  bands = BANDS,
  context = PERSONAL,
  initiallyOpen = false,
}: {
  bands?: BandOption[]
  context?: BandContext
  initiallyOpen?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <MobileContextSwitcher
      bands={bands}
      context={context}
      userName="Ada"
      open={open}
      onOpenChange={setOpen}
    />
  )
}

function openSheet() {
  fireEvent.click(screen.getByTestId('mobile-context-trigger'))
  return screen.getByRole('dialog', { name: 'Switch mode' })
}

describe('MobileContextSwitcher personal bar', () => {
  it('shows Personal and a Switch mode trigger in personal context', () => {
    render(<Harness />)

    const trigger = screen.getByTestId('mobile-context-trigger')
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(screen.getByRole('button', { name: 'Switch mode' })).toBe(trigger)
    expect(screen.getByTestId('mobile-context-bar').textContent).toContain('Personal')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders no bar in band context, where the band bar carries the trigger', () => {
    render(<Harness context={ALPHA} />)

    expect(screen.queryByTestId('mobile-context-bar')).toBeNull()
    expect(screen.queryByTestId('mobile-context-trigger')).toBeNull()
  })

  it('renders nothing at all with zero bands', () => {
    const { container } = render(<Harness bands={[]} initiallyOpen />)

    expect(container.innerHTML).toBe('')
  })
})

describe('MobileContextSwitcher sheet', () => {
  it('lists Personal with the user name, a Bands heading and every band', () => {
    render(<Harness />)

    const sheet = openSheet()
    expect(sheet.getAttribute('data-testid')).toBe('mobile-context-sheet')
    const options = within(sheet).getAllByRole('button').filter((b) => b.textContent !== 'Close')
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Personal'),
      expect.stringContaining('Alpha Quartet'),
      expect.stringContaining('Beta Ensemble'),
    ])
    expect(options[0].textContent).toContain('Ada')
    expect(within(sheet).getByText('Bands')).toBeDefined()
  })

  it('marks the active personal option with aria-current and a tick', () => {
    render(<Harness />)

    const sheet = openSheet()
    const personal = within(sheet).getByRole('button', { name: /Personal/ })
    expect(personal.getAttribute('aria-current')).toBe('true')
    expect(personal.textContent).toContain('✓')
    const alpha = within(sheet).getByRole('button', { name: /Alpha Quartet/ })
    expect(alpha.getAttribute('aria-current')).toBeNull()
  })

  it('marks the active band in band context', () => {
    render(<Harness context={ALPHA} initiallyOpen />)

    const sheet = screen.getByRole('dialog', { name: 'Switch mode' })
    expect(within(sheet).getByRole('button', { name: /Alpha Quartet/ }).getAttribute('aria-current')).toBe('true')
    expect(within(sheet).getByRole('button', { name: /Personal/ }).getAttribute('aria-current')).toBeNull()
  })

  it('switches to a band through the hook and closes', () => {
    render(<Harness />)

    fireEvent.click(within(openSheet()).getByRole('button', { name: /Beta Ensemble/ }))

    expect(switchToSpy).toHaveBeenCalledWith({ type: 'band', id: 'band-beta', name: 'Beta Ensemble', color: undefined })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('passes the band colour on', () => {
    render(<Harness />)

    fireEvent.click(within(openSheet()).getByRole('button', { name: /Alpha Quartet/ }))

    expect(switchToSpy).toHaveBeenCalledWith({ type: 'band', id: 'band-alpha', name: 'Alpha Quartet', color: '#1d4ed8' })
  })

  it('switches to Personal through the hook from band context', () => {
    render(<Harness context={ALPHA} initiallyOpen />)

    fireEvent.click(screen.getByRole('button', { name: /Personal/ }))

    expect(switchToSpy).toHaveBeenCalledWith({ type: 'user' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('only closes when the already-active option is chosen', () => {
    render(<Harness />)

    fireEvent.click(within(openSheet()).getByRole('button', { name: /Personal/ }))

    expect(switchToSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on the backdrop without switching', () => {
    render(<Harness />)
    openSheet()

    fireEvent.click(screen.getByTestId('mobile-context-backdrop'))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(switchToSpy).not.toHaveBeenCalled()
  })

  it('closes on Close without switching', () => {
    render(<Harness />)

    fireEvent.click(within(openSheet()).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(switchToSpy).not.toHaveBeenCalled()
  })

  it('closes on Escape without switching', () => {
    render(<Harness />)
    openSheet()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(switchToSpy).not.toHaveBeenCalled()
  })

  it('ignores other keys', () => {
    render(<Harness />)
    openSheet()

    fireEvent.keyDown(document, { key: 'Enter' })

    expect(screen.getByRole('dialog')).toBeDefined()
  })
})
