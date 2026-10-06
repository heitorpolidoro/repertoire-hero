# RH-127 — Ingest uploaded images: decode, bake rotation, strip metadata, downscale

Part 1 of 2 from the RH-104 split. Part 2 (RH-128) opens the picker to images and
renders them in the stage; this part is deliberately invisible to the user.

## Drift corrections (re-read against the tree at `03e60f0`)

This spec was approved **before RH-123 landed**, and five of its statements no longer
describe the tree. They are corrected in place below; this list exists so a reviewer can
see what moved and why, rather than diffing two specs.

1. **`repertoire_tabs` is gone — the table is `song_files`.** RH-123
   (`migrations/0015_song_files.sql`) re-keyed it from a repertoire row to
   `(user_id, song_id)`. Confirmed columns today: `id, user_id, song_id, title, file_url,
   annotations, created_at`. Every mention of the old name below now reads `song_files`.
2. **The type is `SongFile`, not `RepertoireTab`** (`src/types/database.ts:229`).
3. **The authorization call is `ensureOwnEntry(userId, songId)`**, a local helper at
   `src/app/actions/tabs.ts:49` — not `assertRepertoireAccess`. The *ordering* claim is
   unchanged and still binding: it precedes any byte work or blob call.
4. **The migration prefix is not `0009`.** The highest present is `0016`, and RH-125 is
   taking `0017`, so **re-read the directory at implementation time** and take the next free
   number. Never skip one: `migrationsSingleSource.test.ts` requires prefixes unique and
   contiguous from `0001`.
