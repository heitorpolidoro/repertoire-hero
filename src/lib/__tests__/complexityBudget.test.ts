/**
 * F20/RH-39 — the complexity budget is a ratchet, and this is what makes it bite.
 *
 * `eslint.config.mjs` declares `complexity`, `max-depth`, `max-lines-per-function`,
 * `max-params` and `max-lines` as errors for everything under `src`, plus a
 * looser (documented, not exempt) budget for test files and a per-file override
 * list for the files that were already over budget when the rules landed.
 *
 * No CI job runs eslint, so the rules alone would be invisible. This test lints
 * all of `src` through the real config with the ESLint Node API and fails if:
 *   a) the base or test budget drifts from the declared thresholds;
 *   b) the override list grows past MAX_OVERRIDES, or points at a file that no
 *      longer exists;
 *   c) an override relaxes something other than the five budget rules, or
 *      relaxes below the base threshold;
 *   d) any budget rule is actually violated anywhere under `src`;
 *   e) an override ceiling is not exactly its file's current worst number —
 *      which is what forces the list to shrink as files get fixed, and what
 *      catches an override added for a file that never needed one.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { ESLint } from 'eslint'
import type { Linter } from 'eslint'
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(__dirname, '../../..')

const BUDGET_RULES = [
  'complexity',
  'max-depth',
  'max-lines-per-function',
  'max-params',
  'max-lines',
] as const
type BudgetRule = (typeof BUDGET_RULES)[number]

const BASE: Record<BudgetRule, number> = {
  complexity: 15,
  'max-depth': 4,
  'max-lines-per-function': 200,
  'max-params': 4,
  'max-lines': 400,
}

// The override list is a ratchet. Lower this number when an override is
// removed; never raise it.
const MAX_OVERRIDES = 21

type ConfigEntry = {
  name?: string
  files?: string[]
  rules?: Record<string, unknown>
}

let configPromise: Promise<ConfigEntry[]> | undefined

/**
 * Load the real `eslint.config.mjs`. The specifier is computed at runtime, so
 * Vite hands the import straight to Node instead of trying to transform it.
 *
 * RH-59: the import is memoized so it is issued at most once per worker. It
 * pulls the whole `eslint-config-next` module graph through Node's ESM loader
 * (~0.7-1.2 s cold, unloaded), and whichever test ran first was charged the
 * entire bill — 4469 ms of a 5000 ms default budget in a measured full-suite
 * run. The hook below pays it once, off any single test's clock.
 */
function loadConfig(): Promise<ConfigEntry[]> {
  configPromise ??= (async () => {
    const href = pathToFileURL(resolve(ROOT, 'eslint.config.mjs')).href
    const mod = (await import(/* @vite-ignore */ href)) as { default: ConfigEntry[] }
    return mod.default
  })()
  return configPromise
}

async function loadOverrides(): Promise<ConfigEntry[]> {
  const config = await loadConfig()
  return config.filter(entry => entry?.name === 'complexity-budget/override')
}

/** `[id]` is a character class in a glob, so overrides escape it. Disk paths do not. */
function toDiskPath(glob: string): string {
  return glob.replace(/\\/g, '')
}

function ceilingOf(value: unknown): number {
  return (value as [string, number])[1]
}

