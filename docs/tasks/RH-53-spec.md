# RH-53 (board id RH-52) — Integration close-out for the PlaylistDetailPage decomposition (F11, F13)

Parent task of RH-66..RH-71 (board ids RH-65..RH-70), all `done`.

**Numbering note.** The board calls this task `RH-52`; every doc, commit scope and
sibling spec in the repository calls this same decomposition `RH-53`, and
`docs/tasks/RH-52-spec.md` is already taken by the unrelated Fast View part 5/5
spec. This spec therefore lives at `docs/tasks/RH-53-spec.md` and the
documentation edits below are attributed to **RH-53**, so that they read
consistently with `docs/tasks/RH-66-spec.md` .. `RH-71-spec.md` and with the F11
status line. The commit scope is the board id: `docs(RH-52): ...`.

## Scope

The six children already landed the whole refactor. What is left is the
close-out: verify the final shape mechanically, record the verification where
the repo records it, and repair the census numbers in `AGENTS.md` that the six
slices moved and nobody re-measured.

This task changes **no** code under `src/`, `e2e/` or `eslint.config.mjs`. If
verification finds a real defect, that is a new task, not a fix here.

## Approach

### Behavior

1. **Verify the final shape** of `src/app/playlists/[id]/page.tsx` and the
   ratchet, with no source edits. The facts to confirm: the file is an async
   Server Component (no `'use client'`, no `useState`/`useEffect`, `export
   default async function`), it resolves its own session and `redirect`s, it
   reads `getPlaylistWithSongs` and `getRepertoire` through `src/lib`, it scopes
   the repertoire to `playlist.band_id`, it injects its Server Actions as typed
   bundles into one island, it has **no** `complexity-budget/override` entry in
   `eslint.config.mjs`, and the override list is 19 entries with
   `MAX_OVERRIDES = 19`.
2. **Record the close-out** in `docs/plans/code-quality-review.md` section 5, on
   the plan entry covering F11/F20: extend its `**Status:**` line with
   `integrated and verified by RH-53`, matching the phrasing already used by the
   T5 (line ~546) and T8 (line ~567) entries. Do **not** rewrite the F11 or F13
   `**Status:**` lines; both are already written and are the children's record.
   The deliberate "do not read this for F13's current state" note in F13's
   status and the T8 sentence it refers to both stay untouched.
3. **Re-point the one now-false current-state sentence** in F15's `**Status:**`:
   it names `/playlists/[id]` as "a large client component already owned
   elsewhere ... RH-53" and counts ten of fifteen `page.tsx` files as
   `'use client'`. Append one sentence recording that the route has since
   converted and the count is now nine of fifteen, in the addendum style the
   file already uses — the original measurement at `66d9442` stays standing as
   the record of what RH-41 saw.
