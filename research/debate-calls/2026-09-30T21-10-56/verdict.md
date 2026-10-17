# Verdict 2026-09-30T21-10-56

Holdout (never shown to either agent): calls from 2026-09-29T18:00:00.000Z to 2100-01-01T00:00:00.000Z, scored on live data with the same simulator.

| Strategy | Holdout trades | Mean SOL | Trimmed mean | Total SOL | Total w/o best | Win | 5x captured | 10x captured | Research trades | Research mean | Research total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| young-token.ts — young-token: <=100 pre-call trades, tp +100% / sl -50% (live v2) | 3 | 0.08442 | 0.08442 | 0.2532 | 0.1651 | 100% | 0/1 | 0/0 | 220 | 0.02448 | 5.3867 |
| baseline-trail.ts — baseline: every call, trail 20%, stop -35% | 7 | 0.01288 | -0.00715 | 0.0902 | 0.0115 | 42.9% | 0/1 | 0/0 | 1079 | -0.00575 | -6.2072 |
| claude-r1.ts — claude-r1: stand aside (no leak-free entry beats zero on fit) | 0 | – | – | 0 | 0 | –% | 0/1 | 0/0 | 0 | – | 0 |
| claude-r2.ts — claude-r2: stand aside (no leak-free entry passes the fit gate) | 0 | – | – | 0 | 0 | –% | 0/1 | 0/0 | 0 | – | 0 |
| claude-r3.ts — claude-r3: stand aside (no leak-free entry survives validation) | 0 | – | – | 0 | 0 | –% | 0/1 | 0/0 | 0 | – | 0 |
| codex-r1.ts — codex-r1: abstain after fit-only flow and exit audit | 0 | – | – | 0 | 0 | –% | 0/1 | 0/0 | 0 | – | 0 |
| codex-r2.ts — codex-r2: completed flow <=300, stop25, trail200/40 | 1 | 0.07645 | 0.07645 | 0.0764 | 0 | 100% | 0/1 | 0/0 | 128 | 0.02252 | 2.882 |
| codex-r3.ts — codex-r3: abstain after concentration and exit checks | 0 | – | – | 0 | 0 | –% | 0/1 | 0/0 | 0 | – | 0 |

A strategy is worth a forward test only if its holdout trimmed mean is positive and it did not depend on its single best trade.
