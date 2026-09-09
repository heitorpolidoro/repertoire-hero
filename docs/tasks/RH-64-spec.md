# RH-64 — Server Components parte 4/5: reduzir useBandAdmin a dados mais comandos de intencao

Parent: RH-41 (F14, part 4 of 5). Depends on RH-63 (`35d6f66`, done).
Baseline for every measurement in this document: `35d6f66`
(`feat(RH-63): convert /playlists to a Server Component with client islands`).

## Scope

Redesign the interface of exactly one module — `src/hooks/useBandAdmin.ts`, 370
lines, one hook function of 298 lines returning **39 members, ten of them raw
`set*` state setters** — into data plus intent-named commands, and rewrite the
two consumers that destructure it (`src/app/bands/[id]/page.tsx`,
`src/app/profile/page.tsx`) against the new surface.

This is F14 and nothing else. It is not a Server Components task: `/bands/[id]`
and `/profile` stay `"use client"`, keep their mount-time load effect, and keep
the `// eslint-disable-next-line react-hooks/set-state-in-effect` that guards it
(the comment moves with no line of the effect it guards, and is not relocated to
a new file). Part 4 was chained after part 3 only because the board runs one
task at a time; it shares no code with parts 1-3.

Three things come with the redesign and are part of this task:

1. **The `setBand` / `setError` / `setCopied` escape hatches the pages use.**
   `/bands/[id]`'s regenerate-invite flow (page lines 80-96) writes the hook's
   band, error and copied state directly. Those three writes become two intent
   commands (`invite.applyNewCode(code)` and `reportError(message)`) plus
   `dismissError()`; no raw setter survives on the surface.
2. **The pure state transitions** the hook performs inline today (seeding the
   edit draft from a band, trimming it back into an update payload, patching the
   loaded band, dropping a removed member), which move to a new
   `src/lib/bandAdminState.ts` next to the existing `src/lib/bandAdminLoad.ts`
   and get unit tests of their own.
3. **The complexity ratchet.** `src/hooks/useBandAdmin.ts` carries a per-file
   override (`max-lines-per-function: 298`). The hook function comes under the
   base budget of 200, so that entry is **deleted**, `MAX_OVERRIDES` goes
   `21 -> 20` and AGENTS.md's "past 21 entries" follows it in the same commit.
   The two pages keep their overrides but must be **re-pinned** to their new
   worst numbers, because `complexityBudget.test.ts` fails on a ceiling that is
   not exactly the file's current number.

Behaviour is preserved, flow by flow. The complete inventory of what the hook
drives today, all of which must behave identically after the change:

- load the band and its playlists on mount, under either load policy;
- the not-found branch (`/bands` replaces the route; `/profile` shows a banner);
- copy the invite link, with the `Copied!` label reverting after 2000 ms;
- regenerate the invite link (`/bands/[id]` only) and show the new code;
- open the edit modal seeded from the band; edit name, description and colour;
  pick and client-side-compress a cover image and preview it;
- save the edit: refuse a blank name, surface an upload failure without saving,
  patch the loaded band on success, sync the active band context in
  `bandContextStore` when the edited band is the active one, close the modal;
- cancel the edit modal;
- delete the band, leave the band, remove a member — each staged as an in-page
  `ConfirmPanel` confirmation, confirmed or dismissed, with the member removal
  toasting on success and every failure landing in the shared error banner;
- open the new-playlist form, type a name, cancel it, or submit it and navigate
  to the created playlist.

No user-visible behaviour changes. No Server Action signature changes, no
`src/app/actions/bands.ts` change, no `src/lib/bands.ts` change, no
`src/lib/bandAdminLoad.ts` change, no `src/app/bandAdminActions.ts` change, no
markup unification between the two pages (F14's remediation says explicitly:
"Keep the two pages' markup separate as they are today").

## Audit at 35d6f66

### `src/hooks/useBandAdmin.ts` — 370 lines, hook function 298 lines

The returned object (lines 329-369) has 39 members. Ten are raw setters —
`setBand`, `setError`, `setEditing`, `setEditName`, `setEditDesc`,
`setEditColor`, `setCopied`, `setShowNewPlaylist`, `setNewPlaylistName`,
`setPendingAction` — measured with
`grep -cE "^[[:space:]]*set[A-Z][A-Za-z]*,$" src/hooks/useBandAdmin.ts`, which
prints `10`.

Internal state, in file order: `band`, `playlists`, `loading`, `error` (86-89);
the edit-modal six, `editing`, `editName`, `editDesc`, `editCoverFile`,
`editCoverPreview`, `editColor`, plus `saving` (92-98); `copied` (101); the
new-playlist three, `showNewPlaylist`, `newPlaylistName`, `creatingPlaylist`
(104-106); and `pendingAction` / `actionBusy` (109-110). `editCoverFile` is the
only piece of state the hook does **not** export today.

Three `useEffect` (`grep -c "useEffect(" src/hooks/useBandAdmin.ts` prints `3`):
two ref-syncs for `onNotFound` and `actions` (116-118, 124-126) and the load
effect at 161-164, which carries the inline
`react-hooks/set-state-in-effect` disable at line 162 — the only such comment
under `src/hooks`.

Handlers: `handleCopyInvite` (173-177), `openEdit` (179-186),
`handleEditCoverChange` (188-195), `handleSaveEdit` (197-246),
`handleDelete` / `handleLeave` / `handleRemoveMember` (248-262),
`confirmPendingAction` (264-314, a three-arm switch), `handleCreatePlaylist`
(316-327). Derived: `currentMember`, `isAdmin`, `inviteUrl` (166-171).

