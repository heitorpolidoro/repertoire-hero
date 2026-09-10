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
  // being re-created after it is fixed. No CI job runs eslint, so
  // src/lib/__tests__/complexityBudget.test.ts is what actually enforces them.
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
  { name: "complexity-budget/override", files: ["src/app/api/spotify/playlists/\\[id\\]/import/route.ts"], rules: { complexity: ["error", 21] } },
  { name: "complexity-budget/override", files: ["src/app/api/spotify/playlists/\\[id\\]/sync/route.ts"], rules: { complexity: ["error", 26], "max-depth": ["error", 5] } },
  { name: "complexity-budget/override", files: ["src/app/bands/\\[id\\]/page.tsx"], rules: { complexity: ["error", 30], "max-lines-per-function": ["error", 469], "max-lines": ["error", 487] } },
  { name: "complexity-budget/override", files: ["src/app/join/\\[code\\]/page.tsx"], rules: { "max-lines-per-function": ["error", 249] } },
  { name: "complexity-budget/override", files: ["src/app/page.tsx"], rules: { complexity: ["error", 18], "max-lines-per-function": ["error", 511], "max-lines": ["error", 640] } },
  { name: "complexity-budget/override", files: ["src/app/playlists/\\[id\\]/page.tsx"], rules: { complexity: ["error", 35], "max-lines-per-function": ["error", 1071], "max-lines": ["error", 1343] } },
  { name: "complexity-budget/override", files: ["src/app/profile/page.tsx"], rules: { complexity: ["error", 23], "max-lines-per-function": ["error", 385], "max-lines": ["error", 681] } },
  { name: "complexity-budget/override", files: ["src/components/landing/LandingPage.tsx"], rules: { "max-lines-per-function": ["error", 208] } },
  { name: "complexity-budget/override", files: ["src/components/layout/AppLayout.tsx"], rules: { complexity: ["error", 21], "max-lines-per-function": ["error", 202] } },
  { name: "complexity-budget/override", files: ["src/components/songs/SongForm.tsx"], rules: { complexity: ["error", 17], "max-lines-per-function": ["error", 459], "max-lines": ["error", 612] } },
  { name: "complexity-budget/override", files: ["src/components/tabs/TabDrawingStage.tsx"], rules: { complexity: ["error", 21], "max-lines-per-function": ["error", 757], "max-lines": ["error", 819] } },
  { name: "complexity-budget/override", files: ["src/hooks/useTabLibrary.ts"], rules: { "max-params": ["error", 5] } },
  { name: "complexity-budget/override", files: ["src/lib/bands.ts"], rules: { "max-params": ["error", 5] } },
  { name: "complexity-budget/override", files: ["src/lib/linkFetcher.ts"], rules: { complexity: ["error", 18] } },
  { name: "complexity-budget/override", files: ["src/lib/songs.ts"], rules: { complexity: ["error", 21], "max-lines": ["error", 529] } },
  { name: "complexity-budget/override", files: ["src/lib/tabs.ts"], rules: { "max-params": ["error", 5] } },
  { name: "complexity-budget/override", files: ["src/lib/__tests__/edge_cases.test.ts"], rules: { complexity: ["error", 32] } },
  { name: "complexity-budget/override", files: ["src/lib/__tests__/errors.test.ts"], rules: { complexity: ["error", 17] } },
  { name: "complexity-budget/override", files: ["src/lib/__tests__/spotify.test.ts"], rules: { "max-lines": ["error", 804] } },
  { name: "complexity-budget/override", files: ["src/lib/__tests__/test-helpers.ts"], rules: { complexity: ["error", 25] } },
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
