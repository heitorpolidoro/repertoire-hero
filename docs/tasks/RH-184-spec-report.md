# RH-184 — spec generator report (round 2)

Verdict: SPEC_READY. Spec: `docs/tasks/RH-184-spec.md`. Mock: `docs/tasks/RH-184-mock.html`, unchanged.

## The blocking finding, and why path (b)

The round-1 review found that the spec rewrote the registry's permission line to "any member" and made member-level create a contract (ER5). That contradicts the **Decided** bullet in `docs/use-cases.md` § *Create, reorder and delete a playlist*: "Band playlists are band-admin only to create, reorder, rename and delete". The review asked for a fix based on the operator's answer.

**There is no operator answer.** The task, read through the API, has no `questions` array. Round 1 raised the question in its report and the reviewer raised it in the review, but neither reached the card. So I did not pick a side for the operator. I chose the path that changes no recorded decision, which is the reviewer's option (b):

- The second registry line is dropped from Behavior changes. "Creating, renaming, reordering and deleting a band playlist requires a band admin." stays as it is.
- ER5 (a plain member creates a band playlist in `authzBands.db.test.ts`) is dropped. So is the `authzBands.db.test.ts` change: it existed only for ER5, and the task changes no server code.
- `docs/use-cases.md` is explicitly not touched.
- The spec now says what `+ New Playlist` does in band mode for a plain member. It creates the band playlist, because `createBandPlaylist` checks membership only. That is the outcome the band page's "+ New playlist" already gives every member (`src/app/bands/[id]/page.tsx:316`, not wrapped in `isAdmin`).
- The tightening, or the documentation rewrite, is left to a follow-up. Its direction is the question below.

Why (b) is right even before the answer:

1. **The documents agree with each other.** The `docs/use-cases.md` bullet (`f25d5dc`, 2026-10-01) and the registry line say the same thing. Only the code differs.
2. **The gap is known and deferred.** RH-103's spec (Scope, "Not in scope") says that `assertPlaylistAccess` checks membership only and that the use case wants admin-only. It leaves closing that to "a separate task". RH-184 is not that task.
3. **Nothing new can be done.** RH-184 routes the new entry point through the same `createBandPlaylist` the band page uses. A plain member can do nothing they could not do before.
4. **Either answer stays cheap.** No result or test now depends on member-level create. A later admin-only change to `createBandPlaylist` breaks nothing in RH-184, and it covers both entry points at once.

## Review suggestions also addressed

- **ER6 bundled jsdom and e2e.** It is now ER5 (the two vitest files) and ER6 (the Playwright file), so a QA failure points at one file.
- **The branch is behind master by RH-181 (`c28a7e5`).** The spec says to rebase before implementing. The e2e steps now name the RH-181 helpers: `createBand`, `deleteBand` and the `band-indicator-exit` test id. They also name the existing helpers `uniqueFixtureName`, `openPlaylist` and `deletePlaylistFromDetail`, all exported from master's `e2e/helpers.ts`. Master's `band-indicator-mobile.spec.ts` still enters band context through `localStorage['band-context']`, so step 2 holds.
- **Production message masking.** The Stale context bullet now says that the exact "Access denied" copy is a dev/test guarantee, as with the page's existing delete and rename banner.
- **`aria-describedby` id.** It is named `new-playlist-owner` and is rendered only in band context. ER3 now checks it as the dialog's description.

## Other checks this round

- `node scripts/behavior.js area Playlists`: the two lines quoted in the spec are present verbatim. On master, RH-181 adds one registry line, in a different area (mobile context switch), so it does not conflict with the Playlists edit.
- `createBandPlaylist` (`src/lib/bands.ts:257-263`) still has `assertBandMember` and the RH-34 comment "Any member may add a setlist — the UI's new-playlist form is not admin-gated." The spec leaves that file untouched.
- Mock: its notes are neutral on the permission question ("asked on the card in words, not here"). The spec no longer makes a permission claim, so the mock needs no edit.

## Expected results returned (7)

1. Band context: the new playlist is in the band section, not in My playlists, and stays there after a reload.
2. Personal context: the new playlist is in My playlists and in no band section.
3. The owner cue is the dialog's description on both tabs in band context, and it is absent in personal context.
4. When creation is refused, the dialog stays open, shows the message and does not refresh.
5. The two vitest files cover both contexts and pass.
6. The Playwright file passes in `chromium`.
7. The registry shows the new ownership line, and the permission line is unchanged.

None are `[operator]`. They map to the three operator results in `## Operator Results Coverage`.

## Question for the operator (technical, in words)

Band playlists: may any member create, rename and delete them, or only admins? Any member is what the code allows today, and the band page offers it to every member. Admins only is what `docs/use-cases.md` decided on 2026-10-01. RH-184 is built and tested the same way under either answer. The answer only chooses the follow-up task:
- **admins**: `createBandPlaylist` and the rename and delete paths become admin-only, and plain members no longer see those buttons;
- **any member**: the `docs/use-cases.md` bullet and the registry line are rewritten to match the code.

## Why not NEEDS_SPLIT

This is one deliverable in one subsystem: the `/playlists` create dialog, one injected action, the tests and one registry line.
