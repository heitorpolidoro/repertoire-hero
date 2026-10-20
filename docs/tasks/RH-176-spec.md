# RH-176 — Create the behavior registry from current behavior

## Scope
Add `docs/behavior.md` (the registry) and `scripts/behavior.js` (its reader) so the Meridian pipeline can read, cite and edit current behavior. The registry only describes what the code does today; it proposes no change and edits no application code.

Not covered: changing any app behavior, wiring the registry into CI or lint, rewriting `docs/use-cases.md`.

## Approach
**Behavior**
- `docs/behavior.md` has one `## <area>` section per functional area (derive the areas from `src/app/*` routes, `src/app/api/*`, `src/lib/*`, and the topics in `docs/use-cases.md`: repertoire/overrides and band context, playlists, files and annotations, practice/status, search, catalog suggestions and moderation, queue/fast view, offline, auth/profile, bands/admin, i18n).
- Under each section: one bullet per observable behavior, one short sentence stating what the system does now (not how). Each bullet ends with a traceability pointer to a code path or test (e.g. `` (src/lib/bands.ts) `` or `` (e2e/…) ``). Pointers must name files that exist.
- **Format rules (this spec is the authority; Meridian's own files are only a tie-breaker the developer may consult at `/Users/heitor/workspace/meridian/docs/behavior.md` and `scripts/behavior.js` if they disagree on something unstated here, and any deviation is noted in the PR).**
  - File layout: optional `# Behavior` title and intro lines before the first `##`; then sections. A section starts at a line matching `^## (.+)$` and ends at the next `^## ` line or EOF. Area name = the heading text, trimmed. Names are unique.
  - Bullet syntax: each behavior is one line `- <sentence>. (<path>[, <path>...])`: starts with `- `, ends with a parenthesised, comma-plus-space separated list of one or more repo-relative file paths (no globs, no line numbers, no backticks inside the parentheses). Continuation lines and nested bullets are not allowed.
  - `node scripts/behavior.js area` prints each area name on its own line in file order, nothing else, exit 0.
  - `node scripts/behavior.js area <name>` matches the name exactly, case-insensitively after trimming. On a match it prints the `## <name>` heading line followed by that section's bullet lines (blank lines dropped), exit 0. On no match it prints `unknown area: <name>` plus the available names on stderr, nothing on stdout, and exits 1. Missing `docs/behavior.md` also exits 1 with a stderr message.
  - Any other invocation (no subcommand, extra args, unknown subcommand) prints a usage line to stderr and exits 2. There is no way to print the whole file.
  - `scripts/behavior.js` is dependency-free Node (built-ins only, CommonJS or ESM matching what `node` runs without flags in this repo) and must not be picked up by `npm run lint` failures.
- `AGENTS.md` gets the pointer: decided **yes**. Add one line under the existing docs/conventions section saying `docs/behavior.md` is the registry of current behavior, read via `node scripts/behavior.js area [name]`, and that a change to observable behavior must update it.
- Behaviors are taken from reading code and tests, not from `docs/use-cases.md` alone; where use-cases and code disagree, the code wins.

**Files touched**
- `docs/behavior.md` — new, the registry.
- `scripts/behavior.js` — new, the reader.
- `AGENTS.md` — one-line pointer to the registry and the rule that behavior changes update it.

**Test criteria**
- Ad-hoc runs, no committed test (the diff stays three files): run `node scripts/behavior.js area`, then `area <name>` for every listed area (non-empty, only that section), then an unknown name (exit 1, empty stdout) and no args (exit 2).
- Ad-hoc pointer check: a throwaway one-liner (e.g. `node -e`, not committed) reads every `- ` bullet of `docs/behavior.md`, extracts the trailing `( ... )` list, splits on `, ` and asserts `fs.existsSync` for each path; it must report zero bullets without a pointer and zero missing paths. The developer pastes its output in the PR.

## Behavior changes
none

## Expected Results
- [ ] `docs/behavior.md` exists with at least 10 `##` area sections, each holding at least 3 bullet lines.
- [ ] `node scripts/behavior.js area` exits 0 and prints exactly the `##` section names of `docs/behavior.md`, one per line.
- [ ] `node scripts/behavior.js area <name>` prints the `## <name>` heading and only that section's bullets for every listed area (case-insensitive exact match), and for an unknown name prints nothing on stdout, a message on stderr, and exits 1.
- [ ] Every `- ` bullet ends with a `(path[, path...])` pointer, and an ad-hoc check of those paths with `fs.existsSync` reports zero missing and zero bullets without a pointer.
- [ ] The registry covers at least the repertoire/overrides, playlists, files, search, catalog suggestions/moderation, offline and auth areas, matching `docs/use-cases.md` topics.
- [ ] The diff touches only `docs/behavior.md`, `scripts/behavior.js` and `AGENTS.md` (no `src/` change), and `npm run lint` still passes.

## Out of Scope
Proposing or implementing behavior changes; automated enforcement of registry updates.
