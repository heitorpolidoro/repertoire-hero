# Offline mode — design (RH-28)

**Date:** 2026-09-20
**Status:** Approved in brainstorming; input to the Meridian spec for RH-28
**Board task:** RH-28 "Implementar modo offline"

## Problem

A musician arrives at a venue or rehearsal room where the Wi-Fi does not reach
and the mobile signal drops. They need the setlist, the tablature PDFs and the
lyrics. Today none of that survives without a network: the app has no service
worker, no manifest, and every read goes to the server.

Two failures compound. The phone has been locked in a pocket, so the browser tab
is gone and the app must boot from nothing. And the tablature PDFs — the heaviest
and most necessary bytes — live in Vercel Blob behind `repertoire_tabs.file_url`.

## Scope decisions

Five decisions bound this work. Each was taken deliberately; each cuts work that
a wider reading would have pulled in.

| Decision | Choice | What it rules out |
|---|---|---|
| Scenario | Stage and rehearsal — the Fast View | Offline for the rest of the app |
| Trigger | Explicit download per playlist | Background or automatic caching |
| Writes | Read-only, with a visible notice | Write queue, sync, conflict resolution |
| Cold start | Must open from nothing in airplane mode | A design that only survives in a live tab |
| Install | Ship a web app manifest | App Store / Play Store distribution (that is RH-29) |

**Why read-only matters most.** `repertoire` is owned by a user **or** a band
(`check_repertoire_owner_exclusive`). Accepting offline edits to band repertoire
would mean two members editing the same row without a network and a reconciliation
layer to settle it. Refusing writes removes that entire problem by construction
rather than solving it.

**Why the manifest is in scope.** The storage this feature depends on —
IndexedDB and Cache Storage — is script-writable, and browsers evict
script-writable storage for sites the user has not returned to. Installing to the
home screen is the signal the user gives the system that the storage matters. A
home-screen *shortcut* (what Chrome creates for a site with no manifest) does not
carry that signal. Chrome also generally requires a service worker with a fetch
handler before offering installation, so the service worker this task builds is
what unlocks installability: the two pay for each other.

## Non-goals

Stated so a later reader does not mistake an omission for an oversight:

- No write queue, no background sync, no conflict resolution.
- No automatic or background download.
- No offline support for `/`, `/bands`, `/playlists`, `/settings` or search.
- No push notifications.
- No native packaging. See "Relationship to RH-29".

## Architecture

The Fast View already **injects** its action bundles rather than importing them
(`TAB_LIBRARY_ACTIONS`, `PLAYLIST_NAV_ACTIONS`, `LYRICS_EDITOR_ACTIONS` — the F21
import-direction rule). That injection point is the seam: a decorator wraps a
bundle and returns the same interface, reading from the snapshot when the network
is gone.

```
offlineFirst(TAB_LIBRARY_ACTIONS) -> same interface, snapshot-backed when offline
```

The hooks do not change. There is one offline branch, in one module, instead of a
condition scattered across every controller.

### New modules

| Module | Responsibility | Tested as |
|---|---|---|
| `src/lib/offlineSnapshot.ts` | Pure: build, validate and version the snapshot shape. No browser API. | vitest, no mocks |
| `src/lib/offlineStore.ts` | Browser boundary: write/read/delete a snapshot in Cache Storage and IndexedDB | vitest with a storage fake |
| `src/lib/offlineFirst.ts` | The action-bundle decorator | vitest, pure |
| `src/hooks/useOfflineStatus.ts` | Online/offline signal | vitest |
| `src/hooks/useOfflinePlaylist.ts` | Download controller: progress, size, removal | vitest |
| `src/app/offlineActions.ts` | The download action bundle (F21 pattern) | — |
| `src/app/manifest.ts` | Web app manifest | — |

`useOfflineStatus` **must** be built on `useSyncExternalStore`, not
`useEffect` + `setState`. That shape is a `react-hooks/set-state-in-effect`
error under this repository's ESLint config; `src/hooks/useHydrated.ts` (RH-77)
is the precedent to follow.

The service worker is configured through `@serwist/next`. `next-pwa` is
unmaintained and is not an option.

## Data flow

### Download

The control lives on the playlist detail page, `/playlists/[id]` — the screen the
musician already opens to review a setlist before a show, and the only screen that
knows which songs a playlist holds. That page became an async Server Component in
RH-71, so the control belongs in its client island, not in the page itself. The
aggregate view — total storage used and per-playlist removal — lives in
`/settings`, next to the other account-level controls.