`BandAdminActions` (21-38) is the eight-action injected dependency object from
RH-47/F21; it is **not changed by this task**, and neither is
`src/app/bandAdminActions.ts` (27 lines), which builds it. `regenerateBandInviteCodeAction`
is deliberately *not* one of the eight: `/bands/[id]` imports it directly,
because the regenerate affordance exists on that page only.

Its override in `eslint.config.mjs` is
`{ name: "complexity-budget/override", files: ["src/hooks/useBandAdmin.ts"], rules: { "max-lines-per-function": ["error", 298] } }`
— one rule, the hook function's own length. There is no `complexity`,
`max-depth`, `max-params` or `max-lines` violation in the file.

### The two consumers

`src/app/bands/[id]/page.tsx` — 508 lines, a single 490-line component with one
40-line destructuring statement (lines 25-64) naming 39 members. Override:
`complexity 30 / max-lines-per-function 490 / max-lines 508`. It additionally
owns two local `useState` (`confirmingRegenerate`, `regenerating`) and
`handleRegenerateInvite` (80-96), which calls `setError(null)`, then
`regenerateBandInviteCodeAction(bandId)`, then `setBand(prev => ({ ...prev,
invite_code: newCode }))`, `setCopied(false)`, `setConfirmingRegenerate(false)`
and a toast — and `setError(message)` on failure. That function is the only
reason `setBand`, `setCopied` and the error writer are on the hook's surface at
all.

`src/app/profile/page.tsx` — 723 lines holding three components. Only
`BandProfileView` (34-427, the 394-line worst function) touches the hook, in two
destructuring statements (50-57 and 59-63) naming 30 members. Override:
`complexity 23 / max-lines-per-function 394 / max-lines 723`. `PersonalProfileView`
(432-655, 224 lines) and `ProfilePage` (660-723) are **untouched by this task**
and keep their own local `useState`, including their own `setError`.

Measured setter usage:
`grep -cE "setBand|setError|setEditing|setEditName|setEditDesc|setEditColor|setCopied|setShowNewPlaylist|setNewPlaylistName|setPendingAction" 'src/app/bands/[id]/page.tsx'`
prints `25`. The same command on `src/app/profile/page.tsx` prints `24`, but
seven of those are `PersonalProfileView`'s own local `setError`; excluding
`setError`, `grep -cE "setBand|setEditing|setEditName|setEditDesc|setEditColor|setCopied|setShowNewPlaylist|setNewPlaylistName|setPendingAction" src/app/profile/page.tsx`
prints `14`, and `grep -c "setError" src/app/profile/page.tsx` prints `10`
(lines 43, 51 and 87 in `BandProfileView`; 438, 461, 468, 490, 499, 507 and 526
in `PersonalProfileView`).

### Duplication between the two pages

`npm run lint:dup` reports four clones spanning exactly this pair, all of them
markup F14 tells us to leave alone: `bands/[id] 165-174` vs `profile 158-167`
(the delete `ConfirmPanel`), `284-293` vs `243-252` (the remove-member panel),
`408-423` vs `262-277` (the leave-band panel) and `436-469` vs `353-387` (34
lines of edit-modal form). They survive this task by design. The rewritten
destructuring in the two pages must not create a *fifth* clone: the two
statements name different subsets in a different order and must stay that way.

### Tests and gates at 35d6f66

`src/hooks/__tests__/useBandAdmin.test.tsx` — 517 lines, five `describe` blocks,
**29 tests** (`rtk proxy npx vitest run src/hooks/__tests__/useBandAdmin.test.tsx`
prints `Tests  29 passed (29)`). It is jsdom (`// @vitest-environment jsdom` as
the literal first line), calls `afterEach(cleanup)`, mocks only
`@/lib/auth-client` and `@/lib/imageCompressor`, injects the eight actions as
`vi.fn()` spies, and drives the real `useBandContextStore`. Its
`captureUnhandledRejection` helper (128-146) exists because
`BANDS_PAGE_LOAD_POLICY.catchLoadErrors === false` lets a load failure reject
unhandled by design; that helper and that guarantee are kept verbatim.

