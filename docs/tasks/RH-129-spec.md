# RH-128 — Render an image file as a single page in the viewer and the stage

Part 2 of 2 from the RH-104 split. Part 1 (RH-127, spec `docs/tasks/RH-128-spec.md`)
made the server ingest images — sniffed, rotated upright, stripped, downscaled, with the
produced content type stored on `repertoire_tabs.content_type` — and deliberately left the
upload picker PDF-only so nothing unrenderable could reach a user. This task opens that
gate and makes an image readable and annotatable.

## Scope

Three things, and the plumbing that joins them.

1. **The picker admits images.** `accept` on the tab upload input lists PDF plus the three
   ingested image types. RH-127's guard test, which asserts the picker is PDF-only, is
   replaced here by its inverse — that is the hand-off, and it is the only place this task
   edits an expected result RH-127 established.
2. **The viewer branches away from `gview`.** For an image tab, `TabViewer` renders the
   file itself instead of the `docs.google.com/gview` iframe. PDFs keep the iframe
   untouched.
3. **The stage renders an image as page 1.** The `react-pdf` `Document`/`Page` pair is
   extracted out of `TabDrawingStage` behind a page-surface interface, and a second
   implementation renders an `<img>`. The annotation layer, the stroke math and the
   persistence path are not touched: `normalizePoint` cancels the native dimensions out, so
   a stored stroke is already a plain fraction of the rendered box, and an `<img>`'s
   `naturalWidth`/`naturalHeight` are exactly the `originalWidth`/`originalHeight` the
   existing `PageGeometry` wants. Naming the interface is the work; rewriting the maths is
   not.

Also in scope: carrying the content type through the offline snapshot so the branch is
made the same way offline, and the landing copy, which today sells PDFs only.

