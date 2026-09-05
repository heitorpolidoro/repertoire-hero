// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Toast } from '../Toast'
import { AlertBanner } from '../AlertBanner'
import { TOAST_TONE_CLASSES, type ToastTone } from '@/lib/uiTones'

afterEach(cleanup)

const TONES: ToastTone[] = ['success', 'error', 'warning', 'info']

describe('Toast', () => {
  it.each(TONES)('renders the %s message with the TOAST_TONE_CLASSES palette applied', (tone) => {
    render(<Toast message={`A ${tone} thing happened`} tone={tone} onDismiss={vi.fn()} />)

    const message = screen.getByText(`A ${tone} thing happened`)
    // uiTones.test.ts only pins the string; this pins that it reaches the DOM.
    expect(message.parentElement?.className).toContain(TOAST_TONE_CLASSES[tone])
  })

  it('fires onDismiss from the ✕ control', () => {
    const onDismiss = vi.fn()
    render(<Toast message="Saved" tone="success" onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: '✕' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('AlertBanner', () => {
  it.each([
    ['error', 'alert', 'border-red-200 bg-red-50', 'text-sm text-red-700'],
    ['success', 'status', 'border-green-200 bg-green-50', 'text-sm text-green-700'],
  ] as const)('renders the %s tone with role="%s"', (tone, role, panelClass, textClass) => {
    render(<AlertBanner tone={tone} message="Band not found." onDismiss={vi.fn()} />)

    const banner = screen.getByRole(role)
    expect(banner.className).toContain(panelClass)
    expect(screen.getByText('Band not found.').className).toBe(textClass)
  })

  it('appends the caller className and fires onDismiss', () => {
    const onDismiss = vi.fn()
    render(<AlertBanner tone="error" message="Boom" onDismiss={onDismiss} className="mb-6" />)

    expect(screen.getByRole('alert').className).toContain('mb-6')

    fireEvent.click(screen.getByRole('button', { name: '✕' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
