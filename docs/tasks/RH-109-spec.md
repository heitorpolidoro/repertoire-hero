# RH-109 — Address the Fast View by version and navigate a queue (integration and verification)

> **Renamed 2026-10-13** to match its task id. Older text below may describe a "board id + 1" filename rule: that was a mistake copied between specs, not a convention. A spec is always `docs/tasks/<task id>-spec.md`.


> Filename note: repo convention is spec file = board id + 1, so RH-109's spec is
> `RH-109-spec.md`. `docs/tasks/RH-108-spec.md` is RH-108's committed spec and is NOT touched;
> the old `RH-108-mock.html` likewise belongs to RH-108.

## Scope

RH-109 was split into RH-132 (route by version, offline snapshot re-key), RH-133 (`sessionStorage`
queue replaces `returnTo`) and RH-134 (window fetch, `invalidateSongWindow`); all three are done.
This task is the closing step: prove the three parts work **together**, and clean up what the parts
individually left behind. It builds no feature and redoes no part.

Read against the tree on 2026-10-12, the parts are in place: `src/app/songs/[versionId]/fast-view/page.tsx`,
`src/lib/songQueue.ts` (written once, from `PlaylistSongList.tsx`), `src/lib/songWindow.ts`,
`songWindowData.ts` and `useSongWindow`/`usePlaylistNav`; no `returnTo` remains in `src` or `e2e`; both
link builders (`RepertoireDashboard.tsx`, `PlaylistSongRow.tsx`) emit `/songs/<versionId>/fast-view`;
`AGENTS.md` and `docs/use-cases.md` already describe the queue and the window. What is missing:

1. **No end-to-end spec walks the whole path.** `e2e/` has playlist, offline and mobile Fast View specs,
   none of which opens a playlist song, swipes along the queue, edits, and returns.
2. **Stale `[id]` references** to the old route in comments: `src/lib/__tests__/rootLayoutRendering.test.ts`
   (~line 15) and `src/lib/__tests__/devBundler.test.ts` (~line 7).
3. **`docs/use-cases.md` *Walk a queue of songs*** has not been checked line by line against behaviour
   after all three parts landed (see Approach 3).

**Not in scope:** the computed practice-session queue and hand-picked selection (RH-115), any change to
queue/window code unless a verification step finds a real defect (then the fix is the minimum and is
named in the report), cache invalidation for someone else's edits, server-side queue storage, the
landing page (the queue is plumbing for a feature owned by RH-115, not a selling point yet).

## Approach

### Behavior to verify (cross-part)

1. **Walk**: from a playlist, open song 2 of 3; the URL is `/songs/<versionId>/fast-view` with only `?bandId=`
   (band playlists) and no `returnTo`; the setlist chrome shows position 2 of 3; arrow keys and swipe move to
   1 and 3; there is no prev at the start and no next at the end (no wraparound); back lands on the playlist.
2. **Reload and tab scope**: reloading mid-queue keeps the chrome; a new tab opened on the same Fast View URL
   shows no setlist chrome (a song opened alone has none).
3. **Write then revisit**: edit the lyrics of song 2, move to 3 and back to 2; the edited text is shown, never
   the pre-edit text (RH-134 invalidation rule, as written in `use-cases.md`).
4. **Song absent from the repertoire mid-queue**: an entry with no repertoire row stays in the queue and opens
   at version defaults; the chrome does not vanish.
5. **Offline**: with the playlist downloaded and the network cut, the queue chrome and a downloaded song's
   content render, and walking still works from the snapshot; a non-downloaded neighbour does not break the
   current song (window is best-effort).
6. **Owner precedence**: `?bandId=` in the URL wins over the queue's recorded owner.

### Files touched

- `e2e/fast-view-queue.spec.ts` (new): covers behaviours 1-4 and 6 against the real server; behaviour 5 lives
  in `e2e/offline-mode.spec.ts` as one added case if it is not already covered there (check first; do not
  duplicate).
- `src/lib/__tests__/rootLayoutRendering.test.ts`, `src/lib/__tests__/devBundler.test.ts`: comments say
  `[versionId]`, no behavioural change.
- `docs/use-cases.md`: only if the audit finds a line contradicting shipped behaviour; fix the text, and
  mark Walk-a-queue items still owned by RH-115 as pending rather than implied done.
- `AGENTS.md`: only if the audit finds a stale statement.

### 3. Doc conformance audit

Compare each *Walk a queue of songs* statement (table of sources, "holds only version id, title, artist,
order", one window request, write invalidates, Decided bullets including arrow keys off while a stage surface
is up, origin-based back) with the code. Each statement is either confirmed in the report with the file that
implements it, marked as owned by RH-115, or fixed in the doc.

### Test criteria

The new e2e spec and the existing suites pass: `npm run lint`, `npx tsc --noEmit`, `npm test`, and
`npx playwright test e2e/fast-view-queue.spec.ts e2e/offline-mode.spec.ts e2e/fast-view-mobile.spec.ts`.
Version bump in `package.json` per AGENTS.md when committing to master.

## Expected Results

- [ ] `grep -rn returnTo src e2e` finds nothing, and no source or test comment still refers to `/songs/[id]`.
- [ ] `e2e/fast-view-queue.spec.ts` passes: opening song 2 of 3 from a playlist shows position 2 of 3 at `/songs/<versionId>/fast-view` with no `returnTo`, swipe/arrow keys reach songs 1 and 3, and prev/next are absent at the ends.
- [ ] That spec passes a reload mid-queue (chrome kept) and a fresh tab on the same URL (no setlist chrome), and back returns to the playlist.
- [ ] That spec edits song 2's lyrics, walks to song 3 and back, and asserts the edited text, not the old one.
- [ ] That spec opens a queue entry that has no repertoire row and asserts it renders at defaults while the setlist chrome stays.
- [ ] An offline e2e case, in `offline-mode.spec.ts` or the new spec, walks a downloaded playlist with the network cut and shows queue chrome and content.
- [ ] Every statement in `docs/use-cases.md` *Walk a queue of songs* is confirmed against code, fixed, or marked as owned by RH-115, as listed in the task report.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` and the three named Playwright specs exit 0.

## Out of Scope

Practice-session and hand-picked queues (RH-115), changes to who may write, progress in a queue,
cross-user cache invalidation.
