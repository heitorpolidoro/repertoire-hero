-- Migration 0018 (RH-127): record what a stored file actually is.
--
-- Until now every `song_files` row was a PDF by construction: `uploadTabAction`
-- sniffed `%PDF-`, refused everything else, and passed the literal
-- `application/pdf` to `put()`. RH-127 makes the action decode-and-re-encode
-- images too, so the stored bytes may now be JPEG, PNG or WebP — and which one
-- is not derivable from anything already on the row. The blob URL's extension
-- is a hint written by the same code path, not a fact, and re-sniffing the
-- object would mean a network round trip per file in a list.
--
-- So the content type is stored at write time, by the code that chose the
-- encoder. See `src/lib/fileIngest.ts`.

ALTER TABLE song_files
    ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'application/pdf';

-- The default is honest history, not a guess. Before this migration the upload
-- action accepted PDFs and nothing else, so `application/pdf` is the correct
-- reading of every pre-existing row rather than a plausible one — which is also
-- why the column can be NOT NULL with no backfill statement: the DEFAULT fills
-- the existing rows in the same ALTER.
COMMENT ON COLUMN song_files.content_type IS
    'The content type of the bytes actually stored in Vercel Blob, as chosen by the ingest''s encoder (src/lib/fileIngest.ts) and passed to put() — never the client-supplied MIME type. The DEFAULT ''application/pdf'' is honest history: every row written before RH-127 was a PDF, because the upload action refused everything else.';
