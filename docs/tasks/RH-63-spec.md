# RH-63 — Server Components parte 3/5: converter /playlists em Server Component e resolver o contexto de banda no servidor

Parent: RH-41 (F15, part 3 of 5). Depends on RH-61 (`57bc60a`, done) and RH-62
(`6e32874`, done).
Baseline for every measurement in this document: `6e32874`
(`refactor(RH-62): render /bands and /admin/moderation on the server with client islands`).

## Scope

Convert exactly one route — `src/app/playlists/page.tsx`, 899 lines,
`"use client"` on line 1 — into an `async` Server Component that reads the
playlist list through `getUserPlaylists(userId)` from `@/lib/playlists` with the
session helpers, resolves the Spotify connection flag on the server, and hands
everything to `"use client"` islands under `src/components/playlists/`.

Three things come with the conversion and are part of this task:

1. **The band-context transport decision** (below): where the active band
   context comes from once a Server Component renders the page, given that
   `src/store/bandContextStore.ts` is a zustand `persist` store in
   localStorage that no Server Component can read.
2. **The second read**, `fetch("/api/spotify/playlists")`, which happens in the
   page's mount effect today and must not happen on mount any more.
3. **The inline `// eslint-disable-next-line react-hooks/set-state-in-effect`**
   at line 728, removed by deleting the effect it guards, not by relocating the
   comment.

Behaviour is preserved: same header and `+ New Playlist` button, same grouping
into `My playlists` plus one section per band, same card markup with the rename
pencil and the inline `Sure? / Yes / No` delete confirmation, same dismissable
error banner, same create modal with its two tabs, same Spotify import flow
including the `Keep synced with Spotify` checkbox and the band destination, same
navigation to `/playlists/<id>` on a card click. The route moves from the
prerendered set to the dynamic (`f`) set of the `next build` route table.

One visible difference is carved out of that preservation, and only one: because
`spotifyConnected` is resolved on the server it becomes a plain `boolean` and
never `null`, so the `&& spotifyConnected !== null` loading guard in the
empty-state condition at line 807 disappears. An account with no playlists sees
`No playlists yet` at first paint instead of a blank panel until the
`/api/spotify/playlists` round trip resolves. That is an improvement, it is the
direct consequence of the server read, and no other user-visible behaviour
changes.

Nothing else changes: no Server Action signature changes, no
`src/app/actions/playlists.ts` change, no `src/lib/playlists.ts` change, no
`src/app/api/**` change, no `src/store/**` change, no `src/proxy.ts` change, no
`/playlists/[id]` change.

## Audit at 6e32874

### `src/app/playlists/page.tsx` — 899 lines, `"use client"` on line 1

Module-level pieces, in file order:

- 20-27 `formatDuration(totalSeconds)` — pure, no dependency on React.
- 33-54 `ModalCloseButton` — presentational.
- 60-74 `PendingImport` and `SpotifyImportListItemProps` interfaces.
- 76-161 `SpotifyImportListItem` — presentational, one `?.` chain.
- 167-176 `CreatePlaylistTab` type and `CreatePlaylistModalProps`
  (`spotifyConnected: boolean | null`, `spotifyPlaylists: SpotifyPlaylist[]`,
  `bandId: string | null`, `onClose`, `onCreate`, `onImported`).
- 178-403 `CreatePlaylistModal` — **226 lines**, which is the file's
  `max-lines-per-function` ceiling. Seven `useState` (`activeTab`,
  `newPlaylistName`, `isCreating`, `createError`, `pendingImport`,
  `importingId`, `importError`), one `useRef`, three `useEffect`
  (197-199 focus on tab change, 201-203 focus on mount, 206-212 Escape
  listener), `handleCreate` (214-227), `handleConfirmImport` (229-255, POSTs
  `/api/spotify/playlists/<id>/import` with `band_id: bandId ?? undefined`),
  `canShowSpotifyTab = spotifyConnected === true` (257), then the dialog:
  header (271-274), tab bar (277-306), tab content (309-378) and the footer
  shown only on the `new` tab (381-399).
- 409-454 `PlaylistNameEditor` — presentational.
- 456-643 `PlaylistCard` — 181 lines. Three `useState` (`confirmDelete`,
  `editing`, `editName`), one `useRef`, one `useEffect` (474-476) that focuses
  the rename input when `editing` flips (no `setState`), `handleRenameSubmit`,
  the `songCount` / `totalSeconds` / `totalDuration` derivation (484-494) and
  the card markup, including the inline delete confirmation at 590-613
  (`Sure?` / `Yes` / `No` — there is no `window.confirm` anywhere on this page).
- 649-684 `PlaylistGroup` interface and `buildPlaylistGroups(playlists)` — a
  pure function, currently untested.
- 690-897 `PlaylistsPage` — **208 lines**. `useRouter`,
  `useBandContextStore((s) => s.bandId())` at 692, five `useState`
  (`playlists`, `spotifyConnected` initial `null`, `spotifyPlaylists`,
  `showCreateModal`, `pageError`), `loadPlaylists` (699-708, `useCallback`),
  `loadSpotifyStatus` (710-725, `useCallback`, `fetch("/api/spotify/playlists")`,
  `catch { setSpotifyConnected(false) }`), the mount effect at **727-731**
  carrying the inline `// eslint-disable-next-line react-hooks/set-state-in-effect`
  at 728, `handleDelete` (733-742, optimistic local filter), `handleRename`
  (744-756, optimistic local map then re-read on failure), `handleCreatePlaylist`
  (758-761, `createPlaylist` then `loadPlaylists`), `handleImported` (763-765),
  the `useMemo` grouping (767-772), and the JSX (774-896).

The dispatch brief counts five effects on the page: three live in
`CreatePlaylistModal`, one in `PlaylistCard`, one in `PlaylistsPage`. Only the
last one reads data; the other four are focus/keyboard effects and are moved
verbatim with their components.

Measured facts:

- `grep -c "" src/app/playlists/page.tsx` prints `899`.
- `rtk proxy npx eslint src/app/playlists/page.tsx` exits `0` with no output:
  the page contributes **nothing** to the repo total of
  `22 problems (8 errors, 14 warnings)`, because the one violation it would
  report is silenced by the inline disable and the two `max-lines-per-function`
  violations plus the `max-lines` violation are absorbed by its override.
- Its override in `eslint.config.mjs` is
  `{ name: "complexity-budget/override", files: ["src/app/playlists/page.tsx"], rules: { "max-lines-per-function": ["error", 226], "max-lines": ["error", 899] } }`.
