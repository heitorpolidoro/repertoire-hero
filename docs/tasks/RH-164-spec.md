# RH-164 — Play the linked Spotify track in Fast View

Part 3 of the RH-149 split; panel A of `docs/tasks/RH-149-mock.html`. Independent of the other parts.

## Scope
Fast View gets a Spotify player for the track behind the song's own Spotify link, placed directly under the song identity header. Playback uses the Spotify Web Playback SDK and therefore needs Spotify Premium, three new OAuth scopes (`streaming`, `user-read-playback-state`, `user-modify-playback-state`) and re-consent of every already-connected user. These costs must be accepted by the operator at spec approval before any build starts (see the open question).

Not covered: YouTube embed, uploaded audio, practice transport (other RH-149 parts); resolving `spotify.link` / `spoti.fi` short links (no player is shown for them); offline playback; autoplay; playback queues across songs.

## Approach
Behavior:
- The authorize route requests the existing four scopes plus the three new ones.
- The callback records the scope string Spotify returns with the token, so the app can tell whether a connected user holds the playback scopes. Existing rows have no recorded scope and count as "lacks the scopes".
- Fast View decides what to show from three inputs: the song's Spotify link (via `spotifyTrackUriFromUrl`, null means no player), the user's Spotify connection and granted scopes, and the account's Premium status. The decision is a pure function extracted into `src/lib` and unit-tested; the component only renders its result.
- States: no track uri (including short links) renders nothing; not connected or missing scopes shows a "Re-connect Spotify (new permissions)" prompt linking to the authorize route; non-Premium shows an explicit "Spotify Premium is required to play here" message with no playback controls; otherwise a player with a play button.
- Playback starts only on a user tap: the SDK is not asked to play on mount, on song change, or on token arrival. When offline the player shows "No connection: playback unavailable".
- The player gets a short-lived access token from a server route using the existing token helper in `spotifyAuth.ts`; the token is never rendered into the page HTML.

Files touched:
- `src/app/api/auth/spotify/authorize/route.ts` — add the three scopes.
- `src/app/api/auth/spotify/callback/route.ts` — persist the granted scope string.
- `migrations/<next>_spotify_tokens_scope.sql` — nullable `scope` column on `spotify_tokens`.
- `src/lib/spotifyPlayback.ts` (new) — pure decision function (hidden / reconnect / premium-required / ready) and scope check.
- `src/app/api/spotify/playback-token/route.ts` (new) — returns a token plus scope/Premium facts for the signed-in user.
- `src/components/fastview/SpotifyPlayer.tsx` (new) — renders the states and loads the SDK on tap.
- `src/components/fastview/` song page composition — mount the player under the identity header.
- `AGENTS.md` — note the new scopes and the re-consent cost.

Test criteria:
- Authorize route test asserts all seven scopes in the redirect URL.
- Unit tests for the decision function cover every state and short links.
- Component tests cover player shown, short link hidden, reconnect prompt, Premium message without controls, and no autoplay (the SDK play call is not made until the button is clicked).

## Expected Results
- [ ] The authorize redirect URL requests `streaming`, `user-read-playback-state` and `user-modify-playback-state` in addition to the existing four scopes, verified by a route test.
- [ ] Fast View renders a Spotify player for a song whose link yields a uri from `spotifyTrackUriFromUrl`, verified by a component test.
- [ ] A song whose Spotify link is a `spotify.link` or `spoti.fi` short link renders no player, verified by a component test.
- [ ] A connected user lacking the new scopes sees a re-authorise prompt linking to the authorize route and no player, verified by a component test.
- [ ] A non-Premium account sees an explicit Premium-required message and no playback controls, verified by a component test.
- [ ] No playback is requested until the user taps play, verified by a component test asserting the SDK play call is not made on mount.

## Out of Scope
Short-link resolution, other audio sources, background or cross-song playback, Premium upsell flows.
