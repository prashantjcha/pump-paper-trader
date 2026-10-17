# Letting an LLM retune a trading agent: hard limits, unseen data, automatic rollback

*Prashant Chauhan · October 2026*

I built a paper-trading agent for brand-new pump.fun tokens and let Claude rewrite its trading rules. This is about as adversarial as data gets: most launches are rugs, insiders exit within seconds, and almost any backtest can be made to look profitable. That made it a good place to test a narrower question than "can an LLM trade?": **if you let a model change an agent's behaviour, how do you keep a confident and wrong model from making it worse?**

Below are the guardrails I used, the one time they caught a real error (made by me, not the model), and what I'd change.

## The setup

- The bot watches every launch and trade on the bonding curve and paper-trades several strategy "books" with 1 SOL each.
- **It cannot spend money.** There are no private keys in the codebase, and nothing is ever signed or sent. Moving to live trading would be a separate, reviewed change. This is the first guardrail and the most important one: the worst a bad decision can do is lose paper money.
- Fills are deliberately pessimistic. A decision at time *t* fills at *t* + 600 ms against the real reserves at that moment. Every leg pays the real fees. An entry whose price moved more than 15% during that delay doesn't fill, and the fee is still charged. A model can't make itself look good by trading against a friendly simulator.
- Every six hours a retrospective looks at what happened and proposes parameter changes. Claude does this when an API key is set; a plain data-driven proposer runs otherwise.

## The guardrails

**1. A small action space.** Claude doesn't write code. It may propose at most three changes to named numeric parameters per retrospective. Each change is a diff against the current version, with a stated reason.

**2. Hard bounds the learning loop can't cross.** Every parameter has a `[min, max]` range in [`packages/core/src/config.ts`](../packages/core/src/config.ts), and every proposal is clamped to it before it is evaluated. The risk caps are the tightest: at most 0.2 SOL per trade, 6 open positions, and a 15% daily loss pause. Bounds are configuration owned by the human operator; nothing in the loop can write to them.

**3. Changes that add risk need more evidence.** Changes that loosen a filter need at least 100 of the bot's own trades first ([`apps/analyst/src/learning.ts`](../apps/analyst/src/learning.ts)). Until then, only changes that tighten risk can be accepted. The prompt tells the model this, but the rule is enforced in code, not by trusting the model to follow it. The 100 isn't arbitrary: 50 trades leave about ±14 percentage points of uncertainty on a win rate, and telling 55% from 50% takes around 780.

**4. Proposals are tested on data the model never saw.** The model studies an older window. Each proposal is then replayed on the newest 24 hours and kept only if expected profit and drawdown are no worse than the current version.

**5. Changes go live provisionally, and roll back automatically.** A change that passes goes live marked *provisional*. After 24 hours of new data it is either confirmed or reverted to its parent version if it did worse. No human is needed for the rollback, and every version, proposal and rejection reason is stored, so the history can be audited.

**6. A kill switch.** Creating `data/KILL`, or pressing a button on the dashboard, closes every position and stops new entries.

## Two models arguing, scored by a referee neither of them controls

For bigger strategy changes I didn't want to trust one model's judgement, so I built a debate runner ([`scripts/debate-calls.ts`](../scripts/debate-calls.ts)):

- The runner snapshots the data up to a cutoff and holds back the most recent hours as a **sealed holdout** that neither agent ever sees.
- Claude (`claude -p`) and Codex (`codex exec`) take turns. Each reads the transcript, runs its own replays, rebuts the other side and writes a full strategy proposal as code.
- At the end, **the runner, not either model**, scores every proposal and the live strategy on the sealed holdout. A strategy only earns a forward test if its trimmed mean is positive and it doesn't depend on its single best trade.
- Nothing is applied automatically.

The full transcripts, prompts, proposals and the agents' scratch scripts are in [`research/debate-calls/`](../research/debate-calls/).

## What happened: the model caught my mistake

In the first debate both agents tested 13 combinations that looked profitable on the fitting data. None survived validation, and both recommended trading nothing. That was the right answer, and it's a useful property in itself: when there's no edge, a good agent should say so.

The second debate is the interesting one. Between the two debates *I* had chosen a "young token" strategy (only buy tokens called with few prior trades). It looked strongly positive in backtests, so I deployed it to the paper books and widened the hard bounds to fit it. This is worth stating plainly: the human was the one who loosened the limits.

In round one of the second debate, Claude declined to propose anything and explained why ([`transcript.md`](../research/debate-calls/2026-09-30T21-10-56/transcript.md)): the strategy's edge came from future information. The price-history service answered "not found" for tokens whose trading pool only existed *after* they graduated, and my fetcher cached that as "zero prior trades". So "young" quietly meant "will graduate later". Claude backed this with a test: 66% of tokens with empty histories crossed $60k within 24 hours, against 9% of the rest. It also pointed out that the sealed holdout read the same after-the-fact data, so the referee itself was contaminated, and asked for it to be scored differently.

I checked it, found that all 60 sampled empty-history tokens had graduated, and retracted the result in a commit titled *"Retract runner-features result: empty Codex histories were a look-ahead leak."* The fetcher and the live trader now treat "not found" as unknown, not as zero.

## What I take from this

- **Put the guardrails in code, not in the prompt.** Each limit the model was told about was also enforced somewhere it couldn't reach. The prompt explains the rules; the code is what makes them true.
- **The referee has to be outside the agents' control, and it can still be wrong.** The sealed holdout stopped the agents from grading their own work, but it shared a data-collection bug with the training set. Separating evaluation data isn't enough if it comes from the same broken pipeline.
- **Abstaining has to be an allowed answer, and a cheap one.** Both models chose "do nothing" when the evidence was weak. That only works because the scoring rewards zero over a negative expected value, and because doing nothing costs the model nothing in the format.
- **The biggest risk was the operator.** The bounds held against the model. The bad change came from me, and it was a model that caught it. A design where people can widen limits without the same scrutiny as the model is only as safe as those people.

## Limits

This is paper trading on one market over a few weeks. The holdouts are small (single-digit trades in the second debate), so none of the profit numbers mean much. The claim is about the process, not the returns: that bounded, versioned, independently scored changes let me give a model real control over an agent's behaviour, and find out quickly when it, or I, got something wrong.

Code: [github.com/prashantjcha/pump-paper-trader](https://github.com/prashantjcha/pump-paper-trader)
