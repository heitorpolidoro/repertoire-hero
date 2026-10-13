# Android (Trusted Web Activity)

Files for publishing Repertoire Hero to Google Play as a Trusted Web Activity (RH-81). Everything committed here carries placeholder values; the operator replaces each one marked `PLACEHOLDER` before the first upload.

## Why this is not a thin wrapper

Play rejects apps that only wrap a website. This one is a real tool for working musicians:

- installable offline repertoire: playlists, lyrics, keys, statuses and PDF charts are downloaded to the device and read with no signal;
- Fast View with PDF tablature and Stage Mode: a music-stand reading mode where you annotate charts with a finger or a pen;
- setlist navigation: swipe between the songs of a playlist during a gig;
- band shared repertoires: a band keeps its own repertoire and playlists, shared through an invite link.

## Package id

`app.repertoirehero.twa` (PLACEHOLDER until the operator confirms it in the Play Console). The package id can never change after the first Play upload, so confirm it before uploading anything.

## Release checklist

1. Confirm the package id above (PLACEHOLDER) and keep it identical in `twa-manifest.json` and `public/.well-known/assetlinks.json`.
2. Confirm the host `repertoire-hero.vercel.app` in `twa-manifest.json` (PLACEHOLDER if a custom domain is used).
3. Generate the upload keystore at the `signingKey.path` of `twa-manifest.json` (PLACEHOLDER). It is ignored by git: never commit `*.keystore`, `*.jks`, `*.aab` or `*.apk`.
4. Put the SHA-256 certificate fingerprint of the signing key (Play App Signing, if enabled) in `public/.well-known/assetlinks.json`, replacing the all-zero PLACEHOLDER.
5. Run `bubblewrap build` from this directory.
6. Prepare the store assets: screenshots and feature graphic (PLACEHOLDER), then paste the copy from `listing.md`.
7. Set the privacy policy URL to `https://repertoire-hero.vercel.app/privacy`.
8. Deploy, then verify `https://repertoire-hero.vercel.app/.well-known/assetlinks.json` is served before testing the app.
