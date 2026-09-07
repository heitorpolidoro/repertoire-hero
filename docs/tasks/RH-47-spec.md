# RH-47 - Invert SongForm, CorrectionModal and useBandAdmin, and ban @/app/* in ESLint

Parent: RH-37, part 3 of 3 (RH-25 T4, the remainder of finding F21). Depends on RH-46
(`51151d7`, done). This is the last part; when it lands, F21 can be closed.

## Scope

Three files under `src/components` and `src/hooks` still reach up into the App Router
tree to call Server Actions. This task inverts all three so the calls arrive as props or
as an injected dependency object, and then adds the ESLint `no-restricted-imports` rule
that F21's remediation asks for - the rule that can only reach zero violations once this
part lands.

In scope:

- `src/hooks/useBandAdmin.ts` stops importing the eight band actions from
  `@/app/actions/bands` and takes them as one required `actions: BandAdminActions`
  option.
- `src/app/bandAdminActions.ts` (new) composes that object once from the real actions;
  `src/app/bands/[id]/page.tsx` and `src/app/profile/page.tsx` both pass it in.
- `src/components/songs/SongForm.tsx` stops importing the four repertoire actions from
  `@/app/actions/repertoire` and takes them, plus the correction submitter, as one
  required `actions: SongFormActions` prop; `src/app/page.tsx` supplies it.
- `src/components/songs/CorrectionModal.tsx` stops importing
  `submitGlobalSongEditAction` from `@/app/actions/moderation` and takes an
  `onSubmitCorrection` callback prop; `SongForm` forwards
  `actions.submitGlobalSongEdit` into it.
- `eslint.config.mjs` gains a scoped `no-restricted-imports` block banning `@/app/*` and
  `@/app/**` under `src/components/**`, `src/lib/**` and `src/hooks/**`, with
  `**/__tests__/**` deliberately exempt.
- `src/hooks/__tests__/useBandAdmin.test.tsx` is retargeted: the
  `vi.mock('@/app/actions/bands')` block is replaced by a fake `actions` object built
  from `vi.fn()` spies and passed into the hook. All 29 existing test names, describe
  blocks and assertions survive unchanged.
- Two new jsdom suites: `src/components/songs/__tests__/SongForm.test.tsx` (5 tests) and
  `src/components/songs/__tests__/CorrectionModal.test.tsx` (4 tests).
- One line added to AGENTS.md recording the import-direction convention and naming the
  rule that enforces it (AGENTS.md does not state this rule anywhere today - the closest
  it comes is the `A2 - thin Server Actions` paragraph, which is about SQL, not about
  which direction imports may point).

Behaviour is identical everywhere: the same actions are called with the same arguments in
the same order, the same loading flags flip, the same error banners and toasts appear
with the same text, and RH-18's `BANDS_PAGE_LOAD_POLICY` / `BAND_PROFILE_LOAD_POLICY`
semantics (catch-or-propagate, clear-or-keep loading on not-found) are untouched. There is
no deliberate behaviour delta in this task at all.

## Audit at 51151d7

`git log --oneline -1` prints
`51151d7 refactor(RH-46): TabDrawingStage and AppLayout receive their data by props`.
`git status --porcelain` prints nothing. `package.json` version is `0.1.73-202609071401`.

### The three remaining inward imports

`grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints exactly
three lines today, which are exactly this task's targets:

```
src/components/songs/SongForm.tsx:16:} from "@/app/actions/repertoire";
src/components/songs/CorrectionModal.tsx:5:import { submitGlobalSongEditAction } from "@/app/actions/moderation";
src/hooks/useBandAdmin.ts:11:} from "@/app/actions/bands";
```

The full grep (without the `__tests__` filter) adds six test-file hits: four
`src/lib/__tests__` suites importing route handlers from `@/app/api/...`
(`devProfiles.test.ts:27`, `spotify.test.ts:58` and `:59`,
`spotifyPlaylistRouteAuthz.db.test.ts:32-34`, `spotifySyncAtomicity.db.test.ts:20`) and
`src/hooks/__tests__/useBandAdmin.test.tsx:5` and `:34`. Those four `src/lib` suites are
testing the route handlers themselves and must keep importing them, which is why the new
ESLint rule exempts `__tests__` (see the Approach).

### `src/hooks/useBandAdmin.ts` (345 lines)

Eight actions, imported aliased at L2-L11 and called at these sites:

| Action (aliased) | Call site | Notes |
| --- | --- | --- |
| `getBandWithMembersAction as getBandWithMembers` | L106, inside `load`'s `Promise.all` | `Promise<Band \| null>`; `null` drives the not-found branch |
| `getBandPlaylistsAction as getBandPlaylists` | L107, same `Promise.all` | `Promise<Playlist[]>` |
| `uploadBandCoverAction` | L182, in `handleSaveEdit` | returns `{ coverUrl?, error? }`; an `error` aborts the save |
| `updateBandAction as updateBand` | L191, in `handleSaveEdit` | `Promise<void>` |
| `deleteBandAction as deleteBand` | L246, `confirmPendingAction` case `deleteBand` | |
| `leaveBandAction as leaveBand` | L255, case `leaveBand` | |
| `removeBandMemberAction as removeBandMember` | L266, case `removeMember` | takes `member.id`, not `bandId` |
| `createBandPlaylistAction as createBandPlaylist` | L296, `handleCreatePlaylist` | `Promise<string>` (the new playlist id) |

Signatures confirmed in `src/app/actions/bands.ts` at L24, L39, L52, L57, L62, L67, L72
and L82.

**How it is consumed.** Two pages, both `'use client'`:

- `src/app/bands/[id]/page.tsx:64` destructures 33 members of the return value and passes
  `bandId`, `showToast`, `onNotFound: () => router.replace('/bands')`,
  `loadPolicy: BANDS_PAGE_LOAD_POLICY`, `onGone`, `onNavigateToPlaylist` and
  `messages: BAND_PAGE_MESSAGES`.
- `src/app/profile/page.tsx:38` (inside `BandProfileView`) passes the same option names
  with `loadPolicy: BAND_PROFILE_LOAD_POLICY`, `onNotFound: () => setError('Band not found.')`
  and `messages: BAND_PROFILE_MESSAGES`.

Both pages already declare their `messages` object at **module level** with the comment
"Module-level so the hook's `load` callback stays referentially stable" - the precedent
this task follows for the injected actions object.

**`src/lib/bandAdminLoad.ts` and the load policies.** `bandAdminLoad.ts` holds only
`BandAdminLoadPolicy`, the two policy constants and `resolveLoadErrorMessage`. It imports
nothing from `@/app` and calls no action; it is pure data plus one pure function, and
this task does not touch it. `useBandAdmin`'s `load` is
`useCallback(..., [bandId, loadPolicy, loadErrorMessage])` and the load effect at L136-L139
depends on `load`, so **anything that goes into `load`'s dependency array must be
referentially stable or the load runs on every render**. That is the single constraint
that shapes the design below.

**Existing coverage.** `src/hooks/__tests__/useBandAdmin.test.tsx` is a jsdom suite of 29
tests in five describe blocks (`useBandAdmin load policies` 6, `useBandAdmin derived state`
6, `useBandAdmin edit modal` 8, `useBandAdmin destructive actions` 6,
`useBandAdmin playlist creation` 3), verified by
`npx vitest run src/hooks/__tests__/useBandAdmin.test.tsx --reporter=verbose`. It mocks
`@/app/actions/bands` wholesale at L5-L14 and asserts against those module mocks. Once the
hook takes its actions as an option, that `vi.mock` becomes dead weight - the hook would
never touch the mocked module - so the suite must be retargeted, not merely tolerated.

### `src/components/songs/SongForm.tsx` (575 lines)

Four actions, imported aliased at L11-L16:

| Action (aliased) | Call site | Notes |
| --- | --- | --- |
| `updateSongAction as updateSong` | L210, edit branch of `handleSubmit` | `(entry: Repertoire, data: SongUpdateInput)`, `Promise<void>` |
| `createAndAddSongAction as createAndAddSong` | L222, create branch | returns the created `Repertoire`; only `entry.id` is read |
| `updateSongStatusAction as updateSongStatus` | L234 | called only when `form.status !== 'unknown'` |
| `updateSongTagsAction as updateSongTags` | L236 | called only when `tags.length > 0` |

The last two run inside one `Promise.all` immediately after the create. After either
branch the component calls `await loadSongs()` (from `useRepertoireStore`) and then
`onSuccess()`; a throw is caught and rendered in the inline error paragraph as
`err instanceof Error ? err.message : 'An unexpected error occurred.'`. Signatures
confirmed in `src/app/actions/repertoire.ts` at L46, L53, L77 and L88;
`SongUpdateInput` is declared at `src/lib/songs.ts:232`.

**Consumers:** exactly one. `src/app/page.tsx:19` imports it and renders it at L600-L604
as `<SongForm song={modal.song} onClose={closeModal} onSuccess={handleSuccess} />`, inside
`{modal.open && ...}`. `grep -rn "SongForm" src e2e` finds no other import; the only other
mentions are two comments in `e2e/helpers.ts` (L42, L62) about waiting for the dialog.
`src/app/page.tsx` already imports `createAndAddSongAction as createAndAddSong` at L11 for
its own quick-add flow, so three of the five actions the form needs are new imports there.

**Transitive note.** `SongForm` also imports `useRepertoireStore` from
`@/store/repertoireStore`, and `src/store/repertoireStore.ts:6` imports
`@/app/actions/repertoire`. That transitive edge is real but is **not** in scope: F21 named
`src/components`, `src/lib` and `src/hooks`, `src/store` is not in the new rule's `files`
list, and inverting the zustand store is a different task. Verified with a probe run of the
rule over the whole tree: `src/store` produces no violation.

### `src/components/songs/CorrectionModal.tsx` (158 lines)

One action: `submitGlobalSongEditAction` (`src/app/actions/moderation.ts:11`,
`(songId: string, data: Record<string, unknown>) => Promise<GlobalSongEdit>`), called at
L37 inside `handleSubmit` with `(song.id, { title, artist, album, standard_key, reason })`,
all trimmed, with `album`/`standard_key`/`reason` falling back to `null` when blank. On
success it calls `onSuccess()` then `onClose()`; on throw it sets the inline error to
`err.message` or `'Failed to submit correction request.'`; `finally` clears `submitting`.
There is also a pre-flight guard: a blank title or artist sets
`'Title and artist are required.'` and returns without calling the action.

**Consumers:** exactly one, and it is `SongForm` itself
(`src/components/songs/SongForm.tsx:18` and L557-L565), rendered when
`showCorrectionModal && song?.song`. Its `onSuccess` sets `SongForm`'s own
`toastMessage` to `'Correction request submitted for admin review!'` for 4 s. So the
injected callback has to be threaded two levels: `src/app/page.tsx` -> `SongForm` ->
`CorrectionModal`.

### Gate baselines measured at 51151d7

- `./node_modules/.bin/tsc --noEmit` exits 0 and prints nothing. Use that exact binary
  path; `npx tsc` is intercepted by a shell hook in this environment.
- `npx eslint .` reports `29 problems (12 errors, 17 warnings)`.
  `npx eslint src/hooks/useBandAdmin.ts src/components/songs/SongForm.tsx src/components/songs/CorrectionModal.tsx src/app/page.tsx "src/app/bands/[id]/page.tsx" src/app/profile/page.tsx eslint.config.mjs src/hooks/__tests__/useBandAdmin.test.tsx src/lib/bandAdminLoad.ts`
  reports `1 problem (1 error, 0 warnings)`: `react-hooks/set-state-in-effect` at
  `src/app/profile/page.tsx:670:5`, on the `setActiveTab(context.type === "band" ? "band" : "personal")`
  inside the band-context sync effect. Every other file in that list is clean. Note that
  `useBandAdmin.ts:137` already carries an inline
  `// eslint-disable-next-line react-hooks/set-state-in-effect` over `load()`; it stays.
- `npm run lint:dead` (knip) clean. `npm run lint:dup` (jscpd) `Found 19 clones.`, 239
  duplicated lines, 0.90 %, threshold 2 %. `npm run audit` 0 vulnerabilities.
