// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PendingButton } from '@/components/ui/PendingButton'

afterEach(cleanup)

describe('PendingButton', () => {
  it('shows the label and forwards clicks while idle', () => {
    const onClick = vi.fn()
    render(<PendingButton pending={false} label="Create" pendingLabel="Creating…" onClick={onClick} />)

    const button = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disables itself and shows a spinner with the pending label while pending', () => {
    const onClick = vi.fn()
    render(<PendingButton pending label="Create" pendingLabel="Creating…" onClick={onClick} />)

    const button = screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.querySelector('svg.animate-spin')).not.toBeNull()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
