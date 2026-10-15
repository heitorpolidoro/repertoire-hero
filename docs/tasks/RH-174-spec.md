# RH-174 — Update the landing page to present recently shipped features

The landing page (`src/components/landing/LandingPage.tsx`, copy in `src/i18n/dictionaries/{en,pt-BR}.json` under `landing.*`) last gained a feature card with RH-80 (offline, 2026-09-22). Since then the app shipped practice sessions, three kinds of in-app playback, a setlist player and several Fast View tools, none of which a visitor can learn about. Some existing cards now undersell or misdescribe what the app does.

## Gap analysis (landing copy vs. shipped work)

### Missing entirely

| Feature | Shipped in | Landing today |
|---|---|---|
| Practice sessions: start in due order from a playlist, the whole repertoire or a hand-picked selection; "Practised it" per song; finish with a review list that records practice and updates levels | RH-115, RH-158, RH-159, RH-168, RH-169, RH-170, RH-172 | Nothing. The page only talks about tracking a level, not about practising. |
| Listen while you read: uploaded audio player, linked YouTube video and Spotify track (Premium) playing inside Fast View | RH-149, RH-162, RH-163, RH-164 | Nothing. |
| Setlist player: "Play setlist" plays the whole queue (uploaded audio, then Spotify, then YouTube), skipping songs with no source | RH-167 | Nothing. |
| Song map (sections, bars, notes) and per-musician tuning in Fast View | RH-118, RH-146 | Nothing. |
| Installable app (PWA) | RH-78 | Nothing. Google Play (RH-81/RH-161) is still blocked, so the page must not promise a store listing. |

### Outdated or incomplete

| Card / text | Problem |
|---|---|
| `f6` "Spotify Integration" | Describes only search and import. Spotify now also plays the track in Fast View and in the setlist player. |
| `f7` "Your Setlist Works Offline" | Says "download a playlist"; RH-116 also lets a single song be downloaded from Fast View. |
| `f4` "Stage-Ready Fast View" | Lists only swipe, lyrics with chords and Stage Mode. Omits the screen staying on, arrow-key navigation, the primary file opening on arrival (RH-147/RH-148) and the links grouped by provider (RH-145). |
| `f2` "5-Stage Mastery Scale" | Still correct as a scale, but presents the level as a manual label only; since RH-158/RH-169 it is fed by practice (last practised date, levels updated in the review list). Should tie into the new practice card. |
| `subtitle` | "Catalog songs, track mastery stages, share setlists, and pull up chords & tabs" leaves out practising and listening, now the two biggest additions. |
| `f5` | Correct. Audio uploads are not mentioned, but they belong to the new "listen" card rather than here. |

### Left out on purpose

Admin catalog tools and correction review (RH-107/RH-111/RH-141/RH-156), catalog search ranking (RH-113), data-model work (RH-122 to RH-145): internal or invisible to a visitor.

## Scope

Covers: landing copy in both dictionaries and the feature grid in `LandingPage.tsx`.

- Add a **practice sessions** card and a **listen while you read** card (audio, YouTube, Spotify playback and the setlist player in one card).
- Rewrite `f6` to cover playback as well as import, `f7` to mention single-song downloads, `f4` to mention the song map, tuning, the primary file and the screen staying on, and `f2` to connect the level to practice.
- Update `subtitle` to name practising and listening.
- Mention that the app can be installed on the phone's home screen, in an existing card or the CTA subtitle, without naming any app store.

Does not cover: layout or visual redesign, screenshots, new routes, any change outside `LandingPage.tsx`, the `landing.*` keys, and the two tests that pin them (`LandingPage.test.tsx` header comment and `src/lib/__tests__/landingCopy.test.ts`).

## Approach

- New keys `landing.f8Title/f8Desc` and `landing.f9Title/f9Desc`, rendered through the existing `FeatureCard` (icons: 🔁 practice, 🎵 listen). Nine cards fill the `lg:grid-cols-3` grid evenly.
- Every `landing.*` key must differ between `en.json` and `pt-BR.json`: `src/components/landing/__tests__/LandingPage.test.tsx` relies on that to tell the two renders apart. Update the key count in its header comment.
- Copy must only claim shipped behaviour: Spotify playback says Premium is required; no Google Play or iOS claim.
- `LandingPage.tsx` must stay under its `max-lines-per-function` budget without a new `complexity-budget/override` entry (F20). If the card list pushes it over, map over a `FEATURES` array instead of adding JSX lines.

- `src/lib/__tests__/landingCopy.test.ts` must be updated: its test "the landing page renders a card for every feature key it has copy for" loops over f1..f7 and ends with `expect(source).not.toContain('f8Title')`, which fails once f8/f9 exist. Extend the loop to 1..9 and drop the f8 negation.
- Copy constraints enforced by that same file, to respect in every new or rewritten string (EN and PT):
  - No `landing.*` string may match `/moderat|moderaç|aprovaç|approval|corrig|correct/i` (so no "correct", "correctly" or "corrigir" anywhere) nor `/weakest|menor n[ií]vel|aggregate/i`.
  - `f7Title` must contain "offline"; `f7Desc` must contain "download", "playlist" and "offline" (EN) and "baix", "playlist" and "offline" (PT), even after the single-song rewrite.
  - `f1`, `f3` and `f5` have pinned wording and are not rewritten; leave them as they are.

## Expected results

- ER1: The landing page renders nine feature cards, in both `en` and `pt-BR`.
- ER2: One card describes practice sessions (start in due order or from a selection, mark as practised, finish with a review list) in both locales.
- ER3: One card describes playing a song's uploaded audio, YouTube video or Spotify track while reading it, and playing a whole setlist.
- ER4: The Spotify card mentions both importing and playback, and says playback needs Spotify Premium.
- ER5: The offline card mentions downloading a single song as well as a playlist.
- ER6: No landing copy mentions Google Play, the App Store or iOS.
- ER7: Every `landing.*` key has a different value in `en.json` and `pt-BR.json`, and both dictionaries have the same set of `landing.*` keys.
- ER8: `npm run lint`, `npm run typecheck` (or `tsc --noEmit`) and the full `npm test` vitest suite (including `landingCopy.test.ts`, updated to nine cards, and the `LandingPage` suite) pass with no new eslint override.
