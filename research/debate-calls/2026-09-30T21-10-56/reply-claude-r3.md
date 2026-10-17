I wrote `proposals/claude-r3.ts` and ran it through the referee on the full snapshot: 0 trades, so every metric is 0 or undefined. It stands aside for the third time. The scripts are in `work/`. Run them from the repo root with `npx tsx research/debate-calls/2026-09-30T21-10-56/work/r3.ts` and `.../work/r3c.ts`; the output is in `r3.out` and `r3c.out`.

**Rebutting Codex r2 (`r3.ts`, part A).** I ran 30 variants around Codex's rule: trade-count cap 150–500 times stop 20–50%, with the same trailing exit (arm +200%, trail 40%).
- **Concession:** my round-2 claim that nothing leak-free passes the fit gate is wrong. Caps 300–500 with stops of 20–35% pass it (n 60–96, trimmed +0.0015 to +0.0100). Codex found one example of a wider pattern, not a single lucky setting.
- **But none of the 30 survives later data.** Validation trimmed mean is negative in all 30 (n 24–76), and so is test (only cap 500 reaches 30 trades on test).
- **The tighter stop is not a stable improvement.** Codex's own paired table shows −0.09 SOL on validation (n 52). Across my variants the validation effect has no consistent direction: at cap 250 the −50% stop beats −25% (total +1.03 vs +0.74).
- **One caller carries fit.** Excluding caller_03 leaves 50 trades at trimmed −0.0148 (Codex's report). At its best, the rule beats zero on fit only.

**Token age (`r3.ts`, part B).** I measured age from the first finished order-flow bar, with thresholds set before running. Age ≤30/60/120 min gives fit n 359–482 and trimmed mean −0.017 to −0.025. It is negative on every split under both the live exit and the trailing exit. Most calls are already on tokens under 30 minutes old, so age doesn't separate winners.

**The live rule measured without the leak (`r3c.ts`).** I counted youth from finished pre-call flow bars, which the live bot effectively sees:
- **Coverage:** only 24/15/5 calls (fit/validation/test) have ≤100 trades, against 110/73/37 entries for the backtested rule. That backs up Codex's audit (182/185 empty event lists had >100 real trades).
- **P&L:** with the live exit (+100%/−50%) it is negative on every split and −0.72 SOL pooled over 44 trades. Every split is under 30 trades, so this is descriptive only.
- **For the user:** live, the rule should trade about one-fifth as often as its backtest suggests, with no measured edge on those trades.

**What I concede:** neither of us beats the live rule's snapshot numbers on all three splits. Standing aside catches none of the 116 tokens that ran 5x.

**What I still dispute:**
1. **Scoring the holdout on after-the-fact events.** `preTrades` is fetched after the fact, so the same 220-vs-44 gap will show up in the forward sample. Referee: please score youth on the finished `ctx.flow` count or on the count the bot logged at the call.
2. **That Codex r2 has an edge.** Every variant that passes on fit fails validation.

**Why standing aside should win on unseen calls:** across three rounds, about 70 leak-free variants and 30 feature quintiles have been tested. Every one that looked good on fit lost on validation, so zero is the best supported expected value until the forward holdout shows otherwise.
