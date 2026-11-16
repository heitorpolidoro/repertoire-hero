VERDICT: APPROVED

Diff reviewed: `git diff master...HEAD`, 34 files changed, +2828 / -1 lines across commits `f7245de` through `b0e544d`; working tree clean.

## Blocking Findings
None.

## Suggestions
None.

## What was checked

1. **Spec & Acceptance Criteria Alignment**:
   - Migration `migrations/0032_subscriptions.sql` implements the full subscription schema: `user_id` (unique, FK to `profiles(id)` on delete cascade), `plan` (`free`, `pro`), `status` (`trialing`, `active`, `past_due`, `canceled`), `trial_ends_at`, `current_period_ends_at`, `cancel_at_period_end`, `provider`, `provider_customer_id`, and `provider_subscription_id` (ER 1, AC-1).
   - `src/lib/subscriptions.ts` defaults to Pro when `BILLING_ENFORCED !== 'true'` without database queries; when enforced, new users lazily receive a 14-day Pro trial (ER 2, AC-2).
   - Central entitlements engine in `src/lib/entitlements.ts` implements exact Free and Pro limits (Free: 50 charts, 2 custom fields, 0 audio, 0 tokens, no setlist player, 5 offline songs, no download all; Pro: unlimited charts with 2 GB abuse guard, unlimited custom fields, 1 GB audio, tokens enabled, setlist player enabled, unlimited offline songs, download all enabled) and pure `can*` predicates (ER 2, AC-2).
   - `PaymentAdapter` in `src/lib/billing/types.ts` defines neutral interfaces without leaking third-party SDK dependencies (verified by unit test in `mockBillingAdapter.test.ts`) (ER 3, AC-3).
   - `MockPaymentAdapter` in `src/lib/billing/mockAdapter.ts` generates deterministic sessions pointing to `/mock-checkout?session_id=...` and correctly activates Pro upon completion (ER 4, AC-4).
   - Webhook route `POST /api/billing/webhook` forwards raw body and headers to the configured payment adapter and answers `200` with `{ received: true }` (ER 5, AC-5).
   - Settings page mounts `SubscriptionSettingsSection` with plan badge, trial/renewal date, and upgrade or manage actions (ER 6, AC-6).
   - Vitest suite (with DB tests enabled via `RUN_DB_TESTS=1`), test coverage gates, `npm run lint`, and `npx tsc --noEmit` all exit 0 (ER 7, AC-7).

2. **Behavior Registry**:
   - `docs/behavior.md` diff verified against `docs/tasks/RH-202-spec.md` `## Behavior changes`. All three added lines match word-for-word in the `Auth and profile` section.

3. **Architecture & Patterns**:
   - Client Action Injection (F21): `SubscriptionSettingsSection` receives `BILLING_SETTINGS_ACTIONS` and `MockCheckoutPanel` receives `MOCK_CHECKOUT_ACTIONS` through props from Server Action bundle `src/app/billingActions.ts`.
   - Server Component Pattern: `src/app/mock-checkout/page.tsx` is an async Server Component validating session through `getSession()` and redirecting unauthenticated requests to `/login`.
   - Line Budget: `src/types/subscription.ts` was created to keep `src/types/database.ts` at its 400-line limit; all new implementation files remain comfortably under 400 lines (`subscriptions.ts`: 208 lines, `entitlements.ts`: 111 lines, `mockAdapter.ts`: 110 lines, `billing.ts` action: 89 lines).
   - Production Guard: `getPaymentAdapter()` throws in production if `BILLING_ENFORCED === 'true'` while using the mock adapter.

4. **Security & Session Scoping**:
   - All Server Actions in `src/app/actions/billing.ts` enforce user authentication via `getRequiredUserId()`.
   - `completeMockCheckoutAction` validates session ownership against the signed-in user id.
   - `cancelSubscriptionAction` queries only the authenticated user's subscription record.
   - All 5 billing Server Actions are registered as `FAIL_CLOSED` in `src/app/actions/__tests__/actionSessionGuard.test.ts` and pass.
   - Webhook handler safely parses payloads, handles errors gracefully, and returns status 400 on invalid payloads without leaking internal stack traces.

5. **Test Suite & Verification**:
   - Vitest: 338 test files passed (4,148 tests passed, 3 skipped).
   - Coverage: Statements 97.13%, Branches 90.81%, Functions 96.97%, Lines 97.81% (well above thresholds: 80 / 65 / 78 / 80).
   - Lint & Typecheck: `npm run lint` and `npx tsc --noEmit` passed with 0 errors.