describe('complexity budget (F20)', () => {
  // RH-59: pay the `eslint.config.mjs` import here, not inside whichever test
  // happens to run first. Measured cost: ~1.2 s isolated, 2.0-4.5 s under
  // full-suite parallel load (17.6 s for the ESLint runs under artificial CPU
  // contention), against a 5000 ms default per-test timeout — a 1.1x margin
  // that made this healthy guard flake. 60 s restores a ~13x margin.
  beforeAll(async () => {
    await loadConfig()
  }, 60_000)

  it('sets the base budget for src at complexity 15, max-depth 4, max-lines-per-function 200, max-params 4 and max-lines 400', async () => {
    const config = await loadConfig()
    const base = config.find(entry => entry?.name === 'complexity-budget/base')

    expect(base, 'eslint.config.mjs has no "complexity-budget/base" block').toBeDefined()
    expect([...(base?.files ?? [])].sort()).toEqual(['src/**/*.ts', 'src/**/*.tsx'])
    expect(base?.rules).toEqual({
      complexity: ['error', BASE.complexity],
      'max-depth': ['error', BASE['max-depth']],
      'max-lines-per-function': ['error', BASE['max-lines-per-function']],
      'max-params': ['error', BASE['max-params']],
      'max-lines': ['error', BASE['max-lines']],
    })
  }, 60_000)

  it('relaxes the budget for test files to max-lines-per-function off and max-lines 800', async () => {
    const config = await loadConfig()
    const tests = config.find(entry => entry?.name === 'complexity-budget/tests')

    expect(tests, 'eslint.config.mjs has no "complexity-budget/tests" block').toBeDefined()
    expect([...(tests?.files ?? [])].sort()).toEqual([
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/__tests__/**',
    ])
    expect(tests?.rules).toEqual({
      'max-lines-per-function': 'off',
      'max-lines': ['error', 800],
    })
  }, 60_000)

  it('lists at most 21 per-file overrides, each naming a file that exists', async () => {
    const overrides = await loadOverrides()

    // `<=`, not `===`: fixing a file and deleting its override must not fail
    // the guard. Growth past the bound is what must fail.
    expect(
      overrides.length,
      `the override list is a ratchet and may only shrink: ${overrides.length} entries, at most ${MAX_OVERRIDES} allowed`,
    ).toBeLessThanOrEqual(MAX_OVERRIDES)

    const missing: string[] = []
    for (const entry of overrides) {
      expect(entry.files, `override ${JSON.stringify(entry)} must name exactly one file`).toHaveLength(1)
      const glob = entry.files?.[0] ?? ''
      if (!existsSync(resolve(ROOT, toDiskPath(glob)))) missing.push(glob)
    }
    expect(missing, `override targets that do not exist on disk: ${missing.join(', ')}`).toEqual([])
  }, 60_000)

  it('relaxes only the five budget rules, and never below the base threshold', async () => {
    const overrides = await loadOverrides()
    const offenders: string[] = []

    for (const entry of overrides) {
      const file = entry.files?.[0] ?? '(no file)'
      for (const [rule, value] of Object.entries(entry.rules ?? {})) {
        if (!(BUDGET_RULES as readonly string[]).includes(rule)) {
          offenders.push(`${file}: ${rule} is not a budget rule`)
          continue
        }
        if (!Array.isArray(value) || value[0] !== 'error' || typeof value[1] !== 'number') {
          offenders.push(`${file}: ${rule} must be ["error", n], got ${JSON.stringify(value)}`)
          continue
        }
        if (value[1] <= BASE[rule as BudgetRule]) {
          offenders.push(
            `${file}: ${rule} ceiling ${value[1]} is not above the base budget ${BASE[rule as BudgetRule]}`,
          )
        }
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  }, 60_000)

  it('reports no budget violation anywhere under src', async () => {
    const eslint = new ESLint({ cwd: ROOT })
    const results = await eslint.lintFiles(['src'])

    const violations: string[] = []
    for (const result of results) {
      for (const message of result.messages) {
        if (message.ruleId && (BUDGET_RULES as readonly string[]).includes(message.ruleId)) {
          violations.push(`${relative(ROOT, result.filePath)}: ${message.ruleId}`)
        }
      }
    }

    expect(violations, `budget violations under src:\n${violations.join('\n')}`).toEqual([])
  }, 120_000)

  it('pins every override ceiling to the current worst number in its file', async () => {
    const overrides = await loadOverrides()

    // Tighten every override by one and demand that each (file, rule) pair then
    // reports. Combined with the previous test (clean at the ceiling) this
    // proves the ceiling is exactly the file's current worst number.
    const tightened = overrides.map(entry => ({
      files: [entry.files?.[0] ?? ''],
      rules: Object.fromEntries(
        Object.entries(entry.rules ?? {}).map(([rule, value]) => [rule, ['error', ceilingOf(value) - 1]]),
      ),
    }))
    const expected = overrides.flatMap(entry =>
      Object.keys(entry.rules ?? {}).map(rule => `${toDiskPath(entry.files?.[0] ?? '')}: ${rule}`),
    )

    const eslint = new ESLint({
      cwd: ROOT,
      overrideConfig: tightened as unknown as Linter.Config[],
    })
    const results = await eslint.lintFiles(overrides.map(entry => toDiskPath(entry.files?.[0] ?? '')))

    const reported = new Set<string>()
    for (const result of results) {
      for (const message of result.messages) {
        if (message.ruleId) reported.add(`${relative(ROOT, result.filePath)}: ${message.ruleId}`)
      }
    }

    const slack = expected.filter(pair => !reported.has(pair))
    expect(
      slack,
      `override ceilings looser than the file's current worst number (fix or drop them):\n${slack.join('\n')}`,
    ).toEqual([])
  }, 120_000)
})
