# Task Breakdown - Repertoire Hero

## Phase 1: Infrastructure & Project Setup
- [ ] **T1.1:** Initialize Next.js project with Tailwind CSS and TypeScript.
- [ ] **T1.2:** Configure Supabase Client and Environment Variables (including local bypass toggle).
- [ ] **T1.3:** Create database schema migrations (profiles, songs, and enums).
- [ ] **T1.4:** Setup Seed script for local development with `heitor.polidoro@gmail.com`.

## Phase 2: Authentication & Core Layout
- [ ] **T2.1:** Implement Auth Middleware for bypass in development mode.
- [ ] **T2.2:** Create basic Layout (Sidebar/Navbar) responsive for Mobile & Desktop.
- [ ] **T2.3:** Implement Login Page (Production) and Auto-login logic (Local).

## Phase 3: Song Management (CRUD)
- [ ] **T3.1:** Implement Song List view with basic search and filtering by status/tags.
- [ ] **T3.2:** Create Song Details/Form for adding and editing songs.
- [ ] **T3.3:** Implement Status update quick-actions (Ready, Learning, etc).
- [ ] **T3.4:** Implement Delete song functionality with confirmation.

## Phase 4: UI/UX Refinement
- [ ] **T4.1:** Implement "Fast View" mode for mobile performance/shows.
- [ ] **T4.2:** Add visual indicators for song progress (color-coded statuses).
- [ ] **T4.3:** Setup basic unit tests for song filtering logic.
- [ ] **T4.4:** Write E2E tests for the song CRUD happy path (add, edit, delete) using Playwright. DoD: CI run passes; test covers all three actions end-to-end against a Supabase local instance.
- [ ] **T4.5:** Write E2E tests for authentication flows (production login and local auto-login bypass). DoD: Both auth paths are exercised; CI run passes.
- [ ] **T4.6:** Write E2E tests for "Fast View" mode on a mobile viewport. DoD: Playwright device emulation confirms the correct layout and song search behavior at mobile breakpoints.

## Phase 5: Audit & Deployment
- [ ] **T5.1:** Perform security audit on Supabase RLS policies.
- [ ] **T5.2:** Configure Vercel deployment pipeline.

## Phase 6: CI/CD & Quality Gates

### T6.1 – GitHub Actions: Core CI Workflow
- [ ] **T6.1:** Create `.github/workflows/ci.yml` that runs on every push and pull request. DoD: Workflow installs dependencies, runs `next build`, executes unit tests (`vitest`), and executes E2E tests (`playwright`) in CI. Build failures block PR merges.

### T6.2 – SonarCloud Integration
- [ ] **T6.2:** Configure SonarCloud project for the repository and add the `SONAR_TOKEN` secret to GitHub. Create `sonar-project.properties` at the project root. DoD: The CI workflow includes a SonarCloud scan step; quality gate status is reported back on every pull request. Coverage report is uploaded so SonarCloud tracks line coverage.

### T6.3 – DeepSource Integration
- [ ] **T6.3:** Add `.deepsource.toml` to enable the JavaScript/TypeScript analyser. DoD: DeepSource runs on every commit; any new issues at severity "critical" or "major" are surfaced as PR checks.

### T6.4 – Branch Protection & Merge Rules
- [ ] **T6.4:** Configure GitHub branch protection on `main`: require CI, SonarCloud quality gate, and DeepSource checks to pass before merging. DoD: Direct pushes to `main` are rejected; all checks are required status checks.

## Phase 7: Observability

### T7.1 – Frontend Error Monitoring (Sentry)
- [ ] **T7.1:** Integrate Sentry SDK (`@sentry/nextjs`) in the Next.js project. Configure DSN via Vercel environment variable (`SENTRY_DSN`). DoD: Unhandled React errors and unhandled promise rejections are captured in Sentry; source maps are uploaded during Vercel build.

### T7.2 – Vercel Analytics & Web Vitals
- [ ] **T7.2:** Enable Vercel Analytics and Speed Insights on the Vercel project. DoD: Core Web Vitals (LCP, CLS, FID) are visible in the Vercel dashboard; no additional instrumentation code is required beyond the package import.

### T7.3 – Structured Client-Side Logging
- [ ] **T7.3:** Define a thin logging utility (`src/lib/logger.ts`) that wraps `console.error`/`console.warn` in production and forwards critical events to Sentry as breadcrumbs. DoD: All Supabase API error paths in the data layer call `logger.error`; Sentry breadcrumbs confirm event delivery in a staging test.
