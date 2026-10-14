# RH-82 — Decide and execute the App Store path for Repertoire Hero

## Scope
A documentation and decision task. It extends `docs/plans/mobile-app-analysis.md` (the RH-29 deliverable); it creates no new document and changes no application code. It covers:

1. Verifying first-hand what Apple's current App Review Guidelines say about repackaged websites and minimum functionality.
2. Recording a reasoned choice between three paths: Capacitor over the existing code, a React Native rewrite, or no App Store release (iOS stays on the home-screen PWA).
3. Stating the cost of that choice against this codebase and the recurring costs of Apple distribution.
4. Handing the decision to the operator with a recommended path; the operator's answer is the decision.
5. Executing the outcome of the decision (see "Outcome handling").

It does not cover implementing Capacitor, React Native, an HTTP API or account deletion. Those become child tasks only if the operator decides to proceed.

## Approach
Behavior, files touched and tests, in that order.

**Premise check comes first.** The task text claims that a WKWebView wrapper is the textbook rejection under Apple's minimum-functionality guideline. The implementer fetches Apple's current App Review Guidelines (https://developer.apple.com/app-store/review/guidelines/) directly. They quote the relevant text verbatim, with section numbers (at least 4.2 and 4.2.x; 5.1.1(v) for account deletion), and record the access date. They then state plainly whether the premise is confirmed, refuted or nuanced. A summary from memory or a third-party site does not count. If the page cannot be fetched, say so and do not fill the gap from memory. Mark the section "unverified" and tell the operator.

**Reconcile with the existing document.** `docs/plans/mobile-app-analysis.md` §6 already recommends Capacitor with `server.url` and mitigates 4.2 with offline, Pencil, wake lock and share. The new section must test that recommendation against the verified guideline text instead of repeating it. One fact must be stated precisely, because it affects the cost claim. The `server.url` variant keeps Server Actions and cookie auth and needs no HTTP API. It is also the variant closest to a "repackaged website". The bundled-assets variant and React Native need a real HTTP API in front of Postgres. In that API every endpoint must authorize and fail closed (deny by default, covered by guard tests like the existing `actionSessionGuard.test.ts` and `actionAuthorizationGuard.test.ts`). It would be a new authorization surface in a repository that keeps a security audit. The document must say which of these costs applies to the chosen path. If the guideline text makes `server.url` too risky, the API cost applies to the Capacitor path too. The cost must be tied to concrete files and tasks: `next.config.ts` has no `output: 'export'`, and the Server Components added by RH-61, RH-62, RH-63, RH-71 and RH-77 are incompatible with it. Verify each reference against the code or task before citing it.

**Decision section.** Add a new top-level section to the document, "App Store decision (RH-82)", and update the Status banner at the top of the file. It contains:
- The verified guideline quotes.
- The chosen path and the written justification, with the two rejected paths and why.
- The cost against this codebase, as above, using the document's existing effort scale.
- The recurring costs: Apple Developer Program membership (US$99/year, re-check the current price), a Mac or paid cloud build service for builds and signing, certificates and provisioning profiles, and a review cycle measured in days for every fix, including urgent ones.
- A recommendation addressed to the operator, with the decision explicitly left to them. The question is whether an App Store listing is a business requirement, and that is not a technical one.

**Outcome handling (after the operator answers).**
- Proceed: do not implement. Hand back a decomposition into PR-sized children (for example account deletion, API layer with fail-closed authorization, shell, Pencil support, Spotify OAuth, version derivation, privacy forms, release pipeline). Reuse the backlog items in §6.1 of the analysis where they still apply. The task is then split, not executed as one.
- Do not proceed: record the reasoning in the same document, in the decision section, so the question is not re-opened from scratch. Close the task as `nope` through the Meridian flow (the `work` skill does this, not the implementer).

**Files touched**
- `docs/plans/mobile-app-analysis.md`: Status banner updated, decision section added, §6 reconciled where it conflicts. No other file changes.

**Not part of the document contract.** The outcome handling above (split into children, or `nope` closure) happens only after the operator answers and is performed by the `work` skill. It is checked then, not against the document as written.

**Test criteria.** There are no automated tests. Verification is by reading the document: the quoted text appears with section numbers and a date, the chosen path has a written justification, the cost and recurring-cost items are all present, and the recommendation leaves the decision to the operator. Run the repository's markdown or lint checks if any apply.

## Expected Results
- [ ] `docs/plans/mobile-app-analysis.md` quotes guideline 4.2 verbatim, labelled with its section number.
- [ ] The same file records the date Apple's guidelines page was accessed.
- [ ] The same file states whether the "repackaged website is rejected" premise is confirmed, refuted or nuanced.
- [ ] The "App Store decision (RH-82)" section names exactly one recommended path: Capacitor, React Native, or no App Store.
- [ ] The section gives a written reason for each of the two paths not recommended.
- [ ] The section states whether the recommended path needs the fail-closed HTTP API.
- [ ] The section states the Apple Developer Program annual fee as a dollar amount.
- [ ] The section ends with a sentence stating that the operator's answer is the decision.

The remaining detail (`output: 'export'` absent from `next.config.ts` and its conflict with the Server Components of RH-61/62/63/71/77, the Mac or cloud build, certificates and provisioning profiles, the days-long review cycle) stays required by the Approach above but is not a separate result.

## Out of Scope
Any application code, the Capacitor or React Native projects, the HTTP API, account deletion, store assets, and push notification design.
