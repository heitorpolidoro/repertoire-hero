// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { findScrollHost, lockScrollHost } from '@/lib/scrollHost'

afterEach(() => {
  document.body.innerHTML = ''
})

/** Appends a chain of divs to `document.body` and returns them outermost first. */
function chain(...overflows: (string | null)[]): HTMLDivElement[] {
  const created: HTMLDivElement[] = []
  let parent: HTMLElement = document.body
  for (const overflowY of overflows) {
    const el = document.createElement('div')
    if (overflowY) el.style.overflowY = overflowY
    parent.appendChild(el)
    created.push(el)
    parent = el
  }
  return created
}

describe('findScrollHost', () => {
  it('findScrollHost returns the nearest ancestor whose computed overflow-y is auto', () => {
    const [outer, inner, node] = chain('auto', 'auto', null)

    expect(findScrollHost(node)).toBe(inner)
    expect(findScrollHost(node)).not.toBe(outer)
  })

  it('findScrollHost accepts an ancestor whose computed overflow-y is scroll', () => {
    const [host, node] = chain('scroll', null)

    expect(findScrollHost(node)).toBe(host)
  })

  it('findScrollHost skips ancestors that are not scrollable and returns the outer one', () => {
    // The real shape: the app shell's scrolling <main> wraps the page's own
    // non-scrolling one, which wraps the overlay.
    const [shell, page, node] = chain('auto', 'visible', null)

    expect(findScrollHost(node)).toBe(shell)
    expect(findScrollHost(node)).not.toBe(page)
  })

  it('findScrollHost returns null when no ancestor scrolls', () => {
    const [, node] = chain('visible', 'hidden')

    expect(findScrollHost(node)).toBeNull()
  })

  it('findScrollHost returns null for a null node', () => {
    expect(findScrollHost(null)).toBeNull()
  })

  it('findScrollHost never returns the node itself', () => {
    const [host, node] = chain('auto', 'auto')

    expect(findScrollHost(node)).toBe(host)
    expect(findScrollHost(node)).not.toBe(node)
  })
})

describe('lockScrollHost', () => {
  it('lockScrollHost hides the host overflow and restores the previous inline value verbatim', () => {
    const [host] = chain('auto')
    host.style.overflow = 'auto'
    const previous = host.style.overflow

    const release = lockScrollHost(host)
    expect(host.style.overflow).toBe('hidden')

    release()
    expect(host.style.overflow).toBe(previous)
  })

  it('lockScrollHost restores an empty inline overflow rather than freezing the host', () => {
    const [host] = chain(null)
    expect(host.style.overflow).toBe('')

    const release = lockScrollHost(host)
    expect(host.style.overflow).toBe('hidden')

    release()
    expect(host.style.overflow).toBe('')
    expect(host.getAttribute('style')).not.toContain('hidden')
  })

  it('lockScrollHost is a no-op for a null host', () => {
    const release = lockScrollHost(null)

    expect(typeof release).toBe('function')
    expect(() => release()).not.toThrow()
  })
})
