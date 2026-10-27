# RH-187 — Let an AI agent act on my account through a token-authenticated API and an agent skill

Mock: [`docs/tasks/RH-187-mock.html`](RH-187-mock.html) (Settings → "AI access").

## Scope

A signed-in user can create a **personal access token** in Settings, hand it to
an AI agent (Claude Code, Codex, …), and the agent can then act on that user's
own account through a small REST API under `/api/v1`, guided by an **agent
skill** (`SKILL.md`) served by the app. The operator's three use cases are the
whole write surface: set a song's tuning, set a custom-field value (the
pedalboard "Preset" from RH-186), and upload a tab file.

In scope:

1. Personal access tokens: create, list, revoke, expire; stored hashed.
2. Settings "AI access" section (mocked).
3. A bearer-token guard for `/api/v1` route handlers, with scopes.
4. Six endpoints: search the user's repertoire, read one version, list custom
   fields, set tuning, set a custom-field value, upload a local file as a tab.
5. The agent skill at `/agent-skill/repertoire-hero/SKILL.md` and a parity test
   tying it to the routes.
6. Moving the upload logic out of `uploadTabAction` into a lib seam shared by
   the action and the API.

Not in scope (see Out of Scope): uploading from a web link (deferred by the
operator, 2026-10-27), OAuth, an MCP server, band repertoires, rate limiting,
deleting anything through the API.

The API always acts in **personal context**: it reads and writes the token
user's own rows (`{ userId }` owner), never a band's.

## Approach

### Decisions

1. **Token format and storage.** A token is `rh_pat_` followed by 32 random
   bytes in base64url. Only its SHA-256 hex digest is stored (`token_hash`,
   unique), plus the first 12 characters as a display prefix (`rh_pat_AbC1…`).
   The plaintext is returned once, by the create action, and never again.
2. **Table.** New migration `migrations/0031_api_tokens.sql` (next free number
   at implementation time; `0030` is taken twice already): `api_tokens` with
   `id uuid`, `user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`,
   `name text NOT NULL`, `token_prefix text NOT NULL`, `token_hash text NOT NULL
   UNIQUE`, `scopes text[] NOT NULL`, `created_at`, `last_used_at` (nullable),
   `expires_at` (nullable = never), `revoked_at` (nullable).
3. **Scopes.** Exactly three: `read` (the GET endpoints), `write:songs` (tuning
   and custom-field PUTs), `write:tabs` (the upload). A write scope does not
   imply `read`. A token missing the endpoint's scope gets **403**
   `{"error":"This token lacks the <scope> scope"}`.
4. **Creation rules.** Name trimmed, 1–50 characters; at least one scope;
   expiry one of 30 days, 90 days (default), 1 year, never. A user holds at most
   10 active (unrevoked, unexpired) tokens. The refusals are, verbatim:
   `Give the token a name.`, `Token names are at most 50 characters.`,
   `Pick at least one scope.`, `You can have at most 10 active tokens. Revoke one first.`
5. **Revoke** sets `revoked_at`; the list shows only active tokens. Expired and
   revoked tokens are refused by the guard the same way as unknown ones.
6. **The guard.** `withApiAuth(scope, handler)` in `src/lib/apiAuth.ts` reads
   only the `Authorization: Bearer rh_pat_…` header. A missing header, a
   non-Bearer scheme, a malformed token, an unknown/revoked/expired token, and a
   request carrying only a valid session cookie all answer **401**
   `{"error":"Missing or invalid API token"}` with `WWW-Authenticate: Bearer`,
   and the handler is not called. On success it updates `last_used_at` (at most
   once a minute per token is fine; a plain update per request is acceptable)
   and calls the handler with the token's `userId`. Cookies are never read.
   `src/proxy.ts` needs no change: its matcher does not cover `/api` or
   `/agent-skill`.
7. **Error shape.** Every `/api/v1` error is JSON `{"error": "<message>"}`; there
   is no `code` field. Unexpected failures answer **500**
   `{"error":"Internal error"}` and are logged through `logger.error`; the
   token, the header and request bodies are never logged.