- Copying the file to `src/components/playlists/__probe.tsx` (where the override
  glob does not match) and linting it reports exactly four errors: the
  `@/app/actions/playlists` import (F21), `Arrow function has too many lines
  (226)` at 178:29, `File has too many lines (899)` at 401:1 and `Arrow function
  has too many lines (208)` at 690:23. **No `complexity`, no `max-depth`, no
  `max-params` violation** — so the split below is driven by line counts only,
  not by branch arithmetic (RH-62's moderation split was the opposite case).
  The probe file was deleted after measuring.

### Who reads and writes the band context

`src/store/bandContextStore.ts` (35 lines) is `create(persist(..., { name:
'band-context' }))`, i.e. localStorage. Writers: `ContextSwitcher` inside
`src/components/layout/AppLayout.tsx:41,59-60` (the dropdown, which also calls
`loadSongs()` and `router.push('/')`), `AppLayout:166,172` (sign-out and
`Exit band mode`), `src/app/AppShell.tsx:34-41` (reconciles the persisted
name/colour with the database row after `getBandsAction()` resolves — RH-46),
and `src/hooks/useBandAdmin.ts:235-237` (after a band rename). Readers:
`src/app/page.tsx:126`, `src/app/profile/page.tsx:661`,
`src/app/playlists/[id]/page.tsx:278`, `src/app/playlists/page.tsx:692`,
`src/store/repertoireStore.ts:37,48,63` and `AppLayout` itself. Fast View does
not read the store at all: `src/app/songs/[id]/fast-view/page.tsx:45` takes the
context from the `bandId` **query parameter** instead.

**What line 692 actually decides on this page.** `bandId` is read once and used
in exactly one place: it is passed to `CreatePlaylistModal` (889) and lands in
the import POST body as `band_id: bandId ?? undefined` (241). It does **not**
scope the list. `src/lib/playlists.ts:8-41` `getUserPlaylists(userId)` takes no
band argument at all: it selects `WHERE p.user_id = $1 OR p.band_id = ANY($2)`
over every band the user belongs to, and the page then splits the result into
`My playlists` plus one section per band with `buildPlaylistGroups`. So the read
this page performs is already user-scoped, and the band context is only the
destination of one mutation.

### The Spotify read

`src/app/api/spotify/playlists/route.ts` (67 lines, RH-35) answers
`{ connected: false }` when there is no session or when
`getSpotifyAccessToken(userId)` returns `null`, otherwise an array of
`SpotifyPlaylist`. `getSpotifyAccessToken` (`src/lib/spotifyAuth.ts:10-96`)
reads `spotify_tokens` and, when the token is within 60 seconds of expiry,
performs an HTTP POST to `https://accounts.spotify.com/api/token` to refresh it.
The page maps the answer onto `spotifyConnected: boolean | null`, where `null`
means "not resolved yet" and is used as a loading guard in the empty-state
condition at line 807 (`playlists.length === 0 && spotifyConnected !== null`).
`spotifyConnected === true` also enables the `From Spotify` tab (257, 294-295)
and appends `" or import one from Spotify"` to the empty-state copy (816).

### Actions, revalidation and authorization

`src/app/actions/playlists.ts` is A2-thin: every export resolves
`getRequiredUserId()` and delegates to `src/lib/playlists`, with no `try/catch`
and no `next/cache` import — `grep -n "revalidatePath" src/app/actions/playlists.ts`
prints nothing. Signatures used here:
`getUserPlaylistsAction(): Promise<Playlist[]>`,
`createPlaylistAction({ name, description? }): Promise<Playlist>`,
`updatePlaylistAction(id, { name?, description?, sync_with_spotify?, tags? }): Promise<void>`,
`deletePlaylistAction(id): Promise<void>`. Authorization lives in the lib
(`assertPlaylistAccess`, `assertBandMember`) and is unchanged by this task.
`getUserPlaylistsAction` keeps its export even though the page stops calling it:
`src/app/actions/__tests__/playlists.test.ts:74` and
`src/app/actions/__tests__/actionSessionGuard.test.ts:147` still import it, and
knip does not flag an export whose only consumer is a test — verified by adding
a throwaway `src/lib/__probeKnip.ts` plus a test importing it and running
`npx knip`, which exited `0`; both probe files were deleted.

### Route table and gates at 6e32874

`npx next build` output already on disk at this commit:

```
prerendered (12): / /_global-error /_not-found /forgot-password /icon.jpg
                  /login /playlists /profile /reset-password /settings /signup
                  /songs/search
dynamic    (16): /admin/moderation /api/auth/[...all] /api/auth/spotify/authorize
                  /api/auth/spotify/callback /api/auth/spotify/disconnect
                  /api/dev/profiles /api/spotify/playlists
                  /api/spotify/playlists/[id]/import
                  /api/spotify/playlists/[id]/sync
                  /api/spotify/playlists/[id]/tracks /api/spotify/search /bands
                  /bands/[id] /join/[code] /playlists/[id] /songs/[id]/fast-view
```

`.next/server/app/playlists.html` exists (14K) and contains the string
`My playlists` and no playlist data; it does **not** contain `No playlists yet`,
because `spotifyConnected` is `null` during the prerender so the empty-state arm
is not taken.

`src/proxy.ts:3` `PUBLIC_PATHS` is
`['/login', '/signup', '/forgot-password', '/reset-password', '/api/auth/', '/api/dev/', '/join/']`
and `/` is public; `/playlists` is not, so an unauthenticated request is
answered `307` by the middleware and never reaches the page component.

Other gates, all verified at `6e32874`: `rtk proxy npx vitest run` 95 files /
1083 tests / 0 skipped (Postgres at
`postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations
applied and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`);
`rtk proxy npx eslint .` `22 problems (8 errors, 14 warnings)`;
`npm run lint:dup` 19 clones / 242 duplicated lines / `0.70 %`; `npm run
lint:dead` clean; `./node_modules/.bin/tsc --noEmit` clean; `npm run audit` 0
high/critical; coverage thresholds 80 / 65 / 78 / 80; `eslint.config.mjs` holds
exactly 22 override entries and `src/lib/__tests__/complexityBudget.test.ts`
sets `MAX_OVERRIDES = 22` across 6 tests, one named `lists at most 22 per-file
overrides, each naming a file that exists`; `AGENTS.md:94` ends on "and on the
list growing past 22 entries"; `package.json` version `0.1.92-202609091251`.

## Approach

### The band-context transport: user-scoped server read, context stays client-side

**Decision: option (b).** The Server Component reads `getUserPlaylists(userId)`
— personal playlists plus every band the user belongs to, which is what the
function already returns — and renders all of it. The active band context is
never transported to the server. It stays exactly where it is today, in the
zustand store, and is read by the one client island that needs it:
`CreatePlaylistModal`, for the `band_id` of a Spotify import.

The comparison the dispatch asks for:

| | (a) cookie mirror | (b) user-scoped read, context on the client | (c) `/playlists?bandId=` |
|---|---|---|---|
| Correctness across tabs/devices | Cookie is per-browser like localStorage, so no better; needs a validation pass (`assertBandMember`) on every render to fail closed when the cookie names a band the user left, and a migration path for users whose localStorage already holds a context but whose browser has no cookie yet | Unchanged from today: one store, one writer set, no second source of truth that can disagree | Per-tab, which is *different* from today's per-browser semantics; the switcher pushes `/` on every switch, so a bookmarked `/playlists?bandId=` goes stale silently |
| SSR flash on context switch | Real: the server would render the band-scoped list from a possibly stale cookie, then the client would correct it | None: the server markup does not depend on the context, so nothing can mismatch on hydration | Real for a stale or absent param |
| Blast radius | `src/store/bandContextStore.ts` (6 production readers, 4 writers, 2 test suites), a new `src/lib` cookie validator plus its tests, an extra membership query per render, `cookies()` in the page | `src/app/playlists/page.tsx` and the new island files only | Every link to `/playlists` (`AppLayout` `NAV_ITEMS` desktop and mobile) has to carry the parameter |
| RH-64 / RH-65 boundary | Pre-empts the design of a cross-cutting transport that `useBandAdmin` (RH-64) and `src/proxy.ts` (RH-65) are the natural owners of | Leaves that decision to the parts that own it | Same objection as (a), plus it is Fast View's convention, not the app chrome's |

The deciding fact is in the audit: on this route the band context is not an
input to the read. Introducing a cookie (or a query parameter) here would add a
second source of truth, a fail-closed validation path and a hydration-flash risk
to buy nothing that the page actually needs. Options (a) and (c) are recorded in
Out of Scope with that reason. If a later route genuinely needs server-side
band scoping, (a) is the option to revisit, and it should be designed once, for
all routes, by the part that owns the shared plumbing.

Two consequences worth stating explicitly:

- `src/components` may import `@/store/*` — the F21 restriction is on `@/app/*`
  only, and `AppLayout`, `useBandAdmin` and `repertoireStore` all read the store
  the same way. So the island needs no new prop plumbing.
- The store read is placed in `CreatePlaylistModal`, which is mounted only after
  the user clicks `+ New Playlist`, i.e. never during hydration. Therefore no
  server-rendered markup depends on a localStorage value and there is no
  hydration mismatch to guard with a `mounted` flag.

### The Spotify read: connection flag on the server, playlist list on tab open

Split in two, because the two halves have different costs:

- **`spotifyConnected`** is needed at first paint (it enables the `From Spotify`
  tab and changes the empty-state copy), so the server resolves it — but with a
  cheap row-existence check, not `getSpotifyAccessToken`, which would block SSR
  on an HTTP round trip to `accounts.spotify.com` whenever the token is near
  expiry. New file `src/lib/spotifyConnection.ts`:

  ```ts
  export async function hasSpotifyConnection(userId: string): Promise<boolean> {
    try {
      const res = await query<{ one: number }>(
        'SELECT 1 AS one FROM spotify_tokens WHERE user_id = $1 LIMIT 1',
        [userId],
      )
      return (res.rowCount ?? 0) > 0
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to check the Spotify connection', err, { userId })
      return false
    }
  }
  ```

  This deliberately degrades to `false` instead of following L1's log-then-throw,
  and the reason goes in a comment at the call site: it replaces
  `catch { setSpotifyConnected(false) }` (page line 722-724) and it must not turn
  an unreachable `spotify_tokens` table into a 500 document for a page whose
  main content does not depend on Spotify at all. `catch (x: any)` and
  `console.error` are not used, so `src/lib/__tests__/errorHandlingStyle.test.ts`
  stays green.

- **The playlist list** is fetched from the existing
  `GET /api/spotify/playlists` route, unchanged, **from the `From Spotify` tab
  button's `onClick` handler** in `CreatePlaylistModal`, guarded by a
  `hasLoadedSpotify` flag so it runs at most once per modal open. Not on page
  mount, not on modal mount, and not from a `useEffect` — an event handler,
  which is why no new `react-hooks/set-state-in-effect` suppression is needed
  anywhere. While the request is in flight the panel shows `Loading Spotify
  playlists...`; if the route answers `{ connected: false }` (a token that no
  longer refreshes) the panel shows the same `Connect your Spotify account in
  Profile & Settings` copy the disabled-tab case shows today.

  The row check and the token check can therefore disagree for a user whose
  refresh token has been revoked: the tab is enabled and the panel then reports
  no connection. That is the accepted cost of not blocking SSR on Spotify, and
  it is strictly better than today, where such a user silently gets a disabled
  tab with no explanation.

`spotifyConnected` becomes a plain `boolean` (never `null`), so the empty-state
condition at line 807 loses its `&& spotifyConnected !== null` loading guard and
becomes `playlists.length === 0`.

### New files

Under `src/components/playlists/` (the directory does not exist at `6e32874`):

- **`PlaylistsView.tsx`** — `"use client";` on line 1, the only island the page
  imports. Exports `PlaylistsView` and
  `export interface PlaylistsViewActions { createPlaylist(data: { name: string; description?: string }): Promise<Playlist>; updatePlaylist(id: string, data: { name?: string }): Promise<void>; deletePlaylist(id: string): Promise<void> }`.
  Props: `{ playlists: Playlist[]; initialError: string | null; spotifyConnected: boolean; actions: PlaylistsViewActions }`.
  State: `pageError` (seeded with `initialError`), `showCreateModal`,
  `removedIds: string[]`, `renames: Record<string, string>`. No `useEffect`, no
  data fetch. Renders the header, the error banner, `PlaylistGroupList` and the
  modal.
- **`PlaylistGroupList.tsx`** — presentational, no state. Props
  `{ playlists, onOpen, onDelete, onRename }`; calls `buildPlaylistGroups`,
  renders the empty state, the `My playlists` section and one section per band
  with its `/bands/<id>` link, delegating each row to `PlaylistCard`.
- **`PlaylistCard.tsx`** — `PlaylistCard` and `PlaylistNameEditor` moved
  verbatim (including the focus effect and the inline `Sure? / Yes / No` delete
  confirmation), with the duration derivation replaced by calls into
  `@/lib/playlistList`.
- **`CreatePlaylistModal.tsx`** — `ModalCloseButton` plus the modal, moved with
  three changes: `bandId` is read from `useBandContextStore((s) => s.bandId())`
  instead of arriving as a prop, `spotifyConnected` is a `boolean`, and the
  Spotify list is loaded in the tab button's handler into new state
  (`spotifyPlaylists`, `spotifyLoading`, `spotifyLoadFailed`). The tab bar may be
  extracted into `CreatePlaylistTabs.tsx` if the arrow function still measures
  over 200 lines.
- **`SpotifyImportPanel.tsx`** — `SpotifyImportListItem` plus the tab body
  (loading, not-connected, empty and list states). Presentational apart from the
  `pendingImport` / `importingId` / `importError` state it may keep; the
  `POST /api/spotify/playlists/<id>/import` call and the `band_id` it carries
  stay wherever `handleConfirmImport` lands, and that placement is free as long
  as the store read stays inside `CreatePlaylistModal.tsx`.

Under `src/lib/` (both enter the coverage universe, hence the unit tests in
ER12):

- **`playlistList.ts`** — the pure decisions lifted out of the page, in the
  spirit of the Fast View precedent (AGENTS.md): `PlaylistGroup`,
  `buildPlaylistGroups(playlists)` (moved verbatim from lines 649-684),
  `formatPlaylistDuration(totalSeconds)` (moved from lines 20-27),
  `playlistDurationSeconds(playlist)` (the reduce at lines 487-493), and
  `applyPlaylistOverlay(playlists, { removedIds, renames })` (new, see below).
- **`spotifyConnection.ts`** — `hasSpotifyConnection(userId)` as above.

No `src/app/*Actions.ts` module is created: the page is the composition root and
holds a module-scope `const PLAYLISTS_VIEW_ACTIONS: PlaylistsViewActions`, which
is the `src/app/bands/page.tsx` (RH-62) and `src/app/page.tsx:104` precedent.
No new file may take a complexity override — the list is a ratchet that may only
shrink — so every new file must be clean under `complexity` 15, `max-depth` 4,
`max-lines-per-function` 200, `max-params` 4 and `max-lines` 400. The
`226`-line modal and the `208`-line page body are therefore split as described,
and the implementer confirms with eslint rather than trusting these estimates.

### The server page

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import { getUserPlaylists } from "@/lib/playlists";
import { hasSpotifyConnection } from "@/lib/spotifyConnection";
import {
  createPlaylistAction,
  deletePlaylistAction,
  updatePlaylistAction,
} from "@/app/actions/playlists";
import { PlaylistsView, type PlaylistsViewActions } from "@/components/playlists/PlaylistsView";
import type { Playlist } from "@/types/database";

const PLAYLISTS_VIEW_ACTIONS: PlaylistsViewActions = {
  createPlaylist: createPlaylistAction,
  updatePlaylist: updatePlaylistAction,
  deletePlaylist: deletePlaylistAction,
};

export default async function PlaylistsPage() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  let playlists: Playlist[] = [];
  let loadError: string | null = null;
  try {
    playlists = await getUserPlaylists(userId);
  } catch (error) {
    // `src/lib/playlists.ts` already logged this at L1; a second log would
    // double-report to Sentry. Degrade to the same banner as before.
    const err = error instanceof Error ? error : new Error(String(error));
    loadError = err.message;
  }

  return (
    <PlaylistsView
      playlists={playlists}
      initialError={loadError}
      spotifyConnected={await hasSpotifyConnection(userId)}
      actions={PLAYLISTS_VIEW_ACTIONS}
    />
  );
}
```

`getSession()` rather than `getRequiredUserId()` for the same reason as RH-62:
the latter throws a 500 document where a redirect is wanted, and `redirect()`
returns `never`, which narrows `userId` to `string` without a non-null
assertion. The route is dynamic by construction because `getSession()` awaits
`headers()`; no `export const dynamic` is added. Over HTTP the redirect is
unreachable — `src/proxy.ts` answers `307` first (ER8) — and exists as defence
in depth.

### Refresh strategy after a mutation

Same shape as RH-62, and the same reasoning: no `revalidatePath` is added,
because touching `src/app/actions/playlists.ts` would drag
`actionSessionGuard` / `actionAuthorizationGuard` / `actionDataAccessGuard` into
a refactor whose subject is the page layer, and revalidating a route that is
dynamic-by-session buys nothing.

The list is **not** copied into `useState`. A `useState(initialPlaylists)`
initialiser is ignored on re-render, so a `router.refresh()` would leave the
copy stale forever — the trap that RH-62's islands avoided only because their
lists shrink monotonically. Instead the props are the source of truth and the
island keeps a small overlay of in-flight local edits, applied at render by the
pure `applyPlaylistOverlay(playlists, { removedIds, renames })`:

- **Delete**: push the id into `removedIds` (the card disappears at once), call
  `actions.deletePlaylist(id)`, then `router.refresh()`. On failure, drop the id
  from `removedIds` again and set `pageError` — today's behaviour, which leaves
  the card in place and shows the banner.
- **Rename**: write `renames[id] = name`, call
  `actions.updatePlaylist(id, { name })`, then `router.refresh()`. On failure,
  drop the entry and set `pageError`.
- **Create / import**: call the action (or let the import POST finish), then
  `router.refresh()`, then close the modal. No overlay is needed because the new
  row can only come from the server.

The overlay entries are never cleared, and they do not need to be: after the
refresh a removed id is absent from the props (so the filter is a no-op) and a
renamed playlist already carries the overlay's name (so the map is a no-op). The
one visible consequence is that if a *different* member renames the same band
playlist afterwards, this tab keeps showing the locally applied name until a
full page load — the same staleness today's local `setPlaylists` copy has, and
strictly smaller in scope.

`useRouter()` comes from `next/navigation` and is mocked in the jsdom tests.
No `useEffect` is introduced in `PlaylistsView`.

### eslint, override and AGENTS.md consequences

- The inline `// eslint-disable-next-line react-hooks/set-state-in-effect`
  disappears with the effect it guards. Nothing else on the page reported a
  problem, so the repo total stays `22 problems (8 errors, 14 warnings)`: this
  task removes no problem from the count (the suppressed one was never counted)
  and must add none.
