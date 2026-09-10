/**
 * RH-43 — Guard for the conventions AGENTS.md now writes down.
 *
 * Three sections of AGENTS.md — "Naming Conventions", "Module Layout" and
 * "Internationalisation" — describe what this tree already does. Most of those
 * claims are prose a reviewer has to read; the seven below are the ones a
 * machine can check, so they are checked here rather than asserted. Each claim
 * AGENTS.md tags `(guarded)` is one of the five in `naming conventions`; the
 * other two suites hold the server-only import rule that replaces the `.server`
 * suffix's broken promise (F24) and the i18n scope decision (F25).
 *
 * Every fact is computed from the source tree with `node:fs`, never from a
 * hardcoded answer, and no rule here carries an exception list: if a later task
 * needs one, the honest move is to change the rule in AGENTS.md and this file
 * together.
 *
 * Dictionary key parity between `en.json` and `pt-BR.json` is deliberately not
 * re-asserted here — `src/lib/__tests__/landingCopy.test.ts` already pins it.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { stripComments } from './test-helpers'
import { actionFileNames, allExportedActionNames } from '@/app/actions/__tests__/actionScan'

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const SRC_DIR = path.join(REPO_ROOT, 'src')
const LIB_DIR = path.join(SRC_DIR, 'lib')

/**
 * Every non-test `.ts`/`.tsx` file under `dir`, recursively and sorted.
 * `__tests__` directories are outside every scan in this file: the conventions
 * described here are about production source.
 */
function walk(dir: string): string[] {
  const files: string[] = []
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dirent.name === '__tests__') continue
    const full = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      files.push(...walk(full))
    } else if (/\.tsx?$/.test(dirent.name) && !/\.test\.tsx?$/.test(dirent.name)) {
      files.push(full)
    }
  }
  return files.sort()
}

/** A repo-relative, `/`-separated path, e.g. `src/lib/bands.ts`. */
function relativePath(full: string): string {
  return path.relative(REPO_ROOT, full).split(path.sep).join('/')
}

/** One file's source with comments blanked out, so prose never counts as code. */
function readSource(full: string): string {
  return stripComments(fs.readFileSync(full, 'utf8'))
}

/**
 * One `import` statement: whatever sits between the `import` keyword and the
 * quoted specifier, then the specifier. The clause may span several lines
 * (`import {\n  a,\n  b,\n} from '@/lib/annotationMath'`), and it may be empty
 * for a bare side-effect import (`import '@/lib/pdfWorker'`), which is why the
 * specifier is taken from the statement rather than from a `from` clause.
 */
const IMPORT_STATEMENT = /^import\b([^'"]*)['"]([^'"]+)['"]/gm

/** `@/lib/auth-client`, `@/lib/bands.server` — the module name, hyphens and dots included. */
const LIB_ALIAS = /^@\/lib\/([A-Za-z0-9_.-]+)$/

/** The same module named from inside `src/lib` itself: `@/lib/db` or `./db`. */
const LIB_NEIGHBOUR = /^(?:@\/lib\/|\.\/)([A-Za-z0-9_.-]+)$/

/**
 * The specifiers a source file imports **for their values**.
 *
 * An `import type { X } from '@/lib/y'` clause is not an edge in this graph:
 * TypeScript erases it before anything is bundled, so it cannot pull `pg` into
 * a client bundle — which is the invariant the module-layout rule is named
 * after. AGENTS.md states the same reading, in the words "imported for its
 * values".
 */
function valueImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  for (const match of source.matchAll(IMPORT_STATEMENT)) {
    if (!/^\s*type\s/.test(match[1])) specifiers.push(match[2])
  }
  return specifiers
}

