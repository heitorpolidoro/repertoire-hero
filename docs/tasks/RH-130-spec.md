# RH-130 — Make confirmDelete read the link-removal envelope

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


## Scope
`confirmDelete` in `src/hooks/useSongLinks.ts` must treat a `{ success: false, error }` result from `actions.updateLinks` as a failure, as `submit` already does. Covers the hook, its test, and the three passages that record this as an open remainder. Does not change `submit`, the offline-disabled controls, or the `pending` path.

## Approach
Behavior: after `updateLinks` resolves, `success: false` is checked before `pending`. On refusal, `onLinksSaved` is not called, no `Link deleted.` toast is raised, and the envelope's `error` is shown as an error toast (fallback `Failed to delete link.` when `error` is empty). The delete confirmation still closes and `deleteBusy` still resets. `pending` and plain-success behaviour are unchanged. A rejection keeps its existing `Failed to delete link.` toast.

Files touched:
- `src/hooks/useSongLinks.ts`: branch on `success` in `confirmDelete`; drop the "mirrors" gap from comments if stale.
- `src/hooks/__tests__/useSongLinks.test.tsx`: add a test for a `{ success: false, error }` envelope next to the existing delete tests.
- `src/lib/offlineFirst.ts`: doc block (~line 55-59) says `confirmDelete` now reads the envelope; remove "Tracked as RH-130".
- `docs/use-cases.md`: *Read offline* section (~line 1003-1007), same update.
- `docs/plans/repertoire-rework.md`: `Disable every write control while offline` item (~line 620-623), mark the remainder closed.
- `package.json`: version bump per AGENTS.md.

Test criteria: new test asserts all three behaviours; existing pending, success, and rejection tests pass unchanged. No complexity-budget override added.

## Expected Results
- [ ] ER1-ER5 as returned in the task's `expected_results`.

## Out of Scope
Changing `submit`, adding new toasts for other writes, UI changes (no mock).
