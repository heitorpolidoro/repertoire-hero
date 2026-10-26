# RH-184 — spec review (round 2, findings-only re-review)

VERDICT: APPROVED

## Blocking Findings
None.

## Suggestions
- **Open a follow-up task for band-playlist permissions.** The spec says the conflict will be fixed in a follow-up but does not name one. Today `createBandPlaylist`, `updatePlaylist` and `deletePlaylist` let any band member through, while `docs/use-cases.md` l.1041 and the registry line "Creating, renaming, reordering and deleting a band playlist requires a band admin." say admins only. After this task that conflict reaches two create entry points instead of one. Putting the follow-up on the board, with the round-1 question as its starting point, keeps the conflict from being forgotten.
- **The spec points at "the report" for the operator's question.** It should say which file: `docs/tasks/RH-184-spec-report.md`.

## What I checked and the evidence

### Mode
Round 2. The dispatch included one blocking finding from round 1, so I checked only that finding and the sections changed to fix it (commit `1c59ef5`: `RH-184-spec.md` and `RH-184-spec-report.md`; the mock did not change).

### Round-1 finding: the permission change contradicted `docs/use-cases.md`
**Resolved, using option (b).**
- **Second registry line dropped.** Behavior changes now lists one `changed:` line, the ownership line. It also says outright that "Creating, renaming, reordering and deleting a band playlist requires a band admin." stays unchanged and records the `docs/use-cases.md` decision.
- **Member-create assertion dropped from ER5.** The old ER5 (plain member's `createBandPlaylistAction` in `authzBands.db.test.ts`) is gone. `authzBands.db.test.ts` is no longer in Files touched. Approach adds: "It also makes no test or result depend on member-level create, so a later admin-only change breaks nothing here."
- **What a plain member gets in band context is now stated.** Approach → "A plain member in band mode": `+ New Playlist` creates the band playlist, because `createBandPlaylist` accepts any member. That is the same result the band page gives that member today, so the task adds no new capability.
- **Tightening left to a follow-up.** Scope "Not covered" first bullet and Out of Scope first bullet both say so. Files touched lists `docs/use-cases.md`, `src/lib/bands.ts`, `src/app/actions/bands.ts` and the permission line as not touched.
- **Facts checked against the worktree:**
  - `node scripts/behavior.js area Playlists` prints both lines exactly as the spec quotes them;
  - `docs/use-cases.md:1041` holds the "band-admin only to create, reorder, rename and delete" Decided bullet the spec cites.

After this change `docs/behavior.md` and `docs/use-cases.md` agree with each other. Their existing disagreement with the code is named, limited to the same function, and handed to a follow-up. Round 1 offered this outcome as option (b).

### Consistency pass on the changed sections
- **Expected results:** 7 results, each one sentence.
  - ER5 now covers the jsdom files only. ER6 is the e2e alone, which also takes up round 1's ER6-bundling suggestion.
  - ER7 now asserts the permission line is still printed unchanged, which `behavior.js` can check mechanically.
- **Operator results:** all three still covered.
  - "appears under the section for that band" → ER1;
  - "still personal" → ER2;
  - "Tests cover both contexts and pass" → ER5 and ER6.
- **E2E step 1:** `createBand` makes the test user an admin, so no e2e step depends on member-level create. This is consistent with the Approach claim.
- **Mock (unchanged):** its note says the permission question "is asked on the card in words, not here", which still holds. It shows no element that implies member-level rights.
- **Round-1 suggestions also taken:**
  - the `new-playlist-owner` id is named;
  - the note that production builds may replace the exact refusal copy is added;
  - the RH-181 rebase and its helpers (`createBand`, `deleteBand`, `band-indicator-exit`) are named.
- **No new contradiction found.**

QUESTIONS:
Should any band member be able to create, rename and delete a band's playlists (what the code allows today, on the band page and, after RH-184, on /playlists), or only band admins (what docs/use-cases.md decided on 2026-10-01)? This belongs to a follow-up task, not to RH-184.
