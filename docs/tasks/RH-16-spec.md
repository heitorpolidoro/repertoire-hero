# RH-16 — Replace `window.confirm()` with inline confirmation + Toast

## Scope

This task removes **every** remaining native `confirm()` call from the codebase and
replaces each one with an inline confirmation panel plus a floating Toast, the
pattern RH-8 already shipped for the "Regenerate invite link" control on the band
page.

### Files in scope

The task brief names two files. Investigation found a third with the same defect,
so the scope is stated explicitly here:

| File | Handlers using native `confirm()` | In scope |
|---|---|---|
| `src/app/bands/[id]/page.tsx` | `handleDelete` (L192), `handleLeave` (L203), `handleRemoveMember` (L213) | **Yes** — the task's stated subject |
| `src/app/songs/[id]/fast-view/page.tsx` | `handleDeleteTab` (L443), `handleDeleteLink` (L585) | **Yes** — `docs/tasks/RH-28-spec.md` (lines 427–430, 613–615) explicitly deferred these two to RH-16 |
| `src/app/profile/page.tsx` | `handleDelete` (L169), `handleLeave` (L180), `handleRemoveMember` (L190), inside the `BandProfileView` component | **Yes** — see below |

**Why `src/app/profile/page.tsx` is included (decision).** It was not mentioned in
the task brief, but `BandProfileView` in that file is a near-verbatim copy of the
band detail page: the same three handlers, the same three confirmation strings, the
same actions (`deleteBandAction`, `leaveBandAction`, `removeBandMemberAction`).
Reachable in the UI at `/profile` whenever the band-context store is set to a band
(`src/app/profile/page.tsx:862`). It is the same defect class, fixed by the same
pattern, in the same feature area, in a diff of the same shape. Excluding it would
also make the guardrail below impossible to state as "zero", leaving a permanent
baseline of three violations that nothing prevents from growing. Including it is
what makes the "no native dialogs anywhere" invariant enforceable.

Total: 8 `confirm()` call sites across 3 files. There are **no** `alert()` calls in
the tree today; the guardrail introduced here covers both.

### Not in scope

See "Out of Scope" at the end.

### Landing Page Rule — explicit decision

**This task is NOT a selling point and MUST NOT touch the landing page.** Replacing
a native browser dialog with an in-app confirmation is a UX-correctness fix to an
existing behaviour, not a capability a musician or band would choose the app for.
No change to `src/components/landing/**`, and no change to the `landing.*` keys in
`src/i18n/dictionaries/en.json` or `src/i18n/dictionaries/pt-BR.json`. This is
enforced as an expected result below.

Note: none of the three pages in scope consume the i18n dictionaries today (their
strings are hardcoded English — e.g. `"Leave band"`, `"Copied!"`). New confirmation
and toast copy is therefore hardcoded English too, matching the surrounding code.
Localising these pages is a separate concern and is out of scope.

## Approach

### 1. New shared component: `src/components/ui/ConfirmPanel.tsx`

Eight confirmations across three files need the same two-button affordance. Rather
than triplicating the markup, add one small presentational component. It owns no
business logic and no positioning — the caller places it.

```tsx
"use client";

export interface ConfirmPanelProps {
  message: string;
  /** Label of the destructive/affirmative button, e.g. "Delete", "Leave", "Remove". */
  confirmLabel: string;
  /** Label while the action is running; defaults to `${confirmLabel}...`. */
  busyLabel?: string;
  busy?: boolean;
  tone?: "danger" | "warning"; // default "danger"
  onConfirm: () => void;
  onCancel: () => void;
  /** Positioning / spacing supplied by the caller. */
  className?: string;
}
```

Rendering and behaviour requirements:

- Root element has `role="alertdialog"` and `aria-live="assertive"`.
- Panel styling follows the RH-8 panel already in the tree
  (`src/app/bands/[id]/page.tsx:353-376`): rounded box, tinted background and
  border — `border-red-200 bg-red-50` / text `text-red-800` for `tone="danger"`,
  `border-amber-200 bg-amber-50` / text `text-amber-800` for `tone="warning"`.