- The page drops to roughly 45 lines with no function over 200, so its override
  entry **must be deleted** from `eslint.config.mjs` — `complexityBudget.test.ts`
  fails on a ceiling that is not exactly the file's current worst number.
- That leaves 21 entries. `MAX_OVERRIDES` goes `22 -> 21` and the test title
  becomes `lists at most 21 per-file overrides, each naming a file that exists`,
  per the ratchet comment at that constant. `AGENTS.md:94` ends on "the list
  growing past 22 entries"; that number documents the guard's actual ceiling, so
  it becomes "past 21 entries" in the same commit. This is the RH-55 / RH-62
  precedent exactly (`b024a87` 24 -> 23, `6e32874` 23 -> 22), each a numstat of
  one insertion and one deletion in AGENTS.md and nothing more. If `next build`
  regenerates the `<!-- BEGIN:nextjs-agent-rules -->` block at lines 317-325,
  that regeneration is reverted before the commit.

### Test plan

**`src/components/playlists/__tests__/PlaylistsView.test.tsx`** — literal first
line `// @vitest-environment jsdom`, `import { cleanup } from
'@testing-library/react'` with `afterEach(cleanup)` (globals are off), and
`vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))`
with hoisted `vi.fn()`s, in the style of
`src/components/bands/__tests__/BandsView.test.tsx`. Eight tests, names in ER10.
The last one stubs `globalThis.fetch` with a `vi.fn()` and asserts it was never
called by a plain render — the mechanical proof that the mount read is gone, not
relocated.

