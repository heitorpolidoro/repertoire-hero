// @vitest-environment jsdom
/** RH-163 ER4/ER5 — the only CSP directive is frame-src for the nocookie embed and the gview origins. */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, cleanup } from '@testing-library/react'
import nextConfig from '../../../next.config'
import { TabViewer } from '../../components/fastview/TabViewer'

afterEach(cleanup)

async function cspValue() {
  const rules = (await nextConfig.headers?.()) ?? []
  expect(rules).toHaveLength(1)
  expect(rules[0].source).toBe('/:path*')
  const csp = rules[0].headers.filter((h) => h.key === 'Content-Security-Policy')
  expect(csp).toHaveLength(1)
  return csp[0].value
}

describe('next.config.ts headers', () => {
  it('sets Content-Security-Policy to exactly the nocookie and gview frame-src on all routes', async () => {
    const value = await cspValue()
    expect(value).toBe('frame-src https://www.youtube-nocookie.com https://docs.google.com')
    expect(value).not.toContain('*')
  })

  it('allows the origin of the GviewFrame iframe URL so the PDF preview keeps loading', async () => {
    const value = await cspValue()
    const allowed = value.replace('frame-src ', '').split(' ')
    const { container } = render(
      createElement(TabViewer, {
        url: 'https://blob.example/a.pdf',
        title: 'Riff',
        onOpenStage: vi.fn(),
        onClose: vi.fn(),
      }),
    )
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    expect(iframe).not.toBeNull()
    expect(allowed).toContain(new URL(iframe.getAttribute('src') as string).origin)
  })
})