**Not in scope, and this is a deliberate call** — the two-state chrome from
`docs/use-cases.md`, *Annotate a file* ("drawing off shows the page and one small button,
bottom centre; drawing on shows the toolbar"). See *Out of Scope* for why, and the mock's
"Stage chrome" section for the operator question that goes with it.

## Approach

### Behaviour

- **One pure decision, one module.** `src/lib/tabRenderer.ts` *(new)* exports the set of
  image content types the ingest can produce (`image/jpeg`, `image/png`, `image/webp`) and
  `isImageTab(contentType: string | null | undefined): boolean`. An absent or unknown
  content type reads as PDF — the same honest-history reading RH-127's column default
  takes, so every row and every snapshot written before this task behaves exactly as it
  does today. The module is client-safe: it imports nothing, and in particular not
  `src/lib/fileIngest.ts`, which pulls in `sharp`.
- **The picker.** `accept` becomes PDF plus the three image types. The 10 MB client-side
  size mirror (`MAX_TAB_FILE_BYTES`) and the submit flow are unchanged; no client-side MIME
  check is added, because the bytes are still what decides, on the server (RH-127). The
  form's button and the section's copy stop saying "PDF" where they now mean "file" —
  `Upload PDF`, `Tabs (PDF)`, `No PDFs uploaded yet.` — written inline in English (F25).
- **The viewer.** `TabViewer` takes the active tab's content type. For an image it renders
  the file in an `<img>` inside the same 550px card box, object-contained and scrollable,
  with the same spinner-until-loaded treatment the iframe gets, and **no `gview` iframe is
  mounted at all**. The `offline` panel is a `gview` workaround, so it must not apply to an
  image: today `TabViewer.tsx:57` evaluates `offline ? panel : GviewFrame` before anything
  else, which would paint "Preview needs a connection" over a photograph that renders
  perfectly well — the offline `file_url` is the synthetic same-origin cache key the service
  worker answers `CacheOnly`. **The image branch therefore comes first and the offline
  branch is gated behind it**: for an image tab the `<img>` is rendered whether the browser
  is online or offline, and `data-testid="tab-viewer-offline"` is never mounted. Only for a
  PDF does the `offline` branch keep today's behaviour — same iframe online, same panel
  offline.
- **The stage.** `TabDrawingStage` stops knowing how a page is produced. It passes
  `fileUrl`, `pageNumber` and the computed `renderWidth` to a page surface and receives
  back two things it already consumes: the page count and a `PageGeometry`. The PDF
  implementation is today's `Document`/`Page` block moved verbatim, including the
  `'@/lib/pdfWorker'` side-effect import and its static `react-pdf` import (the eager chain
  AGENTS.md's Turbopack note depends on must not become dynamic). The image implementation
  renders one `<img>` at the given width, reports `1` page, and on load reports
  `{ width: renderWidth, height: renderWidth * naturalHeight / naturalWidth,
  originalWidth: naturalWidth, originalHeight: naturalHeight }`. Nothing else about the
  stage changes — not the canvas, not the gestures, not the save path, and not RH-99's
  offline-disabled drawing toggle.
- **Page controls follow the page count, not the file type.** The prev/next buttons and
  the `Page n / m` indicator render only when the surface reports more than one page. An
  image reports 1, so they are absent; a multi-page PDF is unchanged. A single-page PDF
  loses them too, which is the honest reading of the rule and not a special case. The save
  indicator lives in that row today and must survive the row's absence — it moves into the
  control row, or the row renders with only the indicator in it; either is acceptable, an
  image tab that can be annotated with no visible save state is not.
- **Offline.** `OfflineTabSnapshot` gains `contentType`, filled from the row at download
  time and read back by `offlineTabToRepertoireTab` as `content_type`. An absent value
  reads as `application/pdf`, so **`OFFLINE_SCHEMA_VERSION` is not bumped** — every v2
  snapshot already on disk predates image upload and is a PDF, so the fallback is a fact
  rather than a guess, and discarding those snapshots would cost a musician a downloaded
  setlist for nothing. The bytes themselves need no work: the download fetches the blob URL
  and caches the whole `Response`, whose `Content-Type` the blob already serves correctly
  since RH-127, and the service worker's `/__offline-tab/` route is content-type blind.
- **Landing copy.** Handwritten annotation is already the selling point in `landing.f5*`;
  it currently promises it on "PDF chord charts and tablatures" only, which this task makes
  untrue in the user's favour. `f5Title` and `f5Desc` are rewritten in **both**
  dictionaries to cover a photograph of a handwritten chart alongside the PDF. Same keys,
  no new keys, no new consumer — the parity test and the single-consumer test both stay
  green.

### Files touched

- `src/lib/tabRenderer.ts` *(new)* — the image content-type set and `isImageTab`.
- `src/components/tabs/PdfPageSurface.tsx` *(new)* — today's `Document`/`Page` block,
  moved; owns `react-pdf` and `@/lib/pdfWorker`.
- `src/components/tabs/ImagePageSurface.tsx` *(new)* — the `<img>` implementation.
- `src/components/tabs/StagePageSurface.tsx` *(new)* — the shared props type and the
  one-line branch on `isImageTab`; the only thing `TabDrawingStage` renders.
- `src/components/tabs/TabDrawingStage.tsx` — accepts `contentType`, renders
  `StagePageSurface` instead of `Document`/`Page`, gates the page-nav row on the reported
  count. **Shrinks**; see the budget note below.
- `src/components/fastview/TabViewer.tsx` — `contentType` prop, the image branch.
- `src/components/fastview/TabUploadForm.tsx` — `accept`, button copy.
- `src/components/fastview/TabLibrarySection.tsx` — passes the content type down, section
  and empty-state copy.
- `src/components/fastview/FastViewOverlays.tsx`,
  `src/components/fastview/PdfStageOverlay.tsx` — one more prop, passed through.
- `src/lib/tabLibrary.ts`, `src/hooks/useTabLibrary.ts` — the active tab carries its content
  type; `TabLibraryController` gains `activeTabContentType`.
- `src/lib/offlineSnapshot.ts` — `OfflineTabSnapshot.contentType`, written by
  `toTabSnapshot`, validated as an optional string by `isTabSnapshot`, read back by
  `offlineTabToRepertoireTab`.
- `src/i18n/dictionaries/en.json`, `src/i18n/dictionaries/pt-BR.json` — `landing.f5Title`,
  `landing.f5Desc`.
- `eslint.config.mjs` — the `TabDrawingStage.tsx` override lowered to the file's new actual
  numbers.
- `package.json` — version bump per the release rule.
- Tests: `src/lib/__tests__/tabRenderer.test.ts` *(new)*,
  `src/components/tabs/__tests__/` surface and stage tests,
  `src/components/fastview/__tests__/TabViewer.test.tsx`,
  `.../TabUploadForm.test.tsx` (RH-127's PDF-only assertion inverted here),
  `src/lib/__tests__/offlineSnapshot.test.ts`, `src/lib/__tests__/landingCopy.test.ts`.

**No migration.** RH-127 added `repertoire_tabs.content_type`; this task reads it.

**The budget, measured.** `src/components/tabs/TabDrawingStage.tsx` is pinned at
`complexity: 21`, `max-lines-per-function: 757`, `max-lines: 819`, and RH-99 lowers that to
815/750 by extracting `drawPath` into `src/lib/strokeRenderer.ts`. The ratchet may only
shrink, so this task cannot add a renderer branch to that file — it extracts, and the
override is then set to the file's **actual** new worst numbers. Do not trust any literal
in this spec or in RH-99's: run the lint and read them off the failure.
`complexityBudget.test.ts` fails on a ceiling that is not exactly the current worst number,
and it declares `MAX_OVERRIDES = 17` while the list already holds 17 entries — so the list
**may not grow at all**. The three new components must each stay inside the default budget,
because there is no room to give any of them an entry.

### Test criteria

DOM tests (`// @vitest-environment jsdom` first line, explicit `afterEach(cleanup)`), plus
one node test for `tabRenderer` and the offline snapshot round trip.

- `isImageTab` over the three image types, `application/pdf`, `undefined`, `null` and an
  unknown string.
- `TabViewer` with an image content type: an `<img>` whose `src` is the file URL, and no
  `iframe` anywhere in the output. The same with `offline` set: still the `<img>`, still no
  iframe, and no `tab-viewer-offline` element. With `application/pdf`: the `gview` iframe is
  still there, `src` unchanged, and offline the panel is still there — the regression
  assertions.
- The stage, mounted over an image: the page surface reports one page, the prev/next
  buttons and the page indicator are absent, the save indicator is present; over a
  multi-page PDF (the `react-pdf` pair mocked, as the existing stage tests do) they are all
  present.
- The coordinate round trip, which is the claim this task rests on: feed
  `normalizePoint`/`denormalizePoint` the `PageGeometry` an `<img>` of a known
  `naturalWidth`/`naturalHeight` produces at a known render width, and assert a point maps
  back to itself within rounding tolerance, and that the normalized value is independent of
  the render width (two widths, same normalized stroke).
- The offline snapshot: an image tab round-trips its content type through
  `buildOfflineSnapshot` → `readValidSnapshot` → `offlineTabToRepertoireTab`, and a
  snapshot written without the field still validates and reads back as
  `application/pdf`.
- `accept` on the file input contains `application/pdf` and the three image types.
- `landingCopy.test.ts`'s existing key-parity test, unchanged, plus an assertion that both
  dictionaries' `landing.f5Desc` mention images/photos.

## Expected Results

- [ ] ER1 — the tab upload input's `accept` attribute admits JPEG, PNG and WebP alongside
      PDF; a test asserts all four values are present on the input. Both halves of RH-127's
      ER11 are retired here and replaced by this one: the suite no longer asserts
      `accept === 'application/pdf'`, and it no longer greps
      `src/components/fastview/TabUploadForm.tsx` for the absence of image MIME types or
      image file extensions.
- [ ] ER2 — for a tab whose stored content type is an image type, `TabViewer` renders an
      image element whose source is the tab's file URL, and the rendered output contains no
      `iframe` pointing at `docs.google.com/gview`; a test asserts both.
- [ ] ER3 — for a tab whose stored content type is `application/pdf`, `TabViewer` still
      renders the `docs.google.com/gview` iframe with the same `src` it builds today; a
      regression test asserts it.
- [ ] ER4 — for an image file the stage reports exactly one page and renders no previous-
      page button, no next-page button and no page indicator, while the save-state
      indicator is still rendered; a test asserts the controls are absent for an image and
      present for a multi-page PDF.
- [ ] ER5 — the page surface is extracted out of `src/components/tabs/TabDrawingStage.tsx`
      into its own module(s) under `src/components/tabs/`, that file's line count is
      strictly lower than before this task, its `complexity-budget` override is set to its
      new actual `max-lines` / `max-lines-per-function` / `complexity` values (lowered,
      never raised), no override entry is added for the new files, and `npm run lint` and
      `src/lib/__tests__/complexityBudget.test.ts` both pass.
- [ ] ER6 — a test asserts a stroke normalized against the `PageGeometry` an image surface
      produces (`originalWidth`/`originalHeight` from `naturalWidth`/`naturalHeight`)
      denormalizes back to the same rendered coordinates within rounding tolerance, and
      that the normalized value is identical at two different render widths.
- [ ] ER7 — an image tab's content type survives the offline round trip: a test puts an
      image tab through `buildOfflineSnapshot`, `readValidSnapshot` and
      `offlineTabToRepertoireTab` and gets the image content type back, and a snapshot
      whose tabs carry no content type still validates and reads back as
      `application/pdf`, with `OFFLINE_SCHEMA_VERSION` unchanged.
- [ ] ER8 — an image tab renders from the cache while the browser is offline: a test mounts
      `TabViewer` for an image tab with `offline` true and the offline cache-key file URL,
      and asserts an image element whose `src` is that cache-key URL **is** rendered, that
      the element with `data-testid="tab-viewer-offline"` is **not** rendered, and that no
      `iframe` is present — so the existing `/__offline-tab/` CacheOnly route serves the
      bytes with no new service-worker rule. The same test, repeated with
      `application/pdf`, still gets the `tab-viewer-offline` panel.
- [ ] ER9 — `src/lib/tabRenderer.ts` exists and exports `isImageTab`, which answers true
      for `image/jpeg`, `image/png` and `image/webp` and false for `application/pdf`,
      `undefined`, `null` and an unknown string; a unit test covers all seven cases, and
      the module imports nothing from `src/lib/fileIngest.ts`.
- [ ] ER10 — `landing.f5Title` and `landing.f5Desc` in **both** `en.json` and
      `pt-BR.json` say the feature covers photographs of charts and not PDFs alone; the key
      sets of the two dictionaries are still identical and
      `src/lib/__tests__/landingCopy.test.ts` passes.
- [ ] ER11 — no user-facing copy in the tab section calls the feature PDF-only any more:
      the section heading, the empty state and the upload button name files generally; a
      test or review-visible diff shows `Tabs (PDF)`, `No PDFs uploaded yet.` and
      `Upload PDF` are gone.
- [ ] ER12 — an interactive mock covering the image viewer, the image stage and the
      deferred-chrome question exists at `docs/tasks/RH-129-mock.html` and is recorded as
      the task's `mock_path`.
- [ ] ER13 — `npm run lint` and `npm test` both pass, `npm run test:coverage` stays above
      the configured thresholds, and `npm run lint:dead` reports no unused new export.
- [ ] ER14 — `package.json`'s `version` is bumped above the value it carries on `master`
      before this task, as AGENTS.md's release rule requires for any change landing on
      `master`.

## Out of Scope

- **The two-state stage chrome** (`docs/use-cases.md`, *Annotate a file*): hiding the
  toolbar while drawing is off, the single bottom-centre toggle, and edge-tap page turns.
  It is a separate deliverable — it changes the PDF stage identically, it is not required
  by image rendering, it carries its own open question (edge tap versus setlist swipe,
  recorded as *Open* in the use case), and it rewrites most of the toolbar JSX in a file
  this task is already shrinking under a ratchet. Doing both at once would make one review
  of two unrelated regressions. It should be its own task, after this one.
- A manual rotate control, HEIC/AVIF input, thumbnails, multi-image "pages" for one tab.
- `song_files` and the `(user_id, song_id)` key (RH-123) — this runs on `repertoire_tabs`.
- Re-processing or re-typing files uploaded before RH-127.
