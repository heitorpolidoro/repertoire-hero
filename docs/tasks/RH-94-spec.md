# RH-94 — Show a lyrics formatting cheat sheet beside the lyrics while editing

Mockup: `docs/tasks/RH-94-mock.html` (editor on a wide screen, and on a phone with the guide collapsed and expanded).

## Scope

While the Fast View lyrics editor is open, show a small "Formatting" guide next
to the textarea listing the four formats the lyrics mini-markdown accepts —
`**bold**`, `*italic*`, `__underline__` and `[text]` (the emerald chord/cue
badge) — each with the literal text to type and a live preview produced by
`parseLyricsMarkdown`. The list and the parser read the same rule table, so a
format cannot be added to, removed from or reordered in one without the other.

Baseline: `d3ce7e2` (v0.1.128). At that commit the rules are four chained
`.replace` calls inside `parseLyricsMarkdown` (`src/lib/lyricsMarkdown.ts:16-25`),
and the editor (`src/components/fastview/LyricsEditorPanel.tsx`) is a textarea
plus the Auto-import / Cancel / Save row, with no hint of the syntax anywhere.

Not covered: any change to what the mini-markdown accepts or how it renders
(output of `parseLyricsMarkdown` stays byte-identical for every input); Stage
Mode (`LyricsStageOverlay`); the read-only lyrics card; toolbar buttons that
insert syntax into the textarea; i18n of the guide copy (Fast View copy is
English-only today).

## Approach

**Behavior.**

1. *One rule table.* `src/lib/lyricsMarkdown.ts` gains a module-private,
   ordered table of the four formatting rules. Each row carries a stable id
   (`bold`, `italic`, `underline`, `badge`), a human label (`Bold`, `Italic`,
   `Underline`, `Chord / cue badge`), the example syntax shown to the user
   (`**bold**`, `*italic*`, `__underline__`, `[Am]`), and the regex +
   replacement string the parser applies. Table order is parse order and must
   stay bold → italic → underline → badge (bold must run before italic).
   `parseLyricsMarkdown` keeps its three HTML escapes first, in the same order,
   then applies the table's rules by iterating it — it no longer spells out the
   four formatting `.replace` calls itself. Its output is unchanged for every
   input; the existing 11 tests in `lyricsMarkdown.test.ts` pin that.
2. *Guide data.* A new exported function `lyricsFormatGuide()` in the same
   module returns, for each table row in order, `{ id, label, syntax,
   previewHtml }` where `previewHtml` is `parseLyricsMarkdown(syntax)`. It is a
   function declaration (the `src/lib` export-style guard) and exports a named
   entry interface. The regexes are not exported.
