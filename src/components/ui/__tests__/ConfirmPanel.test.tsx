// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ConfirmPanel } from '../ConfirmPanel'

afterEach(cleanup)

function renderPanel(props: Partial<React.ComponentProps<typeof ConfirmPanel>> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const utils = render(
    <ConfirmPanel
      message="Remove Ana from the band?"
      confirmLabel="Remove"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  )
  return {
    ...utils,
    onConfirm,
    onCancel,
    confirmButton: () => screen.getByRole('button', { name: /^Remove/ }),
    cancelButton: () => screen.getByRole('button', { name: 'Cancel' }),
  }
}

describe('ConfirmPanel accessibility', () => {
  it('renders as an assertive alertdialog carrying the message', () => {
    renderPanel()

    const panel = screen.getByRole('alertdialog')
    expect(panel).toHaveProperty('ariaLive', 'assertive')
    expect(panel.textContent).toContain('Remove Ana from the band?')
  })

  it('moves focus to Cancel on mount so the safe choice is the default', () => {
    const { cancelButton } = renderPanel()

    expect(document.activeElement).toBe(cancelButton())
  })

  it('appends the caller-supplied className to the panel', () => {
    renderPanel({ className: 'mt-4 w-full' })

    expect(screen.getByRole('alertdialog').className).toContain('mt-4 w-full')
  })
})

describe('ConfirmPanel interaction', () => {
  it('invokes onConfirm and onCancel from their buttons', () => {
    const { onConfirm, onCancel, confirmButton, cancelButton } = renderPanel()

    fireEvent.click(confirmButton())
    fireEvent.click(cancelButton())

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels on Escape pressed anywhere in the document', () => {
    const { onCancel } = renderPanel()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('ignores keys other than Escape', () => {
    const { onCancel } = renderPanel()

    fireEvent.keyDown(document, { key: 'Enter' })

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('makes Escape inert while the action is running', () => {
    const { onCancel } = renderPanel({ busy: true })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('stops listening for Escape once unmounted', () => {
    const { onCancel, unmount } = renderPanel()

    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('ConfirmPanel busy state', () => {
  it('derives the busy label from confirmLabel and disables both buttons', () => {
    const { confirmButton, cancelButton } = renderPanel({ busy: true })

    expect(confirmButton().textContent).toBe('Remove...')
    expect(confirmButton()).toHaveProperty('disabled', true)
    expect(cancelButton()).toHaveProperty('disabled', true)
  })

  it('prefers an explicit busyLabel over the derived one', () => {
    renderPanel({ busy: true, busyLabel: 'Removing member' })

    expect(screen.getByRole('button', { name: 'Removing member' })).toBeDefined()
  })
})

describe('ConfirmPanel tones', () => {
  it.each([
    ['danger (the default)', undefined, 'border-red-200 bg-red-50', 'bg-red-600'],
    ['warning', 'warning' as const, 'border-amber-200 bg-amber-50', 'bg-amber-600'],
  ])('renders the %s palette', (_label, tone, panelClasses, buttonClass) => {
    const { confirmButton } = renderPanel(tone ? { tone } : {})

    expect(screen.getByRole('alertdialog').className).toContain(panelClasses)
    expect(confirmButton().className).toContain(buttonClass)
  })
})
