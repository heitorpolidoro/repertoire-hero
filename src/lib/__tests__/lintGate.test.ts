/**
 * RH-129 — `npm run lint` is a binary signal again, and this is what keeps it
 * one.
 *
 * The baseline this task cleared (8 errors and 9 warnings across 11 files) grew
 * because nothing failed on it: `npm run lint` was a bare `eslint`, which exits
 * 0 on warnings, and no CI job ran it at all. Clearing the findings without a
 * gate would just restart the clock, so this guard asserts the *clean state*
 * rather than the diff — and asserts it four ways, because "lint is green" can
 * be faked at four different layers:
 *
 *   a) the findings themselves — a whole-project ESLint run must report no
 *      message of ANY severity. Severity 1 fails here exactly like severity 2,
 *      which makes this half independent of `--max-warnings=0`; and because it
 *      runs inside the existing `Coverage (vitest)` CI job, it bites in CI even
 *      if the lint job of §E.2 is ever deleted.
 *   b) the RESOLVED SEVERITIES, via `calculateConfigForFile`. This is the half
 *      that must not be a text scan of `eslint.config.mjs`. Review proved the
 *      hole: inserting the single line `"react-hooks/set-state-in-effect": 0`
 *      into an existing `rules` block takes the baseline from 8 errors to 4
 *      while every plausible text assertion (two `"off"` literals, zero
 *      `"warn"`, 18 `rules: {` blocks) stays true — ESLint accepts `0` as a
 *      severity and grep cannot see a number. `calculateConfigForFile` answers
 *      with the last-wins resolution of the whole array, so it is blind to how
 *      a severity was spelled, to which config object wrote it, and to whether
 *      that object's `rules` were spread in from another module.
 *   c) the RESOLVED FILE UNIVERSE. A severity says nothing about a file that
 *      left the run, so every git-tracked lintable path must come back with a
 *      result. This is what closes `globalIgnores`, a config object's own
 *      `ignores:` key, a bare `{ ignores: [...] }` object and moving a source
 *      file under an already-ignored glob.
 *   d) a text read, but only where text IS the thing: the `lint` script's CLI
 *      escapes, `eslint.config.mjs`'s imports / `process.env` /
 *      `linterOptions`, and whole-file `eslint-disable` block comments. A
 *      `linterOptions` key is not a rule declaration, so lowering
 *      `reportUnusedDisableDirectives` through it would leave every resolved
 *      severity in half (b) untouched.
 *
 * Deliberately NOT re-asserted here: the `rules` objects and sorted `files`
 * arrays of `complexity-budget/base` and `complexity-budget/tests`.
 * `src/lib/__tests__/complexityBudget.test.ts:112`/`:113` and `:127`/`:132`
 * already pin both by `toEqual` — which is also what closes "narrow a budget
 * block's glob until it matches nothing". Duplicating them would mean two files
 * to update on the next legitimate budget change.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { ESLint } from 'eslint'
import type { Linter } from 'eslint'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(__dirname, '../../..')

/** The extensions eslint flat config picks up in this repository. */
const LINTABLE = /\.(?:js|jsx|mjs|cjs|ts|tsx)$/

/**
 * The rule ids `eslint.config.mjs` declares in its OWN config objects — the
 * exported array minus the two vendored `eslint-config-next` spreads. An eighth
 * id fails whatever it is set to: a rule the repository did not declare
 * yesterday and declares today is either a new budget (which belongs in
 * `complexityBudget.test.ts`) or a downgrade in disguise.
 *
 * The preset is never walked. It contributes 87 rule entries across 66 unique
 * rules, 38 of them `warn` and 5 `off`, so a blanket "nothing is off anywhere"
 * assertion would fail on its first run. The three rules inherited from it that
 * this task cares about are probed by name below instead.
 */
const DECLARED_RULE_IDS = [
  '@typescript-eslint/no-explicit-any',
  'complexity',
  'max-depth',
  'max-lines',
  'max-lines-per-function',
  'max-params',
  'no-restricted-imports',
]

