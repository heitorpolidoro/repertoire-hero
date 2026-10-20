# RH-119 — Mark who was present at a rehearsal

## Scope

In the whole-playlist "Review practice" list (RH-159) opened from a **band** playlist, a band admin can mark which band members were present. Confirming then advances `last_practiced` for every ticked song on **each present member's own** `user_songs` row, as well as on the admin's own row and the band's row (both already written by RH-158).

This is the one deliberate exception to "nothing propagates to other members" (`docs/use-cases.md`, *Practice buttons* — Decided). It is bounded so the invariant stays otherwise true:

- Only `last_practiced` is written to another member's row. Never `status`, key, tags or anything else.
- Only a band **admin** can name other members; a plain member's tap stays a personal-only write.
- Only current members of that band can be named; a non-member id is refused and nothing is written.
- `GREATEST(existing, now())` returns for these writes only: a present member's row keeps a later date they set themselves; it is never moved backwards. The presser's own row and the band row keep RH-158's plain `now()`.
- A present member with no `user_songs` row at that version gets one, born `unknown`, exactly as the presser's own does today.
- Presence is not stored. There is no attendance table, history or per-rehearsal record; the tap is the whole fact.

Not covered: personal playlists and Fast View's "Finish practice" (no band, so no presence control); the single-song practice button (stays one-owner); any notification to credited members; undoing a credit (the member edits their own date, as for any date).

## Approach

**Behavior**
1. In the band playlist's review list, an admin sees a "Who was there" checklist of the band's members, every member unticked except the admin themself (ticked, and not removable: the admin's own row is always written, as today). Plain members and personal playlists see no checklist and behave exactly as today.
2. Confirm sends the existing batch plus the list of present user ids. For each ticked song and each present member, the database sets `last_practiced = GREATEST(existing, now())` on that member's `user_songs` row, creating it `unknown` if absent. Date comes from the database clock, never the client.
3. The server action checks the caller is admin of the band (`assertBandAdmin`) whenever present ids are supplied, and that every id is a member of that band; either failure throws before any write. Still one transaction: any failing item rolls the whole batch back. An empty present list is exactly today's behavior.
4. No `GREATEST` or presence logic leaks into the existing `PRACTISE_*` statements; the new statement is separate so the single-owner path is untouched.

**Visual contract:** `docs/tasks/RH-119-mock.html` shows the checklist below the song list and above Confirm, with the admin's own row ticked and disabled ("always included"), other members unticked with their names, a "(N present)" count on Confirm, and the checklist absent for a plain member and for a personal playlist.

**Files touched**
- `src/lib/practiceWrite.ts` — new presence statement and an optional present-user-ids argument to `recordPractice` (keep it under the 400-line budget; split a sibling module `practicePresence.ts` if it would not fit, no new override).
- `src/app/actions/repertoire.ts` — `recordPracticeAction` accepts the optional present ids; admin and membership validation before the write.
- `src/hooks/usePracticeReview.ts` — presence selection state and payload.
- `src/components/ui/PracticeReviewList.tsx` — "Who was there" checklist, rendered only when the caller supplies members (band context, admin).
- `src/app/playlists/[id]/page.tsx` — supplies band members to the list for an admin of a band playlist.
- `docs/use-cases.md` — move "Marking who is present" from Open to Decided; amend the no-propagation and no-`GREATEST` lines to describe this exception.
- `AGENTS.md` — extend the RH-158/RH-159 practice-write paragraph with the presence exception.

**Test criteria**
- DB test: admin ticks two members; both members' `user_songs.last_practiced` advance for the ticked songs only; an unticked member's row is untouched.
- DB test: a member whose date is later than `now()` keeps it (GREATEST); a member with no row gets an `unknown` row; statuses of other members never change.
- Action test: a plain member sending present ids throws; an id outside the band throws; neither writes anything.
- Hook/component test: checklist shows only for an admin on a band playlist; payload carries the ticked ids; no ids → payload identical to today's.
- Existing `practiceIsolation.db.test.ts` stays green for every call without present ids.

## Behavior changes

none (no behavior registry)

## Expected Results
- [ ] A band admin confirming the review list with members A and B ticked advances `last_practiced` on A's and B's `user_songs` rows for each ticked song and on no unticked song.
- [ ] A present member's `last_practiced` that is later than the database `now()` is left unchanged, and a present member with no row at that version gets one with status `unknown`.
- [ ] No column other than `last_practiced` changes on any other member's row, and an unticked member's rows are untouched.
- [ ] `recordPracticeAction` throws, writing nothing, when present ids are sent by a non-admin or include a user who is not a member of the band.
- [ ] A batch with an invalid present id or failing item rolls back entirely (no row of any member changes).
- [ ] The "Who was there" checklist renders only for an admin on a band playlist; a personal playlist, Fast View's "Finish practice" and a plain member see today's list and send no present ids.
- [ ] `practiceIsolation.db.test.ts` and the existing RH-158/RH-159 tests pass unchanged, and `npm run lint`, `lint:dead` and `tsc` are clean.

## Out of Scope
Attendance history, notifications to credited members, presence for personal playlists or the single-song button, a member-initiated "I was there" claim, and any propagation of status.