8. **One rule for a version (resolves the previous round's two rules).**
   - `versionId` is a catalog `song_versions.id`. A `versionId` that is not a
     UUID, or names no row, answers **404** `{"error":"Song version not found"}`
     on every per-version endpoint.
   - `GET /songs/{versionId}` and the custom-field PUT accept **any existing
     version**, held or not. This matches RH-186 Decision 4, quoted: "A value
     can be set on a version nobody holds, and setting one never creates a
     repertoire row in either table." For an unheld version `GET` answers
     `inRepertoire: false` and `status: null`.
   - Only the tuning PUT needs a held row, because tuning is an owner override
     (registry: "Tuning is edited from Fast View and writes the addressed
     owner's override, never the version's tuning."). On an existing version
     the user does not hold it answers **404**
     `{"error":"This song is not in your repertoire"}` and writes nothing.
   - How 404 is told from 500: a new lib read `findSongVersion(versionId)` in
     `src/lib/apiSongs.ts` returns `{ versionId, songId } | null` (null for no
     row; the route checks UUID shape first so no query runs for garbage).
     Only after it returns a row does the handler call
     `getResolvedEntryForVersion({ userId }, versionId)`; any throw from that is
     a 500. The tuning PUT takes `ownerRowId` from that resolved entry as the
     `repertoireId` for `updateSongOverrides({ userId }, ownerRowId, { tuning })`;
     `ownerRowId === null` is the 404 above.
9. **Tuning value.** `{"tuning": string | null}`. It goes through the existing
   `normalizeTuning` in `src/lib/songTuning.ts` (pre-existing, unchanged): blank
   or `null` clears the override. Any non-canonical text is stored as-is, as the
   Fast View free-text path does; longer than 40 characters → **400**
   `{"error":"Tuning is at most 40 characters"}`. The response is
   `{"tuning": <stored value or null>}`.
10. **Custom-field addressing.** The path segment is the field's **name**,
    URL-encoded, matched against the token user's own fields ignoring case
    (`preset` finds `Preset`). No match → **404**
    `{"error":"Custom field not found"}`. Body `{"value": string}`; it goes
    through the existing `setCustomFieldValue(userId, fieldId, versionId, value)`
    in `src/lib/customFields.ts`, so a blank value clears and RH-186's length
    rules and messages apply (a rule error → **400** with that message).
    Response `{"field": "<name>", "value": <stored value or null>}`.
11. **Upload.** `POST /api/v1/tabs`, `multipart/form-data` with `versionId`,
    `title` and `file`. The version resolves to its `songId` (Decision 8; unknown
    → 404). The work is done by `uploadTabForUser({ userId, songId, title, file })`
    in a new `src/lib/tabUpload.ts`, which receives the body of today's
    `uploadTabAction` (10 MB cap, byte sniffing, `ensureOwnEntry`,
    `prepareUploadBytes`, Blob `put`, `createTab`) unchanged in behaviour. The
    **lib enforces the 10 MB cap** so both callers share it. `uploadTabAction`
    becomes session resolution + `uploadTabForUser` + `revalidatePath('/')`
    (it keeps its `{ data, entry, error }` envelope; `revalidatePath` stays in
    the action, never in the lib). The API answers **201** with
    `{"id","title","contentType","createdInRepertoire": boolean}`; a missing
    field, an unsupported type or an over-cap file → **400** with the existing
    message. The skill notes that the hosted function body limit is 4.5 MB.
12. **Read endpoints.**
    - `GET /api/v1/songs?q=<text>` (`read`): the token user's personal
      repertoire, filtered case-insensitively on title or artist when `q` is
      given, at most 50 items:
      `[{versionId, songId, title, artist, versionLabel, status, tuning}]`.
      Backed by `getRepertoire({ userId })` plus a pure filter in
      `src/lib/apiSongs.ts` (no new SQL).
    - `GET /api/v1/songs/{versionId}` (`read`): `{versionId, songId, title,
      artist, inRepertoire, status, key, tuning, customFields: [{name, value}]}`
      from `getResolvedEntryForVersion` and `getCustomFieldValues`.
    - `GET /api/v1/custom-fields` (`read`): `[{name}]` in the user's order, from
      `listCustomFields`.
13. **Sentry.** The `Authorization` header must not reach Sentry. Add a pure
    `scrubAuthorizationHeader(event)` in `src/lib/sentryScrub.ts`, wired as
    `beforeSend` in `sentry.server.config.ts` and `sentry.edge.config.ts`, that
    deletes `authorization` (any case) from `event.request.headers`.
14. **Settings "AI access" section.** A new `AiAccessSettingsSection` placed
    after "Custom fields", styled like RH-186's section (same row and
    `ConfirmPanel` styling). States, all in the mock: loading; empty list
    ("No tokens yet. Create one to let an AI agent work on your songs."); token
    list (name, prefix, scopes, created, last used or "Never used", expires or
    "Never expires", a Revoke button); create form (name, the three scope
    checkboxes with `read` pre-checked, expiry select); a validation error shown
    inline under the form; the one-time reveal (full token, Copy button, the
    warning "You will not see this token again.", the two lines
    `export REPERTOIRE_HERO_URL=<origin>` and
    `export REPERTOIRE_HERO_TOKEN=<token>`, a link to the skill, a Done
    button); and the revoke confirmation ("Revoke "<name>"? Agents using it
    stop working immediately."). The URL line reads `NEXT_PUBLIC_APP_URL` the
    way `src/lib/auth-client.ts` does, falling back to `window.location.origin`.
    Offline, the create and revoke buttons are disabled, as in RH-186's section.
    **Copy is inline English (AGENTS.md F25). No dictionary key, no
    `getDictionary`, no third F25 exception.**
15. **The skill.** `public/agent-skill/repertoire-hero/SKILL.md`, served
    statically at `/agent-skill/repertoire-hero/SKILL.md`. Frontmatter
    `name: repertoire-hero` and a one-line `description`. Body: reads the base
    URL from `REPERTOIRE_HERO_URL` and the token **only** from
    `REPERTOIRE_HERO_TOKEN` (never asks the user to paste it into the chat),
    one `curl` example per endpoint written as `METHOD /api/v1/...` headings,
    the workflow "search → read → write", the error table (401, 403, 404, 400),
    and the 4.5 MB upload note.

### Files touched

- `migrations/0031_api_tokens.sql` — new `api_tokens` table (Decision 2).
- `src/lib/apiTokenRules.ts` — new, pure: token generation, SHA-256 hashing,
  prefix, header parsing, scope list, creation validation and messages.
- `src/lib/apiTokens.ts` — new: create, list active, revoke (scoped by user),
  resolve by hash (active only) and touch `last_used_at`.
- `src/lib/apiAuth.ts` — new: `withApiAuth(scope, handler)` and the JSON error
  helpers.
- `src/lib/apiSongs.ts` — new: `findSongVersion`, the repertoire filter, and the
  response mappers.
- `src/lib/tabUpload.ts` — new: `uploadTabForUser` (body moved from the action).
- `src/lib/sentryScrub.ts` — new: `scrubAuthorizationHeader`.
- `src/app/api/v1/songs/route.ts`, `src/app/api/v1/songs/[versionId]/route.ts`,
  `src/app/api/v1/songs/[versionId]/tuning/route.ts`,
  `src/app/api/v1/songs/[versionId]/custom-fields/[fieldName]/route.ts`,
  `src/app/api/v1/custom-fields/route.ts`, `src/app/api/v1/tabs/route.ts` — new
  route handlers, each wrapped in `withApiAuth`.
- `src/app/actions/tabs.ts` — `uploadTabAction` delegates to `uploadTabForUser`.
- `src/app/actions/apiTokens.ts` — new: list, create, revoke actions.
- `src/app/apiTokenActions.ts` — new: typed bundle for the client.
- `src/hooks/useApiTokenSettings.ts` — new: section controller.
- `src/components/settings/AiAccessSettingsSection.tsx` — new: the section.
- `src/app/settings/page.tsx` — renders the section after "Custom fields".
- `public/agent-skill/repertoire-hero/SKILL.md` — new: the skill.
- `sentry.server.config.ts`, `sentry.edge.config.ts` — `beforeSend` scrub.
- `src/proxy.ts` — header comment only: `/api/v1` handlers resolve a bearer
  token, not a session.
- `src/app/actions/__tests__/actionSessionGuard.test.ts` — covers the new actions.
- `AGENTS.md` — the session sentence, the file map and an "AI access API"
  paragraph; `docs/behavior.md` — the lines under Behavior changes.

### Test criteria

- `apiTokenRules.test.ts`: generated tokens match `^rh_pat_[A-Za-z0-9_-]{43}$`;
  the hash is the SHA-256 hex of the token; header parsing accepts only
  `Bearer rh_pat_…`; each validation message above.
- `apiTokens.db.test.ts`: after create, no column of the row contains the
  plaintext; resolve finds an active token and refuses it once revoked or past
  `expires_at`; user B cannot revoke user A's token (zero rows, not found); the
  11th active token is refused.
- `apiAuth.test.ts` (route-level): for every `/api/v1` route, no header, a
  `Basic` header, `Bearer garbage`, an unknown token and a session cookie alone
  each answer 401 and the wrapped handler is never called; a `read`-only token
  on each write route answers 403 `This token lacks the write:songs scope` /
  `… write:tabs scope` and nothing is written.
- `apiSongs.db.test.ts`: tuning PUT on a held version writes the user's
  `user_songs.tuning`, leaves `song_versions.tuning` and another user's row
  unchanged; on an unheld version answers 404 and creates no row; a random UUID
  answers 404 `Song version not found` on GET and both PUTs; custom-field PUT
  `preset` → `Lead 3B` on an unheld version stores the value, creates no
  `user_songs`/`band_songs` row, and `GET /songs/{versionId}` then returns it;
  an unknown field name answers 404; `GET /songs?q=` returns only the token
  user's rows.
- `tabUpload.test.ts` (Blob mocked): a PDF creates a `song_files` row owned by
  the token user and the user's repertoire row when missing; over 10 MB and an
  unsupported type are refused with the existing messages and write nothing.
  `src/app/actions/__tests__/tabs.test.ts` passes unchanged.
- `sentryScrub.test.ts`: `Authorization` and `authorization` are removed, other
  headers kept.
- `agentSkillParity.test.ts`: every exported method of every
  `src/app/api/v1/**/route.ts` has a `METHOD /api/v1/...` heading in the skill,
  and every such heading names an existing route and method; the frontmatter
  has `name: repertoire-hero`; the skill mentions `REPERTOIRE_HERO_TOKEN` and
  contains no `rh_pat_` literal longer than the prefix.
- `AiAccessSettingsSection.test.tsx` / `useApiTokenSettings.test.tsx`: empty
  state; create shows the reveal with the token, both `export` lines and the
  warning; after Done (and on remount) the token text is gone and the row shows
  name, prefix and scopes; validation message shown inline; revoke asks for
  confirmation and removes the row.
- Gates: `npm run lint`, `npm run lint:dead`, `npm run lint:dup`, `npx tsc
  --noEmit` and the vitest suite pass; `namingConventions.test.ts` passes (no
  new `getDictionary` use); no new entry in the complexity-override list.

## Behavior changes

- changed: Auth and profile — The proxy only checks cookie presence; every action and route handler resolves its own session, except the `/api/v1` handlers, which resolve a bearer personal access token through `withApiAuth` and never read the session cookie. (src/proxy.ts, src/lib/auth-session.ts, src/lib/apiAuth.ts) (RH-187)
- added: Auth and profile — A user creates, lists and revokes personal access tokens in Settings → "AI access"; the token is shown once and only its SHA-256 hash is stored. (src/lib/apiTokens.ts, src/components/settings/AiAccessSettingsSection.tsx) (RH-187)
- added: Auth and profile — An `/api/v1` request with a missing, malformed, unknown, revoked or expired token gets 401, and a token without the endpoint's scope gets 403. (src/lib/apiAuth.ts, src/lib/apiTokenRules.ts) (RH-187)
- changed: Repertoire and overrides — Tuning is edited from Fast View or `PUT /api/v1/songs/{versionId}/tuning` and writes the addressed owner's override, never the version's tuning; the API writes only a row the user holds. (src/components/fastview/SongTuningControl.tsx, src/hooks/useSongTuning.ts, src/lib/songTuning.ts, src/app/api/v1/songs/[versionId]/tuning/route.ts) (RH-187)
- changed: Files and annotations — Uploading a file, from the app or `POST /api/v1/tabs`, creates the uploader's own repertoire row as unknown, even in band context. (src/app/actions/tabs.ts, src/lib/tabUpload.ts, src/lib/tabs.ts) (RH-187)
- added: Auth and profile — The agent skill is served unauthenticated at `/agent-skill/repertoire-hero/SKILL.md` and documents exactly the `/api/v1` routes. (public/agent-skill/repertoire-hero/SKILL.md, src/lib/__tests__/agentSkillParity.test.ts) (RH-187)

## Expected Results

- [ ] In Settings → "AI access", creating a token named `Claude Code` shows the full `rh_pat_…` token with the warning `You will not see this token again.` exactly once.
- [ ] `GET /api/v1/songs` answers 401 for a token after it is revoked, though it answered 200 with that token before (`apiTokens.db.test.ts`).
- [ ] Every `/api/v1` route answers 401 to a request carrying only a valid session cookie and no `Authorization` header (`apiAuth.test.ts`).
- [ ] `GET /api/v1/songs?q=` returns the matching songs of the token user's own repertoire and none of another user's (`apiSongs.db.test.ts`).
- [ ] `PUT /api/v1/songs/{versionId}/tuning` with `{"tuning":"Drop D"}` on a held version writes the token user's `user_songs.tuning` and leaves `song_versions.tuning` unchanged (`apiSongs.db.test.ts`).
- [ ] `PUT /api/v1/songs/{versionId}/custom-fields/preset` with `{"value":"Lead 3B"}` stores the token user's Preset value for that version (`apiSongs.db.test.ts`).
- [ ] `POST /api/v1/tabs` with a multipart PDF creates a `song_files` row owned by the token user (`tabUpload.test.ts`, Blob mocked).
- [ ] `agentSkillParity.test.ts` passes, and fails when a `/api/v1` route is missing from `public/agent-skill/repertoire-hero/SKILL.md`.

## Out of Scope

- Uploading a tab from a web link (`POST /api/v1/tabs` with a JSON `url`) —
  deferred to a follow-up task by the operator (2026-10-27).
- OAuth and an MCP server (later tasks, per the operator).
- Band repertoires: the API never writes a `band_songs` row's override.
- Deleting songs, files or fields; editing key, lyrics, map, tags or status.
- Rate limiting and token usage analytics beyond `last_used_at`.
- Translating the Settings copy (F25).