/** The six component/page files whose `set-state-in-effect` / `<a href>` findings RH-129 cleared. */
const TOUCHED_COMPONENTS = [
  'src/app/profile/page.tsx',
  'src/app/reset-password/page.tsx',
  'src/app/settings/page.tsx',
  'src/components/landing/LandingPage.tsx',
  'src/components/layout/AppLayout.tsx',
  'src/components/layout/LanguageSelector.tsx',
]

/** All eleven files that carried a finding in the RH-129 baseline. */
const BASELINE_FILES = [
  'e2e/global-setup.ts',
  'scripts/migrate.mjs',
  ...TOUCHED_COMPONENTS,
  'src/lib/__tests__/edge_cases.test.ts',
  'src/lib/__tests__/errors.test.ts',
  'src/lib/__tests__/i18n.test.ts',
]

/** The only module specifiers `eslint.config.mjs` may import. */
const ALLOWED_CONFIG_IMPORTS = [
  'eslint-config-next/core-web-vitals',
  'eslint-config-next/typescript',
  'eslint/config',
]

/** CLI escapes that would let `eslint` report a finding without failing, or lint something else. */
const FORBIDDEN_LINT_FLAGS = [
  '--quiet',
  '|| true',
  '--no-error-on-unmatched-pattern',
  '--ignore-pattern',
  '--config',
  '--rulesdir',
  '--flag',
]

type ConfigEntry = { name?: string; files?: string[]; rules?: Record<string, unknown> }

const ESLINT_TIMEOUT = 120_000

let eslintInstance: ESLint | undefined
/** One instance for both halves (a) and (b), so the config is resolved once. */
function linter(): ESLint {
  eslintInstance ??= new ESLint({ cwd: ROOT })
  return eslintInstance
}

let resultsPromise: Promise<ESLint.LintResult[]> | undefined
/** Memoized: the whole-project run is the expensive part, and halves (a) and (c) share it. */
function lintProject(): Promise<ESLint.LintResult[]> {
  resultsPromise ??= linter().lintFiles(['.'])
  return resultsPromise
}

let ownObjectsPromise: Promise<ConfigEntry[]> | undefined
/**
 * The repository's own config objects. `eslint.config.mjs` and the two presets
 * are imported through Node's ESM loader from runtime-computed specifiers, so
 * Vite hands them straight to Node instead of transforming them — the same
 * trick `complexityBudget.test.ts` uses. The slice length is derived from the
 * presets' actual lengths rather than hardcoded, so vendoring a different
 * `eslint-config-next` cannot silently shift the window.
 */
function loadOwnConfigObjects(): Promise<ConfigEntry[]> {
  ownObjectsPromise ??= (async () => {
    const req = createRequire(resolve(ROOT, 'package.json'))
    const load = async (href: string): Promise<ConfigEntry[]> =>
      ((await import(/* @vite-ignore */ href)) as { default: ConfigEntry[] }).default
    const exported = await load(pathToFileURL(resolve(ROOT, 'eslint.config.mjs')).href)
    const presets = await Promise.all(
      ['eslint-config-next/core-web-vitals', 'eslint-config-next/typescript'].map(spec =>
        load(pathToFileURL(req.resolve(spec)).href)
      )
    )
    return exported.slice(presets[0].length + presets[1].length)
  })()
  return ownObjectsPromise
}

async function resolvedRules(file: string): Promise<Record<string, unknown>> {
  const config = (await linter().calculateConfigForFile(file)) as Linter.Config | undefined
  expect(config?.rules, `calculateConfigForFile returned no rules for ${file}`).toBeDefined()
  return (config?.rules ?? {}) as Record<string, unknown>
}

