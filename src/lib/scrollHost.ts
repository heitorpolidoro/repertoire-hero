/**
 * Scroll-host helpers for a full-screen overlay (RH-28 section 3).
 *
 * DOM-only: no React, no App Router import. The overlay's controller resolves
 * its host from its own ref and freezes it while the overlay is up; `body` is
 * never touched, because in a `flex h-screen` shell `body` is not what scrolls.
 */

/**
 * Nearest scrollable DOM ancestor of `node`, resolved by computed overflow
 * rather than by tag name: the Fast View page contains two <main> elements —
 * the app shell's (AppLayout, `flex-1 overflow-y-auto`, which really scrolls)
 * and the page's own (`min-h-screen`, which never does) — and only the former
 * may be scroll-locked while PDF Stage Mode is open.
 */
export function findScrollHost(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY
    if (oy === 'auto' || oy === 'scroll') return el
  }
  return null
}

/**
 * Freezes `host`'s inline overflow at 'hidden' and returns the restore closure,
 * which writes the previous inline value back verbatim. A null host yields a
 * no-op restore.
 */
export function lockScrollHost(host: HTMLElement | null): () => void {
  if (!host) return () => {}
  const previousOverflow = host.style.overflow
  host.style.overflow = 'hidden'
  return () => {
    // Restored verbatim, so an element that had no inline overflow goes back
    // to having none (computing to `auto`) rather than being frozen.
    host.style.overflow = previousOverflow
  }
}