5. **`createTab` may NOT take a fifth positional parameter — this was a hard blocker.** The
   earlier draft said "`createTab` reaches five parameters, which the file's existing pinned
   `max-params: 5` override already permits". RH-123 **deleted** that override
   (`eslint.config.mjs:69-73`: "`src/lib/tabs.ts` and `src/hooks/useTabLibrary.ts` each
   carried `max-params: 5`; every function in both lost a parameter … so both now sit inside
   the base budget of 4 and the overrides had to go"). `createTab` today takes exactly four
   (`userId, songId, title, fileUrl`) — at the global ceiling — and the ratchet may **only
   shrink**, so the override cannot come back. See §"The `createTab` signature" for the
   resolution.

`sharp` was re-verified and ER1's premise still holds: `package-lock.json:13019` carries
`node_modules/sharp` at **0.35.4** as an optional dependency of `next`, it is installed, and
it encodes and reads metadata correctly in this environment.

## Scope

`uploadTabAction` stops being validate-and-forward and becomes decode-and-re-encode on
the Node runtime. It identifies an uploaded file by its leading magic bytes (PDF as
today, plus JPEG/PNG/WebP), and for an image it decodes the pixels, **bakes the EXIF
rotation into them**, strips all metadata, downscales to a bounded longest edge and a
bounded byte length, and re-encodes. The blob upload's `contentType` becomes the content
type of what was actually produced, and that content type is stored on the row via a new
column on `song_files`.

Why the rotation is baked rather than left to the EXIF flag — this is the decision the
implementation must not get wrong. `normalizePoint` cancels the native dimensions out, so
a stored stroke is a plain fraction of the rendered box and records no evidence of what it
was drawn over. Every renderer must therefore agree about the orientation flag forever: a
future canvas path, a server-side thumbnail or the offline view that reads EXIF
differently silently and unrepairably invalidates every annotation already saved. Baking
leaves no flag to disagree about. Stripping metadata additionally removes the GPS a phone
photo carries, which would otherwise be published at a public blob URL; that reason
stands on its own (`docs/use-cases.md`, *Attach a file to a song*).

Not covered: the upload picker, which **stays PDF-only** — see Out of Scope.

## Approach

### Behaviour

- **Sniffing replaces trust in the client MIME type.** The current
  `file.type === 'application/pdf' || <%PDF- sniff>` disjunction is replaced by sniffing
  alone, over four signatures: `%PDF-` at offset 0, `FF D8 FF` (JPEG),
  `89 50 4E 47 0D 0A 1A 0A` (PNG), and `RIFF` at 0 with `WEBP` at 8 (WebP). A file
  matching none is rejected with a validation error (message widened from
  `Only PDF files are allowed` to name the four accepted kinds) and nothing is uploaded or
  inserted. A file whose client MIME claims `application/pdf` but whose bytes are not
  `%PDF-` is now rejected — a deliberate tightening, and the Android Storage Access
  Framework case the old comment protects (a genuine PDF reported as
  `application/octet-stream`) is still accepted, because the sniff is what decides.
- **PDFs pass through byte-identical.** No re-encode, no metadata work;
  `contentType: 'application/pdf'` as today.
- **The two bounds are `2048` px on the longest edge and `2 * 1024 * 1024` bytes**, exported
  from `src/lib/fileIngest.ts` as `MAX_IMAGE_EDGE_PX` and `MAX_IMAGE_BYTES`. These are
  literals of this task, not inherited from anywhere: `src/lib/imageCompressor.ts`'s 1024px
  is the **band-logo/avatar** path (`useBandEdit`, `BandsView`) and is the wrong reference
  for this file, which is a *photograph of a handwritten chart read off a music stand while
  playing*. 2048px across an A4 sheet's long edge is ≈175 dpi, comfortably above the ~150 dpi
  where ballpoint strokes start to smear, and it matches the long edge of the largest tablet
  viewport a player is plausibly using (12.9" iPad, 2732×2048), so the chart never renders
  below 1:1 pixel density on the stage; 1024px would be ≈87 dpi, which softens handwriting
  exactly when the player leans back. The 2MB cap is set so the chart loads over venue wifi
  or a phone hotspot before the song starts (≈3 s at 5 Mbps) while still being 5× below the
  10MB input ceiling, so the ingest demonstrably shrinks real phone photos rather than
  waving them through. An illegible chart is a worse failure than a large file: when the two
  bounds conflict, legibility is why the dimension bound is tried first and only lowered as
  a last resort (see the terminal case below).
- **Images are re-encoded through `sharp`.** One pass: auto-rotate from the EXIF
  Orientation tag so the pixels come out upright and the tag is gone; no metadata is
  carried over (no `exif`, `icc`, `iptc`, `xmp` in the output); resize so the longest edge
  is at most `MAX_IMAGE_EDGE_PX`, never upscaling a smaller image; encode in the input's
  own family (JPEG→JPEG, PNG→PNG, WebP→WebP), walking a descending quality/effort ladder
  (quality `82 → 70 → 60 → 50 → 40` for the lossy families) until the output is at most
  `MAX_IMAGE_BYTES`, and falling back to the JPEG ladder if PNG's lossless rungs still
  cannot reach it. Both bounds hold unconditionally for every stored image. sharp's default
  `limitInputPixels` stays in force as the decompression-bomb guard; a decode failure
  surfaces as a validation error through the action's existing envelope.
- **Terminal case of the ladder, stated so nothing is left to the implementer's taste.**
  If the JPEG fallback's last rung (quality 40) is still over `MAX_IMAGE_BYTES`, the ingest
  **halves the longest edge and re-walks the JPEG ladder**, repeating down to a floor of
  `MIN_IMAGE_EDGE_PX = 512`. `MAX_IMAGE_EDGE_PX` is therefore a **ceiling, not a target** —
  a smaller output is always acceptable, so the two bounds cannot deadlock. If even 512px at
  quality 40 exceeds the byte bound, the upload is **rejected with a validation error** and
  nothing is uploaded or inserted. Storing an over-bound output is never permitted: the
  invariant above is absolute.
- **The output content type is derived, never assumed.** It is whatever the chosen encoder
  produced, and it is what is passed to `put()` as `contentType`, what the stored blob path's
  final extension reflects (`.pdf`/`.jpg`/`.png`/`.webp`, replacing the picked file's
  extension on the sanitized name), and what is written to the new row column.
- **The 10MB input ceiling and its message are unchanged**, and so is the authorization
  order: `ensureOwnEntry(userId, songId)` (`src/app/actions/tabs.ts:49`) still precedes any
  byte work or blob call. A failure there refuses the upload with nothing written, where a
  failure after it would leave an orphaned blob object behind — which is the whole reason
  `abandoned_blobs` exists.

### The `createTab` signature

`createTab` must carry the content type, but it is already at the global `max-params: 4`
ceiling and its override is gone for good (Drift correction 5). A fifth positional parameter
would fail `src/lib/__tests__/complexityBudget.test.ts`, and adding an override back is
forbidden — the ratchet may only shrink, and it is currently at 14 entries against
`MAX_OVERRIDES = 17`.

**So `createTab` takes a single payload object**, which is the convention AGENTS.md already
names for a parsed-and-narrowed input shape (`<Subject>Payload`, as in `SongEditPayload` at
`src/lib/songEditPayload.ts:19` and `BandUpdatePayload` at `src/lib/bandAdminState.ts:33`):

```ts
export interface CreateSongFilePayload {
  userId: string
  songId: string
  title: string
  fileUrl: string
  contentType: string
}

export async function createTab(payload: CreateSongFilePayload): Promise<SongFile>
```

The interface lives beside `createTab` in `src/lib/tabs.ts` — it is an argument shape for one
function, not app vocabulary (so not `src/types/database.ts`) and not a SQL projection (so
not `dbRows.ts`). This drops the function to **one** parameter, leaving headroom for RH-128
rather than consuming the last slot. The single call site
(`src/app/actions/tabs.ts:102`) and the two test call sites
(`src/lib/__tests__/tabs.test.ts:66,154`) are updated to the object form; this is a
mechanical change at three places, not a refactor.

### Files touched

- `package.json` — promote `sharp` to a direct dependency. Verified: the lockfile already
  carries `node_modules/sharp` at **0.35.4** as an optional dependency of `next`, and it is
  installed, so no resolution change is needed. Bump the app version per the release rule.
- `next.config.ts` — add `"sharp"` to `serverExternalPackages` (native, Node-only, no
  `./react` subpath, so the RH-32 guard is satisfied); extend the comment with why.
- `src/lib/fileIngest.ts` *(new)* — the whole decision: the signature table and
  `sniffUploadContentType(buffer)`, the exported bounds (`MAX_IMAGE_EDGE_PX = 2048`,
  `MIN_IMAGE_EDGE_PX = 512`, `MAX_IMAGE_BYTES = 2 * 1024 * 1024`) and quality ladder, the re-encode
  (`prepareUploadBytes`), and the stored-file-name/extension mapping. It lives in `src/lib`
  so it is inside the coverage universe and keeps the action under its complexity budget;
  it imports nothing from `@/app` (F21).
- `src/app/actions/tabs.ts` — `uploadTabAction` sniffs, prepares, uploads with the derived
  `contentType` and path, and passes the content type to `createTab`.
- `src/lib/tabs.ts` — `createTab` takes a `CreateSongFilePayload` object (§"The `createTab`
  signature") carrying the content type, and inserts it; every `SELECT` list on `song_files`
  (`createTab` RETURNING, `listTabs`) returns `content_type`. Add no override and raise none.
- `src/types/database.ts` — `SongFile` gains `content_type?: string`, optional for the
  same reason `annotations` is: it is present on every row read through `src/lib/tabs.ts`,
  and absent only from offline snapshots and fixtures written before this task, where
  `application/pdf` is the correct reading of an absent value.
- `migrations/NNNN_add_song_file_content_type.sql` *(new)* — `ALTER TABLE song_files ADD
  COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'application/pdf'`, plus a
  `COMMENT ON COLUMN` recording that the default is honest history (every pre-existing row
  is a PDF), not a guess. **Numbering:** one above the highest prefix present in
  `migrations/` at implementation time — `0016` is the highest landed and RH-125 is taking
  `0017`, so resolve it by looking rather than trusting any number quoted here, and never
  skip a number (`migrationsSingleSource.test.ts` requires prefixes unique and contiguous
  from `0001`).
- `src/lib/__tests__/fileIngest.test.ts` *(new)*, `src/app/actions/__tests__/tabs.test.ts`,
  `src/lib/__tests__/tabs.test.ts`, `src/components/fastview/__tests__/TabUploadForm.test.tsx`
  — tests below.

### Test criteria

Node-environment vitest, with `sharp` used for real (it is installed; `@vercel/blob` stays
mocked as today). Fixtures are generated in-test with `sharp`, not committed as binaries:
a non-square image with EXIF Orientation 6 for the rotation case, and an image above both
bounds (e.g. 4000×3000 noise, which no quality rung compresses under 2MB at full size) for
the downscale case, which also exercises the ladder-exhaustion re-resize. The unreachable
terminal case (over the byte bound even at 512px) cannot be produced by a real image, so it
is covered by stubbing the encoder to return an over-bound buffer on every rung. The sniffer
is tested on all four accepted signatures plus
a rejected buffer and the `application/pdf`-claiming impostor. The metadata assertion reads
the stored bytes back with `sharp` and inspects the parsed metadata. The action test asserts
the `contentType` and path handed to `put` and the content type handed to `createTab`, and
that a PDF's stored bytes are byte-identical to the input.

## Expected Results

- [ ] ER1 — `package.json` lists `sharp` as a direct dependency at the lockfile's existing
      `0.35.4`, and `next.config.ts`'s `serverExternalPackages` contains `"sharp"`;
      `src/lib/__tests__/serverExternalPackages.test.ts` passes.
- [ ] ER2 — `uploadTabAction` identifies an uploaded file by its leading magic bytes and
      never by the client-supplied MIME type: JPEG, PNG and WebP signatures are accepted as
      images, the `%PDF-` sniff still accepts PDFs, and a buffer matching no signature is
      rejected with a validation error — including one whose `file.type` is
      `application/pdf` — with no blob upload and no row insert. Unit tests cover all six
      cases.
- [ ] ER3 — a unit test feeds the ingest a JPEG whose EXIF Orientation is 6 and asserts the
      stored bytes decode with the rotation already applied: output width and height are
      swapped relative to the input, so the orientation is baked into the pixels.
- [ ] ER4 — a unit test reads the stored image bytes back with `sharp` and asserts the
      metadata carries no `exif`, no GPS, no `icc`, no `iptc` and no `xmp` block.
- [ ] ER5 — `src/lib/fileIngest.ts` exports `MAX_IMAGE_EDGE_PX === 2048`,
      `MIN_IMAGE_EDGE_PX === 512` and `MAX_IMAGE_BYTES === 2 * 1024 * 1024`, and a unit test
      asserts those three literal values.
- [ ] ER6 — a unit test feeds the ingest a 4000×3000 image too noisy to compress at full
      size and asserts the stored result has a longest edge **of at most 2048 pixels** and a
      byte length **of at most 2 097 152 bytes**, both written as literals in the test, and
      that the input itself exceeded both (so the assertion proves a real downscale).
- [ ] ER7 — a unit test proves the byte bound is never violated when the quality ladder is
      exhausted: for an image that cannot reach 2 097 152 bytes at 2048px, the stored output
      is smaller than 2048px on its longest edge and at most 2 097 152 bytes; and, with the
      encoder stubbed to return an over-bound buffer on every rung down to 512px, the upload
      is rejected with a validation error, with no blob upload and no row insert. No code
      path stores an image above either bound.
- [ ] ER8 — a unit test asserts the `contentType` passed to the blob `put` call equals the
      content type of the re-encoded output (`image/jpeg`, `image/png` or `image/webp` for
      images, `application/pdf` for PDFs) rather than a hardcoded or client-supplied value,
      and that the stored blob path's final extension matches that content type.
- [ ] ER9 — a unit test asserts a PDF upload stores bytes byte-identical to the input (no
      re-encode path touches PDFs).
- [ ] ER10 — the SQL migration whose prefix is the highest in `migrations/` adds a
      content-type column to `song_files` with `NOT NULL DEFAULT 'application/pdf'`,
      `uploadTabAction` writes the stored file's content type into it through
      `createTab`, and `listTabs`/`createTab` return it; the file name is never asserted
      literally. `src/lib/__tests__/migrationsSingleSource.test.ts` passes, confirming
      prefixes stay unique and contiguous from `0001`.
- [ ] ER11 — the upload picker's `accept` attribute still admits PDFs only: a test asserts
      `accept === 'application/pdf'` on the file input and that no image MIME type or image
      file extension appears anywhere in `src/components/fastview/TabUploadForm.tsx`.
- [ ] ER12 — `npm test` passes and `npm run test:coverage` stays above the configured
      thresholds (statements 80, branches 65, functions 78, lines 80), with no new entry in
      the `complexity-budget-overrides` block and no existing ceiling raised. `npm run lint`
      adds **nothing** to its pre-existing baseline of 8 errors and 12 warnings across 12
      untouched files (tracked as RH-129) — that baseline makes `npm run lint` exit 1 today,
      so the gate is "no new finding attributable to this change", not "exit 0".
- [ ] ER13 — `createTab` takes a single `CreateSongFilePayload` object rather than a fifth
      positional parameter: `src/lib/__tests__/complexityBudget.test.ts` passes with **no**
      `max-params` override for `src/lib/tabs.ts` and no new entry in the
      `complexity-budget-overrides` block, and the three existing call sites
      (`src/app/actions/tabs.ts`, `src/lib/__tests__/tabs.test.ts` ×2) use the object form.

## Out of Scope

- **Opening the picker to images and rendering them** — RH-128. Until it lands, no image
  can be chosen through the UI, so this task can never put an unrenderable file in front of
  a user. That is the point of doing it first; hold the line.
- **Re-keying the table to `(user_id, song_id)`** — that was **RH-123, which has landed**
  (`migrations/0015_song_files.sql`). This task therefore runs on `song_files` as it now
  stands and changes no ownership path: it adds one column and touches no key. The earlier
  draft's "This runs on the current `repertoire_tabs`" is withdrawn — that table no longer
  exists (Drift correction 1).
- A manual rotate control, HEIC/AVIF input, server-side thumbnails, and migrating or
  re-processing files already stored.
- Offline-snapshot or service-worker handling of the new content type.
