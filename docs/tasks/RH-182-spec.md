# RH-182 — Count whole calendar days in the practice order

## Scope
`orderForPractice` measures "days since last practised" as fractional days (milliseconds over 86 400 000). Rehearsals are a per-day event, so the hour should not matter: two songs practised on the same day at the same level do not tie today when their timestamps differ, and the same song's urgency drifts with the hour the session is started.

This task replaces the fractional measure with **whole calendar days** in the band's time zone, `America/Sao_Paulo`: the number of calendar dates between the date of `last_practiced` and the date of `now`, both read in that zone. Practised today is 0, yesterday is 1, and so on, whatever the hour.

Not covered: the interval table, `MAX_DUE_RATIO`, the "always due" rule for unassessed and never-practised songs, near-tie handling, per-user or per-band time zones, and any write path.

## Approach
Behavior:
- `days = calendarDate(now) − calendarDate(lastPracticed)`, both as `YYYY-MM-DD` in `America/Sao_Paulo`, as an integer. A future `lastPracticed` gives a negative count, as the fractional measure did.
- The ratio stays `min(days ÷ interval, MAX_DUE_RATIO)`. Unassessed, absent-row, never-practised and unparseable dates keep `Infinity`.
- Songs at one level practised on the same local date tie exactly and are shuffled, whatever their hours.
- The boundary is local midnight: 23:59 and 00:01 São Paulo time on consecutive dates are 1 day apart even though they are 2 minutes apart.

Files touched:
- `src/lib/practiceOrder.ts` — export `PRACTICE_TIME_ZONE = 'America/Sao_Paulo'`; compute calendar days with `Intl.DateTimeFormat` (no new dependency); update the header comment.
- `src/lib/__tests__/practiceOrder.test.ts` — replace the "uses fractional days" case; adjust any case whose half-interval offset now rounds onto another date; add the cases below.
- `docs/use-cases.md` § *Start a practice session* and `docs/behavior.md` — state whole calendar days in São Paulo time.

Test criteria:
- Two learning songs practised 08:00 and 22:00 São Paulo time on the same date tie exactly; across seeds both orders appear.
- 23:59 and 00:01 São Paulo time on consecutive dates differ by one day.
- A song practised earlier today has ratio 0 and ranks below one practised yesterday at the same level.
- The date boundary is São Paulo's, not UTC's: 22:00 São Paulo (01:00 UTC next day) counts on the São Paulo date.
- Cap, always-due group, input immutability and existing tie-shuffle tests still pass.

## Behavior changes
- changed: Practice and status — Practice order counts whole calendar days in São Paulo time since last practised, divided by the level's interval, capped at twice overdue, highest first. (RH-182)

## Expected Results
- [ ] Two songs at one level whose `lastPracticed` falls on the same São Paulo date at different hours tie exactly in `orderForPractice`, and across seeded `random` values either can come first.
- [ ] `lastPracticed` at 23:59 and at 00:01 São Paulo time on consecutive dates are one day apart: at learning level the older one ranks first.
- [ ] A learning song practised at 22:00 São Paulo time (01:00 UTC the next day) counts as that São Paulo date, not the UTC date.
- [ ] `PRACTICE_TIME_ZONE` is exported from `src/lib/practiceOrder.ts` as `'America/Sao_Paulo'`, and `practiceOrder.test.ts` passes with no fractional-day case left.
- [ ] `docs/use-cases.md` and `docs/behavior.md` state whole calendar days in São Paulo time, and `npm run lint` and `npx tsc --noEmit` pass.

## Out of Scope
Configurable time zones, interval or cap changes, UI changes.
