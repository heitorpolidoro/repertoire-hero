/**
 * RH-20 — Guardrail: an erase is persisted in the same call that applies it.
 *
 * The bug this guards against: `eraseAt` used to remove the stroke from
 * `annotationsRef.current` and from React state immediately, but defer the
 * database write to the end of the pointer gesture via an
 * `erasedDuringGestureRef` flag. Every path that ends a gesture *without*
 * reaching `endPointer`'s erase branch — a second finger starting a pinch,
 * `lostpointercapture`, drawing toggled off mid-gesture — reset that flag with
 * no save, and the removal survived only in memory until the next reload.
 *
 * RH-5's Autosave paragraph already required the opposite: "Each stroke removed
 * by the eraser triggers the same debounced save path — there is no separate
 * 'erase save' mechanism." This test enforces that mechanically, at the source
 * level, because the vitest environment is `node` (see vitest.config.ts) and
 * cannot dispatch pointer events at a React component. It is written in the
 * style of the existing `noBrowserDialogs.test.ts` / `pdfWorkerAsset.test.ts`
 * source guards: the detector helpers are exported and unit-tested on synthetic
 * strings first, so a failure of the real assertion is trustworthy.
 *
 * Comments are stripped before matching, so prose (including this file's own
 * description of the banned pattern, and the explanatory comments inside the
 * component) can neither satisfy nor trip the guard.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const STAGE_COMPONENT = path.join(REPO_ROOT, 'src', 'components', 'tabs', 'TabDrawingStage.tsx')

/** The deferred-save flag this task removed. Built by concatenation so this constant is not itself an occurrence. */
const BANNED_IDENTIFIER = 'erasedDuring' + 'Gesture'

/**
 * An *assignment* to the persistent per-page model. Deliberately not a bare
 * `annotationsRef.current[` substring: `scheduleSave` and `flushSave` both read
 * that same expression to decide what to send, and a reader has nothing to lose.
 * The negative lookahead keeps `==` / `===` comparisons out.
 */
const ANNOTATION_WRITE = /annotationsRef\.current\[[^\]]*\]\s*=(?!=)/

/** The one and only way that write is turned into a database save. */
const SAVE_CALL = 'scheduleSave()'

/**
 * Removes `//` line comments and block comments from a source string.
 * Block comments become their own newlines so line numbers are preserved.
 * (Same approach as `noBrowserDialogs.test.ts`.)
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
}

/**
 * Returns the names of every function declared directly inside the component
 * body — i.e. at exactly two-space indentation, which is how every
 * component-inner function in `TabDrawingStage.tsx` is written. Module-level
 * helpers (zero indent) are deliberately excluded: they hold no refs.
 */
export function componentFunctionNames(source: string): string[] {
  return Array.from(source.matchAll(/^ {2}function ([A-Za-z0-9_$]+)\s*\(/gm)).map((m) => m[1])
}

/**
 * Returns the text of the component-inner function `name`: from the line
 * beginning `  function <name>(` through the first following line that is
 * exactly `  }` (the closing brace at the component-inner indent level).
 * Returns `null` when no such function is declared.
 */
export function sliceFunction(source: string, name: string): string | null {
  const lines = source.split('\n')
  const startPattern = new RegExp(`^ {2}function ${name}\\s*\\(`)
  const start = lines.findIndex((line) => startPattern.test(line))
  if (start === -1) return null
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '  }') {
      return lines.slice(start, i + 1).join('\n')
    }
  }
  return lines.slice(start).join('\n')
}

/**
 * The invariant: every component-inner function that writes the persistent
 * model (`annotationsRef.current[<page>] = ...`) must also schedule the save
 * in the same body. Returns the names of the functions that write without
 * saving — empty when the invariant holds.
 *
 * The declaration line is excluded before looking for the save call, so
 * `function scheduleSave() {` cannot exempt itself by containing its own name.
 */
export function findUnpersistedAnnotationWriters(source: string): string[] {
  const stripped = stripComments(source)
  const offenders: string[] = []
  for (const name of componentFunctionNames(stripped)) {
    const body = sliceFunction(stripped, name)
    if (!body) continue
    const inner = body.split('\n').slice(1).join('\n')
    if (ANNOTATION_WRITE.test(inner) && !inner.includes(SAVE_CALL)) {
      offenders.push(name)
    }
  }
  return offenders
}

// ---- Synthetic fixtures for the detector unit tests ----

/** The exact expression the component uses, as plain text, for the fixtures below. */
const WRITE_TARGET = 'annotationsRef.current[String(pageNumber)]'

const SYNTHETIC_COMPONENT = [
  'export default function Widget() {',
  '  function goodWriter() {',
  '    const next = [1]',
  `    ${WRITE_TARGET} = next`,
  `    ${SAVE_CALL}`,
  '  }',
  '',
  '  function badWriter() {',
  `    ${WRITE_TARGET} = []`,
  '    deferredFlag.current = true',
  '  }',
  '',
  '  function pureReader() {',
  `    return ${WRITE_TARGET} ?? []`,
  '  }',
  '',
  '  function innocentReader() {',
  '    if (x) {',
  '      return 1',
  '    }',
  '    return 0',
  '  }',
  '}',
].join('\n')

describe('stripComments (detector)', () => {
  it('removes a line comment', () => {
    expect(stripComments(`const a = 1 // ${WRITE_TARGET} = []`)).toBe('const a = 1 ')
  })

  it('removes a block comment while preserving line numbers', () => {
    const stripped = stripComments(`/*\n ${SAVE_CALL}\n*/\nconst a = 1`)
    expect(stripped).not.toContain(SAVE_CALL)
    expect(stripped.split('\n')).toHaveLength(4)
  })

  it('leaves real code untouched', () => {
    expect(stripComments(`  ${SAVE_CALL}`)).toBe(`  ${SAVE_CALL}`)
  })
})

