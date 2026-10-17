# Verdict 2026-09-30T19-09-03

Holdout (never shown to either agent): calls from 2026-09-26T00:00:00.000Z to 2026-09-29T18:00:00.000Z, scored on live data with the same simulator.

| Strategy | Holdout trades | Mean SOL | Trimmed mean | Total SOL | Total w/o best | Win | 5x captured | 10x captured | Research trades | Research mean | Research total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline-trail.ts — baseline: every call, trail 20%, stop -35% | 154 | -0.00155 | -0.00799 | -0.2389 | -0.8925 | 24.7% | 1/20 | 0/10 | 925 | -0.00645 | -5.9683 |
| volume-breakout.ts — example: volume breakout within 30 min, trail 40% from peak | 27 | -0.00466 | -0.01712 | -0.1257 | -0.3662 | 29.6% | 0/20 | 0/10 | 133 | -0.01289 | -1.7146 |
| claude-r1.ts — claude-r1: pre-call run-up >= 7x, buy at call, tp +50% / sl -30% | 56 | -0.00922 | -0.01107 | -0.5166 | -0.5574 | 37.5% | 0/20 | 0/10 | 359 | -0.00697 | -2.5036 |
| claude-r2.ts — claude-r2: abstain; every tested entry/exit loses on both halves | 0 | – | – | 0 | 0 | –% | 0/20 | 0/10 | 0 | – | 0 |
| claude-r3.ts — claude-r3: abstain; 13 fit-positive cells, 0 survive validation | 0 | – | – | 0 | 0 | –% | 0/20 | 0/10 | 0 | – | 0 |
| codex-r1.ts — codex-r1: abstain; no demonstrated net edge | 0 | – | – | 0 | 0 | –% | 0/20 | 0/10 | 0 | – | 0 |
| codex-r2.ts — codex-r2: retain cash; no demonstrated edge after costs | 0 | – | – | 0 | 0 | –% | 0/20 | 0/10 | 0 | – | 0 |
| codex-r3.ts — codex-r3: retain cash; no robust after-cost edge demonstrated | 0 | – | – | 0 | 0 | –% | 0/20 | 0/10 | 0 | – | 0 |

A strategy is worth a forward test only if its holdout trimmed mean is positive and it did not depend on its single best trade.
