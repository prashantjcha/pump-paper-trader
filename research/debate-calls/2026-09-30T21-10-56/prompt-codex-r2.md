# Call-strategy debate 2026-09-30T21-10-56

You are one of two researchers (Claude and Codex) arguing, with data, about how to trade the calls posted in a Telegram group
("Degen Diamonds"). Each call is a Solana token address posted by a human caller. The book buys 0.1 SOL per token.

## Goal
A new strategy is now being paper-traded live on every book: buy a call only if the token had at most 100 trades before the
call, exit at +100% or -50% (research/debate-calls/examples/young-token.ts). Your job: improve its entry and exit using what
separates runners from dead calls (wallets, holders, order flow, price), or show that it cannot be improved and defend it.
The user wants to catch the 5x-10x runners while limiting losses on the ones that die.

## What is already known (research/runner-features-2026-09-30/REPORT.md, research/calls-2026-09-30/REPORT.md)
- Most calls collapse (median 0.41x after 1 h). Buying every call lost money in every study; speed alone did not help.
- Calls on very young tokens (few pre-call trades) are where the edge is. Features that separated 3x runners in both
  periods: more brand-new wallets buying in the hour before the call, lower buy/sell USD ratio (not already bought up),
  low top-holder concentration, few buyers in the launch block, few trades/holders, big buys (>= $500) before the call.
- A logistic model on ~40 such features reached AUC 0.75 (validation) / 0.83 (recent), and "young AND model top 20%"
  did slightly better than the young rule alone.
- Referee numbers for the live rule (trimmed mean SOL per 0.1 SOL trade): fit +0.014 (110 trades), 18-26 Sep +0.036 (73),
  26-29 Sep +0.021 (37). The 18-26 Sep window has been used as validation by many studies; treat it as partly seen.

## Data you may use (sealed snapshot: 1312 calls on 1085 tokens, ending 2026-09-29T18:00:00.000Z)
- research/debate-calls/2026-09-30T21-10-56/data/pumpfun.db: table manual_signals (mint, caller, call_ms, msg_text).
- research/debate-calls/2026-09-30T21-10-56/data/ohlcv/<mint>/: codex_m1_*.json / codex_m15_*.json price bars; codex_events_pre.json (every trade before the call:
  [unix_s, side +1/-1, maker, usd, tokens, walletAgeSeconds, wash, sandwich, block]); codex_flow_m1.json (minute bars with
  buys, sells, buyers, sellers, buy/sell USD volume, 6 h before to ~19 h after the call); codex_h1.json hourly bars.
- The simulator already hands your strategy ctx.preTrades (trades before the call), ctx.preTradesComplete and ctx.flow
  (order-flow bars finished by the current bar). Use those rather than reading files inside the strategy.
- Do NOT read data/ (live directory) or anything dated after the snapshot. The winner is decided on calls made AFTER the
  snapshot (a true forward holdout), scored by the runner once they have 24 h of data.

## Tools
- Evaluate any strategy on the snapshot with the exact referee simulator:
  `npx tsx scripts/calls-eval.ts <strategy.ts> --data research/debate-calls/2026-09-30T21-10-56/data [--from ISO] [--to ISO] [--trades N]`
  It feeds bars one at a time (no lookahead): entry and custom-exit decisions at a bar's close fill at the next bar's open; policy stops act inside bars (stop first).
  Costs: venue fee per side, 0.003 SOL fixed per leg, price impact from each bar's liquidity. Horizon 24 h after the call.
- Strategy interface and context fields: scripts/lib/callsSim.ts (CallStrategy, CallCtx, HoldCtx, PreTrade, FlowBar). Shared exit policies: packages/core/src/callPolicy.ts.
- Examples: research/debate-calls/examples/young-token.ts (the live rule), baseline-trail.ts, volume-breakout.ts.
- Put analysis scripts in research/debate-calls/2026-09-30T21-10-56/work/. Do not edit files outside research/debate-calls/2026-09-30T21-10-56.

## Rules of engagement
1. Use three splits inside the snapshot: fit before 2026-09-18, validate 2026-09-18 to 2026-09-26, test 2026-09-26 onward. Choose on fit, report all three with n.
2. Report mean, trimmed mean, total without best, win rate, and captured5x / captured10x.
3. Every claim needs a number, its sample size and the command that produced it. Ignore effects with fewer than 30 trades.
4. Attack the other side's latest proposal: which trades carry it, does it hold on every split, is it one caller or one lucky day, how many knobs were tuned.
5. Concede when the evidence beats yours. Do not agree without evidence. Beating the live rule on all three splits is the bar.
6. Keep strategies simple enough to run live: use only ctx fields (bars up to the current one, pre-call trades, finished flow bars, caller history, call time). Fewer parameters beat more.

## Your output each turn
- Write your current strategy to research/debate-calls/2026-09-30T21-10-56/proposals/<you>-r<round>.ts (default export implementing CallStrategy; import types from "../../../../scripts/lib/callsSim.ts").
- End with a message under 400 words: what you tested, the numbers, what you concede, what you dispute, and why your strategy should win on unseen calls.

## Your turn: Codex, round 2 of 3
Read research/debate-calls/2026-09-30T21-10-56/transcript.md and Claude's latest file in research/debate-calls/2026-09-30T21-10-56/proposals/.
Rebut Claude's latest strategy with experiments, then improve yours.

Write research/debate-calls/2026-09-30T21-10-56/proposals/codex-r2.ts, then end with your message.
