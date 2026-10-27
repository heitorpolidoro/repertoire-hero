---
name: repertoire-hero
description: Manage songs, tunings, pedalboard presets, and tab charts on Repertoire Hero
---

# Repertoire Hero Agent Skill

Use this skill to interact with the user's Repertoire Hero account through the `/api/v1` REST API.

## Authentication & Configuration

The API requires a personal access token passed in the `Authorization` header:

- Read the base URL from the `REPERTOIRE_HERO_URL` environment variable (default: `http://localhost:3000`).
- Read the token **only** from the `REPERTOIRE_HERO_TOKEN` environment variable. Never ask the user to paste their token into the chat.
- Requests must include the header:
  `Authorization: Bearer $REPERTOIRE_HERO_TOKEN`

## Workflow: Search → Read → Write

1. **Search**: Find the song version in the user's repertoire with `GET /api/v1/songs?q=...`.
2. **Read**: Inspect song details, tuning, and custom field values with `GET /api/v1/songs/{versionId}`.
3. **Write**: Update the song tuning override, set custom field values (e.g. Preset), or upload tab files.

## Endpoints

### GET /api/v1/songs

Searches the token user's personal repertoire. Returns at most 50 songs matching the optional query `q` (matched against title or artist, case-insensitive). Requires scope `read`.

```bash
curl -s -H "Authorization: Bearer $REPERTOIRE_HERO_TOKEN" \
  "$REPERTOIRE_HERO_URL/api/v1/songs?q=comfortably"
```

Response:
```json
[
  {
    "versionId": "b18a1a2e-4b21-4d1a-8c87-9b2f29e3a6a1",
    "songId": "a18a1a2e-4b21-4d1a-8c87-9b2f29e3a6a0",
    "title": "Comfortably Numb",
    "artist": "Pink Floyd",
    "versionLabel": null,
    "status": "learning",
    "tuning": "Drop D"
  }
]
```

### GET /api/v1/songs/{versionId}

Retrieves full details for any existing version, whether or not it is in the user's repertoire. Returns title, artist, status, key, tuning, and all custom fields with the user's values. Requires scope `read`.

```bash
curl -s -H "Authorization: Bearer $REPERTOIRE_HERO_TOKEN" \
  "$REPERTOIRE_HERO_URL/api/v1/songs/b18a1a2e-4b21-4d1a-8c87-9b2f29e3a6a1"
```

Response:
```json
{
  "versionId": "b18a1a2e-4b21-4d1a-8c87-9b2f29e3a6a1",
  "songId": "a18a1a2e-4b21-4d1a-8c87-9b2f29e3a6a0",
  "title": "Comfortably Numb",
  "artist": "Pink Floyd",
  "inRepertoire": true,
  "status": "learning",
  "key": "Bm",
  "tuning": "Drop D",
  "customFields": [
    {
      "name": "Preset",
      "value": "Lead 3B"
    }
  ]
}
```

### GET /api/v1/custom-fields

Lists the names of all custom fields defined by the token user, in display order. Requires scope `read`.

```bash
curl -s -H "Authorization: Bearer $REPERTOIRE_HERO_TOKEN" \
  "$REPERTOIRE_HERO_URL/api/v1/custom-fields"
```

Response:
```json
[
  { "name": "Preset" }
]
```

### PUT /api/v1/songs/{versionId}/tuning

Sets the user's tuning override on a version held in their repertoire. The version must already be in the user's repertoire (returns 404 if not held). Overrides only the user's personal row and leaves the catalog version unchanged. To clear the override, pass `null` or empty string. Requires scope `write:songs`.

```bash
curl -s -X PUT -H "Authorization: Bearer $REPERTOIRE_HERO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tuning": "Drop D"}' \
  "$REPERTOIRE_HERO_URL/api/v1/songs/b18a1a2e-4b21-4d1a-8c87-9b2f29e3a6a1/tuning"
```

Response:
```json
{
  "tuning": "Drop D"
}
```

### PUT /api/v1/songs/{versionId}/custom-fields/{fieldName}

Sets the user's custom-field value for the version. Accepts any existing version (held or not held; does not create a repertoire row). Field name matching is case-insensitive (e.g. `preset` matches `Preset`). To clear the value, pass an empty string `""`. Requires scope `write:songs`.

```bash
curl -s -X PUT -H "Authorization: Bearer $REPERTOIRE_HERO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "Lead 3B"}' \
  "$REPERTOIRE_HERO_URL/api/v1/songs/b18a1a2e-4b21-4d1a-8c87-9b2f29e3a6a1/custom-fields/preset"
```

Response:
```json
{
  "field": "Preset",
  "value": "Lead 3B"
}
```

### POST /api/v1/tabs

Uploads a local tab file (PDF, PNG, JPEG, WebP) for a song version. Creates a `song_files` row owned by the token user, and if the user did not hold the song in their repertoire, automatically creates a personal repertoire row with status `unknown`. Requires scope `write:tabs`.

Note: The maximum upload file size is 10 MB (note: serverless hosted function request bodies may be capped at 4.5 MB).

```bash
curl -s -X POST -H "Authorization: Bearer $REPERTOIRE_HERO_TOKEN" \
  -F "versionId=b18a1a2e-4b21-4d1a-8c87-9b2f29e3a6a1" \
  -F "title=Guitar Solo Tab" \
  -F "file=@/path/to/chart.pdf" \
  "$REPERTOIRE_HERO_URL/api/v1/tabs"
```

Response (HTTP 201):
```json
{
  "id": "c18a1a2e-4b21-4d1a-8c87-9b2f29e3a6a2",
  "title": "Guitar Solo Tab",
  "contentType": "application/pdf",
  "createdInRepertoire": false
}
```

## Error Handling

All errors return JSON with an `"error"` message:

| Status Code | Description | Example Message |
| ----------- | ----------- | --------------- |
| 400 | Bad request / validation failure | `{"error": "Tuning is at most 40 characters"}` |
| 401 | Missing, malformed, revoked, or expired token | `{"error": "Missing or invalid API token"}` |
| 403 | Token lacks the required scope | `{"error": "This token lacks the write:songs scope"}` |
| 404 | Resource not found | `{"error": "Song version not found"}` |
| 500 | Internal server error | `{"error": "Internal error"}` |
