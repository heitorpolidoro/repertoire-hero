# RH-184 — Create a playlist in the active band context

Mockup: `docs/tasks/RH-184-mock.html`. It shows `/playlists` at desktop and phone width, with a toggle for personal mode, band mode, and a band the user has already left. A second toggle switches between today's behaviour and the behaviour after this task.

## Scope

`+ New Playlist` on `/playlists` always calls `createPlaylistAction`, which inserts `user_id` only (`createPlaylist`, `src/lib/playlists.ts`). So a musician in band mode gets a personal playlist. This task makes the dialog's "New playlist" tab create the playlist for the active band. It goes through the band-playlist write that already exists, `createBandPlaylistAction` → `createBandPlaylist` (`src/lib/bands.ts`), the same call the band page's "+ New playlist" makes. In personal context nothing changes.

Covered: picking the owner from the active context, a one-line owner cue in the dialog in band context, tests (vitest and one Playwright spec), and the registry line and comments this makes stale.

Not covered:
- **Who may create a band playlist.** This task changes no permission, in code or in documentation. `docs/use-cases.md` (*Create, reorder and delete a playlist*, "Decided", 2026-10-01) says band playlists are band-admin only to create, rename, reorder and delete, and the registry line "Creating, renaming, reordering and deleting a band playlist requires a band admin." agrees. The code has not caught up for create, rename and delete: `createBandPlaylist` checks membership only (RH-34), and the band page shows "+ New playlist" to every member. RH-103 recorded the same gap and left it to a separate task. Both documents and that line stay as they are. Reconciling them with the code is a follow-up whose direction is the operator's question (see the report). Whichever way it goes, the follow-up is one change in `createBandPlaylist`, and that covers both entry points.
- An owner picker inside the dialog. To create for another owner, the musician switches context first.
- The Spotify import tab. It already sends the active band as `band_id` and stays admin-gated (`resolveBandOwnership`). The only new thing there is the owner cue, which names where the import lands.
- Filtering `/playlists` by the active context (RH-181's open question), and the band page's own create flow.
- Adding songs to a band playlist, which stays admin-only, including the picker defect noted in `e2e/playlist-row-mobile.spec.ts`.
- The landing page. This is not a selling point: bands already have shared playlists, and this task makes one more entry point respect band mode. No dictionary changes.

## Approach

**Behavior**
- **Owner from the context.** `CreatePlaylistModal` is already the only island on the route that reads `useBandContextStore`. It mounts only after the click, so no server-rendered markup depends on the persisted store. Its `onCreate` now receives the active band id along with the trimmed name, `onCreate(name, bandId)`, with `bandId` `null` in personal context. `PlaylistsView` calls `actions.createBandPlaylist(bandId, name)` when `bandId` is set and `actions.createPlaylist({ name })` otherwise, then `router.refresh()` as today. In both contexts the dialog closes on success and the page stays on `/playlists`. (The band page navigates to the new playlist instead.)
- **No server changes.** `createBandPlaylistAction` → `createBandPlaylist` already resolves the session and refuses a non-member with "Access denied: not a member of this band". It inserts `band_id` with a null `user_id`. No action, lib function, SQL or migration changes.
- **A plain member in band mode.** `+ New Playlist` creates the band playlist, because `createBandPlaylist` accepts any member. This is the same outcome the band page's "+ New playlist" gives that member today. The task adds no capability: it routes the second entry point through the same function. It also makes no test or result depend on member-level create, so a later admin-only change breaks nothing here.
- **Where it shows.** After the refresh, the list read on the server includes the new row, and `buildPlaylistGroups` puts it in the band's `section[aria-label="Band: <name>"]`. If this is the band's first playlist, the section appears now. A personal playlist goes to `section[aria-label="My playlists"]`.
- **Owner cue.** In band context, the dialog header shows a line under the "New Playlist" title, `id="new-playlist-owner"` and `data-testid="new-playlist-owner"`: a 🎸 (`aria-hidden`) and "Band playlist for <band name>". It shows on both tabs, because a Spotify import lands in the same band. The dialog's `aria-describedby="new-playlist-owner"` points at it. In personal context the line is not rendered, and neither is `aria-describedby`, so the dialog looks as it does today. The copy is English and written inline (AGENTS.md, Internationalisation).
- **Stale context.** `AppShell`'s reconciliation normally resets a persisted band the user no longer belongs to. If Create runs before that, the refusal shows inline in the dialog through the existing `createError`. The dialog stays open and the list is not refreshed. A production build may replace a thrown Server Action message with a generic one, so the exact copy is guaranteed by the jsdom test only. This page's existing delete and rename banner works the same way.

**Files touched**
- `src/components/playlists/CreatePlaylistModal.tsx`: reads the whole context instead of only `bandId()`, passes `bandId` to `onCreate`, and renders the owner cue and `aria-describedby`. It also updates the comments that say the context has one destination.
- `src/components/playlists/PlaylistsView.tsx`: `PlaylistsViewActions` gains `createBandPlaylist(bandId: string, name: string): Promise<string>`, and `handleCreatePlaylist` picks which action to call.
- `src/app/playlists/page.tsx`: adds `createBandPlaylistAction` (from `@/app/actions/bands`) to `PLAYLISTS_VIEW_ACTIONS`, and corrects the comment that calls the import the context's "one consumer".
- `src/components/playlists/__tests__/CreatePlaylistModal.test.tsx` and `src/components/playlists/__tests__/PlaylistsView.test.tsx`: the cases below, plus the stale header comment. The existing create case now expects `('Gig setlist', null)`.
- `e2e/playlist-band-context.spec.ts`: new. It runs in the `chromium` project and needs no `playwright.config.ts` change.
- `e2e/playlist-row-mobile.spec.ts`: comment only. Its first reason, "`+ New Playlist` always creates a personal playlist", stops being true. The fixture stays because of the second reason.
- `docs/behavior.md`: the one line below. `package.json`: version bump (AGENTS.md).
- Not touched: `docs/use-cases.md`, `src/lib/bands.ts`, `src/app/actions/bands.ts` and the permission line in `docs/behavior.md`.
- No new complexity override, and every touched file stays under 400 lines.

The branch is one commit behind master (RH-181, `c28a7e5`). Rebase it before implementing. The e2e uses `createBand`, `deleteBand` and the `band-indicator-exit` test id from that commit.

**Test criteria**
- `CreatePlaylistModal` (jsdom):
  - in band context `{ id: 'band-7', name: 'The Rolling Stones' }`, Create calls `onCreate('Gig setlist', 'band-7')`;
  - in personal context, Create calls `onCreate('Gig setlist', null)`;
  - in band context the cue reads "Band playlist for The Rolling Stones" and is the dialog's accessible description, and it is still present on the From Spotify tab;
  - in personal context there is no `new-playlist-owner` element.
- `PlaylistsView` (jsdom, through the real modal):
  - band context: `createBandPlaylist('band-1', 'Encore')` is called once, `createPlaylist` never, and `refresh` once;
  - personal context: `createPlaylist({ name: 'Encore' })` is called once and `createBandPlaylist` never;
  - `createBandPlaylist` rejects with "Access denied: not a member of this band": that text shows in the open dialog and `refresh` is not called.
- Playwright (`chromium`, desktop):
  1. `createBand` (`e2e/helpers.ts`) creates a band through `/bands`, which makes the test user its admin.
  2. Enter band context through the persisted `band-context` entry, as `band-indicator-mobile.spec.ts` does. Open `/playlists` and wait until `band-indicator` shows the band. That proves the reconciliation kept it.
  3. Open `+ New Playlist`: the owner cue names the band.
  4. Create a playlist named with `uniqueFixtureName`. Its `Open <name>` card is inside `section[aria-label="Band: <band>"]` and not inside `section[aria-label="My playlists"]`. It is still there after `page.reload()`.
  5. Leave band mode with `band-indicator-exit`, which navigates to `/`. Go back to `/playlists` and open the dialog: there is no owner cue.
  6. Create a second playlist. It is inside "My playlists" and not in the band section.
  7. Clean up. Delete the personal playlist (`openPlaylist`, `deletePlaylistFromDetail`). Then delete the band with `deleteBand`, which removes its playlists by cascade.
- These stay green: `npm run lint` (check the exit code out of band, per AGENTS.md), `lint:dead`, `lint:dup` and the full vitest suite.

## Behavior changes

- changed: Playlists — A playlist belongs to exactly one owner, a user or a band; on /playlists both + New Playlist and the Spotify import take it from the active context, and in band context the dialog reads "Band playlist for <band name>". (src/components/playlists/CreatePlaylistModal.tsx, src/components/playlists/PlaylistsView.tsx, e2e/playlist-band-context.spec.ts) (RH-184)

This replaces "A playlist belongs to exactly one owner, a user or a band, taken from the current context." That line was true for the import and false for `+ New Playlist` until now.

The line "Creating, renaming, reordering and deleting a band playlist requires a band admin." stays as it is. It records the decision in `docs/use-cases.md`, and this task does not change that decision. For create, rename and delete, the line and the code already disagree on the band page. This task's new entry point uses the same `createBandPlaylist`, so it has the same disagreement and no other. The follow-up resolves both entry points at once, in one direction or the other.

## Expected Results
- [ ] With a band active, a playlist created through `+ New Playlist` on `/playlists` is listed inside `section[aria-label="Band: <band name>"]` and not under "My playlists", including after a reload.
- [ ] With the personal context active, a playlist created through `+ New Playlist` is listed inside `section[aria-label="My playlists"]` and in no band section.
- [ ] With a band active, the New Playlist dialog is described by `#new-playlist-owner` reading "Band playlist for <band name>" on both tabs, and in personal context that element is absent.
- [ ] When creating in band context is refused with "Access denied: not a member of this band", the dialog stays open, shows that message and does not refresh the list (`PlaylistsView.test.tsx`).
- [ ] `CreatePlaylistModal.test.tsx` and `PlaylistsView.test.tsx` cover the band and personal contexts and pass.
- [ ] `e2e/playlist-band-context.spec.ts` passes in the `chromium` project.
- [ ] `node scripts/behavior.js area Playlists` prints the RH-184 ownership line in place of the line it replaces, and still prints "Creating, renaming, reordering and deleting a band playlist requires a band admin." unchanged.

## Out of Scope
- Changing who may create, rename or delete a band playlist, in code, in `docs/use-cases.md` or in the registry.
- An owner picker in the dialog, and filtering `/playlists` by context.
- The Spotify import's permission, and adding songs to band playlists.

## Operator Results Coverage
- "With a band active, a playlist created with + New Playlist on /playlists appears under the section for that band" → Behavior (owner from the context, where it shows) → ER1.
- "With the personal context active, a new playlist is still personal" → Behavior (owner from the context) → ER2.
- "Tests cover both contexts and pass" → Test criteria (jsdom, Playwright) → ER5 and ER6.
