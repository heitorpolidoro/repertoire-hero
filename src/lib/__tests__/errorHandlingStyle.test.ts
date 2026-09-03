/**
 * RH-21 — Guardrail: no `any`-typed catch bindings anywhere in `src/`.
 *
 * AGENTS.md ("Error Handling Conventions") forbids annotating a catch binding
 * as `any`. Errors are narrowed instead — `error instanceof Error ? … : …` in
 * lib/action code, or a scoped structural cast (`(err as { code?: string })`)
 * when only a Postgres error code is needed. This test enforces that rule
 * mechanically so the style cannot silently regress.
 *
 * The detector strips comments before matching, so prose describing the banned
 * pattern does not trip it.
 *
 * Note: the offending literal is never written out in this file — every sample
 * is built by string concatenation — so a plain `grep` for the banned pattern
 * does not flag this file either.
 */

import { describe, it, expect } from 'vitest'
import { stripComments, findViolations, formatViolations } from './test-helpers'

const SELF = 'src/lib/__tests__/errorHandlingStyle.test.ts'

/** Matches a `catch` clause whose binding is annotated `: any`. */
const ANY_TYPED_CATCH = /catch\s*\(\s*[A-Za-z_$][A-Za-z0-9_$]*\s*:\s*any\s*\)/

/**
 * Returns one entry per line of `source` that declares an `any`-typed catch
 * binding. Each entry is the offending line, trimmed. Comments are ignored.
 */
export function findAnyTypedCatches(source: string): string[] {
  return stripComments(source)
    .split('\n')
    .filter((line) => ANY_TYPED_CATCH.test(line))
    .map((line) => line.trim())
}

// Built by concatenation so the literal banned text never appears in this file.
const ANY = 'any'
const ERR_SNIPPET = `} catch (err: ${ANY}) {`
const E_SNIPPET = `} catch (e: ${ANY}) {`
const NAMED_SNIPPET = `try { doThing() } catch (whateverName: ${ANY}) { report(whateverName) }`
const COMMENT_SNIPPET = `// never write catch (err: ${ANY}) — narrow instead`
const CLEAN_SNIPPET = `} catch (err) {`

describe('findAnyTypedCatches (detector)', () => {
  it('flags an `any`-typed catch binding named err', () => {
    expect(findAnyTypedCatches(ERR_SNIPPET)).toHaveLength(1)
  })

  it('flags an `any`-typed catch binding named e', () => {
    expect(findAnyTypedCatches(E_SNIPPET)).toHaveLength(1)
  })

  it('flags an `any`-typed catch binding with an arbitrary name', () => {
    expect(findAnyTypedCatches(NAMED_SNIPPET)).toHaveLength(1)
  })

  it('ignores the same text inside a line comment', () => {
    expect(findAnyTypedCatches(COMMENT_SNIPPET)).toEqual([])
  })

  it('ignores a properly narrowed catch clause', () => {
    expect(findAnyTypedCatches(CLEAN_SNIPPET)).toEqual([])
  })
})

describe('src/ tree', () => {
  it('contains no `any`-typed catch bindings', () => {
    const violations = formatViolations(findViolations(ANY_TYPED_CATCH, { skip: SELF }))

    expect(
      violations,
      `\`any\`-typed catch bindings are forbidden (see AGENTS.md, ` +
        `"Error Handling Conventions"). Narrow the error instead — ` +
        `\`error instanceof Error ? error : new Error(String(error))\`, or a ` +
        `scoped \`(err as { code?: string })\` when only a Postgres code is ` +
        `needed. Offending locations:\n` +
        violations.join('\n'),
    ).toEqual([])
  })
})