3. *Guide component.* New presentational `src/components/fastview/LyricsFormatGuide.tsx`
   renders `<aside aria-label="Lyrics formatting">` with a small heading
   `Formatting` and a `<ul>` with one `<li>` per guide entry: the label, the
   syntax in a `<code>` element (literal text, never parsed), and a preview
   element whose inner HTML is `previewHtml` (safe: the example strings are
   constants and pass through the parser's escapes anyway). It takes no props
   and calls `lyricsFormatGuide()`. Its only state is one `open` boolean for
   the phone toggle (item 5), initially `false`.
5. *Phone toggle (operator's option B).* Inside the aside, before the `<ul>`,
   sits a `<button type="button">` whose accessible name is exactly
   `Formatting help`, carrying `aria-expanded` (`"false"` initially) and
   `aria-controls` equal to the `<ul>`'s `id` (from `useId`). Clicking it flips
   `open`. The button is phone-only (`sm:hidden`); the `Formatting` heading is
   the reverse (`hidden sm:block` or equivalent). While `open` is false the
   `<ul>` carries the `hidden` class plus an `sm:` display class, so below `sm`
   only the "Formatting help" line shows and from `sm` up the list is always
   shown whatever `open` is; while `open` is true the `<ul>` has no bare
   `hidden` class and shows as a 2x2 grid below `sm`. The four `<li>` stay in
   the DOM in both states (CSS hides them, not conditional rendering). A native
   `<details>` is not used: its closed content cannot be forced visible from
   `sm` up with Tailwind classes in every supported browser.
4. *Placement.* `LyricsEditorPanel`'s root becomes a row with two children:
   an *editor column* (a wrapper element that is the direct parent of both the
   textarea and the Auto-import / Cancel / Save row, in that order) and the
   `LyricsFormatGuide` aside. The guide is therefore never inside the editor
   column, and the buttons row is never a direct child of the outer row. From
   the `sm` breakpoint up the editor column flexes (`flex-1 min-w-0`) and the
   guide is a fixed narrow column of about `w-44` to its right, top aligned;
   the buttons row sits directly under the textarea and spans only the
   textarea's width - it does not extend under the guide, and Save's right
   edge lines up with the textarea's right edge. Below `sm` the visual order
   is textarea, then the "Formatting help" line (item 5), then the buttons
   row; since the guide is outside the editor column, this is achieved with
   CSS only (e.g. the editor column is `contents sm:flex` so its children join
   the outer column, and `order-*` utilities that reset at `sm:`), never by
   rendering the guide or the buttons twice. Because
   `LyricsSection` mounts `LyricsEditorPanel` only when `controller.isEditing`
   is true, the guide is absent from the DOM whenever the editor is closed; no
   new controller field or hook change is needed.

**Files touched.**

- `src/lib/lyricsMarkdown.ts` — private rule table; parser iterates it; new `lyricsFormatGuide()` + entry interface.
- `src/lib/__tests__/lyricsMarkdown.test.ts` — two new tests for the guide (existing 11 untouched).
- `src/components/fastview/LyricsFormatGuide.tsx` — new aside with the phone-only `Formatting help` toggle (one `open` state).
- `src/components/fastview/LyricsEditorPanel.tsx` — outer responsive row: editor column (textarea + buttons row) beside the guide.
- `src/components/fastview/__tests__/LyricsSection.test.tsx` — four new DOM tests (existing 14 untouched).
- `AGENTS.md` — the file-map line "The 27 Fast View pieces" becomes "The 28 Fast View pieces"; no other line.
- `package.json` — version bump per the AGENTS.md rule.

Nothing under `src/hooks`, `src/app`, `eslint.config.mjs` or
`LyricsStageOverlay.tsx` changes; no complexity override is added.

**Test criteria.**

- Unit (node env, `lyricsMarkdown.test.ts`), new tests named exactly:
  - `lyricsFormatGuide lists bold, italic, underline and the badge in parse order` —
    ids equal `['bold','italic','underline','badge']`, syntaxes equal
    `['**bold**','*italic*','__underline__','[Am]']`.
  - `lyricsFormatGuide previews each syntax through parseLyricsMarkdown` —
    for every entry `previewHtml === parseLyricsMarkdown(syntax)`, and the four
    previews equal `<strong>bold</strong>`, `<em>italic</em>`,
    `<u>underline</u>` and `<strong class="${CHORD_CLASS}">Am</strong>`.
- DOM (jsdom, `LyricsSection.test.tsx`), new tests named exactly:
  - `LyricsEditorPanel shows the formatting guide with each syntax and its rendered preview` —
    without touching the toggle, the `complementary` region named
    `Lyrics formatting` holds 4 list items; each shows its syntax as the text
    of a `<code>` element and the region's `innerHTML` contains each of the
    four preview strings above.
  - `LyricsSection shows the formatting guide only while editing` — with
    `isEditing: true` the region is present; with `isEditing: false` (lyrics
    present, and again with `displayedLyrics: null`) `queryByRole` returns null.
  - `LyricsFormatGuide collapses behind a Formatting help toggle on phones` —
    the `Formatting help` button starts `aria-expanded="false"`, its
    `aria-controls` names the region's `<ul>`, which has class `hidden` and a
    class starting with `sm:`; after one click the button is
    `aria-expanded="true"` and the `<ul>` no longer has class `hidden`; after a
    second click it is back to `"false"` with `hidden`.
  - `LyricsEditorPanel keeps Cancel and Save inside the textarea column` —
    `textarea.parentElement` contains the `Cancel` and `Save` buttons and does
    not contain the `Lyrics formatting` region, and that parent and the region
    share the same parent element.

## Expected Results

ER1 - The formatting guide appears beside the lyrics textarea while editing. `rtk proxy npx vitest run src/components/fastview/__tests__/LyricsSection.test.tsx` exits `0` printing `Tests  18 passed (18)` (was 14 at `d3ce7e2`), including the test named exactly `LyricsEditorPanel shows the formatting guide with each syntax and its rendered preview`, which renders `LyricsEditorPanel` and, without clicking the toggle, finds the region `getByRole('complementary', { name: 'Lyrics formatting' })`, asserts it holds exactly 4 `listitem`s, asserts `<code>` elements whose text is exactly `**bold**`, `*italic*`, `__underline__` and `[Am]`, and asserts the region's `innerHTML` contains `<strong>bold</strong>`, `<em>italic</em>`, `<u>underline</u>` and the badge markup `<strong class="text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100 text-xs font-semibold select-all">Am</strong>`. `test -f src/components/fastview/LyricsFormatGuide.tsx` exits `0` and `grep -c "LyricsFormatGuide" src/components/fastview/LyricsEditorPanel.tsx` prints a number greater than or equal to `1`.

ER2 - Each preview is produced by the same `parseLyricsMarkdown` the lyrics view uses, from a single rule table the parser itself iterates. `rtk proxy npx vitest run src/lib/__tests__/lyricsMarkdown.test.ts` exits `0` printing `Tests  13 passed (13)` (was 11; the 11 pre-existing tests pass unmodified, so parser output is unchanged), including the tests named exactly `lyricsFormatGuide lists bold, italic, underline and the badge in parse order` (ids `bold`, `italic`, `underline`, `badge` and syntaxes `**bold**`, `*italic*`, `__underline__`, `[Am]`, in that order) and `lyricsFormatGuide previews each syntax through parseLyricsMarkdown` (every entry's `previewHtml` strictly equals `parseLyricsMarkdown(entry.syntax)`). Structurally: `grep -c "export function lyricsFormatGuide" src/lib/lyricsMarkdown.ts` prints `1`; `grep -c "\.replace(" src/lib/lyricsMarkdown.ts` prints `4` (the three escapes plus the one call inside the loop over the rule table; it printed `7` at `d3ce7e2`); `grep -c "parseLyricsMarkdown\|lyricsMarkdown" src/components/fastview/LyricsFormatGuide.tsx` prints a number greater than or equal to `1` and `grep -cE "<strong|<em>|<u>" src/components/fastview/LyricsFormatGuide.tsx` prints `0`, so the component hard-codes no preview markup.

ER3 - The guide is not shown outside edit mode. The test named exactly `LyricsSection shows the formatting guide only while editing` passes in the ER1 run: rendering `LyricsSection` with `isEditing: true` finds the `Lyrics formatting` region, and rendering it with `isEditing: false` - once with `displayedLyrics: 'band words'` and once with `displayedLyrics: null` - makes `queryByRole('complementary', { name: 'Lyrics formatting' })` return `null`. Manually in `npm run dev` on `/songs/<id>/fast-view`: the guide is visible after pressing Edit (or Add), and disappears after Cancel and after a successful Save; it never appears in Stage Mode.

ER4 - On a phone the guide is collapsed behind a "Formatting help" toggle. The test named exactly `LyricsFormatGuide collapses behind a Formatting help toggle on phones` passes in the ER1 run: `getByRole('button', { name: 'Formatting help' })` inside the `Lyrics formatting` region has `aria-expanded="false"` on first render, and its `aria-controls` value is the `id` of the region's `<ul>`, whose `classList` contains `hidden` and at least one class starting with `sm:`; after `fireEvent.click` the button has `aria-expanded="true"` and the `<ul>`'s `classList` does not contain `hidden`; after a second click it is `aria-expanded="false"` and contains `hidden` again. `grep -c "<details" src/components/fastview/LyricsFormatGuide.tsx` prints `0` and `grep -c "sm:hidden" src/components/fastview/LyricsFormatGuide.tsx` prints a number greater than or equal to `1`. Manually with `npm run dev` at 390 px (iPhone 12 in DevTools), after pressing Edit: under the textarea there is a single "Formatting help" line with none of the four entries visible, then Auto-import / Cancel / Save; tapping the line shows the four entries as a 2x2 grid between the textarea and the buttons, without horizontal scrolling; tapping again hides them.

ER5 - On a wide screen Cancel and Save stay aligned with the textarea, not under the guide. The test named exactly `LyricsEditorPanel keeps Cancel and Save inside the textarea column` passes in the ER1 run: the textarea's `parentElement` contains the `Cancel` and `Save` buttons (and the Auto-import button), does not contain the `Lyrics formatting` region, and has the same `parentElement` as the region. `grep -cE "sm:flex-row|sm:w-" src/components/fastview/LyricsEditorPanel.tsx src/components/fastview/LyricsFormatGuide.tsx` reports at least one match across the two files. Manually with `npm run dev` at 1280 px: the guide is a narrow column to the right of the textarea with top edges aligned, the Auto-import / Cancel / Save row sits directly under the textarea, the Save button's right edge lines up with the textarea's right edge, and no button is under the guide column; the "Formatting help" line is not shown and the four entries are always visible.

ER6 - Static gates and scope hold. `rtk proxy npx eslint src/lib/lyricsMarkdown.ts src/components/fastview/LyricsFormatGuide.tsx src/components/fastview/LyricsEditorPanel.tsx` exits `0` with no output; `git diff d3ce7e2 -- eslint.config.mjs` prints nothing (no complexity override added); `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts src/lib/__tests__/namingConventions.test.ts` exits `0`; `./node_modules/.bin/tsc --noEmit` exits `0`; `npm run lint:dead` exits `0`; `npm run lint:dup` exits `0` with the `Total:` row reporting at most `16` clones (the `d3ce7e2` count). `grep -c "The 28 Fast View pieces" AGENTS.md` prints `1` and `git diff --numstat d3ce7e2 -- AGENTS.md` prints `1	1	AGENTS.md`. `package.json` version is `0.1.129-YYYYMMDDHHmm` with a real local timestamp. `git diff --name-only d3ce7e2 | sort` lists only paths from this set: `AGENTS.md`, `docs/tasks/RH-94-mock.html`, `docs/tasks/RH-94-spec.md`, `package.json`, `src/components/fastview/LyricsEditorPanel.tsx`, `src/components/fastview/LyricsFormatGuide.tsx`, `src/components/fastview/__tests__/LyricsSection.test.tsx`, `src/lib/__tests__/lyricsMarkdown.test.ts`, `src/lib/lyricsMarkdown.ts` (plus `docs/suggestions-log.md` if the pipeline appends to it).

## Questions

Q1 (visual, answered) - Phone placement. Operator's answer: B. Below `sm`
the guide is collapsed behind a tappable "Formatting help" line, closed by
default, that expands to the four entries (Approach items 4-5, ER4). Wide
screens are unaffected: the guide is always shown beside the textarea, and
Cancel / Save stay under the textarea, not under the guide (ER5).

## Out of Scope

- New syntax, or any change to the rendering of existing syntax.
- Click-to-insert toolbar buttons.
- Showing the guide in Stage Mode or on the read-only lyrics card.
- Translating the guide copy.