4. **Re-measure the `AGENTS.md` census claims** the split invalidated. Each of
   these is a counted claim in prose, and each is now wrong:
   - "The eight bundles live in five `src/app/<area>Actions.ts` files" — nine
     bundles in six files; the list of filenames must gain
     `songPickerActions.ts`.
   - "All eleven files under `src/hooks`" — fifteen. The **same bullet** ends
     "Ten of the eleven also annotate a `<Subject>Controller` return type": that
     becomes "Fourteen of the fifteen also annotate a `<Subject>Controller` return
     type" (measured: 14 of the 15 hook files name a
     `Controller` type; `useToast.ts` is still the single outlier the sentence
     already names, so the rest of the bullet stands).
   - "51 files under `src/components`" — 65.
   - "Twelve of the 46 modules under `src/lib` import it at module scope" — 52
     modules (the twelve `@/lib/db` importers are unchanged, and so are the
     three that pull `pg` in through them, for fifteen server-only in total).
   - The two derived counts in the **same paragraph**, which the 46 → 52 move
     invalidated arithmetically: "The other thirty-one modules are free of `pg`,
     and nineteen of them appear in the 60 client files - fifteen imported for
     their values" becomes "the other thirty-six are free of `pg`, and
     twenty-three of them appear in the 73 client files - nineteen imported for
     their values" and the tail names the remaining **four** as type-only
     (52 − 16 = 36, where the sixteen are the fifteen server-only modules plus
     `db.ts` itself; 23 pg-free `src/lib` modules are imported by a client file,
     19 of them for their values and 4 by `import type` alone, 19 + 4 = 23).
   - "nine of the 106 test files" — "nine of the 125 test files"
     (`find src e2e -name '*.test.ts*'` = 125; the nine `.db.test.ts` files are
     unchanged).
   - The "45 of the 46 modules" sentence under "**`src/lib` exports are function
     declarations**" is **historical, not a current-state census**: it records
     what was true when RH-43 converted the last outlier. Do not re-measure it
     to 52. Instead make its historicity explicit with this exact replacement —
     "declarations hoist and produce better stack traces, and 45 of the 46
     modules then in `src/lib` already did it." (the only inserted words are
     "then in `src/lib`"; no bold, no other change) — and leave the following
     sentence ("RH-43 converted the last outlier, `src/lib/bands.ts`, ...")
     untouched. No other wording in that bullet changes.
   - Directory Structure: the `src/hooks/` listing must gain `usePlaylistDetail`,
     `useSongPicker`, `useSpotifySync` and `useTagEditor` with their one-line
     descriptions, and the `src/app/` listing line
     `bandAdminActions.ts, fastView*Actions.ts` must gain `songPickerActions.ts`.
   Correct the numbers; do not restructure the sections.

   **Provenance of the client-file and pg-free figures (adjudicated in RH-52
   code review, round 2).** `73` is the count the `namingConventions` guard
   itself computes: files under `src/` that *declare* the `'use client'`
   directive at the start of a line, with `__tests__` directories and
   `*.test.ts(x)` files excluded (`clientFiles()` over `walk()` in
   `src/lib/__tests__/namingConventions.test.ts`). A bare
   `grep -rl "use client" src --include='*.ts*' | wc -l` prints `76` because it
   also matches tests and prose mentions of the string; that looser number is
   **not** the one the paragraph is about. Likewise `125`, not `124`, is the
   current `find src e2e -name '*.test.ts*'` count. These four figures —
   thirty-six, twenty-three, 73, 125 — were re-measured and upheld in review;
   do not "correct" them back to the earlier draft's 37 / 22 / 76 / 124.
5. **Version bump** in `package.json` per the AGENTS.md rule.

### Files touched

- `docs/tasks/RH-53-spec.md` — this spec (new).
- `docs/plans/code-quality-review.md` — section 5 F11/F20 plan entry gains
  `integrated and verified by RH-53`; F15 `**Status:**` gains the one-sentence
  addendum. No other status line changes.
- `AGENTS.md` — the census corrections listed above (Naming Conventions,
  Module Layout and Directory Structure).
- `package.json` — version bump.

### Test criteria

No new tests. The existing guards are the verification, and must still pass:

- `npx vitest run src/lib/__tests__/complexityBudget.test.ts src/lib/__tests__/namingConventions.test.ts`
- `npm run test:coverage` unaffected (no `src/` change).

The developer records, in the PR body or the close-out line, the output of the
mechanical checks: `wc -l "src/app/playlists/[id]/page.tsx"`,
`grep -c "complexity-budget/override" eslint.config.mjs`,
`grep -c "use client" "src/app/playlists/[id]/page.tsx"`,
`grep -rn "playlists" eslint.config.mjs`, and the census counts, each taken
from the tree before it is written into prose:

- `ls src/hooks/*.ts | wc -l` = 15; `grep -l "Controller" src/hooks/*.ts | wc -l` = 14
- `find src/components -name '*.tsx' -not -path '*__tests__*' | wc -l` = 65
- `ls src/lib/*.ts | wc -l` = 52; `grep -l '@/lib/db' src/lib/*.ts | wc -l` = 12
- client files = 73, counted the way the guard counts them (files declaring the
  `'use client'` directive, `__tests__` and `*.test.ts(x)` excluded), not the
  looser `grep -rl "use client" src --include='*.ts*' | wc -l`, which prints 76