- `npx vitest run` 57 files / 727 tests / 0 skipped, with Postgres at
  `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied) and a
  non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
- `npm run test:coverage` thresholds statements 80 / branches 65 / functions 78 / lines 80,
  over `coverage.include` = `src/lib/**/*.ts`, `src/app/actions/*.ts`, `src/hooks/**/*.ts`,
  `src/proxy.ts`. **`src/hooks/useBandAdmin.ts` is inside that universe**; its per-file
  numbers in `coverage/coverage-final.json` at `51151d7` are statements 136/138 = 98.55 %,
  branches 57/73 = 78.08 %, functions 18/19 = 94.74 %. `src/lib/bandAdminLoad.ts` is 100 %
  on all three.
- `npx next build` ok; `npx playwright test e2e/ssr-smoke.spec.ts` 4 passed;
  `npx playwright test e2e/bands-confirm.spec.ts` 3 passed. `e2e/songs-crud.spec.ts` is
  **red at this baseline** - all 3 tests fail (`dialog[open]` never reaching count 0 at
  `e2e/helpers.ts:57`, `[aria-label="Song list"]` never visible at `e2e/helpers.ts:27`),
  pre-existing and tracked as RH-44. It is therefore not usable as a gate here; see ER11 and
  Out of Scope.

### Constraints discovered while auditing (do not learn these the hard way)

1. **jsdom has no `HTMLDialogElement.prototype.showModal`.** `SongForm` calls
   `dialogRef.current?.showModal()` in a mount effect (L137-L139), and under jsdom 29 that
   throws `TypeError: dialogRef.current?.showModal is not a function`, failing every render
   in the suite. Verified with a throwaway probe. The `SongForm` suite must install a stub
   in `beforeAll`:
   ```ts
   Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
     configurable: true,
     value(this: HTMLDialogElement) {
       this.open = true
     },
   })
   ```
   `CorrectionModal` renders `<dialog open>` declaratively and needs no stub.
2. **`CorrectionModal`'s labels are not associated with their inputs** - they are bare
   `<label>` elements with no `htmlFor` and no wrapping, so `getByLabelText` does not find
   the fields. Query them with `screen.getByDisplayValue(...)` instead. Verified with a
   probe.
3. **Use `fireEvent.submit(container.querySelector('form')!)`** for the blank-title guard
   test: clicking the submit button with a `required` input empty is at the mercy of
   jsdom's constraint validation, while dispatching `submit` on the form always reaches
   React's `onSubmit`. Verified with a probe; the guard text
   `Title and artist are required.` appears.
4. **`submitGlobalSongEditAction`'s second parameter is `Record<string, unknown>`.** A
   callback prop typed with an `interface` for that payload will **not** accept the action
   (TypeScript gives implicit index signatures to object *type aliases* but not to
   interfaces, so `interface X {...}` is not assignable to `Record<string, unknown>` and
   parameter contravariance rejects the assignment). Declare the payload as
   `export type GlobalSongCorrectionInput = { ... }`. I compiled both shapes through
   `./node_modules/.bin/tsc --noEmit` in a probe file; the `type` alias passes.
5. **Every prop/deps contract below was type-checked before this spec was written**, in a
   probe module that assigned all thirteen real actions into the three interfaces given in
   the Approach. `./node_modules/.bin/tsc --noEmit` exited 0. The probe files were deleted;
   `git status --porcelain` is empty.
6. **The ESLint rule was measured before this spec was written.** Run through a throwaway
   copy of `eslint.config.mjs` over the whole tree, the exact block in the Approach reports
   **3 errors and nothing else** - `SongForm.tsx:11`, `CorrectionModal.tsx:5`,
   `useBandAdmin.ts:2` - taking the repo from 29 problems (12 errors) to 32 (15 errors). No
   `__tests__` file and no `src/store` file is flagged. The three errors are exactly the
   three imports this task removes, so the post-change total lands back on 29 / 12 / 17.

## Approach

### 1. `src/hooks/useBandAdmin.ts` - one injected `actions` object

Delete the `@/app/actions/bands` import block (L2-L11) and add, next to `PendingAction`:

```ts
/**
 * The eight band Server Actions the controller calls. Injected rather than
 * imported, so `src/hooks` never points back into the App Router tree (F21).
 * Required and never defaulted - a default would have to import `@/app`.
 */
export interface BandAdminActions {
  getBandWithMembers: (bandId: string) => Promise<Band | null>;
  getBandPlaylists: (bandId: string) => Promise<Playlist[]>;
  updateBand: (
    bandId: string,
    data: {
      name?: string;
      description?: string | null;
      cover_url?: string | null;
      color?: string | null;
    },
  ) => Promise<void>;
  deleteBand: (bandId: string) => Promise<void>;
  leaveBand: (bandId: string) => Promise<void>;
  removeBandMember: (memberId: string) => Promise<void>;
  createBandPlaylist: (bandId: string, name: string) => Promise<string>;
  uploadBandCover: (formData: FormData) => Promise<{ coverUrl?: string; error?: string }>;
}
```

`UseBandAdminOptions` gains one required member, documented in the same style as
`loadPolicy`:

```ts
  /** Required, never defaulted - see `src/app/bandAdminActions.ts`. */
  actions: BandAdminActions;
```

Wiring inside the hook:

- Add, immediately after the existing `onNotFoundRef` block and for the same reason:
  ```ts
  // `load` reads the actions through a ref so `actions` can stay out of its
  // dependency array; a caller that rebuilds the object every render must not
  // be able to restart the load effect.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });
  ```
- `load`'s `Promise.all` becomes
  `[actionsRef.current.getBandWithMembers(bandId), actionsRef.current.getBandPlaylists(bandId)]`.
  Its dependency array stays exactly `[bandId, loadPolicy, loadErrorMessage]`, and the
  load effect at L136-L139, including its inline `eslint-disable-next-line`, is unchanged.
- Every other call site is inside a plain (non-memoized) inner function that is re-created
  each render, so it reads the prop directly, with no ref: `handleSaveEdit` calls
  `actions.uploadBandCover(formData)` and `actions.updateBand(bandId, {...})`;
  `confirmPendingAction` calls `actions.deleteBand(bandId)`, `actions.leaveBand(bandId)`
  and `actions.removeBandMember(member.id)`; `handleCreatePlaylist` calls
  `actions.createBandPlaylist(bandId, newPlaylistName.trim())`.
- Nothing else moves. The four `*_ERROR` constants, `saveErrorMessage` /
  `loadErrorMessage`, every `useState`, `currentMember` / `isAdmin` / `inviteUrl`, the
  bandContext sync in `handleSaveEdit`, the toast on member removal and the whole 33-member
  return object keep their exact current bodies.

### 2. `src/app/bandAdminActions.ts` (new) - the composition root

One module, imported by both pages, so the object literal exists once (no jscpd clone) and
is referentially stable for free:

```ts
import {
  getBandWithMembersAction,
  getBandPlaylistsAction,
  updateBandAction,
  deleteBandAction,
  leaveBandAction,
  removeBandMemberAction,
  createBandPlaylistAction,
  uploadBandCoverAction,
} from "@/app/actions/bands";
import type { BandAdminActions } from "@/hooks/useBandAdmin";

