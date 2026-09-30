// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CoverPicker } from '@/components/bands/CoverPicker'

afterEach(cleanup)

function renderPicker(props: { preview: string | null; processing: boolean }) {
  return render(
    <CoverPicker
      {...props}
      onChange={vi.fn()}
      boxClassName="w-12 h-12"
      inputClassName=""
      placeholder={<div data-testid="placeholder">🎸</div>}
    />,
  )
}

describe('CoverPicker', () => {
  it('shows the placeholder without a cover and the preview with one', () => {
    const { container, rerender } = renderPicker({ preview: null, processing: false })
    expect(screen.getByTestId('placeholder')).toBeDefined()

    rerender(
      <CoverPicker preview="blob:x" processing={false} onChange={vi.fn()} boxClassName="" inputClassName="" placeholder={null} />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:x')
  })

  it('shows a spinner and disables the input while the picked photo is processed', () => {
    const { container } = renderPicker({ preview: 'blob:x', processing: true })

    expect(screen.getByRole('status', { name: 'Processing image' }).querySelector('svg.animate-spin')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect((container.querySelector('input[type="file"]') as HTMLInputElement).disabled).toBe(true)
  })
})