1. The musician opens a playlist and taps "Disponível offline".
2. The action bundle reads, through the existing `src/lib` functions: the playlist
   and its order, and per song the personal key, status, lyrics and tab list.
3. `offlineSnapshot.ts` builds one versioned JSON from that.
4. The PDFs are written to Cache Storage; the JSON to IndexedDB, keyed by
   `playlistId` and carrying `savedAt`, `bytes` and `schemaVersion`.
5. The UI shows progress during, and the total size after.

### Cross-origin PDFs — verify before choosing

Tab files are uploaded with `access: 'public'`, so they are served from a Vercel
Blob domain, cross-origin to the app.

- **If the Blob response carries CORS headers**, `fetch` returns a normal
  response: `response.ok` is readable and the real byte size counts against quota.
  Cache it directly.
- **If it does not**, the response is *opaque*. It can still be stored and
  replayed, but the browser charges roughly 7 MB of quota per file regardless of
  real size, and a 404 caches as though it succeeded.

**The implementer must measure this before choosing.** If the response is opaque,
the fallback is to serve tab files through a same-origin route handler that
streams the blob. That adds one endpoint, and it *tightens* rather than loosens
the system: today that URL is public and passes no authorization gate at all.

### Reading offline

`offlineFirst` intercepts when there is no network, or when an action fails for
network reasons, and answers from the snapshot. The Fast View shows a read-only
banner and disables lyric editing and status marking. A playlist that was never
downloaded gets an explicit empty state — never an indefinite spinner.

### Service worker and manifest

Precache the app shell and the Fast View route assets, with a navigation fallback
so a cold start in airplane mode resolves. `src/app/manifest.ts` declares
`display: standalone` with 192 and 512 icons derived from the existing
`src/app/icon.jpg`.

Note that `src/proxy.ts` matches `/songs/(.*)` and turns signed-out visitors away
on the server. Offline it does not run — the service worker answers the
navigation before the network is consulted. That is intended, and it is why
sign-out must clear the caches (below).

## Edge cases

**Staleness.** The snapshot is a photograph with a date. The UI shows "baixado há
X" and a manual refresh. Change detection is deliberately absent: the chosen
trigger is explicit download, and inferring updates would be a different product
decision.

**Sign-out clears everything.** The offline cache answers before the network and
therefore bypasses the `proxy.ts` gate. Signing out must delete every snapshot and
PDF, or the device keeps another person's band repertoire readable.

**Quota.** The UI shows total usage and allows removing one playlist at a time. If
the quota is exceeded mid-download, the download fails as a whole and rolls back
what it wrote. A half-written snapshot is worse than none: it tells the musician
the playlist is available when it is not.

**Schema version.** A snapshot whose `schemaVersion` does not match the running
app counts as absent and prompts a fresh download, rather than being parsed into a
shape the code no longer expects.

**Service worker updates.** A precached shell goes stale and will serve an old
build indefinitely unless versioning and activation are handled. This is the
classic PWA failure and must be designed, not discovered.

## Testing

- `offlineSnapshot.ts` and `offlineFirst.ts`: pure unit tests, no mocks.
- `offlineStore.ts`: unit tests against a storage fake.
- **The acceptance test is Playwright**, which supports `context.setOffline(true)`:
  download a playlist, cut the network, **reload the page**, and assert the setlist
  renders, the PDF renders, and the edit controls are disabled. Without the reload
  the test does not exercise cold start, which is the whole requirement.

Repository gates apply unchanged: the coverage gate on new `src/lib` modules, and
**no new entry** in the `complexity-budget/override` list in `eslint.config.mjs` —
that list is a ratchet that may only shrink.

## Relationship to RH-29

Native packaging would help with exactly two of the five decisions above — cold
start (the shell ships as local files) and PDF storage (a real filesystem instead
of Cache Storage). It would not reduce the rest: the snapshot, the download
controller, eviction and the read-only treatment are the same work either way.

Against that, the app reaches Postgres through Server Components and Server
Actions — the direction F15, RH-61, RH-62, RH-63, RH-71 and RH-77 have been
pushing it. Capacitor with `output: 'export'` is incompatible with that, and React
Native cannot call a Server Action at all. Either would require a full HTTP API in
front of the database, which is a new authorization surface of its own.

PWA/TWA offers nothing here: a TWA is a Chrome wrapper around the PWA, so the
offline work *is* the service worker work described above.

This design therefore does not block on RH-29, and RH-29 remains worth doing on
its own merits.