/**
 * The band Server Actions injected into `useBandAdmin` by `/bands/[id]` and the
 * band tab of `/profile`. Module-level, so the object identity is stable and the
 * hook's `load` effect cannot be restarted by a re-render (RH-47, finding F21).
 */
export const BAND_ADMIN_ACTIONS: BandAdminActions = {
  getBandWithMembers: getBandWithMembersAction,
  getBandPlaylists: getBandPlaylistsAction,
  updateBand: updateBandAction,
  deleteBand: deleteBandAction,
  leaveBand: leaveBandAction,
  removeBandMember: removeBandMemberAction,
  createBandPlaylist: createBandPlaylistAction,
  uploadBandCover: uploadBandCoverAction,
};
```

`bandAdminActions.ts` is not a reserved App Router filename, so it creates no route -
the same reasoning that let RH-46 add `src/app/AppShell.tsx`.

### 3. The two `useBandAdmin` consumers

Both pages add `import { BAND_ADMIN_ACTIONS } from "@/app/bandAdminActions";` and one
option:

- `src/app/bands/[id]/page.tsx`: `useBandAdmin({ bandId, actions: BAND_ADMIN_ACTIONS, showToast, ... })`.
- `src/app/profile/page.tsx`: `useBandAdmin({ bandId, actions: BAND_ADMIN_ACTIONS, showToast, ... })`.

Nothing else on either page changes. In particular
`src/app/bands/[id]/page.tsx` keeps its own direct `regenerateBandInviteCodeAction`
import - it is a page importing an action, which is the direction the rule permits.

### 4. `src/components/songs/SongForm.tsx` - one `actions` prop

Delete the `@/app/actions/repertoire` import block (L11-L16) and declare, above
`SongFormProps`:

```ts
type SongFormCreateInput = {
  title: string;
  artist: string;
  album?: string;
  standard_key?: string;
  cover_url?: string;
  duration_seconds?: number;
  links?: SongLink[];
};

type SongFormEditInput = {
  title: string;
  artist: string;
  album?: string | null;
  key: string | null;
  status: SongStatus;
  tags: string[];
  links: SongLink[];
  cover_url?: string | null;
  duration_seconds?: number | null;
};

/**
 * The Server Actions the form and its correction modal call. Injected rather
 * than imported, so `src/components` never points back into `src/app` (F21).
 */
export interface SongFormActions {
  createAndAddSong: (data: SongFormCreateInput) => Promise<Repertoire>;
  updateSong: (entry: Repertoire, data: SongFormEditInput) => Promise<void>;
  updateSongStatus: (repertoireId: string, status: SongStatus) => Promise<void>;
  updateSongTags: (repertoireId: string, tags: string[]) => Promise<void>;
  submitGlobalSongEdit: CorrectionModalProps["onSubmitCorrection"];
}
```

`SongFormCreateInput` and `SongFormEditInput` are deliberately **not** exported (knip
reports unused exports, and no other module needs them); they restate the shapes
`createAndAddSongAction` and `SongUpdateInput` already have, so the real actions assign
into the interface with no cast. `submitGlobalSongEdit` reuses `CorrectionModal`'s own prop
type so the two cannot drift; `CorrectionModalProps` must therefore be exported from
`CorrectionModal.tsx` (see below). `SongFormProps` gains `actions: SongFormActions`, and
`SongForm` destructures it: `export default function SongForm({ song, onClose, onSuccess, actions }: SongFormProps)`.

Call sites become `actions.updateSong(song, {...})`, `actions.createAndAddSong({...})`,
`actions.updateSongStatus(entry.id, form.status)` and
`actions.updateSongTags(entry.id, tags)` - same arguments, same order, same
`Promise.all`, same `await loadSongs()` and `onSuccess()` afterwards, same catch. The
`CorrectionModal` element at L557-L565 gains one prop:
`onSubmitCorrection={actions.submitGlobalSongEdit}`. `parseTags`, `buildInitialState`,
`mapFormFields`, `extractYoutubeAndOtherLinks` and the entire markup are untouched.

### 5. `src/components/songs/CorrectionModal.tsx` - one callback prop

Delete the `@/app/actions/moderation` import (L5) and declare:

```ts
/**
 * The correction payload. A `type` alias, not an `interface`: only an alias gets
 * an implicit index signature, and without one it cannot be passed to a
 * `Record<string, unknown>` parameter (see the action's signature).
 */
export type GlobalSongCorrectionInput = {
  title: string;
  artist: string;
  album: string | null;
  standard_key: string | null;
  reason: string | null;
};

export interface CorrectionModalProps {
  song: GlobalSong;
  onClose: () => void;
  onSuccess: () => void;
  /** Injected `submitGlobalSongEditAction` - `src/components` never imports `@/app` (F21). */
  onSubmitCorrection: (songId: string, data: GlobalSongCorrectionInput) => Promise<unknown>;
}
```

`handleSubmit` calls `await onSubmitCorrection(song.id, { ... })` with the identical
trimmed payload it builds today. The required-fields guard, the error text, the
`submitting` flag, `onSuccess()` then `onClose()` on success, and the whole dialog markup
are unchanged.

### 6. `src/app/page.tsx` - supplies the form's actions

Extend the existing `@/app/actions/repertoire` import (L10-L14, which already has
`createAndAddSongAction as createAndAddSong`) with `updateSongAction`,
`updateSongStatusAction` and `updateSongTagsAction`; add
`import { submitGlobalSongEditAction } from "@/app/actions/moderation";` and
`import SongForm, { type SongFormActions } from "@/components/songs/SongForm";`. Then, at
module level next to the other module-level constants:

```tsx
/** Module-level so the object identity is stable across renders (RH-47). */
const SONG_FORM_ACTIONS: SongFormActions = {
  createAndAddSong,
  updateSong: updateSongAction,
  updateSongStatus: updateSongStatusAction,
  updateSongTags: updateSongTagsAction,
  submitGlobalSongEdit: submitGlobalSongEditAction,
};
```

The call site at L600 becomes:

```tsx
<SongForm
  song={modal.song}
  onClose={closeModal}
  onSuccess={handleSuccess}
  actions={SONG_FORM_ACTIONS}