/**
 * The normalised severity of a resolved rule entry. `calculateConfigForFile`
 * always answers in array form with a numeric severity (`[2, 15]`, never
 * `["error", 15]`), so this is a read and not a translation.
 *
 * An undeclared rule returns the `'undeclared'` sentinel rather than `0` or
 * `undefined`: a rule that stopped resolving is a different failure from a rule
 * set to `off`, and coercing the two together would hide the case where an
 * `ignores:` key is added to a config object that also has a `files` key — the
 * file stays in the run, so half (c) cannot see it, and every budget rule
 * quietly resolves to nothing.
 */
function severityOf(entry: unknown): unknown {
  if (entry === undefined) return 'undeclared'
  return Array.isArray(entry) ? entry[0] : entry
}

function readRepoFile(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
}

describe('lint gate (RH-129)', () => {
  // The whole-project run costs seconds, not milliseconds. Pay it once here,
  // off any single test's clock, exactly as complexityBudget.test.ts does.
  beforeAll(async () => {
    await lintProject()
    await loadOwnConfigObjects()
  }, ESLINT_TIMEOUT)

  describe('(a) the findings', () => {
    it('reports no eslint message of any severity anywhere in the project', async () => {
      const results = await lintProject()

      const findings = results.flatMap(result =>
        result.messages.map(
          message =>
            `${relative(ROOT, result.filePath)}:${message.line} [severity ${message.severity}] ` +
            `${message.ruleId ?? 'no-rule'} — ${message.message.split('\n')[0]}`
        )
      )

      expect(findings, `eslint findings (any severity is a failure):\n${findings.join('\n')}`).toEqual([])
    }, ESLINT_TIMEOUT)
  })

  describe('(b) the resolved severities', () => {
    it('keeps react-hooks/set-state-in-effect and @next/next/no-html-link-for-pages at severity 2 on every touched file', async () => {
      for (const file of TOUCHED_COMPONENTS) {
        const rules = await resolvedRules(file)
        expect(
          severityOf(rules['react-hooks/set-state-in-effect']),
          `react-hooks/set-state-in-effect on ${file}`
        ).toBe(2)
        expect(
          severityOf(rules['@next/next/no-html-link-for-pages']),
          `@next/next/no-html-link-for-pages on ${file}`
        ).toBe(2)
      }
    }, ESLINT_TIMEOUT)

    it('keeps @typescript-eslint/no-unused-vars at severity 1, never 0, on every baseline file', async () => {
      for (const file of BASELINE_FILES) {
        const rules = await resolvedRules(file)
        expect(
          severityOf(rules['@typescript-eslint/no-unused-vars']),
          `@typescript-eslint/no-unused-vars on ${file}`
        ).toBe(1)
      }
    }, ESLINT_TIMEOUT)

    it('declares exactly seven rule ids in its own config objects, and no eighth', async () => {
      const own = await loadOwnConfigObjects()

      const declared = new Set<string>()
      for (const entry of own) {
        for (const ruleId of Object.keys(entry?.rules ?? {})) declared.add(ruleId)
      }

      expect([...declared].sort()).toEqual([...DECLARED_RULE_IDS].sort())
    }, ESLINT_TIMEOUT)

    it('resolves the seven declared rules unchanged on a src/components file with no override', async () => {
      const rules = await resolvedRules('src/components/layout/LanguageSelector.tsx')

      expect(rules['complexity']).toEqual([2, 15])
      expect(rules['max-depth']).toEqual([2, 4])
      expect(rules['max-lines-per-function']).toEqual([2, 200])
      expect(rules['max-params']).toEqual([2, 4])
      expect(rules['max-lines']).toEqual([2, 400])
      // Severity only: `no-restricted-imports` carries the F21 pattern list as
      // its options, and `complexityBudget.test.ts` is not where it is pinned.
      expect(severityOf(rules['no-restricted-imports'])).toBe(2)
      expect(severityOf(rules['@typescript-eslint/no-explicit-any'])).toBe(2)
    }, ESLINT_TIMEOUT)

    it('resolves exactly the two intended zeros among the declared seven on a test file', async () => {
      const rules = await resolvedRules('src/lib/__tests__/errors.test.ts')

      const zeroed = DECLARED_RULE_IDS.filter(ruleId => severityOf(rules[ruleId]) === 0).sort()
      expect(zeroed).toEqual(['@typescript-eslint/no-explicit-any', 'max-lines-per-function'])

      expect(rules['max-lines']).toEqual([2, 800])
      expect(rules['complexity']).toEqual([2, 16])
      // The seventh is not a zero: the F21 block carries
      // `ignores: ["**/__tests__/**"]`, so the rule is never declared for this
      // file at all. Pinned so the distinction cannot rot into a zero.
      expect(severityOf(rules['no-restricted-imports'])).toBe('undeclared')
    }, ESLINT_TIMEOUT)
  })

  describe('(c) the resolved file universe', () => {
    it('lints every git-tracked lintable path, with nothing silently excluded', async () => {
      const results = await lintProject()

      const linted = new Set(results.map(result => relative(ROOT, result.filePath)))
      const tracked = trackedFiles().filter(path => LINTABLE.test(path))
      const unlinted = tracked.filter(path => !linted.has(path)).sort()

      expect(
        unlinted,
        `git-tracked lintable files that eslint did not lint:\n${unlinted.join('\n')}`
      ).toEqual([])
    }, ESLINT_TIMEOUT)
  })

  describe('(d) the text that is the thing', () => {
    it('fails the lint script on a single warning, over the whole project, with no CLI escape', () => {
      const lintScript = (JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> })
        .scripts.lint

      // Exactly one `--max-warnings`, and it is zero. `toContain` alone would
      // be satisfied by `--max-warnings=0 --max-warnings=50`, where the last
      // flag is the one eslint honours.
      expect(lintScript.match(/--max-warnings(=|\s+)\S+/g)).toEqual(['--max-warnings=0'])
      // `eslint` with no path argument lints the whole project, as does an
      // explicit `.`; anything narrower is a shrunken universe.
      const pathArguments = lintScript
        .split(/\s+/)
        .slice(1)
        .filter(argument => !argument.startsWith('-'))
      expect(pathArguments.filter(argument => argument !== '.')).toEqual([])

      for (const flag of FORBIDDEN_LINT_FLAGS) {
        expect(lintScript, `the lint script must not contain ${flag}`).not.toContain(flag)
      }
    })

    it('keeps eslint.config.mjs environment-independent, with no linterOptions key', () => {
      const source = readRepoFile('eslint.config.mjs')

      const specifiers = [...source.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
        match => match[1]
      )
      expect([...new Set(specifiers)].sort()).toEqual(ALLOWED_CONFIG_IMPORTS)

      // An env-conditional config could be strict under vitest and loose under
      // `npm run lint`, which would make every severity above a local truth.
      expect(source).not.toContain('process.env')
      // Not a rule declaration, so half (b) is blind to it:
      // `linterOptions: { reportUnusedDisableDirectives: 'off' }` would silence
      // every stale suppression without moving a single severity.
      expect(source).not.toContain('linterOptions')
    })

    it('carries no whole-file eslint-disable block and no inline eslint config comment', () => {
      // Only block comments can disable a whole file — ESLint ignores a bare
      // `// eslint-disable` line comment — so matching the `/*` opener is both
      // sufficient and what keeps the pattern off the eleven legitimate
      // `-next-line` directives and off the three prose mentions in
      // `dbRowTypes.test.ts`.
      const wholeFileDisable = /\/\*\s*eslint-disable(?!-next-line\b|-line\b)/
      const inlineConfigComment = /\/\*\s*eslint\s+[^*]*\*\//

      const offenders = trackedFiles()
        .filter(path => /^(?:src|e2e|scripts)\//.test(path) && LINTABLE.test(path))
        .filter(path => {
          const source = readRepoFile(path)
          return wholeFileDisable.test(source) || inlineConfigComment.test(source)
        })
        .sort()

      expect(
        offenders,
        `whole-file eslint-disable blocks or inline eslint config comments:\n${offenders.join('\n')}`
      ).toEqual([])
    })
  })
})
