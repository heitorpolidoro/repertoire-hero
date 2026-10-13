# RH-29 — Evaluate turning Repertoire Hero into an Android and iOS app

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


(Filename is board id + 1 by repo convention; the task id is RH-29.)

## Scope
`docs/plans/mobile-app-analysis.md` already exists and answers the operator's question: it compares PWA/TWA, Capacitor and React Native/Expo, covers code impact, store requirements, auth and deep links, fees, effort, and ends with a phased recommendation (harden PWA, build account deletion and offline, Capacitor with `server.url`, re-evaluate native later). It is accepted as the deliverable. Only two gaps remain, and this task closes them. Documentation only, no application code.

1. The document is stale. Its own correction notes (RH-43, RH-74) state that `force-dynamic` was removed from the root layout (RH-61) and that `src/proxy.ts` no longer fetches the session (RH-65). Section 3.1 argues that static export is impossible partly from the first of those, and the notes defer re-deriving that conclusion.
2. Offline, push and deep links are covered per option only in scattered prose, with no side-by-side view the operator can decide from.

Not covered: building any recommended follow-up (manifest, account deletion, Capacitor shell, offline cache, push design), and rewriting the unchanged sections.

## Approach
Edit `docs/plans/mobile-app-analysis.md` only.
- Re-derive section 3.1 against the current code. State which blockers to `output: "export"` still hold (Server Actions cannot be statically exported; cookie auth from a `capacitor://` origin is third-party) and which no longer do (`force-dynamic`, fetching proxy). State whether the recommendation (Capacitor with `server.url`) changes; the expected outcome is that it does not.
- Fold the two correction notes into the affected sections, or reduce them to a one-line changelog, so the body no longer contradicts the code. Keep the RH-19 resolved marker.
- Add one comparison table with rows PWA only, PWA + TWA, Capacitor (`server.url`), React Native/Expo and columns auth/cookies, deep links, offline, push, recurring cost, effort. Values must come from the existing sections, plus a short statement of push per platform (Web Push on iOS only after Home Screen install; FCM and APNs through Capacitor or native).
- Add a "Status" line at the top: date, code version it was re-verified against, decision requested from the operator.
- Check the cited file and line references against the repo and fix any that drifted.

Test criteria: read-through plus grep. No test suite is touched.

## Expected Results
- [ ] `docs/plans/mobile-app-analysis.md` contains no statement that `force-dynamic` is still set in `src/app/layout.tsx` or that `src/proxy.ts` fetches `/api/auth/get-session`.
- [ ] Section 3.1 gives a re-derived conclusion on `output: "export"` that names the blockers still in force, and says whether the Capacitor `server.url` recommendation is unchanged.
- [ ] The document has one table comparing PWA only, PWA + TWA, Capacitor and React Native/Expo on auth, deep links, offline, push, recurring cost and effort, with no empty cells.
- [ ] A Status line at the top gives the verification date and the code version checked.
- [ ] The final recommendation section still names one recommended path and its phases, and lists the follow-up backlog items.
- [ ] `git diff --stat -- docs/plans/mobile-app-analysis.md` shows the document changed, and `git status --porcelain -- docs/plans` lists no path other than that document (the untracked task spec is checked by existence, not by diff; unrelated working-tree changes outside `docs/plans` are pre-existing and ignored).

## Out of Scope
Implementing any follow-up item; creating the follow-up tasks on the board (a PM step after the operator approves the recommendation); push notification architecture.
