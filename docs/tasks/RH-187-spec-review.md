VERDICT: APPROVED

Round 6, findings-only re-review of `docs/tasks/RH-187-spec.md` (commit 2be4c25 on `meridian/RH-187`) and `docs/tasks/RH-187-mock.html`.

## Blocking Findings
None.

## Verification of the previous round's findings

1. **Behavior changes section**: resolved. `## Behavior changes` is present in the worktree file and in the server's `spec_content`. It has `changed:` entries for the three registry lines, quoted verbatim from `node scripts/behavior.js area …`: Auth and profile "The proxy only checks cookie presence…", Repertoire and overrides "Tuning is edited from Fast View…", and Files and annotations "Uploading a file creates the uploader's own repertoire row…". It also has `added:` entries for tokens, for the 401/403 guard and for the served skill. URL ingest is not listed, which is consistent with deferring it.
2. **Mock**: resolved. `has_mock: true`, and `mock_path` is `docs/tasks/RH-187-mock.html`. It shows these states: token list, empty list, create form (name, three scopes with `read` pre-checked, expiry select), validation error, one-time reveal (token, Copy, "You will not see this token again.", both `export` lines, skill link, Done) and revoke confirmation. The script reaches every element through `document.getElementById`/`querySelector(All)`. The top-level globals (`MOCK`, `state`, `render`, `show`, `esc`) do not collide with built-in `window` properties, and `confirm` is a local inside `wire()`.
3. **i18n vs AGENTS.md F25**: resolved. Decision 14 says "Copy is inline English (AGENTS.md F25). No dictionary key, no `getDictionary`, no third F25 exception." Nothing mentions `en.json`/`pt-BR.json` any more. Gates include `namingConventions.test.ts`, and Out of Scope lists translation.
4. **One rule for a version**: resolved. Decision 8 sets these rules:
   - A non-UUID or missing version answers 404 everywhere.
   - `GET` and the custom-field PUT accept any existing version, which matches RH-186 Decision 4.
   - Only the tuning PUT needs a held row. Its row id is `ownerRowId` from `getResolvedEntryForVersion`, and `null` gives 404.
   - 404 is told apart from 500 by `findSongVersion` running first, with any later throw answering 500.

   The Test criteria match these rules, and the stray "second user's versionId" assertion is gone. ER5 no longer reads back through GET. Signatures checked: `getResolvedEntryForVersion(owner, versionId)` (ownerSongs.ts l.334), `updateSongOverrides(owner, repertoireId, patch)` (l.211), `setCustomFieldValue(userId, fieldId, …)`, `getCustomFieldValues(userId, versionId)`, `listCustomFields(userId)`, `normalizeTuning(input)`.
5. **expected_results shape**: resolved. There are eight single-sentence lines, each with one headline outcome and a named test. The spec section and the task's `expected_results` are identical. The secondary assertions moved to Test criteria: reload view, hash storage, malformed/unknown 401s, unheld-version 404, read-back, 403, the `tabs.test.ts` regression and the lint gates. Every operator result keeps its meaning in the spec, with two exceptions, both settled earlier. The unsafe-URL clause was deferred by the operator's answer (2026-10-27). The `en.json`/`pt-BR.json` clause was dropped to comply with F25, as the previous round required.
6. **Revision landed**: resolved. The files are committed (2be4c25), and the server's `spec_content` shows the new headings.

## Suggestions
- Decision 14 says the states are "all in the mock", including loading and offline-disabled buttons. The mock shows neither. Either add the two states or drop "all".
- `normalizeTuning(input: string)` takes a string, but Decision 9 accepts `null`. State that the handler maps `null` to `''` before calling it, so the implementer does not widen the shared signature.
- Decision 2 hard-codes `0031`, yet also says to use the next free number at implementation time. The implementer should check `migrations/` first.

QUESTIONS:
