/**
 * Shared source scanner for the two Server Action guard suites
 * (`actionAuthorizationGuard.test.ts` and `actionSessionGuard.test.ts`).
 *
 * Both need the same fact about the source tree — which `export async function`
 * declarations a `src/app/actions/*.ts` file carries, and what each body
 * contains — so the scan is written once here instead of being copy-pasted into
 * both suites (which `npm run lint:dup` would flag).
 */

import fs from 'fs'
import path from 'path'
import { stripComments } from '@/lib/__tests__/test-helpers'

/** Absolute path of `src/app/actions`. */
const ACTIONS_DIR = path.resolve(__dirname, '..')

/** Every `*.ts` file directly under `src/app/actions`, sorted, e.g. `bands.ts`. */
export function actionFileNames(): string[] {
  return fs
    .readdirSync(ACTIONS_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.ts'))
    .map((dirent) => dirent.name)
    .sort()
}

/** The raw (comment-preserving) source of one action file. */
export function readActionFile(fileName: string): string {
  return fs.readFileSync(path.join(ACTIONS_DIR, fileName), 'utf8')
}

/**
 * Maps every top-level `export async function` in one action file to its body.
 *
 * A top-level function body ends at the first line that is exactly `}` — true
 * for every file in this directory, and cheaper (and more predictable) than a
 * brace counter that has to reason about braces inside SQL template literals.
 * Comments are stripped first, so a name mentioned only in a comment never
 * counts as a call.
 */
export function exportedActionBodies(fileName: string): Map<string, string> {
  const lines = stripComments(readActionFile(fileName)).split('\n')
  const bodies = new Map<string, string>()

  for (let i = 0; i < lines.length; i++) {
    const declaration = /^export async function (\w+)/.exec(lines[i])
    if (!declaration) continue

    const body: string[] = []
    let j = i + 1
    while (j < lines.length && lines[j] !== '}') {
      body.push(lines[j])
      j++
    }
    bodies.set(declaration[1], body.join('\n'))
  }

  return bodies
}

/** Every exported action name across every action file, sorted. */
export function allExportedActionNames(): string[] {
  return actionFileNames()
    .flatMap((fileName) => [...exportedActionBodies(fileName).keys()])
    .sort()
}
