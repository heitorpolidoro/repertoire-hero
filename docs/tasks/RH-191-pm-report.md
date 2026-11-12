# RH-191 — PM Split Report

Task **RH-191** ("Make offline a per-song option and setlist download a shortcut") was split into 5 PR-sized child tasks following the developer's proposed decomposition.

## Created Child Tasks

| ID | Title | Status | Priority | Blocked By | ER Count |
|---|---|---|---|---|:---:|
| RH-192 | Implement song-level offline store and no-network v6 conversion | `backlog` | medium | — | 7 |
| RH-193 | Add playlist page offline count and per-row offline marks | `backlog` | medium | RH-192 | 6 |
| RH-194 | Redesign Settings offline storage with separate Playlists and Songs lists | `backlog` | medium | RH-193 | 4 |
| RH-195 | Add offline setlists screen and cache Fast View documents on song save | `backlog` | medium | RH-194 | 4 |
| RH-196 | Implement offline queue availability and skip navigation in Fast View | `backlog` | medium | RH-195 | 4 |

### Runnable Status
- **Runnable now:** `RH-192` (`backlog`, `blockedBy: []`)
- **Waiting:**
  - `RH-193` (waiting on `RH-192`)
  - `RH-194` (waiting on `RH-193`)
  - `RH-195` (waiting on `RH-194`)
  - `RH-196` (waiting on `RH-195`)

## Expected Results Coverage

Every expected result from the original task RH-191 is covered by the created children:

| Original ER # | Description | Child Task |
|---|---|---|
| ER 1 | Exactly one song record with one set of cached bytes per version/owner context | `RH-192` (ER 1) |
| ER 2 | Single-song removal from row updates count to 4 of 5, refresh returns 5 of 5 | `RH-193` (ER 1) |
| ER 3 | Removing one song leaves other songs and lists stored | `RH-192` (ER 2) |
| ER 4 | Removing setlist deletes only unprotected songs | `RH-192` (ER 3) |
| ER 5 | Pure conversion of v6 records with throwing fetch | `RH-192` (ER 4) |
| ER 6 | Single song download failure isolates and offers "Try again" | `RH-192` (ER 5) |
| ER 7 | E2E cold reload: kept song opens, removed song shows not-downloaded | `RH-193` (ER 2) |
| ER 8 | E2E offline setlist new tab and skip navigation on ArrowRight | `RH-196` (ER 1) |

## Registry Behavior Changes

The child tasks address and update behavior documented in `docs/behavior.md`:

### Area: Offline
- **Replaces:** "Marking a playlist or a single song available offline stores a snapshot of everything readable about it..." (RH-79) → `RH-192` stores each song once per owner context, with setlists storing ordered lists.
- **Replaces:** "A single-song offline copy is stored under a record id made of the version id and band context." → `RH-192` uses this record format for all stored songs regardless of how downloaded.
- **Updates:** "The playlist page's offline control reads 'Make available offline' until downloaded..." (RH-188) → `RH-193` adds live entry counts (`N of M songs`), "Download N missing songs", and per-row marks.
- **Updates:** "Settings lists the stored offline copies and lets the user remove them." → `RH-194` splits into separate Playlists and Songs lists with deduplicated storage totals.
- **Adds:** Removing one stored song keeps every playlist's list and lowers its count (`RH-192`).
- **Adds:** Once a playlist is downloaded or holds a stored song, each row shows an offline mark and allows row removal (`RH-193`).
- **Adds:** Removing a downloaded playlist deletes only unprotected songs (`RH-192`).
- **Adds:** A song failing during download does not abort the setlist download (`RH-192`).
- **Adds:** Copies stored before RH-191 are converted with no network access (`RH-192`).
- **Adds:** `/offline` screen lists downloaded setlists in order and opens stored songs into setlist queue (`RH-195`).
- **Adds:** Storing a song caches its Fast View document in page cache (`RH-195`).

### Area: Fast View and queue
- **Updates:** "Users move through the queue by swipe, arrow keys or the setlist list..." → `RH-196` makes offline movement skip unavailable songs and marks unavailable entries in drawer, sidebar, and select.
