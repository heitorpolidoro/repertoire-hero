/**
 * RH-16 — Guardrail: no native browser dialogs anywhere in `src/`.
 *
 * AGENTS.md ("UI & UX Behavioral Directives") forbids the native `alert` and
 * `confirm` dialogs:
 * every confirmation must be an in-page panel plus a floating Toast. This test
 * enforces that rule mechanically so the invariant cannot silently regress.
 *
 * The detector strips comments before matching, so prose mentioning the banned
 * calls (e.g. the JSX comment in `TabDrawingStage.tsx`) does not trip it.
 *
 * Note: the banned identifiers are never written adjacent to an opening
 * parenthesis in this file, so a plain `grep` for the offending pattern does not
 * flag this file either.
 */

import { describe, it, expect } from 'vitest'
import { stripComments, findViolations, formatViolations } from './test-helpers'

const SELF = 'src/lib/__tests__/noBrowserDialogs.test.ts'

/** Matches bare and `window.`-qualified invocations of `confirm` / `alert`. */
const DIALOG_CALL = /(?:^|[^A-Za-z0-9_$.])(?:window\s*\.\s*)?(?:confirm|alert)\s*\(/

/**
 * Returns one entry per line of `source` that invokes a native browser dialog.
 * Each entry is the offending line, trimmed. Comments are ignored.
 */
export function findBrowserDialogCalls(source: string): string[] {
  return stripComments(source)
    .split('\n')
    .filter((line) => DIALOG_CALL.test(line))
    .map((line) => line.trim())
}

// Built by concatenation so the literal banned text never appears next to `(`.
const OPEN = '('
const CONFIRM_SNIPPET = `if (!${'confirm'}${OPEN}'x')) return`
const ALERT_SNIPPET = `window.${'alert'}${OPEN}'x')`
const COMMENT_SNIPPET = `// no native ${'confirm'}${OPEN}) here`

describe('findBrowserDialogCalls (detector)', () => {
  it('flags a bare native confirmation call', () => {
    expect(findBrowserDialogCalls(CONFIRM_SNIPPET)).toHaveLength(1)
  })

  it('flags a window-qualified native dialog call', () => {
    expect(findBrowserDialogCalls(ALERT_SNIPPET)).toHaveLength(1)
  })

  it('ignores the same text inside a line comment', () => {
    expect(findBrowserDialogCalls(COMMENT_SNIPPET)).toEqual([])
  })

  it('ignores the same text inside a block comment', () => {
    expect(findBrowserDialogCalls(`/* ${CONFIRM_SNIPPET} */`)).toEqual([])
  })

  it('does not flag unrelated members with the same suffix', () => {
    expect(findBrowserDialogCalls(`dialog.${'confirm'}${OPEN})`)).toEqual([])
    expect(findBrowserDialogCalls(`onConfirm${OPEN})`)).toEqual([])
  })
})

describe('src/ tree', () => {
  it('contains no native browser dialog calls', () => {
    const violations = formatViolations(findViolations(DIALOG_CALL, { skip: SELF }))

    expect(
      violations,
      `Native browser dialogs are forbidden (see AGENTS.md). Use an in-page ` +
        `confirmation panel plus a Toast instead. Offending locations:\n` +
        violations.join('\n'),
    ).toEqual([])
  })
})
