// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TabViewer } from '../TabViewer'

afterEach(cleanup)

describe('TabViewer', () => {
  it('shows a loading status over the gview iframe until it loads', () => {
    const { container } = render(
      <TabViewer url="https://blob.example/a.pdf" title="Riff" onOpenStage={vi.fn()} onClose={vi.fn()} />,
    )

    expect(screen.getByRole('status').textContent).toContain('Loading preview')
    fireEvent.load(container.querySelector('iframe[src*="docs.google.com"]') as HTMLIFrameElement)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
