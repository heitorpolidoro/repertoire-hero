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
