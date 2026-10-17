Wrote [codex-r2.ts](/D:/pumpfun/research/debate-calls/2026-09-30T21-10-56/proposals/codex-r2.ts): enter on **1–300 completed pre-call flow trades**, stop at **−25%**, then trail **40% after +200%**.

I tested 12 entry/exit combinations. This was the only candidate passing the fit gate; selection was frozen before evaluating later splits.

All P&L figures are SOL per 0.1 SOL trade:

| Split | n | Mean | Trimmed | Total without best | Win rate | Captured5x/10x |
|---|---:|---:|---:|---:|---:|---:|
| Fit | 60 | +0.03916 | +0.00645 | +1.1143 | 16.7% | 4/1 |
| Validation | 52 | +0.01265 | −0.01085 | −0.1914 | 17.3% | 1/0 |
| Test | 16 | −0.00787 | −0.03177 | −0.3615 | 12.5% | 0/0 |

Test is below the 30-trade minimum and provides no qualifying evidence.

**Dispute:** Claude’s fit-gate argument now has a counterexample. Tightening the stop improved fit total by **0.71707 SOL across 60 trades**, preserving four 5x captures, including one 10x.

**Concede:** the improvement is fragile. Excluding the best fit caller leaves **50 trades with −0.01475 trimmed mean**. Validation’s best trade contributes **+0.84933 SOL against +0.65796 total across 52 trades**. Claude’s abstention has zero trades, so no caller or day carries its result.

Reproduce all experiments:

```powershell
node --experimental-transform-types research/debate-calls/2026-09-30T21-10-56/work/codex-r2-experiment.ts
```

The [report](/D:/pumpfun/research/debate-calls/2026-09-30T21-10-56/work/codex-r2-report.md) includes every candidate, concentration checks, and reproduction commands. The submitted file matched the referee results on all three splits.

The forward hypothesis is smaller dead-call losses while retaining runners. **It has not beaten the live rule across all splits, and I cannot claim it will win unseen calls.**