/** Every module directly under `src/lib`, by the name `@/lib/...` refers to it by. */
function libModuleNames(): string[] {
  return fs
    .readdirSync(LIB_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.ts'))
    .map((dirent) => dirent.name.replace(/\.ts$/, ''))
    .sort()
}

/** The `src/lib` neighbours one module imports for their values, by module name. */
function libValueImportsOf(moduleName: string): string[] {
  const source = readSource(path.join(LIB_DIR, `${moduleName}.ts`))
  const names: string[] = []
  for (const specifier of valueImportSpecifiers(source)) {
    const match = LIB_NEIGHBOUR.exec(specifier)
    if (match) names.push(match[1])
  }
  return names
}

/**
 * The `src/lib` modules that reach `pg` when their values are imported.
 *
 * `db` is the root: it owns the pool. Any module that value-imports a member of
 * the set joins it, iterated to a fixed point, because one hop does not settle
 * the question — `spotifyRouteAuth.ts` imports no `@/lib/db` of its own and
 * reaches the pool only through `@/lib/bands`, and `auth-session.ts` and
 * `emailChange.ts` only through `@/lib/auth`.
 */
function serverOnlyModules(): Set<string> {
  const imports = new Map(libModuleNames().map((name) => [name, libValueImportsOf(name)]))
  const serverOnly = new Set(['db'])
  let growing = true
  while (growing) {
    growing = false
    for (const [name, neighbours] of imports) {
      if (serverOnly.has(name)) continue
      if (!neighbours.some((neighbour) => serverOnly.has(neighbour))) continue
      serverOnly.add(name)
      growing = true
    }
  }
  return serverOnly
}

/** Every non-test file under `src/` carrying the `'use client'` directive. */
function clientFiles(): string[] {
  return walk(SRC_DIR).filter((full) => /^\s*['"]use client['"]/m.test(readSource(full)))
}

describe('naming conventions', () => {
  it('every function exported from src/app/actions has a name ending in Action', () => {
    // `actionScan` matches `export async function` only, so the directory's one
    // type re-export (`export type { Stroke, TabAnnotations }`) is outside this
    // scan by construction — the rule is about function exports, as AGENTS.md says.
    const names = allExportedActionNames()
    expect(actionFileNames().length).toBeGreaterThan(0)
    expect(names.length).toBeGreaterThan(0)

    const violations = names.filter((name) => !name.endsWith('Action'))
    expect(
      violations,
      'Every function exported from src/app/actions is a Server Action and must ' +
        'end in `Action`, so a call site reads as a round trip to the server ' +
        '(AGENTS.md, "Naming Conventions"). Offending exports:\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('every file in src/hooks is use<Name>.ts exporting a function of the same name', () => {
    const hooksDir = path.join(SRC_DIR, 'hooks')
    const fileNames = fs.readdirSync(hooksDir).filter((name) => name.endsWith('.ts'))
    const violations: string[] = []

    for (const fileName of fileNames) {
      const match = /^(use[A-Z][A-Za-z0-9]*)\.ts$/.exec(fileName)
      if (!match) {
        violations.push(`src/hooks/${fileName} — filename is not use<Name>.ts`)
        continue
      }
      const declaration = new RegExp(`^export function ${match[1]}\\b`, 'm')
      if (!declaration.test(readSource(path.join(hooksDir, fileName)))) {
        violations.push(`src/hooks/${fileName} — no \`export function ${match[1]}\``)
      }
    }

    expect(fileNames.length).toBeGreaterThan(0)
    expect(
      violations,
      'A hook file is `use<Name>.ts` and exports `function use<Name>` ' +
        '(AGENTS.md, "Naming Conventions"). Offending files:\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('every component file under src/components is PascalCase.tsx', () => {
    const files = walk(path.join(SRC_DIR, 'components'))
    const violations = files
      .filter((full) => !/^[A-Z][A-Za-z0-9]*\.tsx$/.test(path.basename(full)))
      .map(relativePath)

    expect(files.length).toBeGreaterThan(0)
    expect(
      violations,
      'A component file is `PascalCase.tsx`, one component per file, named after ' +
        'the file (AGENTS.md, "Naming Conventions"). Offending files:\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('every exported interface in src/lib/dbRows.ts ends with Row', () => {
    const source = readSource(path.join(LIB_DIR, 'dbRows.ts'))
    const names = [...source.matchAll(/^export interface ([A-Za-z0-9_]+)/gm)].map((m) => m[1])
    const violations = names.filter((name) => !name.endsWith('Row'))

    expect(names.length).toBeGreaterThan(0)
    expect(
      violations,
      'A raw SQL projection declared in src/lib/dbRows.ts is named `<Subject>Row` ' +
        '(AGENTS.md, "Database Row Types"). Offending interfaces:\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('src/lib declares its exports as functions, never as arrow consts', () => {
    // Only a function-valued `export const` is a violation: a constant such as
    // `export const DEFAULT_LOCALE: Locale = 'pt-BR'` is not an export style at all.
    const functionValuedConst = /^export const .*=\s*(?:async\s*)?(?:\(|function\b)/
    const violations: string[] = []

    for (const moduleName of libModuleNames()) {
      const file = `src/lib/${moduleName}.ts`
      readSource(path.join(LIB_DIR, `${moduleName}.ts`))
        .split('\n')
        .forEach((line, index) => {
          if (functionValuedConst.test(line)) violations.push(`${file}:${index + 1} — ${line.trim()}`)
        })
    }

    expect(
      violations,
      'A `src/lib` module declares its API with `export function` / ' +
        '`export async function`, never `export const f = async () => {}` ' +
        '(AGENTS.md, "Naming Conventions"). RH-43 converted the last outlier, so ' +
        'this rule has no exceptions. Offending declarations:\n' +
        violations.join('\n'),
    ).toEqual([])
  })
})

describe('module layout', () => {
  it('no "use client" file imports a src/lib module that reaches @/lib/db', () => {
    const serverOnly = serverOnlyModules()
    const violations: string[] = []

    for (const full of clientFiles()) {
      for (const specifier of valueImportSpecifiers(readSource(full))) {
        const match = LIB_ALIAS.exec(specifier)
        if (match && serverOnly.has(match[1])) {
          violations.push(`${relativePath(full)} — ${specifier} (src/lib/${match[1]}.ts)`)
        }
      }
    }

    expect(
      violations,
      'A `src/lib` module that reaches `@/lib/db`, directly or through another ' +
        'module, pulls `pg` into whatever imports it, so a `\'use client\'` file ' +
        'must not import it for its values (AGENTS.md, "Module Layout"). A ' +
        '`import type` clause is erased before bundling and is not a violation. ' +
        `Server-only modules: ${[...serverOnly].sort().join(', ')}. Offending imports:\n` +
        violations.join('\n'),
    ).toEqual([])
  })
})

describe('i18n scope', () => {
  it('only the landing page reads copy from a dictionary', () => {
    // A call, not the declaration: `src/lib/i18n.ts` is where `getDictionary` is
    // written, and the lookbehind keeps that line out of the consumer set.
    const dictionaryCall = /(?<!function\s)\bgetDictionary\s*\(/
    const consumers = walk(SRC_DIR)
      .filter((full) => dictionaryCall.test(readSource(full)))
      .map(relativePath)

    expect(
      consumers,
      'i18n is scoped to the landing page: the application UI is English-only, ' +
        'written inline (AGENTS.md, "Internationalisation"). Do not add a ' +
        '`getDictionary` lookup outside src/components/landing/. Current ' +
        `consumers:\n${consumers.join('\n')}`,
    ).toEqual(['src/components/landing/LandingPage.tsx'])
  })
})
