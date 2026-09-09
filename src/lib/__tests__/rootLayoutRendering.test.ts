/**
 * RH-61 — Guardrail: the root layout declares no rendering mode.
 *
 * `src/app/layout.tsx` is the only layout in the tree, so a rendering-mode
 * export there is a global switch: it opts every single route out of static
 * prerendering, including the public marketing page at `/` and the four auth
 * pages (`/login`, `/signup`, `/forgot-password`, `/reset-password`). None of
 * those reads per-request state — the layout is a synchronous component that
 * touches no cookies, no headers and no dynamic server API — so the switch cost
 * a prerendered document on every public route and bought nothing.
 *
 * The routes that genuinely need per-request rendering are dynamic by
 * construction and need no directive: the `/api/**` handlers read the request,
 * `/join/[code]` awaits its params and resolves a session, and `/bands/[id]`,
 * `/playlists/[id]` and `/songs/[id]/fast-view` carry a dynamic segment with no
 * `generateStaticParams`. The one segment that declares the mode explicitly is
 * the dev-only profiles handler, which 404s outside development on the value of
 * `NODE_ENV` at request time — hence the allowlist below.
 *
 * The allowlist may be extended deliberately by a later task for a segment that
 * really does need per-request rendering, but `src/app/layout.tsx` may never be
 * in it: a directive there is global again, whatever the intent.
 *
 * The banned literal is never written out in this file — it is built by string
 * concatenation, as `errorHandlingStyle.test.ts` and `transactionGuard.test.ts`
 * do — so a plain `grep` over `src/` reports only the real occurrence.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { stripComments, findViolations } from './test-helpers'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const ROOT_LAYOUT = 'src/app/layout.tsx'
const SELF = 'src/lib/__tests__/rootLayoutRendering.test.ts'

// Built by concatenation so the literal banned text never appears in this file.
const DIRECTIVE = 'force-' + 'dynamic'
const DIRECTIVE_PATTERN = new RegExp(DIRECTIVE)

/** Matches a segment-config export that pins the rendering mode. */
const RENDER_MODE_EXPORT = /export\s+const\s+(dynamic|revalidate)\b/

/**
 * The only files allowed to pin their rendering mode. A later task may add a
 * segment here on measured evidence; the root layout never qualifies.
 */
const ALLOWED_TO_OPT_OUT = ['src/app/api/dev/profiles/route.ts']

const OFFENDING_SAMPLE = `export const dynamic = "${DIRECTIVE}"`
const CLEAN_SAMPLE = 'export const metadata: Metadata = { title: "Repertoire Hero" }'

describe('the rendering-mode detectors', () => {
  it('match a segment-config directive and ignore an ordinary layout export', () => {
    expect(RENDER_MODE_EXPORT.test(OFFENDING_SAMPLE)).toBe(true)
    expect(DIRECTIVE_PATTERN.test(OFFENDING_SAMPLE)).toBe(true)
    expect(RENDER_MODE_EXPORT.test(CLEAN_SAMPLE)).toBe(false)
    expect(DIRECTIVE_PATTERN.test(CLEAN_SAMPLE)).toBe(false)
  })
})

describe('src/app/layout.tsx', () => {
  it('pins no rendering mode for the whole app', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, ROOT_LAYOUT), 'utf8')
    const offending = stripComments(source)
      .split('\n')
      .filter((line) => RENDER_MODE_EXPORT.test(line) || DIRECTIVE_PATTERN.test(line))
      .map((line) => line.trim())

    expect(
      offending,
      `The root layout is the only layout in the tree, so a \`dynamic\` or ` +
        `\`revalidate\` export here opts every route — including the public ` +
        `landing page and the four auth pages — out of static prerendering. ` +
        `Put the directive on the segment that actually reads per-request ` +
        `state instead. Offending lines:\n` +
        offending.join('\n'),
    ).toEqual([])
  })
})

describe('src/ tree', () => {
  it('opts out of static rendering only in the allowlisted segment', () => {
    const files = [
      ...new Set(findViolations(DIRECTIVE_PATTERN, { skip: SELF }).map((v) => v.file)),
    ].sort()

    expect(
      files,
      `Only ${ALLOWED_TO_OPT_OUT.join(', ')} may opt out of static rendering. ` +
        `Extending this allowlist is a deliberate decision for a segment that ` +
        `genuinely needs per-request rendering — the root layout never ` +
        `qualifies, because it applies to every route. Found:\n` +
        files.join('\n'),
    ).toEqual(ALLOWED_TO_OPT_OUT)
  })
})
