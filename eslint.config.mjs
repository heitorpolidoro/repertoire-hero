import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // F21/RH-47: src/components, src/hooks and src/lib are leaves. They may depend
  // on each other and on src/types, never on the App Router tree. A page (or a
  // wrapper under src/app) owns the Server Action and passes it down as a prop or
  // an injected dependency. `__tests__` is exempt on purpose: a test that
  // exercises a route handler or a Server Action has to import it.
  {
    files: ["src/components/**", "src/lib/**", "src/hooks/**"],
    ignores: ["**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*", "@/app/**"],
              message:
                "src/components, src/hooks and src/lib must not import from the App Router tree. Pass the Server Action down from the page as a prop or an injected dependency (F21/RH-47)",
            },
          ],
        },
      ],
    },
  },
  // F20/RH-39: the complexity budget. These five rules are the mechanical
  // ratchet that keeps a FastViewPage (RH-38) or a PlaylistDetailPage from
  // being re-created after it is fixed. Since RH-129 the `Lint (eslint)` CI job
  // runs `npm run lint`, so a violation fails a PR on its own;
  // src/lib/__tests__/complexityBudget.test.ts additionally pins the thresholds
  // and the override list, which eslint itself cannot check.
  {
    name: "complexity-budget/base",
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "max-lines-per-function": ["error", 200],
      "max-params": ["error", 4],
      "max-lines": ["error", 400],
    },
  },
  // A `describe` block is a container, not a function with logic, so
  // max-lines-per-function says nothing useful about a test file. max-lines
  // still does, at twice the source budget.
  {
    name: "complexity-budget/tests",
    files: ["src/**/__tests__/**", "src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: {
      "max-lines-per-function": "off",
      "max-lines": ["error", 800],
    },
  },
  // The files that were already over budget at b85d0c6, each pinned to its own
  // current worst number. This list is a RATCHET: it may only shrink. Never add
  // an entry for new code - bring the new code under the budget instead. Note
  // the escaped brackets: in a glob, `[id]` is a character class, so an
  // unescaped Next.js dynamic segment silently matches nothing.
  // BEGIN:complexity-budget-overrides
  // RH-123 removed two entries from this ratchet. `src/lib/tabs.ts` and
  // `src/hooks/useTabLibrary.ts` each carried `max-params: 5`; every function
  // in both lost a parameter when a file stopped hanging off a repertoire row,
  // so both now sit inside the base budget of 4 and the overrides had to go
  // rather than be lowered. 17 entries to 15.
  { name: "complexity-budget/override", files: ["src/app/api/spotify/playlists/\\[id\\]/import/route.ts"], rules: { complexity: ["error", 21] } },
  // RH-125 code review lowered this one 26 -> 25: the pull's dedup moved into
  // `dedupeVersionIds` in `src/lib/spotifyPlaylistSync.ts`, where a unit test
  // can reach it (`src/app/api/**` is outside the coverage gate), and the `if
  // (!seenSpotifyVersions.has(...))` branch it took with it is the one the
  // route no longer spends.
  //
  // RH-135 lowered it again, 25 -> 22. The push loop used to pick a song's
  // Spotify link by label and then dig the track id out of its url, spending
  // three branches on it: the `links?.find(...)` optional chain, `if
  // (spotifyLink?.url)` and `if (match)`. All three moved into
  // `spotifyTrackUriFromLinks` (`src/lib/spotifyTrackUri.ts`), where a unit
  // test can reach them — `src/app/api/**` is outside the coverage gate — and
  // the loop is left with one `if (uri)`. `max-depth` stays at 5: the
  // shallower loop body was never the file's deepest block.
  { name: "complexity-budget/override", files: ["src/app/api/spotify/playlists/\\[id\\]/sync/route.ts"], rules: { complexity: ["error", 22], "max-depth": ["error", 5] } },
  { name: "complexity-budget/override", files: ["src/app/bands/\\[id\\]/page.tsx"], rules: { complexity: ["error", 29], "max-lines-per-function": ["error", 453], "max-lines": ["error", 473] } },
  { name: "complexity-budget/override", files: ["src/app/join/\\[code\\]/page.tsx"], rules: { "max-lines-per-function": ["error", 249] } },
  { name: "complexity-budget/override", files: ["src/app/profile/page.tsx"], rules: { complexity: ["error", 22], "max-lines-per-function": ["error", 365], "max-lines": ["error", 615] } },
  { name: "complexity-budget/override", files: ["src/components/layout/AppLayout.tsx"], rules: { complexity: ["error", 21] } },
  // RH-96: the status badge moved into `SongStatusBadge.tsx` and the band-role
  // read into `useBandRole.ts`, so the row's worst complexity fell from 18 to
  // 17 and the component function from 530 lines to 526. RH-102 deleted
  // `SongStatusBadge.tsx` outright — the row renders the shared `StatusNotes`
  // control instead — taking the component function 526 to 525 and the file
  // 579 to 578. `complexity` is unchanged at 17: `readOnly={!canEditStatus}`
  // replaces the `editable` prop one for one, so the gate costs no branch.
  { name: "complexity-budget/override", files: ["src/components/songs/RepertoireDashboard.tsx"], rules: { complexity: ["error", 17], "max-lines-per-function": ["error", 525], "max-lines": ["error", 578] } },
  // RH-97: the link rows moved into `SongLinksEditor.tsx`, one populated shared
  // field into `SharedCatalogField.tsx` and the refusal notice into
  // `CatalogRefusalNotice.tsx`, while the payload builders and the catalog
  // lookups moved to module scope — complexity 17 to 16, the component function
  // 459 lines to 375 and the file 612 to 602.
  { name: "complexity-budget/override", files: ["src/components/songs/SongForm.tsx"], rules: { complexity: ["error", 16], "max-lines-per-function": ["error", 375], "max-lines": ["error", 602] } },
  // RH-99: `drawPath` moved to `src/lib/strokeRenderer.ts`, which paid for the
  // `readOnly` prop that disables `Toggle drawing` offline and left the ratchet
  // lower than it found it — the component function 757 lines to 743 and the
  // file 819 to 815. `complexity` was unchanged at 21: `readOnly` is declared
  // without a default and its only branch is the guard in
  // `handleToggleDrawing`, so the prop cost the budget nothing.
  //
  // RH-128 took three things out of this file and dropped `complexity` from
  // the entry altogether. The `Document`/`Page` pair became
  // `StagePageSurface`/`PdfPageSurface`/`ImagePageSurface`, the toolbar's top
  // row became `StageStatusRow` and the save-badge text became
  // `stageSaveLabel` in `src/lib/stageInteraction.ts` — together worth seven
  // branches, taking the component function from 21 to 14, which is *below*
  // the base budget of 15, so the file no longer needs a complexity ceiling at
  // all. The component function went 743 lines to 709 and the file 815 to 788.
  // None of the four new modules carries an entry: each is inside every base
  // budget (worst: 72 lines, 44 per function, complexity 4).
  { name: "complexity-budget/override", files: ["src/components/tabs/TabDrawingStage.tsx"], rules: { "max-lines-per-function": ["error", 709], "max-lines": ["error", 788] } },
  { name: "complexity-budget/override", files: ["src/lib/bands.ts"], rules: { "max-params": ["error", 5] } },
  { name: "complexity-budget/override", files: ["src/lib/linkFetcher.ts"], rules: { complexity: ["error", 18] } },
  // RH-124 removed `src/lib/songs.ts`'s entry outright rather than lowering it:
  // the owner-row half of the module — every `repertoire` read and write, plus
  // `updateSong`'s and `createAndAddSong`'s owner-row halves — moved to
  // `src/lib/ownerSongs.ts`, leaving the catalog work at 185 lines, below the
  // global 400. The ratchet may only shrink, and deleting an entry is the
  // smallest it goes. Neither new module carries one: both stay inside the
  // plain budgets. (History, for the record: RH-39 pinned it at 531, RH-95 took
  // it from 505 to 483, RH-96 to 473, RH-97 to 471, RH-121 to 470 and RH-122 to
  // 465.)
  { name: "complexity-budget/override", files: ["src/lib/__tests__/edge_cases.test.ts"], rules: { complexity: ["error", 32] } },
  // RH-125 lowered this one 17 -> 16. The mock dispatcher gained a branch for
  // the version upsert, which answers its own id now, and paid for it twice
  // over by collapsing the three `||`-joined transaction-keyword comparisons
  // into one regex.
  { name: "complexity-budget/override", files: ["src/lib/__tests__/errors.test.ts"], rules: { complexity: ["error", 16] } },
  { name: "complexity-budget/override", files: ["src/lib/__tests__/spotify.test.ts"], rules: { "max-lines": ["error", 678] } },
  // END:complexity-budget-overrides
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
    // Build artifact: a ~1 MB minified vendor bundle copied in by
    // scripts/copy-pdf-worker.mjs (RH-19).
    "public/**",
    // Generated coverage report (gitignored) — not source.
    "coverage/**",
  ]),
]);

export default eslintConfig;