describe('componentFunctionNames (detector)', () => {
  it('lists every function declared at the component-inner indent', () => {
    expect(componentFunctionNames(SYNTHETIC_COMPONENT)).toEqual([
      'goodWriter',
      'badWriter',
      'pureReader',
      'innocentReader',
    ])
  })

  it('ignores module-level functions at zero indent', () => {
    expect(componentFunctionNames('function moduleHelper() {\n}\n')).toEqual([])
  })
})

describe('sliceFunction (detector)', () => {
  it('returns the whole body and stops at the function\'s own closing brace', () => {
    const body = sliceFunction(SYNTHETIC_COMPONENT, 'goodWriter')
    expect(body).toContain(WRITE_TARGET)
    expect(body).toContain(SAVE_CALL)
    // Must not bleed into the next function.
    expect(body).not.toContain('badWriter')
  })

  it('does not stop at a nested closing brace at a deeper indent', () => {
    const body = sliceFunction(SYNTHETIC_COMPONENT, 'innocentReader')
    expect(body).toContain('return 0')
  })

  it('returns null for a function that does not exist', () => {
    expect(sliceFunction(SYNTHETIC_COMPONENT, 'noSuchFunction')).toBeNull()
  })
})

describe('findUnpersistedAnnotationWriters (detector)', () => {
  it('flags a function that writes the model without scheduling a save', () => {
    expect(findUnpersistedAnnotationWriters(SYNTHETIC_COMPONENT)).toEqual(['badWriter'])
  })

  it('does not flag a writer that schedules the save in the same body', () => {
    const onlyGood = SYNTHETIC_COMPONENT.replace(
      '    deferredFlag.current = true',
      `    ${SAVE_CALL}`,
    )
    expect(findUnpersistedAnnotationWriters(onlyGood)).toEqual([])
  })

  it('is not satisfied by a save call that only appears in a comment', () => {
    const commentedSave = SYNTHETIC_COMPONENT.replace(
      '    deferredFlag.current = true',
      `    // the caller does ${SAVE_CALL} later`,
    )
    expect(findUnpersistedAnnotationWriters(commentedSave)).toEqual(['badWriter'])
  })

  it('does not flag a function that only reads the model', () => {
    // `pureReader` mirrors the real `flushSave` / `scheduleSave`, which read
    // `annotationsRef.current[...]` to decide what to send. A reader changes
    // nothing and so has nothing to lose.
    expect(findUnpersistedAnnotationWriters(SYNTHETIC_COMPONENT)).not.toContain('pureReader')
  })

  it('is not satisfied by a function whose declaration line merely contains the save call name', () => {
    // Guards the self-exemption trap: `function scheduleSave() {` contains the
    // literal `scheduleSave()`, so the declaration line must be excluded.
    const selfNamed = SYNTHETIC_COMPONENT.replace('  function badWriter() {', '  function scheduleSave() {')
    expect(findUnpersistedAnnotationWriters(selfNamed)).toEqual(['scheduleSave'])
  })
})

describe('TabDrawingStage — every applied erase is persisted (RH-20)', () => {
  const source = fs.readFileSync(STAGE_COMPONENT, 'utf8')
  const stripped = stripComments(source)

  it('has no deferred-erase-save flag left in the code', () => {
    expect(
      stripped.includes(BANNED_IDENTIFIER),
      `The \`${BANNED_IDENTIFIER}Ref\` deferred-save mechanism must not be reintroduced ` +
        `(RH-20): every gesture-abort path resets it without saving, so the erase is lost. ` +
        `Persist inside \`eraseAt\` with ${SAVE_CALL} instead.`,
    ).toBe(false)
  })

  it('persists inside eraseAt rather than at the end of the gesture', () => {
    const body = sliceFunction(stripped, 'eraseAt')
    expect(body, 'eraseAt is no longer a component-inner function declaration').not.toBeNull()
    expect(
      body,
      `eraseAt must call ${SAVE_CALL} on every removal — an erase is destructive the ` +
        `moment it is applied, and deferring the save loses it whenever the gesture is aborted.`,
    ).toContain(SAVE_CALL)
  })

  it('reads the erased page from the same source of truth the save path reads', () => {
    const body = sliceFunction(stripped, 'eraseAt') ?? ''
    expect(
      body,
      'eraseAt must READ the page strokes from annotationsRef.current[String(pageNumber)] — ' +
        'the `strokes` state closure can be stale across two erase hits in one fast drag, ' +
        'and the second write would resurrect the first removal. (The expression must appear ' +
        'on the right-hand side of an assignment, not only as the write target.)',
    ).toMatch(/=\s*annotationsRef\.current\[String\(pageNumber\)\]/)
  })

  it('has no component-inner function that writes annotations without scheduling a save', () => {
    const offenders = findUnpersistedAnnotationWriters(source)
    expect(
      offenders,
      `These functions assign annotationsRef.current[...] but never call ${SAVE_CALL} in the ` +
        `same body, so their change to the persistent model can be lost: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('covers the four known model-mutating functions, so the invariant is not vacuous', () => {
    for (const name of ['commitStroke', 'eraseAt', 'handleUndo', 'handleClearConfirm']) {
      const body = sliceFunction(stripped, name)
      expect(body, `${name} is missing from TabDrawingStage.tsx`).not.toBeNull()
      expect(body ?? '', `${name} no longer assigns annotationsRef.current[...]`).toMatch(ANNOTATION_WRITE)
    }
  })
})
