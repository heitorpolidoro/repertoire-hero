# RH-187 — spec generator report (round 6)

## What happened

The server's `spec_content` was `null` and neither `docs/tasks/RH-187-spec.md` nor
`docs/tasks/RH-187-mock.html` existed in the worktree, so earlier rounds' text was
lost. The spec was rewritten from scratch against the current code.

Before writing, the task branch `meridian/RH-187` was fast-forwarded from `1927fc3` to
`master` at `b3b1ef1`, which carries RH-185 (canonical tunings) and RH-186 (custom
fields), both `done`. The spec now cites real code from those tasks:
`src/lib/customFields.ts` (`setCustomFieldValue`, `getCustomFieldValues`,
`listCustomFields`), `src/lib/songTuning.ts` (`normalizeTuning`, pre-existing),
`src/lib/ownerSongs.ts` (`getResolvedEntryForVersion` l.334,
`updateSongOverrides` l.211).

Commit: `2be4c25 docs(RH-187): spec and mock for the token-authenticated agent API`.

## Previous findings, how each is resolved

1. **Behavior changes** — section added: Auth and profile changed (proxy/session line,
   `/api/v1` uses `withApiAuth`), Repertoire and overrides changed (tuning API), Files
   and annotations changed (`POST /api/v1/tabs` via `uploadTabForUser` in
   `src/lib/tabUpload.ts`), plus three `added:` lines (tokens + Settings section,
   401/403 guard, the served skill). Remote-URL ingest is not mentioned: deferred.
2. **Mock** — `docs/tasks/RH-187-mock.html` with a state switcher: token list, empty
   list, create form (name, three scopes, expiry), validation error, one-time reveal
   (token, Copy, "You will not see this token again.", both `export` lines, skill link,
   Done), revoke confirmation. All element access is via `document.getElementById` /
   `querySelector`; no bare-id globals.
3. **i18n vs F25** — copy is inline English; Decision 14 restates RH-186's Decision 7
   wording. No `en.json`/`pt-BR.json` anywhere in the spec or the results.
4. **One rule for a version** — Decision 8: a non-UUID or unknown `versionId` → 404
   `Song version not found` everywhere; `GET` and the custom-field PUT accept any
   existing version (RH-186 Decision 4 quoted verbatim); only the tuning PUT needs a
   held row (`ownerRowId === null` → 404 `This song is not in your repertoire`). 404
   vs 500 is told apart by a new `findSongVersion` read run before
   `getResolvedEntryForVersion`; `ownerRowId` is the `repertoireId` for
   `updateSongOverrides`.
5. **Results shape** — eight single-assertion lines; secondary assertions (reload view,
   hash storage, unheld-version 404, read-back, 403, lint gates) moved to Test
   criteria. The read search now has a result (reviewer suggestion).
6. **Revision did not land** — both files written in the worktree and committed.

## Operator answer applied

URL ingest deferred (operator, 2026-10-27): `POST /api/v1/tabs` is multipart-only;
listed under Out of Scope.

## Reviewer suggestions adopted

Lib seams named; Sentry scrub as a tested `beforeSend` (no `beforeSend` exists today in
`sentry.server.config.ts`/`sentry.edge.config.ts`); error shape has no `code`;
`actionSessionGuard.test.ts` covers the new actions; AGENTS.md and `src/proxy.ts`
comment updates listed; `revalidatePath` stays in the action; the lib enforces the
10 MB cap; `NEXT_PUBLIC_APP_URL` read like `auth-client.ts`; Settings section styled
like RH-186's.

## Not done here

`expected_results` were not PUT to the API by this agent; they are returned below for
the `work` skill to persist. No questions for the operator.

EXPECTED_RESULTS:
In Settings → "AI access", creating a token named `Claude Code` shows the full `rh_pat_…` token with the warning `You will not see this token again.` exactly once.
`GET /api/v1/songs` answers 401 for a token after it is revoked, though it answered 200 with that token before (`apiTokens.db.test.ts`).
Every `/api/v1` route answers 401 to a request carrying only a valid session cookie and no `Authorization` header (`apiAuth.test.ts`).
`GET /api/v1/songs?q=` returns the matching songs of the token user's own repertoire and none of another user's (`apiSongs.db.test.ts`).
`PUT /api/v1/songs/{versionId}/tuning` with `{"tuning":"Drop D"}` on a held version writes the token user's `user_songs.tuning` and leaves `song_versions.tuning` unchanged (`apiSongs.db.test.ts`).
`PUT /api/v1/songs/{versionId}/custom-fields/preset` with `{"value":"Lead 3B"}` stores the token user's Preset value for that version (`apiSongs.db.test.ts`).
`POST /api/v1/tabs` with a multipart PDF creates a `song_files` row owned by the token user (`tabUpload.test.ts`, Blob mocked).
`agentSkillParity.test.ts` passes, and fails when a `/api/v1` route is missing from `public/agent-skill/repertoire-hero/SKILL.md`.

MOCK_PATH: docs/tasks/RH-187-mock.html
