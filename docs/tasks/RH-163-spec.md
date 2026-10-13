# RH-163 — Embed the linked YouTube video in Fast View

## Scope

Part 2 of the RH-149 split (panel B of `docs/tasks/RH-149-mock.html`). Fast View shows the video behind the song's own YouTube link in a third-party iframe, directly under the song header. No account, no OAuth scope, no new table or column.

**Gate: the operator has not chosen this reading.** Nothing is built until the operator confirms it through the question on the card.

Decisions
1. **Source**: the first `song_links` row of the song with `provider = 'youtube'` (the derived column, never a substring of the url). The video id is extracted from `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/` and `/live/` urls; a youtube-provider url yielding no id (channel, playlist-only, malformed) renders no embed and leaves the link row untouched.
2. **Embed origin**: `https://www.youtube-nocookie.com/embed/<id>` (privacy-enhanced mode). The url carries no `autoplay` parameter; playback begins only on the user's tap on YouTube's own play button. No `enablejsapi`, no scripted control.
3. **Iframe**: `title` set, `loading="lazy"`, `referrerpolicy="strict-origin-when-cross-origin"`, `allow="encrypted-media; picture-in-picture"` (no `autoplay` permission), `allowfullscreen`.
4. **CSP**: the app has no Content-Security-Policy today. Add one response header via `next.config.ts` `headers()` on all routes containing only `frame-src https://www.youtube-nocookie.com https://docs.google.com`. The second origin is required by the existing PDF/doc tab preview (`GviewFrame` in `src/components/fastview/TabViewer.tsx`, which frames `https://docs.google.com/gview?...`); without it that preview goes blank. `TabViewer.tsx` is the only other iframe in `src`, so these two origins are the full list. Other directives stay unset on purpose (adding them risks breaking Sentry, Blob and the service worker; a full CSP is a separate task). No wildcard, no `https:`, no plain `youtube.com`, no other origin. No existing feature is removed or changed.
5. **Offline**: Fast View is read-only offline and cannot play. Offline the section renders the text "Video is not available offline" and no `<iframe>`; it never shows a play affordance. Video is never in the snapshot.
6. **Accepted limits**: ads and end-cards are YouTube's; some uploads forbid embedding and YouTube then shows its own error inside the frame.

Not in scope: Spotify, audio upload (RH-162), multiple videos, thumbnails/facade, YouTube Data API, a full CSP, changes to link rows or `LinksSection`.

## Approach

Behavior
- A lib function turns a url into a video id or `null`. A selector picks the first youtube-provider link from the links Fast View already loads, so no query changes.
- A presentational `YoutubeEmbed` renders a titled 16:9 iframe online, the offline note offline, and nothing when there is no usable link. Offline state comes from the same read-only signal `LinksSection` already receives (RH-99).
- It is injected at the Fast View composition point under the song identity header; `page.tsx` gains no logic.

Files touched
- `src/lib/youtubeEmbed.ts` (new): url to video id, embed url builder.
- `src/components/fastview/YoutubeEmbed.tsx` (new): presentational section.
- Fast View composition (shell that renders `LinksSection`): mounts the section.
- `next.config.ts`: `headers()` returning the CSP.
- Tests (new): `src/components/fastview/__tests__/YoutubeEmbed.test.tsx`, `src/lib/__tests__/youtubeEmbed.test.ts`, `src/lib/__tests__/nextConfigCsp.test.ts`.
- `docs/use-cases.md`, `AGENTS.md`: note the embed and the CSP header; `package.json` version bump.

Test criteria
- Lib: each accepted url shape yields the id; `notyoutube.com/watch?v=x`, channel and playlist urls yield `null`.
- Component: a youtube link renders one iframe whose src starts with the nocookie embed origin and has no `autoplay`; no youtube link (including a spotify-only song) renders no iframe and no heading; offline renders the note and no iframe.
- Config: the header value equals `frame-src https://www.youtube-nocookie.com https://docs.google.com` exactly, and the origin of the URL `GviewFrame` builds is among the allowed origins.
- `TabViewer` code and its existing tests stay unchanged.

## Expected Results
- [ ] Fast View renders one iframe for a song with a `provider = 'youtube'` link, asserted by a component test.
- [ ] A song with no YouTube link (or an unparseable one) renders no iframe, asserted by a component test.
- [ ] The iframe src is on `youtube-nocookie.com/embed/` and contains no `autoplay` parameter, asserted by a test.
- [ ] The configured Content-Security-Policy header is exactly `frame-src https://www.youtube-nocookie.com https://docs.google.com`, with no wildcard or other origin, asserted by a test on `next.config.ts`.
- [ ] The origin of the `GviewFrame` iframe URL in `TabViewer` is allowed by that header, asserted by a test, so the PDF/doc preview keeps loading.
- [ ] Offline, Fast View renders "Video is not available offline" and no iframe, asserted by a component test.

## Out of Scope
Spotify embed, uploaded audio, a full site-wide CSP, offline video, multiple embeds.