**`src/components/playlists/__tests__/CreatePlaylistModal.test.tsx`** — same
jsdom preamble; `globalThis.fetch` stubbed per test; the band context set with
`useBandContextStore.setState({ context: ... })` exactly as
`src/hooks/__tests__/useBandAdmin.test.tsx:153,308` does. Eight tests, names in
ER11; two of them pin the transport decision by asserting the `band_id` in the
import request body for a band context and for the personal context.

**`src/lib/__tests__/playlistList.test.ts`** (node environment, no mocks, pure
functions) and **`src/lib/__tests__/spotifyConnection.test.ts`** (node, with
`vi.mock('@/lib/db')` and `vi.mock('@/lib/logger')` in the style of
`src/lib/__tests__/spotifyRouteAuth.test.ts`). Eleven and four tests, names in
ER12.

**The server half** is not unit-tested: an `async` Server Component that awaits
`headers()` and imports `'use server'` modules is not renderable under vitest,
and `src/app/**/page.tsx` is outside the coverage universe by policy
(AGENTS.md). It is verified by build-manifest inspection (ER7), by `curl`
against `next start` (ER8) and by two new Playwright tests appended to
`e2e/server-pages.spec.ts`, which assert on the raw HTTP document with no
JavaScript executed:

- `GET /playlists signed in is server-rendered with the playlist rows in the document`
  — create a uniquely named playlist through the UI, then `request.get('/playlists')`
  and expect `200`, a body containing that name, and no `id="__next_error__"`.
  At `6e32874` the prerendered shell contains no playlist name at all, so this
  test is red before the change.