Other gates, all verified at `35d6f66`: `rtk proxy npx vitest run`
99 files / 1114 tests / 0 failed / 0 skipped (Postgres at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`);
`rtk proxy npx eslint .` `22 problems (8 errors, 14 warnings)`; `npm run lint:dup`
18 clones / 231 duplicated lines / `0.65 %` lines / `0.70 %` tokens;
`npm run lint:dead` clean; `./node_modules/.bin/tsc --noEmit` clean;
`npm run test:coverage` statements `97.43`, branches `85.52`, functions `99.43`,
lines `97.99` against thresholds 80 / 65 / 78 / 80, with
`hooks/useBandAdmin.ts` at `98.6` statements and `95` functions;
`eslint.config.mjs` holds exactly 21 override entries and
`src/lib/__tests__/complexityBudget.test.ts` sets `MAX_OVERRIDES = 21` across 6
tests, one named `lists at most 21 per-file overrides, each naming a file that
exists`; `AGENTS.md:94` ends on "and on the list growing past 21 entries";
`package.json` version `0.1.93-202609091437`. Playwright: `e2e/bands-confirm.spec.ts`
(3 tests) and `e2e/server-pages.spec.ts` (4 tests) are green;
`e2e/songs-crud.spec.ts` and `e2e/fast-view-mobile.spec.ts` are red at baseline
(RH-44) and nothing here gates on them.

## Approach

### The new surface: 19 members, none of them a setter

```ts
export interface BandAdminController {
  // data
  currentUserId: string | null;
  band: Band | null;
  playlists: Playlist[];
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  isMember: boolean;
  editDraft: BandEditDraft | null;
  saving: boolean;
  invite: BandInviteController;
  pending: BandPendingController;
  newPlaylist: NewPlaylistController;
  // intent commands
  dismissError: () => void;
  reportError: (message: string) => void;
  startEdit: () => void;
  updateDraft: (patch: Partial<BandEditDraft>) => void;
  pickCoverFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  saveEdit: (e: React.FormEvent) => Promise<void>;
  cancelEdit: () => void;
}
```

with three small sub-controllers, each one a piece of state and the commands
that are the only legal way to move it:

```ts
export interface BandInviteController {
  url: string;
  copied: boolean;
  copy: () => Promise<void>;
  /** After /bands/[id] regenerates the code: patch the band and drop `copied`. */
  applyNewCode: (code: string) => void;
}

export interface BandPendingController {
  action: PendingAction | null;
  busy: boolean;
  requestDelete: () => void;
  requestLeave: () => void;
  requestRemove: (member: BandMember) => void;
  confirm: () => Promise<void>;
  dismiss: () => void;
}

export interface NewPlaylistController {
  open: boolean;
  name: string;
  creating: boolean;
  toggle: () => void;
  changeName: (name: string) => void;
  close: () => void;
  submit: (e: React.FormEvent) => Promise<void>;
}
```

Why this shape, member by member:

- **`editDraft` is `BandEditDraft | null`, not a draft plus an `editing` flag.**
  `null` means "the modal is closed", so the two states that could disagree
  (`editing === true` with a draft from a previous band) cannot be expressed,
  and the page's `{editing && (<form>...)}` becomes `{editDraft && (<form>...)}`
  with TypeScript narrowing `editDraft.name` inside. This is the encapsulation
  F14 says the extraction was supposed to buy. `saving` stays a sibling because
  it is not a draft field.
- **`editDraft` / `updateDraft(patch)` keep exactly the names F14 and the task's
  own expected results ask for**, and they are flat rather than nested under an
  `edit` object for that reason. `updateDraft({ name: e.target.value })`
  replaces `setEditName`, `updateDraft({ description })` replaces `setEditDesc`,
  `updateDraft({ color })` replaces `setEditColor`, and `pickCoverFile` is the
  one draft field the page cannot set directly (it goes through
  `compressImageFile`).
- **`invite`, `pending` and `newPlaylist` are grouped** because each is a
  self-contained widget whose state is meaningless without its commands: an
  `invite.copied` that anything but `invite.copy()` can set is exactly the bug
  class F14 describes. Grouping is also what turns 39 members into 19: the
  eleven flat members those three replace (`inviteUrl`, `copied`,
  `pendingAction`, `actionBusy`, `showNewPlaylist`, `newPlaylistName`,
  `creatingPlaylist`, plus the four handlers that fed them) become three.
- **`isMember` replaces `currentMember`.** Both pages use the member object for
  one thing only — `!isAdmin && currentMember` on `/bands/[id]:297` and
  `currentMember &&` on `/profile:257`, i.e. "is the signed-in user in this
  band". Returning the whole `BandMember` invited a second, unmanaged source of
  truth about the member list.
- **`reportError` is a command, not `setError` renamed.** It takes a `string`,
  never a functional updater and never `null`; clearing is `dismissError()`.
  `/bands/[id]`'s regenerate catch calls `reportError(message)`, its prologue
  calls `dismissError()`, and `/profile`'s `onNotFound` becomes
  `() => reportError("Band not found.")` — the same string it sets today.
- **`invite.applyNewCode(code)` is what removes `setBand` from the surface.**
  It patches `band.invite_code` and clears `copied` in one call, which is
  precisely what the page does today in two.

`PendingAction` keeps its current three-arm shape
(`deleteBand` / `leaveBand` / `removeMember`) and moves to `src/lib/bandAdminState.ts`
so both the hook and its sub-hook can name it without a hook-to-hook type
import.

The full sorted key list of the returned object — the thing ER1 pins — is:
`band`, `cancelEdit`, `currentUserId`, `dismissError`, `editDraft`, `error`,
`invite`, `isAdmin`, `isMember`, `loading`, `newPlaylist`, `pending`,
`pickCoverFile`, `playlists`, `reportError`, `saveEdit`, `saving`, `startEdit`,
`updateDraft`.

### New files

**`src/lib/bandAdminState.ts`** — pure state transitions, no React, sibling to
the existing `src/lib/bandAdminLoad.ts` and inside the coverage universe:

```ts
export type PendingAction =
  | { kind: "deleteBand" }
  | { kind: "leaveBand" }
  | { kind: "removeMember"; member: BandMember };

export interface BandEditDraft {
  name: string;
  description: string;
  coverPreview: string | null;
  color: string;
}

export interface BandUpdatePayload {
  name: string;
  description: string | null;
  cover_url: string | null;
  color: string;
}

export function draftFromBand(band: Band | null): BandEditDraft;
export function isDraftNameBlank(draft: BandEditDraft): boolean;
export function draftToBandUpdate(draft: BandEditDraft, coverUrl: string | null): BandUpdatePayload;
export function applyBandUpdate(band: Band, update: BandUpdatePayload): Band;
export function withoutMember(band: Band, memberId: string): Band;
export function withInviteCode(band: Band, code: string): Band;
export function buildInviteUrl(origin: string, inviteCode: string | null | undefined): string;
```

Each one is a verbatim lift of logic that is inline in the hook today:
`draftFromBand` is `openEdit`'s five `set*` calls (lines 180-184, including the
`?? DEFAULT_BAND_COLOR` fallback), `draftToBandUpdate` is the trimming at
216-221, `applyBandUpdate` is the `setBand((prev) => ...)` patch at 223-233,
`withoutMember` is the members filter at 292-299, and `buildInviteUrl` is the
`typeof window !== "undefined"` expression at 168-171 with the origin passed in
so the function itself is pure and testable.

**`src/hooks/useBandEdit.ts`** — the edit-modal controller: `editDraft`,
`saving`, `startEdit`, `updateDraft`, `pickCoverFile`, `saveEdit`, `cancelEdit`,
plus the internal `editCoverFile`. It owns the `compressImageFile` call, the
`uploadBandCover` / `updateBand` sequence, the `bandContextStore` sync (hook
lines 235-238) and the save-error fallback message. Takes one options object
(so `max-params` 4 is not at risk).

**`src/hooks/useBandPendingAction.ts`** — the destructive-action controller:
`action`, `busy`, `requestDelete`, `requestLeave`, `requestRemove`, `confirm`,
`dismiss`, holding the three-arm switch verbatim including its
per-arm fallback messages (`Failed to delete band`, `Failed to leave band`,
`Failed to remove member`), the `onGone()` navigation, the success toast, and
the rule that `requestLeave` is a no-op without a session user.

`src/hooks/useBandAdmin.ts` becomes the composition root: session, the four data
`useState`, the two ref-syncs, `load` and its effect, the derived `isAdmin` /
`isMember`, the internal `patchBand`, `dismissError` / `reportError`, the
invite and new-playlist state (small enough to stay inline), the two sub-hook
calls, and the 19-member return. This mirrors the Fast View precedent recorded
in AGENTS.md: a composition root wiring controller hooks, with the pure
decisions in `src/lib`.

The hook function must land **under 200 lines** so its override can be deleted.
If it does not, the implementer extracts `src/hooks/useBandInvite.ts` and/or
`src/hooks/useNewPlaylistForm.ts` on the same pattern (both are listed as
permitted files) rather than re-pinning the override at a lower number — the
ratchet is expected to shrink by one entry here, and ER7 requires it.

No new file may take a complexity override, so every new file is clean under
`complexity` 15, `max-depth` 4, `max-lines-per-function` 200, `max-params` 4 and
`max-lines` 400, and none of them may import from `@/app/*` (F21).

### The two pages

`/bands/[id]` destructures the 19 members in place of 39. `handleRegenerateInvite`
becomes:

```tsx
async function handleRegenerateInvite() {
  setRegenerating(true);
  dismissError();
  try {
    const newCode = await regenerateBandInviteCodeAction(bandId);
    invite.applyNewCode(newCode);
    setConfirmingRegenerate(false);
    showToast("Invite link regenerated. The old link no longer works.", "success");
  } catch (err) {
    reportError(err instanceof Error ? err.message : "Failed to regenerate invite link");
  } finally {
    setRegenerating(false);
  }
}
```

The remaining rewrites are mechanical and identical in both pages:
`copied` -> `invite.copied`, `inviteUrl` -> `invite.url`,
`handleCopyInvite` -> `invite.copy`, `pendingAction` -> `pending.action`,
`actionBusy` -> `pending.busy`, `confirmPendingAction` -> `pending.confirm`,
`() => setPendingAction(null)` -> `pending.dismiss`,
`handleDelete` -> `pending.requestDelete`, `handleLeave` -> `pending.requestLeave`,
`handleRemoveMember` -> `pending.requestRemove`, `openEdit` -> `startEdit`,
`{editing && ...}` -> `{editDraft && ...}`, `editName` -> `editDraft.name`,
`editDesc` -> `editDraft.description`, `editColor` -> `editDraft.color`,
`editCoverPreview` -> `editDraft.coverPreview`,
`onChange={(e) => setEditName(e.target.value)}` -> `onChange={(e) => updateDraft({ name: e.target.value })}`,
`onChange={setEditColor}` -> `onChange={(color) => updateDraft({ color })}`,
`handleEditCoverChange` -> `pickCoverFile`, `handleSaveEdit` -> `saveEdit`,
`() => setEditing(false)` -> `cancelEdit`,
`showNewPlaylist` -> `newPlaylist.open`, `setShowNewPlaylist(!showNewPlaylist)` -> `newPlaylist.toggle`,
`newPlaylistName` -> `newPlaylist.name`,
`(e) => setNewPlaylistName(e.target.value)` -> `(e) => newPlaylist.changeName(e.target.value)`,
`() => setShowNewPlaylist(false)` -> `newPlaylist.close`,
`creatingPlaylist` -> `newPlaylist.creating`, `handleCreatePlaylist` -> `newPlaylist.submit`,
`currentMember` -> `isMember`, and in `/profile` only,
`onDismiss={() => setError(null)}` -> `onDismiss={dismissError}` and
`onNotFound: () => setError("Band not found.")` -> `onNotFound: () => reportError("Band not found.")`.

Every string, class name, emoji and element in both pages stays byte-identical
otherwise. `PersonalProfileView` and `ProfilePage` are not touched.

### eslint, the ratchet and AGENTS.md

- `src/hooks/useBandAdmin.ts`'s override entry is **deleted**. That leaves 20
  entries; `MAX_OVERRIDES` goes `21 -> 20`, the test title becomes
  `lists at most 20 per-file overrides, each naming a file that exists`, and
  `AGENTS.md:94` ends on "past 20 entries". This is the RH-55 / RH-62 / RH-63
  precedent exactly (`b024a87` 24 -> 23, `6e32874` 23 -> 22, `35d6f66` 22 -> 21),
  each a numstat of one insertion and one deletion in AGENTS.md and nothing more.
  If `next dev`/`next build` regenerates the `<!-- BEGIN:nextjs-agent-rules -->`
  block, that regeneration is reverted before the commit.
- The two page overrides are **re-pinned, not left alone**. Both files shrink
  (the destructuring statements lose ~20 and ~8 lines respectively), and
  `complexityBudget.test.ts`'s last test fails on any ceiling that is not exactly
  the file's current worst number. The recipe: delete the file's override entry,
  run `rtk proxy npx eslint '<file>'`, read the three numbers out of the reported
  messages ("Function has a complexity of N", "has too many lines (N)"), and put
  the entry back with exactly those numbers. Note that `src/app/profile/page.tsx`'s
  `max-lines-per-function` ceiling cannot drop below `224`: `PersonalProfileView`
  is untouched and is itself over the base budget of 200.
- The repo eslint total stays `22 problems (8 errors, 14 warnings)`: none of the
  8 errors or 14 warnings is in a file this task owns, and no new problem may
  appear.

### Test plan

**`src/hooks/__tests__/useBandAdmin.test.tsx`** is rewritten against the new
surface, keeping its jsdom preamble, its `afterEach(cleanup)`, its two module
mocks, its injected action spies, its `captureUnhandledRejection` helper and its
`useBandContextStore.setState({ context: { type: 'user' } })` reset. It keeps
every behaviour the 29 baseline tests assert — the mapping is one-to-one, only
the accessor changes (`result.current.editName` becomes
`result.current.editDraft?.name`, `result.current.handleDelete()` becomes
`result.current.pending.requestDelete()`, and so on) — and adds tests for the
three flows that had no coverage because they were setter writes on the page:
`invite.applyNewCode`, `reportError`/`dismissError`, and `cancelEdit`. Plus one
structural test that pins the whole surface. The named tests ER5 requires are
listed there; the file stays under the 800-line test budget.

**`src/lib/__tests__/bandAdminState.test.ts`** — node environment, no mocks,
pure functions, named tests in ER4.

**The two sub-hooks are covered through the composition hook**, which is how
they are wired in production; dedicated suites for them are permitted but not
required. Their per-file coverage is asserted directly in ER9, so "covered
through the parent" is a measured claim, not an assumption.

**End to end**, `e2e/bands-confirm.spec.ts` gains one test,
`rename a band through the edit modal`, which is the only proof that the largest
interface change (`editDraft` / `updateDraft` / `saveEdit`) still works in a real
browser: create a band through the existing `createBand` helper, click
`getByTitle('Edit band')`, fill the modal's first text input with a new unique
name, click `Save`, assert the modal is gone and the page heading shows the new
name, assert no native dialog fired (`trackDialogs`), then delete the band
through the inline confirmation to clean up. It is green at `35d6f66` too — this
is a refactor, so a regression net is the right kind of test, not a
red-before/green-after one.

### Whitelist

Required:

```
AGENTS.md
docs/tasks/RH-64-spec.md
e2e/bands-confirm.spec.ts
eslint.config.mjs
package.json
src/app/bands/[id]/page.tsx
src/app/profile/page.tsx
src/hooks/__tests__/useBandAdmin.test.tsx
src/hooks/useBandAdmin.ts
src/hooks/useBandEdit.ts
src/hooks/useBandPendingAction.ts
src/lib/__tests__/bandAdminState.test.ts
src/lib/__tests__/complexityBudget.test.ts
src/lib/bandAdminState.ts
```

Permitted but not required, and nothing else:

```
docs/suggestions-log.md
src/hooks/__tests__/useBandEdit.test.tsx
src/hooks/__tests__/useBandPendingAction.test.tsx
src/hooks/useBandInvite.ts
src/hooks/useNewPlaylistForm.ts
```

**Landing Page Rule decision.** This is an internal controller refactor with no
user-visible change at all; bands and shared playlists are already on the
landing page as selling points. The landing copy must not change; ER10 asserts
that mechanically.

**Version.** Bump `package.json` to `0.1.94-YYYYMMDDHHmm` with a real local
timestamp (from `0.1.93-202609091437`).

## Expected Results

ER1 - `src/hooks/useBandAdmin.ts` returns data plus intent commands and no raw state setter. `grep -cE "^[[:space:]]*set[A-Z][A-Za-z]*,$" src/hooks/useBandAdmin.ts` prints `0` (it printed `10` at `35d6f66`, one line for each of `setBand`, `setError`, `setEditing`, `setEditName`, `setEditDesc`, `setEditColor`, `setCopied`, `setShowNewPlaylist`, `setNewPlaylistName` and `setPendingAction`), and the same command prints `0` for each of `src/hooks/useBandEdit.ts` and `src/hooks/useBandPendingAction.ts`, so the setters were removed rather than pushed one file down. (Other hooks under `src/hooks/` - `useTabLibrary.ts`, `useSongLinks.ts`, `useLyricsEditor.ts` - do return setters at `35d6f66` and are outside this task; they must not be edited.) The file declares the surface as a named exported type: `grep -c "export interface BandAdminController" src/hooks/useBandAdmin.ts` prints `1`, and `grep -cE "editDraft|updateDraft" src/hooks/useBandAdmin.ts` prints a number greater than or equal to `2`.

ER2 - The returned surface is exactly 19 members, down from 39, and its shape is pinned by a test rather than by a reviewer counting. `rtk proxy npx vitest run src/hooks/__tests__/useBandAdmin.test.tsx` exits `0`, and among its tests there is one named exactly `exposes 19 members, none of them a state setter`, which asserts that `Object.keys(result.current).sort()` equals exactly `['band', 'cancelEdit', 'currentUserId', 'dismissError', 'editDraft', 'error', 'invite', 'isAdmin', 'isMember', 'loading', 'newPlaylist', 'pending', 'pickCoverFile', 'playlists', 'reportError', 'saveEdit', 'saving', 'startEdit', 'updateDraft']` and that no key starts with `set`. Two further tests in that file, named exactly `groups the invite widget into url, copied, copy and applyNewCode` and `groups the destructive confirmation into action, busy, requestDelete, requestLeave, requestRemove, confirm and dismiss`, assert the sorted key sets of `result.current.invite` and `result.current.pending` the same way, and a third named exactly `groups the new playlist form into open, name, creating, toggle, changeName, close and submit` does it for `result.current.newPlaylist`.

ER3 - The two consumers read only the new interface, and no hook state setter name survives in either. `grep -cE "setBand|setError|setEditing|setEditName|setEditDesc|setEditColor|setCopied|setShowNewPlaylist|setNewPlaylistName|setPendingAction" 'src/app/bands/[id]/page.tsx'` prints `0` (was `25`). `grep -cE "setBand|setEditing|setEditName|setEditDesc|setEditColor|setCopied|setShowNewPlaylist|setNewPlaylistName|setPendingAction" src/app/profile/page.tsx` prints `0` (was `14`), and `grep -c "setError" src/app/profile/page.tsx` prints exactly `7` (was `10`) - the three occurrences inside `BandProfileView` are gone and the seven inside `PersonalProfileView`, which owns its own `useState` and is not part of this task, are untouched. Both pages name the new commands: `grep -cE "invite\.|pending\.|newPlaylist\.|editDraft|updateDraft|startEdit|cancelEdit|saveEdit|pickCoverFile|dismissError|reportError" 'src/app/bands/[id]/page.tsx'` and the same command on `src/app/profile/page.tsx` each print a number greater than or equal to `20` (each printed `0` at `35d6f66`). `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing.

ER4 - The pure state transitions live in the domain layer and are unit-tested. `test -f src/lib/bandAdminState.ts` exits `0`; `grep -cE "^export (function|type|interface) " src/lib/bandAdminState.ts` prints a number greater than or equal to `7`; `grep -c "PendingAction" src/lib/bandAdminState.ts` prints a number greater than or equal to `1`; and `grep -rn "@/app/" src/lib src/hooks src/components | grep -v __tests__` prints nothing at all, so the import direction of F21 still holds. `rtk proxy npx vitest run src/lib/__tests__/bandAdminState.test.ts` exits `0` printing `Test Files  1 passed (1)` and `Tests  11 passed (11)` with `0 failed`, its tests named exactly: `seeds an edit draft from a loaded band`, `falls back to the default colour and empty strings for a band with null fields`, `seeds an empty draft from a null band`, `reports a whitespace-only draft name as blank`, `trims the draft into an update payload and nulls an empty description`, `applies an update payload to a band without touching its other fields`, `drops one member from a band and leaves the rest`, `returns the band unchanged when no member matches`, `replaces the invite code on a band`, `builds an invite url from an origin and an invite code`, `builds an invite url with an empty code when the band has none`.

ER5 - Every user-visible band flow still behaves as it did, proved by the rewritten hook suite. `rtk proxy npx vitest run src/hooks/__tests__/useBandAdmin.test.tsx` exits `0` printing `Test Files  1 passed (1)` and a `Tests  N passed (N)` line with `N` greater than or equal to `32` and `0 failed` (it printed `Tests  29 passed (29)` at `35d6f66`). The file's literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, and among its tests these are present with exactly these names: `loads the band and its playlists, then clears loading`, `copies the invite URL and flags the copied state`, `applies a regenerated invite code to the band and clears the copied flag`, `startEdit seeds the draft from the loaded band`, `updateDraft patches one draft field and leaves the others alone`, `pickCoverFile compresses the chosen file and previews it in the draft`, `saveEdit sends the trimmed draft, patches the band and syncs the active band context`, `saveEdit refuses a blank name and leaves the draft open`, `saveEdit surfaces a cover upload failure without calling updateBand`, `cancelEdit closes the draft without calling updateBand`, `requestRemove stages the confirmation, then drops the member and toasts on confirm`, `requestDelete navigates away through onGone and banners a bare failure`, `requestLeave navigates away through onGone and banners a bare failure`, `requestLeave does nothing without a session user`, `dismiss clears the staged confirmation without calling any action`, `submit creates the band playlist and navigates to it`, `submit banners the failure and clears the creating flag`, `reportError shows a message in the shared banner and dismissError clears it`. The suite still contains the `captureUnhandledRejection` helper and a test asserting that `BANDS_PAGE_LOAD_POLICY` lets a load failure reject unhandled, because that documented difference between the two pages is unchanged.

ER6 - Every static gate holds at its baseline value. `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`, unchanged from `35d6f66`. `rtk proxy npx eslint src/hooks src/lib/bandAdminState.ts 'src/app/bands/[id]/page.tsx'` exits `0` with no output (it does at `35d6f66` too), which for `src/hooks` means every hook file - including the new ones and `useBandAdmin.ts` after its override is deleted - is clean under the base budget with no per-file relaxation. `rtk proxy npx eslint src/app/profile/page.tsx` prints `1 problem (1 error, 0 warnings)`, exactly as it does at `35d6f66`: the `react-hooks/set-state-in-effect` error on `ProfilePage`'s tab-sync effect, which belongs to a component this task does not touch and is one of the repo's 8 errors. `npm run lint:dead` exits `0` with no unused file, export or dependency reported. `npm run lint:dup` exits `0` with the `Total:` row reporting at most `19` clones and at most `0.70 %` duplicated lines (it reported `18` clones, `231` duplicated lines and `0.65 %` at `35d6f66`; the four surviving clones between the two band pages are markup F14 deliberately leaves separate). `npm run audit` exits `0` with `0` high or critical advisories. `grep -c "set-state-in-effect" src/hooks/useBandAdmin.ts` prints `1` and `grep -rc "set-state-in-effect" src/hooks/useBandEdit.ts src/hooks/useBandPendingAction.ts` prints `0` for each file that exists among those two - the one inline suppression stays on the load effect it has always guarded and is not copied into a new file.

ER7 - The complexity ratchet shrinks by exactly one entry and the two page overrides are re-pinned. `grep -c "src/hooks/useBandAdmin.ts" eslint.config.mjs` prints `0` (the `src/hooks/useTabLibrary.ts` entry is a different string and must survive). The count of lines matching `complexity-budget/override` in `eslint.config.mjs` is `20` (it was `21`). `grep -c "MAX_OVERRIDES = 20" src/lib/__tests__/complexityBudget.test.ts` prints `1`. `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits `0` printing `Tests  6 passed (6)`, including the test now named `lists at most 20 per-file overrides, each naming a file that exists` and the test named `pins every override ceiling to the current worst number in its file`, whose passing is the mechanical proof that each remaining ceiling equals its file's current number. In `eslint.config.mjs` the entry for `src/app/bands/\[id\]/page.tsx` names a `complexity` ceiling of at most `30`, a `max-lines-per-function` ceiling of at most `490` and a `max-lines` ceiling strictly less than `508`, and the entry for `src/app/profile/page.tsx` names a `complexity` ceiling of at most `23`, a `max-lines-per-function` ceiling of at most `394` and a `max-lines` ceiling strictly less than `723` (those six numbers are the `35d6f66` values). `grep -c "past 20 entries" AGENTS.md` prints `1` and `grep -c "past 21 entries" AGENTS.md` prints `0`; and `git diff --numstat 35d6f66 -- AGENTS.md` prints exactly one line whose three tab-separated fields are `1`, `1` and `AGENTS.md` - one insertion, one deletion, no other line touched, so a regenerated `nextjs-agent-rules` block was reverted before the commit.

ER8 - End to end, run with `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1"` against a fresh `npx next build`, `BETTER_AUTH_SECRET` exported from `.env.local` and Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied: `npx playwright test e2e/bands-confirm.spec.ts --reporter=list` exits `0` printing `4 passed`, with the three RH-16 tests still green (`delete band via the inline confirmation`, `cancel keeps the band`, `Escape dismisses the confirmation`) and one new test green, named exactly `rename a band through the edit modal`, which creates a band through the UI, opens the modal from the `Edit band` control, types a new unique name, clicks `Save`, asserts the page heading then shows the new name and that no native `dialog` event fired, and deletes the band again to clean up. Under the same server `npx playwright test e2e/server-pages.spec.ts --reporter=list` exits `0` printing `4 passed` and `npx playwright test e2e/ssr-smoke.spec.ts --reporter=list` exits `0` printing `4 passed`, both unchanged from `35d6f66`. No file under `e2e/` other than `e2e/bands-confirm.spec.ts` is modified: `git diff --name-only 35d6f66 -- e2e` prints exactly `e2e/bands-confirm.spec.ts`. (`e2e/songs-crud.spec.ts` and `e2e/fast-view-mobile.spec.ts` are red at `35d6f66` for reasons tracked in RH-44 and are not part of this result.)

ER9 - The whole suite and the coverage gate hold, with Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. `rtk proxy npx vitest run` exits `0` reporting `Test Files` passed greater than or equal to `100` (was 99; at least one new suite), `Tests` passed greater than or equal to `1128` (was 1114; at least 3 more hook tests, 4 surface tests and 11 state tests), `0 failed` and `0 skipped`. `npm run test:coverage` exits `0` with all four thresholds met (statements at least `80`, branches at least `65`, functions at least `78`, lines at least `80`). Reading per-file numbers out of the artefact this repo actually emits, `coverage/coverage-final.json` (there is no `coverage/coverage-summary.json`), the command `node -e "const c=require('./coverage/coverage-final.json');const pct=a=>a.length?Math.round(1000*a.filter(x=>x>0).length/a.length)/10:100;for (const k of Object.keys(c)) if (/\/src\/(hooks\/useBand|lib\/bandAdminState)/.test(k)) console.log(k.split('/src/').pop(), pct(Object.values(c[k].s)), pct(Object.values(c[k].f)))"` prints one line per file, each with a statement percentage and a function percentage of at least `90`, and the set of file names it prints includes `lib/bandAdminState.ts`, `hooks/useBandAdmin.ts`, `hooks/useBandEdit.ts` and `hooks/useBandPendingAction.ts`. (That command shape is verified at `35d6f66`, where the equivalent one-liner aimed at `/src/hooks/` prints `hooks/useBandAdmin.ts 98.6 95` among nine lines.)

ER10 - Release hygiene. `package.json` version is `0.1.94-YYYYMMDDHHmm` with a real local timestamp, sorting above `0.1.93-202609091437`. `git diff 35d6f66 -- src/components/landing src/i18n/dictionaries` prints nothing: an internal controller refactor changes nothing a musician would choose the app for, and bands are already a landing selling point. `git diff 35d6f66 -- src/lib/bandAdminLoad.ts src/app/bandAdminActions.ts src/app/actions/bands.ts src/lib/bands.ts src/lib/bands.server.ts src/proxy.ts src/store docs/plans/code-quality-review.md` prints nothing, so the injected-action wiring, the load policies, the data layer, the middleware, the stores and the review document are all byte-identical. And `git diff --name-only 35d6f66 | sort` lists only paths drawn from this closed set and no others: `AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/RH-64-spec.md`, `e2e/bands-confirm.spec.ts`, `eslint.config.mjs`, `package.json`, `src/app/bands/[id]/page.tsx`, `src/app/profile/page.tsx`, `src/hooks/__tests__/useBandAdmin.test.tsx`, `src/hooks/__tests__/useBandEdit.test.tsx`, `src/hooks/__tests__/useBandPendingAction.test.tsx`, `src/hooks/useBandAdmin.ts`, `src/hooks/useBandEdit.ts`, `src/hooks/useBandInvite.ts`, `src/hooks/useBandPendingAction.ts`, `src/hooks/useNewPlaylistForm.ts`, `src/lib/__tests__/bandAdminState.test.ts`, `src/lib/__tests__/complexityBudget.test.ts`, `src/lib/bandAdminState.ts` - any other path fails this result.

## Out of Scope

- **Converting `/bands/[id]` or `/profile` into Server Components.** They keep
  `"use client"`, the mount load effect and its inline
  `react-hooks/set-state-in-effect` suppression. F15's five-part split covered
  `/bands`, `/admin/moderation` (RH-62) and `/playlists` (RH-63) only; these two
  routes were never in it, and rendering them on the server would delete the
  hook this task is redesigning rather than fix its interface.
- **`src/proxy.ts`**, its matcher, its `PUBLIC_PATHS` list and its
  session-over-fetch strategy - RH-65, part 5 of 5 (F10).
- **The `Status:` lines for F10, F14 and F15 in
  `docs/plans/code-quality-review.md`.** RH-41's own record assigns the
  docs-only close-out of all three findings to the parent, once the five parts
  have landed; that file must not be touched here, and ER10 pins it.
- **Changing `BandAdminActions` or `src/app/bandAdminActions.ts`.** The eight
  injected Server Actions keep their names and signatures.
  `regenerateBandInviteCodeAction` stays a direct import in `/bands/[id]` and
  does not become a ninth injected action: the affordance exists on one page,
  and moving the flow into a hook shared with `/profile` would put page-specific
  state (`confirmingRegenerate`, `regenerating`) into shared code.
- **`src/lib/bandAdminLoad.ts`.** `BandAdminLoadPolicy`, both policy constants
  and `resolveLoadErrorMessage` are unchanged; `onNotFound` stays a required
  option rather than becoming a policy-carried message.
- **De-duplicating the four jscpd clones between `/bands/[id]` and `/profile`**
  (the three `ConfirmPanel` blocks and the 34-line edit-modal form). F14's
  remediation says to keep the two pages' markup separate; extracting a shared
  `BandEditModal` component is a UI change with its own review surface and
  belongs to a separate task.
- **Decomposing either page.** `BandDetailPage` stays one component, and
  `src/app/profile/page.tsx` keeps its three; only the destructuring statements,
  the accessor names and `handleRegenerateInvite` change. `PersonalProfileView`
  and `ProfilePage` are not edited at all.
- **Lowering either page's `complexity` ceiling by restructuring its JSX.** The
  ceilings are re-pinned to whatever the mechanical rewrite produces; chasing a
  lower number by rewriting conditional rendering is a different task.
- **Adding `revalidatePath` anywhere, or any change to `src/app/actions/bands.ts`**,
  which would drag the `actionSessionGuard` / `actionAuthorizationGuard` /
  `actionDataAccessGuard` suites into a refactor whose subject is the hook layer.
- **Any AGENTS.md edit other than the single word `21` -> `20`** in the F20
  complexity-budget sentence on line 94. The directory map's one-line
  description of `src/hooks/useBandAdmin.ts` is still accurate and the new
  sibling hooks are not added to it (recorded as a suggestion instead).
- **Fixing the pre-existing red e2e specs** (`songs-crud`, `fast-view-mobile`)
  or the 8 eslint errors and 14 warnings that make up today's repo total, none
  of which is in a file this task touches.

## Post-merge checks (orchestrator)

After the Vercel deployment of the merge commit, a signed-in smoke pass should
confirm on a real band that: the invite link copies and the button reverts from
`Copied!`; regenerating the invite link replaces the code in the field and the
`Copied!` state resets; editing name, description, colour and cover saves and
the band name in the context switcher updates when that band is the active
context; removing a member toasts and the row disappears; and creating a band
playlist navigates to `/playlists/<id>`. The same five flows should be spot
checked on the `/profile` band tab, which shares the hook but not the markup. No
expected result above depends on any of this.