/>
```

### 7. `eslint.config.mjs` - the rule, verbatim

Insert this object between the existing test-file override block and the `globalIgnores`
call:

```js
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
```

Both patterns are needed: minimatch's `*` does not cross `/`, so `@/app/*` alone matches
`@/app/actions` but not `@/app/actions/bands`. The message has no trailing period because
ESLint concatenates it after its own sentence and strips one.

**Mechanical tamper check (the rule is proved to bite, then the tree is restored).** From
the repository root:

```
printf "import { getBandsAction } from '@/app/actions/bands'\n\nexport const probe = getBandsAction\n" > src/lib/rh47RuleProbe.ts
npx eslint src/lib/rh47RuleProbe.ts
rm src/lib/rh47RuleProbe.ts
test ! -e src/lib/rh47RuleProbe.ts && echo restored
git status --porcelain -- src
```

The `npx eslint` run must print `1 problem (1 error, 0 warnings)` and a line naming
`no-restricted-imports` and `'@/app/actions/bands'`; the `test` must print `restored` and
the final `git status --porcelain -- src` must print nothing. Scope the status check to
`src`: an unscoped run legitimately reports this task's own untracked `docs/` files. I ran exactly this against a throwaway copy of the config and got:

```
  1:1  error  '@/app/actions/bands' import is restricted from being used by a pattern. ...  no-restricted-imports

[x] 1 problem (1 error, 0 warnings)
```

### 8. AGENTS.md - one line

AGENTS.md states the SQL-layering rule (`A2 - thin Server Actions`) but says nothing about
import direction. Add exactly one bullet at the end of the **Testing & quality** list,
where the other mechanical gates are already named:

```
- **Import direction (F21).** Nothing under `src/components`, `src/hooks` or `src/lib` may import from `@/app/*`; a page or a wrapper under `src/app` owns the Server Action and passes it down as a prop or an injected dependency (`src/app/bandAdminActions.ts` is the pattern). Enforced by the `no-restricted-imports` block in `eslint.config.mjs`, which exempts `__tests__` because a route-handler test has to import the handler.
```

Do not touch the `<!-- BEGIN:nextjs-agent-rules -->` block; `next dev` rewrites it.

### 9. Test plan

All three suites follow the house pattern established by RH-46: `// @vitest-environment jsdom`
as the literal first line, `import { cleanup } from '@testing-library/react'` with an
explicit `afterEach(cleanup)` (because `globals: false`), plain-property assertions (there
is no jest-dom), and **no `vi.mock` of any `@/app/actions/*` module** - the whole point of
the task is that the spy arrives as a value.

**`src/hooks/__tests__/useBandAdmin.test.tsx` - retargeted, not rewritten.** Delete the
`vi.mock('@/app/actions/bands', ...)` block (L5-L14) and the eight-name import from
`@/app/actions/bands` (L25-L34). Keep the `@/lib/auth-client` and `@/lib/imageCompressor`
mocks. Add a factory that returns a fresh spy object with the same default behaviours the
old `beforeEach` installed:

```ts
type BandAdminActionSpies = { [K in keyof BandAdminActions]: Mock }

function makeActions(): BandAdminActionSpies {
  return {
    getBandWithMembers: vi.fn().mockResolvedValue(BAND),
    getBandPlaylists: vi.fn().mockResolvedValue(PLAYLISTS),
    updateBand: vi.fn().mockResolvedValue(undefined),
    deleteBand: vi.fn().mockResolvedValue(undefined),
    leaveBand: vi.fn().mockResolvedValue(undefined),
    removeBandMember: vi.fn().mockResolvedValue(undefined),
    createBandPlaylist: vi.fn().mockResolvedValue('pl-1'),
    uploadBandCover: vi.fn().mockResolvedValue({ coverUrl: null }),
  }
}
```

`setup(overrides = {}, actions = makeActions())` passes `actions` into the hook and returns
it alongside `result`, `showToast`, `onNotFound`, `onGone` and `onNavigateToPlaylist`;
`setupLoaded` forwards both arguments. A test that needs a non-default behaviour builds the
object first and programs it before rendering, e.g.
`const actions = makeActions(); actions.getBandWithMembers.mockResolvedValue(null); const { result, onNotFound } = setup({ loadPolicy }, actions)`.
Every assertion `expect(getBandWithMembersAction).toHaveBeenCalledWith(BAND_ID)` becomes
`expect(actions.getBandWithMembers).toHaveBeenCalledWith(BAND_ID)`, and so on for the other
seven. **All 29 test names, all five describe names, and every non-mock assertion stay
character-for-character identical**, including the `it.each` label arrays (the two rows in
the destructive-actions table key off `'deleteBand'` / `'leaveBand'` action names, which
now name keys of the spy object instead of imported symbols). The
`captureUnhandledRejection` helper and the `BANDS_PAGE_LOAD_POLICY` unhandled-rejection
test are untouched - they are the guard that RH-18's load policies still mean what they
say.

**`src/components/songs/__tests__/SongForm.test.tsx` (new, 5 tests).** Mocks
`@/store/repertoireStore` only (a `useRepertoireStore` returning `{ loadSongs }`, which
also keeps `@/app/actions/repertoire` out of the module graph entirely). Installs the
`showModal` stub from constraint 1 in `beforeAll`. Builds `actions` as an object of five
`vi.fn()`s. Fixture `ENTRY` is a `Repertoire` with `id: 'rep-1'`, `status: 'learning'`,
`tags: ['rock']`, `personal_key: 'G'` and an inner `song` `{ id: 'song-1', title: 'Yellow',
artist: 'Coldplay', album: 'Parachutes', standard_key: 'B', duration_seconds: 269, links: [] }`.
Describe block `SongForm calls its injected actions (RH-47)`:

1. `creates a song through the injected createAndAddSong action` - render with no `song`;
   the dialog is `getByRole('dialog', { name: 'Add song' })`; fill `getByLabelText(/^Title/)`
   with `Yellow` and `getByLabelText('Artist')` with `Coldplay`; click the `Add` button.
   `actions.createAndAddSong` was called once with
   `expect.objectContaining({ title: 'Yellow', artist: 'Coldplay' })`,
   `actions.updateSongStatus` and `actions.updateSongTags` were **not** called (status is
   `unknown` and there are no tags), and `onSuccess` was called once.
2. `applies the status and tags through their injected actions after creating` - same
   setup plus `getByLabelText('Tags')` set to `rock, live` and the `Learning` status radio
   clicked. `actions.updateSongStatus` was called with `('rep-1', 'learning')` and
   `actions.updateSongTags` with `('rep-1', ['rock', 'live'])`, where `rep-1` is the `id`
   of the `Repertoire` the mocked `createAndAddSong` resolved.
3. `saves an edit through the injected updateSong action` - render with `song={ENTRY}` and
   click `Save`. `actions.updateSong` was called once with `ENTRY` as the first argument
   and, as the second,
   `{ title: 'Yellow', artist: 'Coldplay', album: 'Parachutes', key: 'G', cover_url: null, duration_seconds: 269, status: 'learning', tags: ['rock'], links: [] }`.
4. `shows the error message when an injected action rejects` - `createAndAddSong` rejects
   `new Error('Song already in repertoire')`; after submitting, that text is in the
   document and `onSuccess` was not called.
5. `passes the injected submitGlobalSongEdit down to the correction modal` - render with
   `song={ENTRY}`, click `Correct Global Info`, then click `Submit for Moderation`.
   `actions.submitGlobalSongEdit` was called once with
   `('song-1', { title: 'Yellow', artist: 'Coldplay', album: 'Parachutes', standard_key: 'B', reason: null })`
   and the text `Correction request submitted for admin review!` appears.

All five argument shapes above were captured from a probe run against the current
component, so they are today's behaviour, not a guess.

**`src/components/songs/__tests__/CorrectionModal.test.tsx` (new, 4 tests).** Mocks
nothing at all. `SONG` is the same inner `GlobalSong` as above. Describe block
`CorrectionModal submits through its injected callback (RH-47)`:

1. `seeds its fields from the song prop` - `getByDisplayValue` finds `Yellow`, `Coldplay`,
   `Parachutes` and `B` (see constraint 2: the labels are not associated with the inputs).
2. `submits the trimmed fields through onSubmitCorrection, then succeeds and closes` -
   change the title field to `'  Yellow (Live)  '` and
   `fireEvent.submit(container.querySelector('form')!)`; `onSubmitCorrection` was called
   once with
   `('song-1', { title: 'Yellow (Live)', artist: 'Coldplay', album: 'Parachutes', standard_key: 'B', reason: null })`,
   and `onSuccess` and `onClose` were each called once.
3. `refuses to submit when the title is blank` - set the title to `'   '` and submit;
   `Title and artist are required.` is in the document and `onSubmitCorrection` was not
   called.
4. `shows the failure message when onSubmitCorrection rejects` - reject with
   `new Error('Song not found')`; that text appears and `onClose` was not called.

All four were verified against the current component in a probe run (with the action
module mocked to stand in for the future prop), including the trimming in test 2 and the
`fireEvent.submit` route in test 3.

**Suite arithmetic.** 9 new tests in 2 new files: 57 files / 727 tests becomes 59 files /
736 tests. `useBandAdmin.test.tsx` stays at 29.

## Expected Results

ER1 - The static gates are all green at the merge commit, run from the repository root. `./node_modules/.bin/tsc --noEmit` exits 0 and prints nothing (use that exact binary path; `npx tsc` is intercepted by a shell hook in this environment). `npx eslint .` reports exactly `29 problems (12 errors, 17 warnings)`, which is the unchanged baseline of commit `51151d7` even though a new rule was added. Within that total, `npx eslint src/hooks/useBandAdmin.ts src/components/songs/SongForm.tsx src/components/songs/CorrectionModal.tsx src/app/page.tsx "src/app/bands/[id]/page.tsx" src/app/profile/page.tsx src/app/bandAdminActions.ts eslint.config.mjs src/hooks/__tests__/useBandAdmin.test.tsx src/components/songs/__tests__/SongForm.test.tsx src/components/songs/__tests__/CorrectionModal.test.tsx` reports exactly `1 problem (1 error, 0 warnings)`: a single `react-hooks/set-state-in-effect` error in `src/app/profile/page.tsx` on the `setActiveTab(context.type === "band" ? "band" : "personal")` line inside the band-context sync effect, which is the pre-existing baseline error for that file and is not touched by this task. `npm run lint:dead` exits 0 and reports no unused files, exports or dependencies. `npm run lint:dup` exits 0 and prints a total duplication percentage below 2 %. `npm run audit` exits 0 and prints `found 0 vulnerabilities`.

ER2 - No file under `src/components`, `src/lib` or `src/hooks` imports from the App Router tree any more, tests aside. `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing and exits 1. Per file, `grep -n "@/app/" src/hooks/useBandAdmin.ts src/components/songs/SongForm.tsx src/components/songs/CorrectionModal.tsx` also prints nothing and exits 1. The six pre-existing test-file hits are unaffected and are expected to remain: `grep -rln "@/app/" src/lib/__tests__ | sort` still prints the four paths `src/lib/__tests__/devProfiles.test.ts`, `src/lib/__tests__/spotify.test.ts`, `src/lib/__tests__/spotifyPlaylistRouteAuthz.db.test.ts`, `src/lib/__tests__/spotifySyncAtomicity.db.test.ts`, because those suites import the `src/app/api/**` route handlers they exist to test.

ER3 - The direction is enforced mechanically, and the enforcement is proved to bite. `eslint.config.mjs` contains a config object whose `files` is exactly `["src/components/**", "src/lib/**", "src/hooks/**"]`, whose `ignores` is `["**/__tests__/**"]`, and whose `rules` sets `"no-restricted-imports"` to `"error"` with a `patterns` entry whose `group` contains both `"@/app/*"` and `"@/app/**"`. Tamper check, run from the repository root at the merge commit: `printf "import { getBandsAction } from '@/app/actions/bands'\n\nexport const probe = getBandsAction\n" > src/lib/rh47RuleProbe.ts` then `npx eslint src/lib/rh47RuleProbe.ts` prints exactly `1 problem (1 error, 0 warnings)`, and the reported line names the rule id `no-restricted-imports` and quotes the import source `'@/app/actions/bands'`. Then `rm src/lib/rh47RuleProbe.ts`, after which `test ! -e src/lib/rh47RuleProbe.ts && echo restored` prints `restored` and `git status --porcelain -- src` prints nothing, proving the probe left no trace under `src`. The check is scoped to `src` on purpose: an unscoped `git status --porcelain` also reports this task's own untracked spec and log files and would fail a correct implementation.

ER4 - `useBandAdmin` receives its eight band actions as an injected object and both consumers supply it. `grep -n "export interface BandAdminActions" src/hooks/useBandAdmin.ts` prints one line, and inside that interface `grep -c "=> Promise<" src/hooks/useBandAdmin.ts` counts at least 8 members covering `getBandWithMembers`, `getBandPlaylists`, `updateBand`, `deleteBand`, `leaveBand`, `removeBandMember`, `createBandPlaylist` and `uploadBandCover` (each name appears at least once in the file: `grep -c "getBandWithMembers\|getBandPlaylists\|updateBand\|deleteBand\|leaveBand\|removeBandMember\|createBandPlaylist\|uploadBandCover" src/hooks/useBandAdmin.ts` prints a number of 16 or more). `grep -n "actions: BandAdminActions" src/hooks/useBandAdmin.ts` prints one line inside `UseBandAdminOptions`. The composition root exists: `src/app/bandAdminActions.ts` is a file, `grep -c "Action," src/app/bandAdminActions.ts` prints 16 or more (the eight `...Action,` import specifiers plus the eight `key: ...Action,` assignments in `BAND_ADMIN_ACTIONS`) and `grep -n "export const BAND_ADMIN_ACTIONS" src/app/bandAdminActions.ts` prints one line. Both consumers wire it: `grep -n "BAND_ADMIN_ACTIONS" "src/app/bands/[id]/page.tsx" src/app/profile/page.tsx` prints exactly two lines per file, one import and one `actions: BAND_ADMIN_ACTIONS` inside the `useBandAdmin({ ... })` call.

ER5 - `SongForm` and `CorrectionModal` receive their server calls from above, and the page supplies them. `grep -n "export interface SongFormActions" src/components/songs/SongForm.tsx` and `grep -n "actions: SongFormActions" src/components/songs/SongForm.tsx` each print at least one line, and `grep -c "actions\." src/components/songs/SongForm.tsx` prints 5 or more (the four repertoire calls plus the forward into the modal). `grep -n "onSubmitCorrection" src/components/songs/CorrectionModal.tsx` prints at least two lines (the prop declaration and the call in `handleSubmit`), and `grep -n "onSubmitCorrection={" src/components/songs/SongForm.tsx` prints exactly one line, inside the single `<CorrectionModal` element in that file. `grep -n "SONG_FORM_ACTIONS" src/app/page.tsx` prints exactly two lines, the module-level declaration and the `actions={SONG_FORM_ACTIONS}` prop on the single `<SongForm` element. `grep -c "submitGlobalSongEditAction" src/app/page.tsx` prints 2 (its import and its use in that object) while `grep -c "submitGlobalSongEditAction" src/components/songs/CorrectionModal.tsx` prints 0.

ER6 - The existing `useBandAdmin` suite proves the hook still behaves identically while now driven by an injected fake. `npx vitest run src/hooks/__tests__/useBandAdmin.test.tsx` exits 0 reporting exactly 29 passed tests, 0 failed. `npx vitest run src/hooks/__tests__/useBandAdmin.test.tsx --reporter=verbose` shows the same five describe blocks as at `51151d7`, with the same per-block counts: `useBandAdmin load policies` 6 tests, `useBandAdmin derived state` 6, `useBandAdmin edit modal` 8, `useBandAdmin destructive actions` 6, `useBandAdmin playlist creation` 3. Among them, `BANDS_PAGE_LOAD_POLICY lets the load failure reject unhandled instead of showing a banner`, `BAND_PROFILE_LOAD_POLICY clears loading on not-found` and `BANDS_PAGE_LOAD_POLICY keeps loading on not-found` are present and passing, which is what proves RH-18's two load policies still mean what they mean. `grep -n "@/app/" src/hooks/__tests__/useBandAdmin.test.tsx` prints nothing and exits 1: the suite no longer mocks the action module, it injects spies.

ER7 - Two new jsdom suites prove the two components render and call outward from props alone. `src/components/songs/__tests__/SongForm.test.tsx` exists, its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, and `npx vitest run src/components/songs/__tests__/SongForm.test.tsx` passes with exactly 5 tests and 0 failures, named verbatim: `creates a song through the injected createAndAddSong action`; `applies the status and tags through their injected actions after creating`; `saves an edit through the injected updateSong action`; `shows the error message when an injected action rejects`; `passes the injected submitGlobalSongEdit down to the correction modal`. `src/components/songs/__tests__/CorrectionModal.test.tsx` exists, its literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, and `npx vitest run src/components/songs/__tests__/CorrectionModal.test.tsx` passes with exactly 4 tests and 0 failures, named verbatim: `seeds its fields from the song prop`; `submits the trimmed fields through onSubmitCorrection, then succeeds and closes`; `refuses to submit when the title is blank`; `shows the failure message when onSubmitCorrection rejects`. The second `CorrectionModal` test asserts the injected callback was called once with the song id `song-1` and a payload whose `title` is the trimmed `Yellow (Live)` and whose `reason` is `null`.

ER8 - Neither new suite, and not the retargeted one, mocks a Server Action module. `grep -n "@/app/actions" src/components/songs/__tests__/SongForm.test.tsx src/components/songs/__tests__/CorrectionModal.test.tsx src/hooks/__tests__/useBandAdmin.test.tsx` prints nothing and exits 1. `grep -c "vi.mock" src/components/songs/__tests__/CorrectionModal.test.tsx` prints 0. `grep -n "vi.mock" src/components/songs/__tests__/SongForm.test.tsx` prints exactly one line, mocking `@/store/repertoireStore`, and `grep -n "vi.mock" src/hooks/__tests__/useBandAdmin.test.tsx` prints exactly two lines, mocking `@/lib/auth-client` and `@/lib/imageCompressor`.

ER9 - Behaviour elsewhere is provably unchanged and the whole suite is green. `git diff 51151d7 -- src/lib src/app/actions src/proxy.ts src/types src/store migrations e2e` prints nothing, proving no domain module, Server Action, migration or end-to-end spec was touched - in particular `src/lib/bandAdminLoad.ts` and its suite `src/lib/__tests__/bandAdminLoad.test.ts` are byte-identical, so RH-18's load policies were satisfied rather than adjusted. `npx vitest run src/lib/__tests__/bandAdminLoad.test.ts src/lib/__tests__/bands.test.ts src/lib/__tests__/bands.server.test.ts src/lib/__tests__/moderation.test.ts src/lib/__tests__/errorHandlingStyle.test.ts src/lib/__tests__/noBrowserDialogs.test.ts src/hooks/__tests__/useToast.test.tsx` reports 7 passed files and 0 failures. Then, with Postgres running at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied (`npm run db:migrate`) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` or the environment, `npx vitest run` exits 0 reporting at least 59 test files and at least 736 tests passed, with 0 failed and 0 skipped. Without those two preconditions six DB-backed files skip 51 tests and the run does not count.

ER10 - The coverage gate still passes and `useBandAdmin.ts` did not lose coverage. With the same Postgres and `SUPABASE_SERVICE_ROLE_KEY` preconditions as ER9, `npm run test:coverage` exits 0 with all four thresholds met (statements 80, branches 65, functions 78, lines 80). In the printed text table, the row for `useBandAdmin.ts` shows `% Stmts` at least 95, `% Branch` at least 75, `% Funcs` at least 90 and `% Lines` at least 95; the baseline at `51151d7` was 98.55 / 78.08 / 94.74 / 98.55, so this is a floor, not a target. The coverage universe itself is unchanged: `git diff 51151d7 -- vitest.config.ts` prints nothing.

ER11 - The app still builds and server-renders, and the band-admin flow still works end to end. `npx next build` exits 0. `npx playwright test e2e/ssr-smoke.spec.ts` reports `4 passed`. `npx playwright test e2e/bands-confirm.spec.ts` exits 0 reporting `3 passed` (`delete band via the inline confirmation`, `cancel keeps the band`, `Escape dismisses the confirmation`), which exercises the real `useBandAdmin` confirmations against real Server Actions rather than injected spies. `e2e/songs-crud.spec.ts` is explicitly not part of this result and must not be run as a gate for this task: all three of its tests are already red at the `51151d7` baseline for reasons unrelated to this change (tracked as RH-44 - `locator('dialog[open]')` never reaches count 0 at `e2e/helpers.ts:57`, and `[aria-label="Song list"]` never becomes visible at `e2e/helpers.ts:27`), so it cannot distinguish a correct implementation from a broken one. The `SongForm` path is instead covered by ER7's jsdom suite plus `e2e/ssr-smoke.spec.ts`.

ER12 - The version was bumped, the landing page was left alone, and nothing outside the task's footprint was touched. `node -p "require('./package.json').version"` prints a string matching `^0\.1\.74-20[0-9]{10}$` (patch 74, then a 12-digit `YYYYMMDDHHmm` local-time stamp), strictly greater than the `0.1.73-202609071401` at `51151d7`. This task ships no user-facing feature - it is an internal dependency inversion plus a lint rule - so it is not a selling point, and `git diff --stat 51151d7 -- src/components/landing src/i18n/dictionaries` prints nothing. `git diff --name-only 51151d7` prints a subset of exactly this whitelist and nothing else: `AGENTS.md`, `docs/tasks/RH-47-spec.md`, `docs/suggestions-log.md`, `package.json`, `eslint.config.mjs`, `src/app/bandAdminActions.ts`, `src/app/page.tsx`, `src/app/bands/[id]/page.tsx`, `src/app/profile/page.tsx`, `src/components/songs/SongForm.tsx`, `src/components/songs/CorrectionModal.tsx`, `src/components/songs/__tests__/SongForm.test.tsx`, `src/components/songs/__tests__/CorrectionModal.test.tsx`, `src/hooks/useBandAdmin.ts`, `src/hooks/__tests__/useBandAdmin.test.tsx`. The only change permitted inside `AGENTS.md` is one added bullet at the end of the `**Testing & quality**` list stating that `src/components`, `src/hooks` and `src/lib` must not import `@/app/*` and naming `eslint.config.mjs` as the enforcer: `git diff 51151d7 -- AGENTS.md` shows added lines only, no deletions, and no change inside the `<!-- BEGIN:nextjs-agent-rules -->` block.

## Out of Scope

- **`src/store/repertoireStore.ts` keeps its `@/app/actions/repertoire` import.** `SongForm`
  still calls `loadSongs()` through `useRepertoireStore`, so the inward edge survives
  transitively. F21 named `src/components`, `src/lib` and `src/hooks`; `src/store` is
  deliberately outside the new rule's `files` list, and inverting a zustand store that four
  pages share is a different change with a different risk profile. Recorded as a suggestion.
- **No change to any Server Action or `src/lib` module.** `src/app/actions/bands.ts`,
  `repertoire.ts` and `moderation.ts` keep their exact signatures; this task only changes
  who imports them. `src/lib/bandAdminLoad.ts` is untouched.
- **No behaviour change anywhere.** Same actions, same arguments, same order, same loading
  flags, same error text, same toasts, same `revalidatePath` (which happens inside the
  actions and is not moved). Unlike RH-46 this task has no accepted behaviour delta at all,
  which is what makes ER6's "29 tests, same names, same assertions" checkable.
- **No unification of the two `useBandAdmin` consumers.** `/bands/[id]` and the `/profile`
  band tab keep their deliberately different markup and their different load policies, as
  RH-18 settled.
- **No new coverage-gate entries.** `src/components/**` and `src/app/**` stay outside
  `coverage.include`; the two new jsdom suites are regression protection, not gate movement.
  `src/app/bandAdminActions.ts` is a nine-line composition root with no logic and gets no
  test of its own - it is exercised end to end by `e2e/bands-confirm.spec.ts`.
- **`e2e/songs-crud.spec.ts` is not a gate for this task and is not repaired here.** All
  three of its tests fail at the `51151d7` baseline, before any change in this task:
  `e2e/helpers.ts:57` waits for `locator('dialog[open]')` to reach count 0 and it never
  does, and `e2e/helpers.ts:27` waits for `[aria-label="Song list"]` to become visible and
  it never does. That is a pre-existing failure tracked as RH-44, in a spec this task does
  not touch (ER9 requires `git diff 51151d7 -- e2e` to print nothing). Running it would only
  reproduce RH-44's red, so ER11 gates on `e2e/bands-confirm.spec.ts` - green at baseline
  with `3 passed` - and the `SongForm` path is covered by the new jsdom suite (ER7) plus
  `e2e/ssr-smoke.spec.ts`.
- **The ESLint rule is not extended to other directions.** It bans `@/app/*` from three
  directories. It does not police `src/components` importing `src/lib`, relative-path
  escapes such as `../../app/actions/x`, or `src/lib` importing `src/components`. Those are
  not violations that exist today and inventing patterns for them would be untested config.

## Post-merge checks (orchestrator)

- `docs/plans/code-quality-review.md` F21 can now be closed. Its text still says "the two
  inward dependencies found by M4" and its remediation still asks for the ESLint rule; both
  are satisfied only after RH-47, across RH-46 and this task. The undercount (five, not two)
  is recorded in `.meridian/reports/RH-37-spec-1.md`.
- F8 and F22 were closed by RH-45 (`a493731`); confirm the review document reflects that
  before archiving RH-37.
- RH-37 should return to `backlog` for its own integration spec (or be closed as fully
  delivered by RH-45 / RH-46 / RH-47), since all three parts of its decomposition will have
  landed.
