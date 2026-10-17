# Runner study: can runners be identified early enough to trade?

**Answer on this data: runners can be ranked far better than chance, but not with certainty, and not well enough to clear costs.**
The best model-picked sets came out near break-even at best on unseen data, and every exit rule chosen on training data lost on the later window.

Data: 392,614 events in two recorded segments on 2026-09-30 (06:47–07:47 and 12:14–13:35 UTC), 507 duplicate events dropped.
Train: before 12:55 UTC. Test: after 12:55 UTC, never used for fitting or choosing anything.
Script: `scripts/research-runners.ts`. Full numbers: `results.json`.

## Method

- Every standard launch (SOL curve, not Mayhem, creation observed) is snapshotted 10, 30 and 60 s after creation, using only events received before the snapshot.
- Entry is simulated 600 ms after the snapshot with 0.1 SOL at the recorded reserves, event-derived curve fees, and 0.003 SOL fixed cost per leg.
- A **runner** is a launch that reached +50% net of all costs from that entry within 5 minutes. "hit25" means it reached +25% net.
- The model is an L2 logistic regression on 26 point-in-time features, trained on the earlier data to predict hit25.

## What made the runners (30 s snapshot, 109 runners of 2,274 launches)

| At 30 s | Runners (median) | Everything else (median) |
|---|---|---|
| SOL raised | 10.2 | 0.3 |
| Unique buyers, last 15 s | 12 | 0 |
| Holders | 22 | 1 |
| Seconds since last buy | 1.5 | 28 |
| Dev initial buy (SOL) | 0.99 | 0.15 |
| Buyers in the creation block | 4 | 1 |
| Creator's other launches in prior 24 h | 0 | 0 |

- Most launches are dead by 30 s. The median non-runner has no buys and one holder. Being alive is most of the signal.
- Launches with more creation-block buyers ran **more** often, not less: runner rate 1.3% with none, 8.2% with 2–4, 10.7% with 4+. This conflicts with the v2 rule that requires zero. Earlier shadow results showed those tokens also lose more on average, so they are higher variance, not simply worse.
- Bigger dev buys ran more often (9.9% above 1.38 SOL vs 1.5% for 0.02–0.49 SOL). Serial creators ran less often (2.3% with 2+ prior launches vs 5.7% with none).

## Can the model pick them?

| Snapshot | Test AUC, all launches | Test AUC, live launches only | Top 5% picks: reached +25% | Reached +100% |
|---|---|---|---|---|
| 10 s | 0.82 | 0.76 | 57% | 22% |
| 30 s | 0.89 | 0.68 | 41% | 16% |
| 60 s | 0.90 | 0.67 | 51% | 8% |

"Live launches" means at least 3 unique buyers in the last 15 s and a buy in the last 10 s. Among those, the base rate of reaching +25% is 22–36%, and the model adds only moderate skill.

## Does trading the picks make money?

Seven exit rules were compared on the model's top 5% of training picks. The best one on training was then applied unchanged to the top 5% of test picks (about 38 trades each):

| Snapshot | Exit chosen on training | Test expectancy SOL/trade | Test win rate |
|---|---|---|---|
| 10 s | TP +50%, stop −15%, 180 s | −0.0005 | 31% |
| 30 s | TP +35%, stop −20%, 120 s | −0.0036 | 40% |
| 60 s | TP +50%, stop −15%, 180 s | −0.0084 | 24% |

Roughly half the picks run, but the other half fall fast, often gapping through the stop, and the ~8% round-trip cost eats the rest.
A few test cells were positive (for example 30 s top 1%, 7 trades), but they are too small to mean anything, and their training counterparts were negative.

## Implications

1. "Certainty" is not available: even the top 1% of picks reached +25% only 43–57% of the time.
2. Early liveness (holders, SOL raised, buy recency) and creator history are the most useful signals, and they are cheap to compute.
3. The zero-bundle rule in v2 removes most runners along with most rugs. Whether that nets out positive needs more data.
4. Worth continuing in paper: run the 10 s model as its own shadow book so it accumulates days of out-of-sample results. Retrain only on data older than what it is scored on.

Caveats: 2.3 hours of data from one day, one recording gap, a single train/test split, entries at recorded reserves, and exits that always fill.