- Message paragraph, then a row with the confirm button first and a `Cancel`
  button second. Both `type="button"`, both `disabled={busy}` with
  `disabled:opacity-60`. Confirm button reads `busyLabel` while `busy`.
- The `Cancel` button receives DOM focus when the panel mounts (`useRef` +
  `useEffect`), so the safe choice is the default.
- A `keydown` listener on `document` calls `onCancel()` when `Escape` is pressed
  and `busy` is falsy; the listener is removed on unmount.
- Accessible names of the two buttons are exactly `confirmLabel` and `Cancel` —
  tests and QA select on these.

### 2. `src/app/bands/[id]/page.tsx`

Replace the three `confirm()` guards with one pending-action state:

```ts
type PendingAction =
  | { kind: "deleteBand" }
  | { kind: "leaveBand" }
  | { kind: "removeMember"; member: BandMember };

const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
const [actionBusy, setActionBusy] = useState(false);
```

- `handleDelete`, `handleLeave`, `handleRemoveMember` become *request* functions:
  they keep their existing guards (`handleLeave` keeps `if (!currentUserId) return`),
  drop the `confirm()` line, and only `setError(null); setPendingAction({...})`.
  Their names and call sites in JSX stay unchanged.
- A single `async function confirmPendingAction()` switches on `pendingAction.kind`
  and runs the body that used to follow the `confirm()` guard, wrapped in
  `setActionBusy(true)` / `finally { setActionBusy(false) }`, clearing
  `setPendingAction(null)` on success.
- Failure handling is unchanged from today and from RH-8: `setError(...)` with the
  existing messages (`"Failed to delete band"`, `"Failed to leave band"`,
  `"Failed to remove member"`), rendered by the existing red banner at L316.
- Success feedback:
  - `removeMember` → `showToast(\`${name} removed from the band.\`, "success")`
    using the page's existing `showToast` (L61) and Toast markup (L617-635).
  - `deleteBand` / `leaveBand` → `router.replace("/bands")` as today; **no toast**,
    because the page unmounts immediately and a toast on an unmounted page is
    unobservable. Navigation is the feedback. Do not add one.

Panel placement:

- **Delete band** — rendered directly beneath the band header block (after the
  `</div>` closing the header at L313, before the `error` banner), with
  `className="mt-4"`. Message: `Delete "<band name>"? This can't be undone.`,
  `confirmLabel="Delete"`, `tone="danger"`.
- **Leave band** — message `Leave this band?`, `confirmLabel="Leave"`,
  `tone="danger"`. There are two "Leave band" buttons (L436 for non-admins, L530
  for admins of a band with more than one member); their render conditions are
  mutually exclusive on `isAdmin`, so the panel may be rendered inside **both**
  branches guarded by `pendingAction?.kind === "leaveBand"` without ever appearing
  twice. Place it immediately after the button in each branch.
- **Remove member** — the member `<li>` (L389) becomes a column: the existing flex
  row, followed by the panel when
  `pendingAction?.kind === "removeMember" && pendingAction.member.id === member.id`.
  Message: `Remove <display name> from the band?` using the same
  `member.profile?.full_name ?? "this member"` fallback as today.
  `confirmLabel="Remove"`, `tone="danger"`.

