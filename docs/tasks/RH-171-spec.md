# RH-171 — Upload a tab picked from Google Drive on an Android phone

## Scope

Fast View's "Upload New Tab" form fails with "Failed to fetch" when the picked file comes from Google Drive on Android Chrome. The request never reaches the server (no server log, no Vercel function invocation), so the failure is client-side, in the browser's own request.

Covers: the tab upload form and its controller only. Not covered: the audio upload form (`AudioUploadForm`/`useAudioLibrary`), which has the same shape; it gets a follow-up task once this fix is proven on a phone. Also not covered: any change to the Server Action, the 12mb body limit, the 10MB ceiling, or the Vercel Blob path.

## Diagnosis (to be confirmed and recorded by the developer)

Evidence from the code, not yet from a device:

- `useTabLibrary.submitUpload` appends the picked `File` straight into a `FormData` and passes it to the Server Action. The browser serializes that `File` lazily, while sending the request, by streaming it from its backing store.
- On Android, a file picked from Drive through the Storage Access Framework is a `content://` handle. When the file is cloud-only (not downloaded), Chrome can create the `File` object (name, size) but cannot read its bytes at send time. A fetch whose body cannot be read rejects with a bare `TypeError: Failed to fetch` and sends nothing. That matches every symptom reported: message text, no server hit, only Drive files.
- The server limits are ruled out: `bodySizeLimit` is `12mb` and the form already refuses files over 10MB before sending, and a server-side refusal would return the action's `{ error }` envelope, not a network error.
- The Vercel Blob upload happens inside the action, after the request has arrived, so it is ruled out too.

The same unreadable file makes `file.arrayBuffer()` reject with `NotReadableError`. That gives a cheap, deterministic probe at pick/submit time, which is both the diagnostic and the fix.

### Confirmed cause and reproduction (developer, RH-171)

Cause (confirmed by code and test, not yet by a device): on Android Chrome a cloud-only Google Drive file is a `content://` handle. The `File` exists (name, size) but its bytes are resolved lazily. `submitUpload` appended that handle to `FormData` and handed it to the Server Action, so the browser had to stream the bytes while sending; when they could not be read, the request was aborted client-side with a bare `TypeError: Failed to fetch` and nothing reached the server.

Reproduction: a desktop-reproducible test double, a `File` whose `arrayBuffer()` rejects with `DOMException('NotReadableError')` (the same failure the send-time read hits). Through `submitUpload` it shows the unreadable file is detected deterministically by reading the bytes before the request. The fix reads the bytes into memory first (`readTabFileIntoMemory` in `src/lib/tabLibrary.ts`), sends an in-memory copy, and on read failure sends nothing and shows `UNREADABLE_TAB_FILE_MESSAGE` (download to the phone first). Covered by `src/lib/__tests__/tabLibrary.test.ts` and `src/hooks/__tests__/useTabLibrary.test.tsx`. The operator's phone confirmation is still pending (see Expected Results); if the phone shows a different cause, record it here and adjust the fix.

Operator retest (2026-10-24): the operator reported "it failed" ("Deu erro") on production, with no message text. That run could not exercise this fix: commit `836db01` exists only on the local `meridian/RH-171` branch, is on no remote, and is not in `master`, so production was still sending the picked `content://` handle. The retest only counts on a build that contains this branch (a preview deploy of it, or production after the merge). If that build still fails, note the exact message. The new message ("Your phone could not read this file...") means the read failed on the phone. "Failed to fetch" or "An unexpected response was received from the server" means the request itself failed. For a file over 4.5 MB, the likely cause is then Vercel's 4.5 MB function request-body limit, which applies before `bodySizeLimit` and the 10MB ceiling. That would need the direct-to-Blob client upload this spec puts out of scope.

## Approach

Behavior:

1. On submit, before building the request, the controller reads the picked file's bytes into memory once and sends a new in-memory `File` (same name, same type) instead of the picked handle. After that read, the request no longer depends on the phone's `content://` stream, so a transient or lazily-resolved Drive handle cannot break the send. Drive files that Chrome can fetch on demand (it downloads them during the read) now upload.
2. If that read fails (`NotReadableError`, `NotFoundError`, `SecurityError`, or any rejection), no request is sent and the form's error line shows a plain message telling the musician the phone could not read the file and to download it to the phone first (for Drive: open the file, "Download", then pick it from Downloads) or try again. The text never contains "Failed to fetch". The state returns to idle, so retrying is one tap.
3. A `TypeError: Failed to fetch` thrown by the action call itself (a real network drop) is not rewritten by this task; it keeps the existing generic handling.
4. The 10MB check stays first and unchanged, so an oversized file never gets read into memory.

The decision (read-and-copy, and mapping a read failure to the message) lives in `src/lib/tabLibrary.ts` as a function with no React, so it is unit-testable; the hook only wires it. The message constant is exported next to the other upload messages.

Files touched:

- `src/lib/tabLibrary.ts`: adds the read-and-copy function and the unreadable-file message.
- `src/hooks/useTabLibrary.ts`: `submitUpload` calls it before `uploadTab` and shows the message on failure. Mind the file's size and complexity budgets in AGENTS.md; extract rather than inline.
- Existing tests for `tabLibrary` and `useTabLibrary`: new cases below.
- `docs/tasks/RH-171-spec.md`: the Diagnosis section updated with the confirmed cause and reproduction.

Test criteria:

- Unit: the read-and-copy function returns a file with the same name, type and bytes as a readable input.
- Unit: with a `File` double whose `arrayBuffer()` rejects `NotReadableError`, the function reports failure with the unreadable-file message.
- Unit (hook): on that failure `uploadTab` is never called, `uploadError` equals the message, `uploading` ends false, and the message does not contain "Failed to fetch".
- Unit (hook): on success `uploadTab` receives a `FormData` whose `file` entry is the copy, and the existing success path (list update, form reset) is unchanged.
- No landing-page change: this is error handling, not a selling point (AGENTS.md Landing Page Rule).

## Expected Results

- [ ] The root cause of "Failed to fetch" for a Google Drive file on Android Chrome is recorded in this spec's Diagnosis section together with how it was reproduced.
- [ ] A unit test shows that a picked file whose bytes cannot be read never calls `uploadTab` and leaves a form error that tells the musician to download the file to the phone first and does not contain "Failed to fetch".
- [ ] A unit test shows that a readable file is sent to `uploadTab` as an in-memory copy with the same name, type and bytes, and the existing upload tests still pass.
- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass, including the complexity and file-size gates.
- [ ] [operator] On a real Android phone in production, pick a tab from Google Drive that is not downloaded to the phone and confirm it uploads, appears in the song's Tabs list and opens; if it still fails, report the exact message shown.

## Behavior changes

Area `Files and annotations` (registry added by RH-176 after this spec was first written; rebase picks it up):

- Add: A picked file whose bytes the browser cannot read is never uploaded; the form asks the musician to download it to the phone first.
- Add: A readable picked file is uploaded as an in-memory copy with the same name, type and bytes.

## Out of Scope

- The audio upload form and any direct-to-Blob client upload redesign.
- Retrying or resuming interrupted uploads.
- Changing the accepted types, size limits or server-side ingest.