- `deleting a playlist through the inline confirmation removes it from the server-rendered document`
  — create a uniquely named playlist, delete it through `Sure? / Yes`, then
  assert the raw document no longer contains the name. This pins the delete
  path, the `router.refresh()` and the absence of a browser `confirm()` in one
  test.

### Whitelist

Required:

```
AGENTS.md
docs/tasks/RH-63-spec.md
e2e/server-pages.spec.ts
eslint.config.mjs
package.json
src/app/playlists/page.tsx
src/components/playlists/CreatePlaylistModal.tsx
src/components/playlists/PlaylistCard.tsx
src/components/playlists/PlaylistGroupList.tsx
src/components/playlists/PlaylistsView.tsx
src/components/playlists/SpotifyImportPanel.tsx
src/components/playlists/__tests__/CreatePlaylistModal.test.tsx
src/components/playlists/__tests__/PlaylistsView.test.tsx
src/lib/__tests__/complexityBudget.test.ts
src/lib/__tests__/playlistList.test.ts
src/lib/__tests__/spotifyConnection.test.ts
src/lib/playlistList.ts
src/lib/spotifyConnection.ts
```

Permitted but not required, and nothing else:

```
docs/suggestions-log.md
src/components/playlists/CreatePlaylistTabs.tsx
src/components/playlists/SpotifyImportListItem.tsx
```

**Landing Page Rule decision.** This is an internal rendering refactor: it adds
no capability a musician or band would choose the app for, and Spotify import
and playlists are already on the landing page as selling points. The landing
copy must not change; ER13 asserts that mechanically.

**Version.** Bump `package.json` to `0.1.93-YYYYMMDDHHmm` with a real local
timestamp (from `0.1.92-202609091251`).

## Expected Results

ER1 - `src/app/playlists/page.tsx` is an async Server Component that reads through the domain layer: `grep -c "use client" src/app/playlists/page.tsx` prints `0`; `grep -c "useState\|useEffect\|useMemo\|useCallback\|useRef" src/app/playlists/page.tsx` prints `0`; `grep -c "export default async function" src/app/playlists/page.tsx` prints `1`; `grep -c "getSession\|getRequiredUserId" src/app/playlists/page.tsx` prints a number greater than or equal to `1`; `grep -c "@/lib/playlists" src/app/playlists/page.tsx` prints `1`; `grep -c "redirect(" src/app/playlists/page.tsx` prints a number greater than or equal to `1`; `grep -c "getUserPlaylistsAction" src/app/playlists/page.tsx` prints `0`; `grep -c "api/spotify/playlists" src/app/playlists/page.tsx` prints `0`; and `grep -c "" src/app/playlists/page.tsx` prints a number less than or equal to `60` (it printed `899` at `6e32874`). The data layer it reads is untouched: `git diff 6e32874 -- src/app/actions/playlists.ts src/lib/playlists.ts src/app/api` prints nothing.

ER2 - The client islands exist under `src/components/playlists/` and respect the project's import and dialog rules: `test -f src/components/playlists/PlaylistsView.tsx && test -f src/components/playlists/PlaylistGroupList.tsx && test -f src/components/playlists/PlaylistCard.tsx && test -f src/components/playlists/CreatePlaylistModal.tsx && test -f src/components/playlists/SpotifyImportPanel.tsx` exits `0` (the directory does not exist at `6e32874`); `head -1 src/components/playlists/PlaylistsView.tsx` prints exactly `"use client";`; `grep -c "export interface PlaylistsViewActions" src/components/playlists/PlaylistsView.tsx` prints `1`; `grep -c "useEffect" src/components/playlists/PlaylistsView.tsx` prints `0`; `grep -rn "@/app/" src/components src/lib src/hooks | grep -v __tests__` prints nothing at all; and `grep -rnE "(^|[^A-Za-z.])(alert|confirm)\(" src/components/playlists src/app/playlists/page.tsx` prints nothing at all, so the delete confirmation is still the inline `Sure? / Yes / No` affordance and never a browser dialog.

ER3 - The band context is not transported to the server, and the store is untouched: `grep -c "useBandContextStore\|bandContextStore" src/app/playlists/page.tsx` prints `0`; `grep -c "cookies()" src/app/playlists/page.tsx` prints `0`; `grep -c "searchParams" src/app/playlists/page.tsx` prints `0`; `grep -rn "document.cookie\|next/headers\|cookies()" src/app/playlists src/components/playlists src/lib/playlistList.ts src/lib/spotifyConnection.ts` prints nothing at all, so no cookie mirror of the band context was introduced in any file this task owns (that command prints nothing at `6e32874` too, over the subset of those paths that exists there); `git diff 6e32874 -- src/store src/components/layout src/app/AppShell.tsx src/hooks` prints nothing, so the store that holds the context, its four writers and its persist key `band-context` in `src/store/bandContextStore.ts:33` are all byte-identical to `6e32874`; and `grep -rln "useBandContextStore" src/components/playlists --exclude-dir=__tests__` prints exactly one line, `src/components/playlists/CreatePlaylistModal.tsx` (test files under `__tests__` may name the store plainly and are not counted) - the one island that needs the active band as the destination of a Spotify import, and one that is mounted only after a user click, so no server-rendered markup depends on a localStorage value.

ER4 - The Spotify connection is resolved on the server and the playlist list is not read on mount: `test -f src/lib/spotifyConnection.ts` exits `0`; `grep -c "export async function hasSpotifyConnection" src/lib/spotifyConnection.ts` prints `1`; `grep -c "getSpotifyAccessToken\|accounts.spotify.com" src/lib/spotifyConnection.ts` prints `0` (the server render never blocks on a Spotify token refresh); `grep -c "hasSpotifyConnection" src/app/playlists/page.tsx` prints a number greater than or equal to `1`; `grep -c "spotifyConnected" src/components/playlists/PlaylistsView.tsx` prints a number greater than or equal to `1`; and `grep -rn '"/api/spotify/playlists"' src/components/playlists` prints exactly one line, in either `src/components/playlists/CreatePlaylistModal.tsx` or `src/components/playlists/SpotifyImportPanel.tsx`. That the read happens on tab open rather than on mount is proved by the named tests of ER10 and ER11.

ER5 - The inline suppression is gone and every static gate holds: `grep -c "eslint-disable" src/app/playlists/page.tsx` prints `0`; `grep -rn "set-state-in-effect" src/app/playlists src/components/playlists src/lib/playlistList.ts src/lib/spotifyConnection.ts` prints nothing at all (the comment was deleted, not relocated); `rtk proxy npx eslint .` prints `22 problems (8 errors, 14 warnings)`, unchanged from `6e32874`; `rtk proxy npx eslint src/app/playlists/page.tsx src/components/playlists src/lib/playlistList.ts src/lib/spotifyConnection.ts` exits `0` with no output, so no new file needed a complexity override; `./node_modules/.bin/tsc --noEmit` exits `0` printing nothing; `npm run lint:dead` exits `0` with no unused file, export or dependency reported; `npm run lint:dup` exits `0` with the `Total:` row reporting at most `19` clones and at most `0.70 %` duplicated lines - exactly the `6e32874` numbers, because nothing in this task is expected to create a clone: the page shrinks, its two helpers move into `src/lib/playlistList.ts`, and the `formatDuration` pair it shares with `src/app/playlists/[id]/page.tsx:38` falls below `.jscpd.json`'s `minTokens: 50` floor, so jscpd does not report it at `6e32874` and will not report it after the copy merely changes address; and `npm run audit` exits `0` with `0` high or critical advisories.

ER6 - The complexity ratchet shrinks by exactly one entry and the manifest follows it: `grep -c "src/app/playlists/page.tsx" eslint.config.mjs` prints `0` (the `src/app/playlists/\[id\]/page.tsx` entry is a different string and must survive); the count of lines matching `complexity-budget/override` in `eslint.config.mjs` is `21` (it was `22`); `grep -c "MAX_OVERRIDES = 21" src/lib/__tests__/complexityBudget.test.ts` prints `1`; `rtk proxy npx vitest run src/lib/__tests__/complexityBudget.test.ts` exits `0` printing `Tests  6 passed (6)`, including the test now named `lists at most 21 per-file overrides, each naming a file that exists`; `grep -c "past 21 entries" AGENTS.md` prints `1` and `grep -c "past 22 entries" AGENTS.md` prints `0`; and `git diff --numstat 6e32874 -- AGENTS.md` prints exactly one line, whose three tab-separated fields are `1`, `1` and `AGENTS.md` - one insertion, one deletion, no other line touched, so if `next build` regenerated the `nextjs-agent-rules` block it was reverted before the commit.

ER7 - From a clean build, `rm -rf .next && npx next build` exits `0` and `/playlists` has moved from the prerendered set to the dynamic set. `node -e "const r=Object.keys(require('./.next/prerender-manifest.json').routes).sort();console.log(r.length);console.log(r.join(' '))"` prints exactly two lines: `11`, then `/ /_global-error /_not-found /forgot-password /icon.jpg /login /profile /reset-password /settings /signup /songs/search`. At `6e32874` that command printed `12` and a list that additionally contained `/playlists`; that name must be absent now, and `ls .next/server/app/playlists.html` must exit non-zero (the file existed at `6e32874`, at 14K, containing the string `My playlists`). `node -e "const a=Object.values(require('./.next/app-path-routes-manifest.json'));const s=new Set(Object.keys(require('./.next/prerender-manifest.json').routes));const d=a.filter(x=>!s.has(x)).sort();console.log(d.length);console.log(d.join(' '))"` prints exactly two lines: `17`, then `/admin/moderation /api/auth/[...all] /api/auth/spotify/authorize /api/auth/spotify/callback /api/auth/spotify/disconnect /api/dev/profiles /api/spotify/playlists /api/spotify/playlists/[id]/import /api/spotify/playlists/[id]/sync /api/spotify/playlists/[id]/tracks /api/spotify/search /bands /bands/[id] /join/[code] /playlists /playlists/[id] /songs/[id]/fast-view` - the `6e32874` dynamic set of 16 plus exactly `/playlists`, no other route having moved in either direction. Consistently, the `Route (app)` table printed by that build marks `/playlists` with `f`.

