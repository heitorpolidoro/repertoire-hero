# RH-177 — Learning songs always come first in the practice order

## Scope
Today `orderForPractice` ranks by `days since last practised ÷ interval`. Learning has a 1-day interval, so after a normal weekly rehearsal gap it scores ~7 while a practicing song scores ~2.3 and the rest below 1: learning songs always lead the queue and the other levels never interleave with them.

The task title is a complaint without a stated target, so this spec takes the smallest change that stops the domination without inventing weights: **cap the urgency ratio** at a named ceiling (`MAX_DUE_RATIO = 2`, "twice overdue is as urgent as it gets"). Every song at or past the ceiling forms one exact-tie group, which the existing uniform shuffle mixes across levels. Below the ceiling the order is unchanged.

Not covered: changing the interval table, the "always due" rule for unassessed / never-practised songs (they stay above every finite ratio), near-tie handling, session sources, or any write path.

## Approach
Behavior:
- A song's ratio is `min(days ÷ interval, MAX_DUE_RATIO)` for assessed, practised songs. Unassessed and never-practised songs keep `Infinity` and still rank first.
- Songs with a capped ratio tie exactly, whatever their level, and are shuffled together through the injected `random`. Songs below the cap keep ratio order (near-ties are not shuffled).
- Example at a 7-day gap: learning and practicing (both capped) mix; polishing (0.5) and mastered (0.33) follow in that order.

Files touched:
- `src/lib/practiceOrder.ts` — add the exported `MAX_DUE_RATIO` constant, apply the cap in `dueRatio`, update the header comment.
- `src/lib/__tests__/practiceOrder.test.ts` — new cases below; adjust any existing case that expects a learning song to outrank an over-ceiling song of another level.
- `docs/use-cases.md` § *Start a practice session* — replace "anything being learned returns almost every session" with the cap rule.
- `docs/behavior.md` — update the practice-order lines (see below).

Test criteria:
- Learning practised 7 days ago and practicing practised 7 days ago tie; with a seeded `random` both orders appear across seeds.
- A capped learning song does not always precede a capped practicing song across a range of seeds.
- Below the cap (e.g. practicing at 3 days = 1.0 vs learning at 0.5 day = 0.5) order is still by ratio.
- Never-practised and `unknown`/absent-row songs still precede every capped song.
- Input is not mutated; existing tie-shuffle tests still pass.

## Behavior changes
- changed: Practice and status — Practice order is days since last practised divided by the level's interval, capped at twice overdue, highest first. (RH-177)
- changed: Practice and status — Exact ties in practice order, including every song at the cap, are broken at random. (RH-177)

## Expected Results
- [ ] A learning song and a practicing song both last practised 7 days ago are an exact tie in `orderForPractice`, and across seeded `random` values either can come first.
- [ ] Below the cap the order is unchanged: ratio 1.0 outranks ratio 0.5 regardless of level.
- [ ] Unknown, absent-row and never-practised songs still rank above every practised song.
- [ ] `MAX_DUE_RATIO` is exported from `src/lib/practiceOrder.ts` and the updated `practiceOrder.test.ts` passes.
- [ ] `docs/use-cases.md` and `docs/behavior.md` state the cap, and `npm run lint` and `npx tsc --noEmit` pass.

## Out of Scope
Interval table changes, UI changes, per-user tuning of the ceiling.
