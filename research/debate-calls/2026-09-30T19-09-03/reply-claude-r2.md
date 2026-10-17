I wrote `proposals/claude-r2.ts`. **I concede: the right move is to not trade these calls.** Every rule I tested loses money on both halves of the data, and the referee scores the proposal at n=0 and 0 SOL on both.

**What I tested.** `work/r2-table.ts` buys every call. It computes call-time features only from pre-call bars that had finished before the call, which fixes the lookahead Codex found. It records the referee's P&L for 7 exits at 0.1 and 0.2 SOL. `work/r2-slice.ts` then tests 47 filters (liquidity, 5/15/60-min run-up, volume, distance from the 1 h high, venue, hour of day, caller hit rates) against those 14 exit/size settings. Run both with `npx tsx research/debate-calls/2026-09-30T19-09-03/work/r2-….ts`.

- **Nothing was positive on the fit half.** No filter-exit pair reached a positive trimmed mean with at least 30 trades. The best was a 15-minute run-up of 5.58x or more, selling at +50% or −30%: −0.0036 fit (n=145) and −0.0051 validation (n=93).
- **Buying everything loses.** The +50%/−30% exit returns −0.0120 trimmed on fit (n=574) and −0.0121 on validation (n=351).
- **My round-1 rule loses once the lookahead is fixed.** It returns −0.0085 on fit (n=222) and −0.0051 on validation (n=115), the same as Codex's numbers. Codex was right about the lookahead.

**Why a bigger size doesn't help.** Each trade pays 0.006 SOL in fixed charges (6% at 0.1 SOL), so buying 0.2 SOL should help if costs were the only problem. It makes things worse instead. With +30%/−20% on tokens with at least $12.6K of liquidity, trimmed mean falls from −0.0101 to −0.0147 (n=145). Price impact there is only about 0.4% per side, so the calls lose money even before costs.

**What I concede:**
1. The lookahead was real.
2. Price and volume after the call don't pick out runners. My `features.ts` and Codex's 75 rules agree on this.
3. Run-up before the call is the only effect that held on both halves, and it still loses.

**On the user's belief:** the claim that catching a few 5x–10x moves carries the book is refuted. Codex's 12x-target test captured 18 moves of 10x on fit and 13 on validation. It still lost 19.95 SOL (n=574) and 11.52 SOL (n=351).

**What I dispute:** only the framing. Not trading scores 0 by construction, so if the holdout ties the two of us, that says nothing about edge. The result to give the user is a joint one: "don't trade these calls." It shouldn't be read as either side winning.

**Why this should hold on unseen calls:** none of the roughly 650 filter-exit combinations I tested is positive, and neither was any of Codex's 75 rules. The calls lose before costs, and they lose at both sizes. In the file I set when trading would be worth trying again: a live-feasible rule with a positive trimmed mean on both halves, at least 30 trades each, not carried by one caller or one week. I would switch only if Codex brings one in round 3.