ER8 - With `export BETTER_AUTH_SECRET=test-secret DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` and `npx next start -p 3210` serving the ER7 build, and with no cookie sent: `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3210/playlists` prints `307 http://127.0.0.1:3210/login?redirect=%2Fplaylists`; `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3210/bands` prints `307 http://127.0.0.1:3210/login?redirect=%2Fbands`; and `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3210/login` prints `200`. These are the `6e32874` values unchanged: the `src/proxy.ts` session gate, not the page, answers an unauthenticated request, and converting the page must not alter that.

ER9 - End-to-end, run with `PLAYWRIGHT_WEB_SERVER="npx next start -p 3000 -H 127.0.0.1"`, `BETTER_AUTH_SECRET` exported from `.env.local`, Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` with migrations applied, and the ER7 build present: `npx playwright test e2e/server-pages.spec.ts --reporter=list` exits `0` printing `4 passed`, with the two RH-62 tests still green (`GET /bands signed in is server-rendered with no loading placeholder`, `GET /admin/moderation signed in as a non-admin renders Access Denied`) and two new ones green, named exactly `GET /playlists signed in is server-rendered with the playlist rows in the document` (creates a uniquely named playlist through the UI, then asserts `request.get('/playlists')` returns status `200`, a body containing that name and no `id="__next_error__"`) and `deleting a playlist through the inline confirmation removes it from the server-rendered document` (creates a uniquely named playlist, deletes it through the `Sure?` / `Yes` affordance, then asserts the raw document no longer contains the name). Checked out at `6e32874` with only this file changed, the first new test fails, because the prerendered shell there contains no playlist name. Under the same server, the pre-existing suites stay at their `6e32874` counts: `npx playwright test e2e/ssr-smoke.spec.ts` exits `0` printing `4 passed`; `npx playwright test e2e/bands-confirm.spec.ts` exits `0` printing `3 passed`; `npx playwright test e2e/auth.spec.ts --grep "credentials"` exits `0` printing `2 passed`. No file under `e2e/` other than `e2e/server-pages.spec.ts` is modified.

ER10 - `rtk proxy npx vitest run src/components/playlists/__tests__/PlaylistsView.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  8 passed (8)` with `0 failed`. The file's literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, and its eight tests are named exactly: `renders one card per playlist from its props, grouped by owner`, `renders the empty state when the playlist list prop is empty`, `renders the initialError prop in the page error banner`, `deletes a playlist through the injected action and removes its card`, `refreshes the router after a successful delete`, `renames a playlist through the injected action and shows the new name`, `surfaces a delete failure in the error banner and keeps the card`, `issues no network request while rendering the list`. The last one stubs `globalThis.fetch` with a `vi.fn()` and asserts it was never called, which is the mechanical proof that the mount read of `/api/spotify/playlists` is gone rather than relocated into the island.

ER11 - `rtk proxy npx vitest run src/components/playlists/__tests__/CreatePlaylistModal.test.tsx` exits `0` printing `Test Files  1 passed (1)` and `Tests  8 passed (8)` with `0 failed`. The file's literal first line is `// @vitest-environment jsdom`, it calls `afterEach(cleanup)`, it imports nothing from `@/app/`, and its eight tests are named exactly: `creates a playlist through the injected action and closes the modal`, `does not request the Spotify playlist list until the From Spotify tab is opened`, `requests the Spotify playlist list once when the From Spotify tab is opened`, `disables the From Spotify tab when the server reports no Spotify connection`, `imports a Spotify playlist into the active band when the context is a band`, `imports a Spotify playlist with no band id when the context is personal`, `surfaces an import failure inside the pending import row`, `closes on Escape`. The two import tests set the context with `useBandContextStore.setState(...)` and assert the `band_id` field of the parsed `POST /api/spotify/playlists/<id>/import` request body - the band id in the first, `undefined` in the second - which is the mechanical proof that the band context still reaches its one destination without any server-side transport.

ER12 - The extracted domain logic is unit-tested and enters the coverage universe green. `rtk proxy npx vitest run src/lib/__tests__/playlistList.test.ts` exits `0` printing `Test Files  1 passed (1)` and `Tests  11 passed (11)`, its tests named exactly: `groups personal playlists into a single personal group`, `groups band playlists under the band name, sorted alphabetically`, `falls back to the band id when the band row carries no name`, `returns no group at all for an empty playlist list`, `hides every playlist whose id is in the removed list`, `applies a rename to the matching playlist and leaves the others untouched`, `returns an equal list when the overlay is empty`, `formats a duration under an hour as minutes and seconds`, `formats a duration of an hour or more with an hours segment`, `sums the song durations of a playlist`, `returns zero seconds when the playlist carries no song array`. `rtk proxy npx vitest run src/lib/__tests__/spotifyConnection.test.ts` exits `0` printing `Test Files  1 passed (1)` and `Tests  4 passed (4)`, its tests named exactly: `reports a connection when the tokens table has a row for the user`, `reports no connection when the tokens table has no row for the user`, `reports no connection and logs the failure when the query throws`, `never performs a token refresh request`. `grep -c "" src/lib/playlistList.ts` and `grep -c "" src/lib/spotifyConnection.ts` each print a number less than or equal to `400`, and neither file appears in `eslint.config.mjs`.