**RH-8 consolidation:** the existing regenerate-invite confirmation (L353-376) is
re-expressed through `ConfirmPanel` with `tone="warning"`, the same copy
("This will invalidate the current link immediately. Anyone with the old link
won't be able to join."), `confirmLabel="Regenerate"`,
`busyLabel="Regenerating..."`, `busy={regenerating}`. Its behaviour, copy and
success toast must be unchanged — this is a markup consolidation only, so the page
does not end up with two visually different confirmation styles. `confirmingRegenerate`
and `handleRegenerateInvite` keep their current shape.

### 3. `src/app/profile/page.tsx` (`BandProfileView`)

Apply exactly the same treatment as §2 to `handleDelete` (L168), `handleLeave`
(L178) and `handleRemoveMember` (L189), with the same copy, tones and panel
placements adapted to this component's markup: delete panel under the band header
section (after L316), leave panel under the "Leave band" button (L394), remove
panel inside the member `<li>` (L347).

`BandProfileView` currently has **no** toast infrastructure. Add the same local
toast used by the band page — `toast` state, `showToast(message, type)`, the 4s
auto-dismiss `useEffect`, and the fixed bottom-centre Toast markup — copied from
`src/app/bands/[id]/page.tsx:58-69` and `:616-635`. Used for the
`<name> removed from the band.` success message.

This duplicates the toast block a second time on purpose: extracting a shared
Toast component would require touching the fast-view toast (which has four
variants and different colours) and is a larger refactor than this task should
carry. Recorded in Out of Scope as a follow-up.

### 4. `src/app/songs/[id]/fast-view/page.tsx`

This page already has `showToast` with four variants (L116-126) and its own bottom-
centre Toast (L1546). The two delete confirmations are driven by one state:

```ts
type PendingDelete =
  | { kind: 'tab'; tabId: string; origin: 'band' | 'personal'; targetId: string }
  | { kind: 'link'; url: string }

const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
const [deleteBusy, setDeleteBusy] = useState(false)
```

- `handleDeleteTab(tabId, origin)` keeps its existing `targetId` resolution and
  `if (!targetId) return` guard — so a confirmation is never opened for an action
  that cannot run — then sets `pendingDelete` instead of calling `confirm()`.
- `handleDeleteLink(urlToDelete)` keeps `if (!entry || !entry.song) return`, then
  sets `pendingDelete`.
- `confirmPendingDelete()` runs the existing bodies unchanged, including the
  existing error toasts (`showToast(res.error, 'error')`,
  `'Failed to delete tab'`, `'Failed to delete link.'`) and the existing
  `showToast('Link deleted.', 'info')`. Add `showToast('Tab deleted.', 'info')` for
  the tab case, which today gives no success feedback.
- Both JSX call sites keep calling `handleDeleteTab` / `handleDeleteLink` — no
  changes to the tab list or link card markup.
- One `ConfirmPanel` is rendered for both cases, bottom-anchored like the existing
  Toast but above it so the two never overlap:
  `className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-sm shadow-xl"`.
  Copy: `Delete this tab? This can't be undone.` / `Delete this link? This can't be undone.`,
  `confirmLabel="Delete"`, `tone="danger"`, `busy={deleteBusy}`.
- The confirmation does **not** auto-dismiss (unlike the 4s toast); it is closed
  only by Confirm, Cancel or Escape.

Precedent for a bottom-anchored confirmation card on this page already exists in
`src/components/tabs/TabDrawingStage.tsx:782-805` ("Clear-page confirmation —
Toast-based, no native confirm()"); this follows it.

### 5. Guardrail test: `src/lib/__tests__/noBrowserDialogs.test.ts`

Vitest runs in the `node` environment with no DOM library, and coverage excludes
`src/app/**` and `src/components/**`, so the confirmations cannot be unit-tested as
components. What *can* be tested — and is worth more against regression — is the
invariant itself. New file, no DB required:

- A `findBrowserDialogCalls(source: string): string[]` helper that strips `//` line
  comments and `/* */` block comments, then matches
  `/(?:^|[^A-Za-z0-9_$.])(?:window\s*\.\s*)?(?:confirm|alert)\s*\(/` per line.
  Comment stripping is required so the TabDrawingStage JSX comment does not trip it;
  the `[^A-Za-z0-9_$.]` prefix class avoids flagging unrelated members like
  `foo.confirm(`, while the optional `window\s*\.\s*` alternative still catches
  `window.confirm(` and `window.alert(`.
- Test 1 — *detector works*: `findBrowserDialogCalls("if (!confirm('x')) return")`
  and `findBrowserDialogCalls("window.alert('x')")` each return one match, and
  `findBrowserDialogCalls("// no native confirm() here")` returns none. Without
  this, a broken regex would make Test 2 pass vacuously.
- Test 2 — *tree is clean*: recursively walk `src/` for `.ts`/`.tsx`, skipping this
  test file itself, and assert the aggregated list of `file:line` violations is
  empty. On failure the assertion message lists the offending locations.
- The file must be written so that it does not itself match the shell grep gate
  (build the pattern so the literal text `confirm(` / `alert(` never appears
  adjacent to an opening parenthesis, e.g. `(?:confirm|alert)\s*\(`); the gate also
  excludes it by name as a belt-and-braces measure.

### 6. E2E test: `e2e/bands-confirm.spec.ts`

Playwright auto-dismisses dialogs when no handler is registered, so `confirm()`
returns `false` and the deletion silently does nothing — meaning this spec **fails
on today's code and passes only once the native dialog is gone**. Chromium project,
`test.use({ storageState: AUTH_STATE_PATH })` as in `e2e/songs-crud.spec.ts`.

Shared setup per test: register `const dialogs: string[] = []; page.on('dialog', d => { dialogs.push(d.message()); d.dismiss() })`, then create a band through the UI —
`/bands` → `+ New Band` → fill `Band name` → `Create Band`, which routes to
`/bands/<id>` — using a unique name such as `E2E Band Confirm ${Date.now()}`.

1. **delete via inline confirmation** — click `getByTitle('Delete band')`; assert a
   `role="alertdialog"` is visible and contains the band name; click its `Delete`
   button; assert the URL is `/bands` and the band name is no longer listed; assert
   `dialogs` is empty.
2. **cancel keeps the band** — open the confirmation, assert the `Cancel` button is
   focused, click `Cancel`, assert the alertdialog is gone, the URL is still
   `/bands/<id>` and the band header still shows the name; assert `dialogs` is
   empty. Finish by deleting the band so no stray row is left behind.
3. **Escape dismisses** — open the confirmation, press `Escape`, assert the
   alertdialog is gone and the band still exists; assert `dialogs` is empty.

Leaving a band is not covered by E2E: the admin "Leave band" button only renders
when the band has more than one member, and the harness has a single seeded user.
It is covered by the guardrail test and by manual QA.

### 7. Lint baseline

`npm run lint` already exits 1 on the untouched tree with `✖ 44 problems
(24 errors, 20 warnings)`. Two of the three files edited here are among the
offenders — `src/app/songs/[id]/fast-view/page.tsx` (3 errors: `prefer-const` at
14:7, `@typescript-eslint/no-explicit-any` at 431:19 and 813:74; plus 3
`no-unused-vars` warnings) and `src/app/profile/page.tsx` (2 errors: "Calling
setState synchronously within an effect" at 83:5 and 818:5). None of these
relate to `confirm()`, and **this task does not fix them** (see Out of Scope).

The bar for RH-16 is therefore: the three *new* files are lint-clean, and the
project-wide counts do not rise above the 24 / 20 baseline. `npx tsc --noEmit`
does exit 0 today and must still exit 0 after.

### 8. Version bump

Per AGENTS.md, bump `package.json`. The highest version used so far is
`0.1.55-202609030059`, so this task ships `0.1.56-<YYYYMMDDHHmm>` (local time at
commit). The version must only ever go up.

## Expected Results

- [ ] Run from the repo root, `grep -rnE "(^|[^A-Za-z0-9_.])(confirm|alert)[[:space:]]*\(" src --include='*.ts' --include='*.tsx' | grep -v "noBrowserDialogs.test.ts"` returns **exactly one** line — the JSX comment in `src/components/tabs/TabDrawingStage.tsx` reading `Clear-page confirmation — Toast-based, no native confirm()` — and in particular **zero** lines from `src/app/bands/[id]/page.tsx`, `src/app/profile/page.tsx` and `src/app/songs/[id]/fast-view/page.tsx`. (Baseline before this task: 9 lines, of which 8 are real `confirm()` calls in those three files.)
- [ ] The file `src/lib/__tests__/noBrowserDialogs.test.ts` exists and `npx vitest run src/lib/__tests__/noBrowserDialogs.test.ts` exits 0 with all tests passing (no DB needed). It contains at least two tests: one asserting its own detector flags the snippets `if (!confirm('x')) return` and `window.alert('x')` while ignoring the same text inside a `//` comment, and one that recursively scans every `.ts`/`.tsx` file under `src/` (excluding itself) and fails, listing `file:line`, if any native `confirm(`/`alert(`/`window.confirm(`/`window.alert(` invocation is found.
- [ ] `src/components/ui/ConfirmPanel.tsx` exists, its root element carries `role="alertdialog"`, it renders one button whose accessible name is the caller-supplied confirm label and one named exactly `Cancel`, it moves DOM focus to the `Cancel` button when it mounts, and pressing `Escape` while it is open invokes its cancel callback. `grep -rn "ConfirmPanel" src --include='*.tsx' | grep import` lists exactly three importing files: `src/app/bands/[id]/page.tsx`, `src/app/profile/page.tsx`, `src/app/songs/[id]/fast-view/page.tsx`.
- [ ] On `/bands/<id>` signed in as a band admin: clicking the trash button (`title="Delete band"`) opens an in-page confirmation containing the band's name and the buttons `Delete` and `Cancel`, and **no** native browser dialog appears. Clicking `Cancel` closes it and the band is still there. Re-opening it and clicking `Delete` deletes the band, navigates to `/bands`, and the band is no longer listed.
- [ ] On `/bands/<id>` as an admin of a band with at least two members: clicking the `×` next to another member opens an in-page confirmation inside that member's row reading `Remove <member name> from the band?` with `Remove` / `Cancel` buttons and no native dialog. `Cancel` leaves the member in the list. `Remove` removes the member's row and shows a floating dark toast at the bottom centre of the screen reading `<member name> removed from the band.`, which disappears on its own after about 4 seconds.
- [ ] On `/bands/<id>` as a non-admin member: clicking `Leave band` opens an in-page confirmation reading `Leave this band?` with `Leave` / `Cancel` buttons and no native dialog; `Cancel` closes it and keeps the user in the band; `Leave` leaves the band and navigates to `/bands`.
- [ ] On `/profile` with the band context switched to a band (the band tab of the profile page), the delete-band, remove-member and leave-band controls behave exactly as described in the three results above — in-page confirmation with `Cancel`, no native browser dialog anywhere, and a floating toast reading `<member name> removed from the band.` after a successful member removal.
- [ ] On `/songs/<id>/fast-view`, deleting a tab and deleting a link each open an in-page confirmation card near the bottom of the screen (`Delete this tab? This can't be undone.` / `Delete this link? This can't be undone.`) with `Delete` and `Cancel` buttons and **no** native browser dialog; `Cancel` leaves the item in place; `Delete` removes it from the list and shows a toast reading `Tab deleted.` / `Link deleted.`. The confirmation card does not auto-dismiss — it stays until Confirm, Cancel or `Escape`.
- [ ] The RH-8 invite-link flow on `/bands/<id>` still works after the refactor: as an admin, clicking `Regenerate` shows an amber in-page confirmation warning that the current link will be invalidated, with `Regenerate` / `Cancel`; `Cancel` closes it with the invite URL unchanged; `Regenerate` changes the invite URL shown in the read-only input and shows a toast reading `Invite link regenerated. The old link no longer works.`
- [ ] `e2e/bands-confirm.spec.ts` exists and `npx playwright test e2e/bands-confirm.spec.ts --project=chromium` passes against a running app with a migrated database. It contains three tests (delete via the inline confirmation, cancel keeps the band, `Escape` dismisses the confirmation), each of which creates its own uniquely named band through the UI and asserts that no native `dialog` event fired on the page during the test.
- [ ] Lint and types: (a) `npx eslint src/components/ui/ConfirmPanel.tsx src/lib/__tests__/noBrowserDialogs.test.ts e2e/bands-confirm.spec.ts` reports **0 errors and 0 warnings** — the three files this task creates must be clean; (b) `npm run lint` (which lints the whole project) reports **no more than the pre-existing baseline of 24 errors and 20 warnings** in its `✖ N problems (E errors, W warnings)` summary line, and **none** of the reported problems is located in `src/components/ui/ConfirmPanel.tsx`, `src/lib/__tests__/noBrowserDialogs.test.ts` or `e2e/bands-confirm.spec.ts`; (c) `npx tsc --noEmit` exits 0. Note for QA: `npm run lint` exits **1** both before and after this task, because of pre-existing problems in files RH-16 does not fix (including 3 errors + 3 warnings in `src/app/songs/[id]/fast-view/page.tsx` and 2 errors in `src/app/profile/page.tsx`). That non-zero exit is expected and is **not** a failure of this task; only an increase above 24 errors / 20 warnings, or a problem in one of the three new files, is.
- [ ] The `version` field in `package.json` matches the regex `^0\.1\.(5[6-9]|[6-9][0-9])-[0-9]{12}$` and is **not** `0.1.55-202609030059` (check with `node -p "require('./package.json').version"`).
- [ ] The commits implementing RH-16 (found with `git log --grep RH-16`) change **no** file under `src/components/landing/` and **no** file under `src/i18n/dictionaries/` — verify with `git show --name-only` on each of them. This task is an internal UX-correctness fix, not a selling point, so the landing page and its copy stay untouched.

## Out of Scope

- Extracting a shared Toast component / `useToast` hook. Three pages will now carry
  near-identical local toast state (`bands/[id]/page.tsx`, `profile/page.tsx`,
  `fast-view/page.tsx` — the last with four variants and different colours).
  Consolidating them is a worthwhile follow-up but a different diff; this task adds
  the third copy deliberately and changes no existing toast behaviour.
- De-duplicating `BandProfileView` in `src/app/profile/page.tsx` against
  `src/app/bands/[id]/page.tsx`. They remain two near-identical implementations;
  both are fixed here, neither is merged.
- Localising the band, profile or fast-view pages. They are hardcoded English today
  and stay that way; no `src/i18n/dictionaries/**` changes.
- E2E coverage of leaving a band, of the `/profile` band tab, and of tab/link
  deletion in fast view (the latter needs a Vercel Blob PDF upload in CI).
- Any change to the Server Actions (`deleteBandAction`, `leaveBandAction`,
  `removeBandMemberAction`, `deleteTabAction`, `updateSongLinksAction`) or to their
  authorization rules. This task is presentation-layer only.
- The Stage Mode clear-page confirmation in `src/components/tabs/TabDrawingStage.tsx`,
  which already follows the correct pattern and is left as is.
- **Clearing the pre-existing lint errors and warnings in the files this task
  touches.** `src/app/songs/[id]/fast-view/page.tsx` (`prefer-const` at 14:7,
  `no-explicit-any` at 431:19 and 813:74, three `no-unused-vars` warnings) and
  `src/app/profile/page.tsx` (two "setState synchronously within an effect"
  errors at 83:5 and 818:5) stay exactly as they are. They predate RH-16, are
  unrelated to native dialogs, and the `no-explicit-any` / effect fixes in
  particular carry their own behavioural risk. Consequently `npm run lint` still
  exits 1 after this task; the gate is the 24-error / 20-warning baseline not
  rising, not a zero exit code. Fixing them is a separate lint-cleanup task.
