# Call-strategy debate 2026-09-30T19-09-03

You are one of two researchers (Claude and Codex) arguing, with data, about how to trade the calls posted in a Telegram group
("Degen Diamonds"). Each call is a Solana token address posted by a human caller. The book buys 0.1 SOL per token.

## Goal
Find entry and exit behaviour that is profitable after costs. The user believes chart movement and volume after the call reveal
the runners, and that catching a couple of 5x-10x moves can carry the book. Test that belief hard: find the pattern if it exists,
and say so plainly if it does not.

## What is already known (research window, from research/calls-2026-09-30/REPORT.md)
- Median price vs entry: 0.41x after 1 h, 0.26x after 6 h, 0.20x after 24 h. Most calls collapse fast.
- 35% of calls reach 2x, 12% reach 5x, 5% reach 10x within 72 h; the biggest peaks (up to ~600x) are real (volume and liquidity back them).
- Buying every call and exiting with fixed or trailing stops lost money out of sample. A 20% trail captured none of the 96 tokens that ran 5x.
- Earlier selections were fooled by one or two outlier trades. Judge with the trimmed mean (two best trades dropped) and "total without best".

## Data you may use (sealed snapshot: 1116 calls on 931 tokens, ending 2026-09-26T00:00:00.000Z)
- research/debate-calls/2026-09-30T19-09-03/data/pumpfun.db: table manual_signals (mint, caller, call_ms, msg_text).
- research/debate-calls/2026-09-30T19-09-03/data/ohlcv/<mint>/codex_m1_*.json and codex_m15_*.json: {"bars": [[unix_s, open, high, low, close, volume_usd, liquidity_usd], ...]} (USD, token-level, all pools).
- Do NOT read data/ (live directory), research/calls-2026-09-30/results.json, or anything dated after the snapshot. A sealed holdout of later calls decides the winner.

## Tools
- Evaluate any strategy on the snapshot with the exact referee simulator:
  `npx tsx scripts/calls-eval.ts <strategy.ts> --data research/debate-calls/2026-09-30T19-09-03/data [--from ISO] [--to ISO] [--trades N]`
  It feeds bars one at a time (no lookahead): entry and custom-exit decisions at a bar's close fill at the next bar's open; policy stops act inside bars (stop first).
  Costs: venue fee per side, 0.003 SOL fixed per leg, price impact from each bar's liquidity. Horizon 24 h after the call.
- Strategy interface and context fields: scripts/lib/callsSim.ts (CallStrategy, CallCtx, HoldCtx). Shared exit policies: packages/core/src/callPolicy.ts.
- Examples: research/debate-calls/examples/baseline-trail.ts and volume-breakout.ts.
- Put analysis scripts in research/debate-calls/2026-09-30T19-09-03/work/. Do not edit files outside research/debate-calls/2026-09-30T19-09-03.

## Rules of engagement
1. Split the research window: fit on calls before 2026-09-18, validate on 2026-09-18 to 2026-09-26. Report both, with n.
2. Report mean, trimmed mean, total without best, win rate, and how many 5x / 10x moves were actually realized (captured5x / captured10x).
3. Every claim needs a number, its sample size and the command that produced it. Ignore effects with fewer than 30 trades.
4. Attack the other side's latest proposal: which trades carry it, does it survive the validation split, is it just one caller or one lucky week.
5. Concede when the evidence beats yours. Do not agree without evidence.
6. Keep strategies simple enough to run live: they may only use bars up to the current one, caller history (callerStats), and the call time.

## Your output each turn
- Write your current strategy to research/debate-calls/2026-09-30T19-09-03/proposals/<you>-r<round>.ts (default export implementing CallStrategy; import types from "../../../../scripts/lib/callsSim.ts").
- End with a message under 400 words: what you tested, the numbers, what you concede, what you dispute, and why your strategy should win on unseen calls.

## Your turn: Claude, round 3 of 3
Read research/debate-calls/2026-09-30T19-09-03/transcript.md and Codex's latest file in research/debate-calls/2026-09-30T19-09-03/proposals/.
Rebut Codex's latest strategy with experiments, then improve yours.
Final round: submit your best strategy and state plainly where you still disagree.
Write research/debate-calls/2026-09-30T19-09-03/proposals/claude-r3.ts, then end with your message.
