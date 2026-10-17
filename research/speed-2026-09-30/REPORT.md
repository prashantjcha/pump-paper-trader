# Speed test: does buying 1–2 seconds after a call make this group profitable?

**No.** With 1-second data on 1,073 calls (702 for the five selected callers), buying 1, 2, 5, 10, 30 or 60 seconds after the
message loses at every delay. No exit rule was positive on the validation period at any delay, even picked with hindsight.

Scripts: `scripts/calls-fetch-seconds.ts`, `scripts/research-speed.ts`. Results: `results.json`, `five-callers/results.json`.
Data: Codex 1-second bars from 60 s before to ~24 min after each token's first call, then 1-minute bars to 24 h.
Entry at the open of the first 1-second bar at or after call + delay. Same costs as the other studies (venue fee per side,
0.003 SOL fixed per leg, impact from minute-bar liquidity). 27 exit rules built for fast trades. Fit before 18 Sep,
validation 18–26 Sep, recent 26–29 Sep.

## What price does in the seconds after a call (entry 1 s after the message)

| After entry | Median price vs entry | 75th percentile | Median best price so far | Share above entry |
|---|---|---|---|---|
| 5 s | 1.000 | 1.029 | 1.012 | 51% |
| 30 s | 1.002 | 1.077 | 1.050 | 51% |
| 60 s | 1.001 | 1.123 | 1.085 | 51% |
| 2 min | 0.998 | 1.153 | 1.127 | 49% |
| 5 min | 0.939 | 1.197 | 1.213 | 42% |
| 15 min | 0.713 | 1.054 | 1.309 | 29% |

- There is no systematic pump after the message. The median token is flat for two minutes, a coin flip, then starts to fall.
- Some of the move comes before the message: the first trade after the call is a median 2.5% above the price 30 s earlier,
  and 59% of tokens were already rising (the caller or faster readers bought first).
- The five selected callers look the same (flat for 2 minutes, 0.76x after 15 minutes).

## Results by entry delay (exit chosen on fit, scored on later periods; SOL per 0.1 SOL trade, trimmed mean)

| Delay | Exit chosen on fit | Fit | Validation (n) | Recent (n) | Exits positive on validation |
|---|---|---|---|---|---|
| 1 s | hold 2 min | −0.0056 | −0.0103 (347) | −0.0107 (154) | 0 of 27 |
| 2 s | hold 2 min | −0.0057 | −0.0105 (347) | −0.0107 (154) | 0 of 27 |
| 5 s | hold 2 min, stop −25% | −0.0061 | −0.0094 (347) | −0.0108 (154) | 0 of 27 |
| 10 s | hold 2 min, stop −15% | −0.0062 | −0.0089 (348) | −0.0110 (154) | 0 of 27 |
| 30 s | hold 2 min | −0.0075 | −0.0099 (346) | −0.0082 (154) | 0 of 27 |
| 60 s | trail 15% from entry, stop −25% | −0.0072 | −0.0092 (343) | −0.0072 (154) | 0 of 27 |

Five callers: the same picture (validation −0.005 to −0.011 per trade; 0 of 27 positive at every delay).

The losses (about −0.006 to −0.011 SOL per trade) are close to the round-trip cost (~0.0095 SOL at 0.1 SOL): before costs
these calls have roughly zero edge in the first minutes, whatever the entry speed.

## Caveats

- The simulation assumes a buy at the first trade price at the chosen second. A real transaction lands later and competes with
  everyone else reacting to the same message, so real results would be no better than these.
- Codex's 1-second bars aggregate all pools; costs are approximated by mint type.