- `find src e2e -name '*.test.ts*' | wc -l` = 125
- `ls src/app/*Actions.ts | wc -l` = 6; `grep -h "^export const [A-Z_]*" src/app/*Actions.ts | wc -l` = 9

## Expected Results

- [ ] `src/app/playlists/[id]/page.tsx` contains no `'use client'`, no
      `useState` and no `useEffect`, and its default export is
      `export default async function PlaylistDetailPage`.
- [ ] `eslint.config.mjs` contains no `complexity-budget/override` entry whose
      `files` glob names `src/app/playlists/`, and
      `grep -c "complexity-budget/override" eslint.config.mjs` prints `19`.
- [ ] `npx vitest run src/lib/__tests__/complexityBudget.test.ts src/lib/__tests__/namingConventions.test.ts` passes.
- [ ] The section 5 plan entry covering F11/F20 in
      `docs/plans/code-quality-review.md` has a `**Status:**` line containing
      `integrated and verified by RH-53`.
- [ ] Both `### F11` and `### F13` in `docs/plans/code-quality-review.md` carry a
      `**Status:**` line beginning `Resolved by`, and neither is reworded by this
      task (`git diff` shows no change on those two lines).
- [ ] F15's `**Status:**` line records that `/playlists/[id]` has since become a
      Server Component and that nine of fifteen `page.tsx` files carry
      `'use client'`.
- [ ] `AGENTS.md` states nine injected action bundles across six
      `src/app/<area>Actions.ts` files, names `songPickerActions.ts` in both the
      Naming Conventions list and the Directory Structure `src/app/` listing,
      says fifteen files under `src/hooks`, 65 files under `src/components`, and
      52 modules under `src/lib` (with twelve importing `@/lib/db`).
- [ ] The `src/hooks` naming bullet in `AGENTS.md` reads "Fourteen of the
      fifteen also annotate a `<Subject>Controller` return type", and
      `grep -c "Ten of the eleven" AGENTS.md` prints `0`.
- [ ] The Module Layout paragraph in `AGENTS.md` reads "the other thirty-six
      are free of `pg`, and twenty-three of them appear in the 73 client
      files - nineteen imported for their values", names the remaining four as
      type-only, and `AGENTS.md` contains neither `thirty-one modules` nor
      `60 client files`.
- [ ] `AGENTS.md` says "nine of the 125 test files", and
      `grep -c "106 test files" AGENTS.md` prints `0`.
- [ ] `AGENTS.md` contains the sentence fragment "45 of the 46 modules then in
      `src/lib` already did it", and the following sentence naming
      `src/lib/bands.ts` as the last outlier is unchanged (`git diff` shows the
      only edit on that bullet is the inserted "then in `src/lib`").
- [ ] `grep -c "the 46 modules" AGENTS.md` prints `1` — the historical `src/lib`
      function-declaration sentence — and `grep -c "51 files under" AGENTS.md`
      prints `0`.
- [ ] `AGENTS.md`'s `src/hooks/` directory listing has a line for
      `usePlaylistDetail`, `useSongPicker`, `useSpotifySync` and `useTagEditor`.
- [ ] `package.json` `version` is higher than every version in `git log` and
      carries a `YYYYMMDDHHmm` suffix.
- [ ] `git diff --stat` for this task touches only `AGENTS.md`,
      `docs/plans/code-quality-review.md`, `docs/tasks/RH-53-spec.md` and
      `package.json`.

## Out of Scope

- Any change under `src/`, `e2e/` or `eslint.config.mjs`.
- Re-wording the F11 or F13 `**Status:**` lines, or the deliberately-stale T8
  sentence F13's status points at.
- Re-measuring the historical "45 of the 46 modules" claim to the current
  `src/lib` size; it is a record of what RH-43 found, and only gains the words
  "then in `src/lib`".
- The five `'use client'` pages F15 leaves with no named owner.
- The unrelated "six DB-backed files skip 51 tests" line in the AGENTS.md test
  section (line ~94). It is not one of the counts the six slices moved; if it is
  stale, that is a separate task.
- Renaming the RH-52/RH-53 numbering divergence anywhere in the repo.