ER13 - Whole-suite and release hygiene, with Postgres reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations applied) and a non-empty `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`: `rtk proxy npx vitest run` exits `0` reporting `Test Files` passed greater than or equal to `99` (was 95; four new suites), `Tests` passed greater than or equal to `1114` (was 1083; 31 new tests), `0 failed` and `0 skipped`; `npm run test:coverage` exits `0` with all four thresholds met (statements at least `80`, branches at least `65`, functions at least `78`, lines at least `80`). Reading the per-file numbers out of the coverage artefact this repo actually emits - `coverage/coverage-final.json`, keyed by absolute path; there is no `coverage/coverage-summary.json`, because `vitest.config.ts` declares no `reporter` and `json-summary` is not a vitest default - `node -e "const c=require('./coverage/coverage-final.json');const pct=a=>a.length?Math.round(1000*a.filter(x=>x>0).length/a.length)/10:100;for (const k of Object.keys(c)) if (k.endsWith('/src/lib/playlistList.ts')||k.endsWith('/src/lib/spotifyConnection.ts')) console.log(k.split('/src/').pop(), pct(Object.values(c[k].s)), pct(Object.values(c[k].f)))"` prints exactly two lines, `lib/playlistList.ts` and `lib/spotifyConnection.ts` in some order, each followed by a statement percentage and a function percentage of at least `90`. (That command shape is verified against `6e32874`, where the same one-liner aimed at `/src/lib/playlists.ts` and `/src/lib/spotifyAuth.ts` prints `lib/playlists.ts 98.9 100` and `lib/spotifyAuth.ts 84.4 100`.) `package.json` version is `0.1.93-YYYYMMDDHHmm` with a real local timestamp, sorting above `0.1.92-202609091251`. `git diff 6e32874 -- src/components/landing src/i18n/dictionaries` prints nothing (an internal rendering refactor is not a selling point). And `git diff --name-only 6e32874 | sort` lists only paths drawn from this closed set and no others: `AGENTS.md`, `docs/suggestions-log.md`, `docs/tasks/RH-63-spec.md`, `e2e/server-pages.spec.ts`, `eslint.config.mjs`, `package.json`, `src/app/playlists/page.tsx`, `src/components/playlists/CreatePlaylistModal.tsx`, `src/components/playlists/CreatePlaylistTabs.tsx`, `src/components/playlists/PlaylistCard.tsx`, `src/components/playlists/PlaylistGroupList.tsx`, `src/components/playlists/PlaylistsView.tsx`, `src/components/playlists/SpotifyImportListItem.tsx`, `src/components/playlists/SpotifyImportPanel.tsx`, `src/components/playlists/__tests__/CreatePlaylistModal.test.tsx`, `src/components/playlists/__tests__/PlaylistsView.test.tsx`, `src/lib/__tests__/complexityBudget.test.ts`, `src/lib/__tests__/playlistList.test.ts`, `src/lib/__tests__/spotifyConnection.test.ts`, `src/lib/playlistList.ts`, `src/lib/spotifyConnection.ts` - any other path fails this result. In particular that list contains no `src/store/bandContextStore.ts`, no `src/hooks/useBandAdmin.ts`, no `src/proxy.ts`, no `src/app/actions/playlists.ts`, no `src/lib/playlists.ts`, no `src/app/api/spotify/playlists/route.ts`, no `src/app/playlists/[id]/page.tsx` and no `docs/plans/code-quality-review.md`.

## Out of Scope

- **Transport option (a), the cookie mirror.** Writing `band-context` from the
  store's `setBandContext` / `setUserContext` via `document.cookie`, reading it
  with `cookies()` and validating it against `assertBandMember` / `getBands`.
  Rejected here because this route's read is user-scoped and the context is only
  an import destination: the cookie would add a second source of truth, a
  fail-closed validation query per render, a rehydration gap for users who
  already have a persisted context and no cookie, and an SSR-flash risk, in
  exchange for nothing this page needs. It is the option to revisit if a route
  ever needs genuine server-side band scoping, and it should then be designed
  once for all routes.
- **Transport option (c), `/playlists?bandId=`.** Fast View's convention
  (`src/app/songs/[id]/fast-view/page.tsx:45`), rejected here because it changes
  the context's semantics from per-browser to per-URL, requires every link to
  `/playlists` in `AppLayout`'s desktop and mobile navigation to carry the
  parameter, and goes stale as soon as the `ContextSwitcher` pushes `/`.
- `src/hooks/useBandAdmin.ts` and its consumers `/bands/[id]` and `/profile` -
  RH-64, part 4 of 5.
- `src/proxy.ts`, including its matcher, its `PUBLIC_PATHS` list and its
  session-over-fetch strategy - RH-65, part 5 of 5.
- Decomposing `src/app/playlists/[id]/page.tsx` (RH-53), including its own
  `useBandContextStore` read at line 278, its own `formatDuration` copy at line
  38 and its `complexity 34 / max-lines-per-function 1072 / max-lines 1344`
  override, which stays exactly as it is.
- `src/app/page.tsx`, `src/app/profile/page.tsx`, `src/app/AppShell.tsx`,
  `src/app/layout.tsx`, `src/store/**` and every other page not named in the
  whitelist.
- Any change to `src/app/actions/playlists.ts` (no new `revalidatePath`, no
  signature change, and `getUserPlaylistsAction` keeps its export even though
  only its tests import it after this change) and to `src/lib/playlists.ts`.
- Any change to `src/app/api/spotify/playlists/route.ts` or to the `import` /
  `sync` / `tracks` routes and their `resolveSpotifyRouteAccess` prologue.
- Replacing the inline `Sure? / Yes / No` delete confirmation with
  `src/components/ui/ConfirmPanel.tsx`. The page already honours the
  no-browser-dialog directive; swapping the affordance is a UI change, not a
  rendering refactor, and ER2 pins the current one.
- The four eslint errors under `src/app` and the four under `src/components`
  that make up today's `8 errors` - none of them is in a file this task touches.
- Adding a `Status:` line for F15 in `docs/plans/code-quality-review.md`: F15 is
  resolved only when all five parts have landed, and part 5 owns that line.
- Any AGENTS.md edit other than the single word `22` -> `21` in the F20
  complexity-budget sentence on line 94. The architecture bullet that should
  eventually name the converted pages as the server-read precedent is not
  touched here (recorded as a suggestion instead), and the `nextjs-agent-rules`
  block is left byte-identical to `6e32874`.
- Fixing the pre-existing red e2e specs (`songs-crud`, `fast-view-mobile`, and
  the two `/`-assumes-protected tests in `auth.spec.ts`).

## Post-merge checks (orchestrator)

After the Vercel deployment of the merge commit, the build summary should list
`/playlists` among the `f` routes and the eleven routes of ER7 as static, and a
production `curl -sS -o /dev/null -w '%{http_code}\n' https://<host>/playlists`
with no cookie should print `307`. A signed-in smoke pass should confirm that
switching to a band in the `ContextSwitcher` and then importing a Spotify
playlist from `/playlists` still lands the playlist under that band's section.
No expected result above depends on any of this.
