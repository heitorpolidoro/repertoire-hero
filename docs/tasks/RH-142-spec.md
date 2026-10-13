# RH-142 — Resolve spotify.link short links before the Spotify push

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


> Filename note: the repo convention is spec file = board id + 1, so RH-142's
> spec is `RH-142-spec.md`. `docs/tasks/RH-141-spec.md` and `RH-141-mock.html`
> belong to board task RH-141 and are untouched. (The "RH-143" mentioned in
> AGENTS.md's Song Links entry is a different, future board task.)

## Scope

**Problem.** The Spotify mobile share sheet produces `https://spotify.link/<code>`
and `https://spoti.fi/<code>`. Neither carries a track id in the path, and neither
host is `spotify.com`, so two things already skip such a song silently: the
derived `song_links.provider` is `'other'` (so `spotifyLinkUrlsJson` never returns
the url to the push), and `spotifyTrackUriFromUrl` would answer `null` anyway.

**Decision (recommended; see QUESTIONS in the report): resolve once, at write
time, and store the canonical url.** `applySongLinkUpdate` (`src/lib/songs.ts`)
already performs outbound fetches before its transaction (`fetchUrlTitle`, 4s
timeout, deliberately outside the transaction). A short link is resolved in that
same pre-transaction step into `https://open.spotify.com/track/<id>`, and the
canonical url is what gets upserted. Consequences: the derived `provider`
becomes `'spotify'` with no migration, the push loop stays free of network
calls (no latency or failure mode inside a playlist push), and the push code
(`spotifyPushUris`, `spotifyTrackUriFromUrl`, the sync route, `songLinksSql.ts`)
does not change. The cost is paid once, by the musician saving the link, who is
already waiting on a title fetch.

**In scope.**
1. A pure-plus-fetch resolver module in `src/lib/` that maps a short-link url to
   its canonical track url or reports it unresolvable.
2. `applySongLinkUpdate` applies it to each submitted link before the
   transaction, alongside the existing label fetch.
3. Replacing the "known follow-up gap" negative test and the stale comment at
   `spotifyTrackUri.ts:49-58`.

**Not in scope.** Pushing-time resolution or caching (no new column, no
migration); backfilling short links already stored (they stay skipped, as today);
the `spotify:track:<id>` URI scheme; resolving album/playlist short links to
tracks; any UI, copy or toast telling the musician a link cannot be pushed
(option 3 of the task, rejected as the primary path - a link that fails to
resolve is simply stored as typed); resolving in `applyCatalogFill`, the
Spotify pull or the moderation-approval path (they receive urls that are
canonical already or were resolved by `applySongLinkUpdate` before submission).

## Approach

**Behavior.**
- Only `https:` urls whose host is exactly `spotify.link` or `spoti.fi`
  (case-insensitive) are ever fetched. Every other url is returned untouched
  and triggers no request. This allow-list is the SSRF boundary: a musician
  chooses the url, so no other host may be contacted by this feature.
- Resolution follows redirects **manually**, with a small hop cap (about 5) and
  a per-request timeout of about 4s, matching `linkFetcher.ts`. Each hop's
  `Location` must itself be https on the allow-list (`spotify.link`, `spoti.fi`,
  `open.spotify.com`, or another `*.spotify.com` host); a hop leaving it ends
  resolution as a failure. The implementer must confirm against the real
  `spotify.link` chain whether it ends in a plain 3xx to `open.spotify.com` or
  in an intermediate page; if a body must be read for the target, say so in the
  PR and keep the same host allow-list on the extracted url.
- The final url is accepted only if `spotifyTrackUriFromUrl` returns non-null
  for it (reuse, do not re-implement the track-id rule). The stored url is then
  the canonical `https://open.spotify.com/track/<id>` with the `?si=` share
  query dropped. A short link that resolves to an album/playlist/artist is a
  failure, not a canonical url.
- **Failure is never an error.** Timeout, network error, non-redirect response,
  off-list hop, non-track target: the link is stored exactly as the musician
  typed it, the save succeeds, and the failure is logged through `logger`
  (S1/L1 conventions; never `console.error`). The song is then skipped by the
  push exactly as it is today.
- Resolution runs for the submitted links concurrently, like the label fetch,
  and strictly before `withTransaction`. A resolved link keeps its label; when
  the label was blank, the title fetch runs on the canonical url (better
  oEmbed hit than on the short link).
- The additive-vs-correction test inside the transaction compares submitted
  urls against stored ones. Resolution rewrites a submitted url, so an existing
  stored short link re-submitted unchanged would be seen as removed and routed
  to the moderation queue. The implementer must keep an already-stored url
  that the musician did not change from being treated as a removal (e.g. skip
  resolution for urls already stored on the song, or compare before
  resolving). A test pins this.

**Files touched.**
- `src/lib/spotifyShortLink.ts` (new): the allow-list predicate and the
  resolver; no `@/lib/db` import, so it stays client-safe and unit-testable.
- `src/lib/songs.ts`: `applySongLinkUpdate` resolves links in its
  pre-transaction step. This file is under a line budget (see AGENTS.md
  Database Row Types); keep the added lines minimal and put logic in the new
  module.
- `src/lib/spotifyTrackUri.ts`: update the doc comment at :49-58 to say short
  links are resolved at write time and the function itself still answers
  `null` for them (it stays pure: no `fetch`).
- `src/lib/__tests__/spotifyTrackUri.test.ts`: retitle the "known follow-up
  gap" test so it states the function stays pure and the resolution lives at
  write time.
- `src/lib/__tests__/spotifyShortLink.test.ts` (new): resolver unit tests with
  a stubbed `fetch`.
- `src/lib/__tests__/` song-links write test (extend the existing
  `applySongLinkUpdate` test file, or a `.db.test.ts` if that is where the
  writer is covered): a stored row carries the canonical url and
  `provider = 'spotify'`.

**Test criteria.**
- Resolver: `spotify.link` and `spoti.fi` 3xx chain to
  `open.spotify.com/track/<id>?si=x` yields `https://open.spotify.com/track/<id>`.
- Resolver: no request is made for `open.spotify.com`, `youtube.com`,
  `http://spotify.link/x`, `notspotify.link`, `spotify.link.evil.io`,
  `spotify.link@evil.io`; the url is returned unchanged.
- Resolver: timeout, rejected fetch, 200 with no redirect, a hop to an
  off-list host, a hop beyond the cap, and an album target each return the
  original url and do not throw.
- Writer: a short link submitted through `applySongLinkUpdate` is stored as the
  canonical url; a failing resolution stores it as typed and the call succeeds
  with no `pending`; no fetch happens inside the transaction callback.
- Writer: re-submitting an unchanged stored short link does not go to the
  moderation queue.
- Push: end to end through `spotifyPushUris`, a song saved from a short link
  contributes its `spotify:track:<id>` uri.
- Gates: `npm run lint` (check `$?` out of band), `npx tsc --noEmit`,
  `npm run lint:dead`, `npm run lint:dup`, and the coverage thresholds pass.

## Expected Results
- [ ] A `spotify.link` or `spoti.fi` url saved through `applySongLinkUpdate` is stored in `song_links` as `https://open.spotify.com/track/<id>` (no share query) with `provider = 'spotify'`.
- [ ] Resolution runs before `withTransaction` opens: no fetch happens inside the transaction callback.
- [ ] `spotifyPushUris`, the sync route and `songLinksSql.ts` are unchanged and contain no network call.
- [ ] The resolver contacts only `https` urls on `spotify.link` or `spoti.fi`, rejects any redirect hop leaving the Spotify allow-list, and makes no request for look-alike hosts such as `spotify.link.evil.io`.
- [ ] When resolution times out, errors, hits the hop cap or lands on a non-track target, the link is stored exactly as typed, the save succeeds, and the failure is logged through `logger`.
- [ ] Re-submitting an unchanged stored short link does not return `pending` or create a moderation suggestion.
- [ ] A song saved from a short link contributes its `spotify:track:<id>` uri through `spotifyPushUris`.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run lint:dead`, `npm run lint:dup` and the vitest coverage gate all pass.

## Out of Scope
Backfill of existing short links, UI messaging for unresolvable links, push-time
resolution or caching, `spotify:` URI scheme input, album/playlist short links.
