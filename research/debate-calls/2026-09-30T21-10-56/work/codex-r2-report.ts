// Generate every reported metric directly from the experiment's JSON records.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve("research/debate-calls/2026-09-30T21-10-56");
const read = (f: string) => JSON.parse(readFileSync(resolve(root, "work", f), "utf8"));
const results = read("codex-r2-results.json"), stress = read("codex-r2-stress.json"), selection = read("codex-r2-selection.json");
const selected = selection.selected;
const fmt = (x: number | null, dp = 5) => x == null ? "NA" : x.toFixed(dp);
const nfmt = (n: number) => `${n}${n < 30 ? "*" : ""}`;
const rows = results.map((r: any) => `| ${r.strategy} | ${r.split} | ${nfmt(r.entries)} | ${fmt(r.meanSol)} | ${fmt(r.trimmedMeanSol)} | ${fmt(r.totalSol,4)} | ${fmt(r.totalWithoutBestSol,4)} | ${fmt(r.winRate,1)} | ${r.captured5x}/${r.captured10x} |`).join("\n");
const exclusions = stress.filter((r: any) => r.strategy === selected || r.strategy.startsWith("young-token") || r.strategy.startsWith("claude-r2"))
  .flatMap((r: any) => r.exclusions.filter((e: any) => e.excludingBest).map((e: any) => {
    const x = e.excludingBest;
    return `| ${r.strategy} | ${r.split} | ${e.kind}: ${x.key} | ${nfmt(x.n)} | ${fmt(x.mean)} | ${fmt(x.trimmed)} | ${fmt(x.withoutBest,4)} | ${fmt(x.winRate,1)} | ${x.captured5x}/${x.captured10x} |`;
  })).join("\n");
const best = stress.filter((r: any) => r.strategy === selected).flatMap((r: any) => r.bestTrades.map((t: any) =>
  `| ${r.split} | ${t.mint} | ${t.caller} | ${new Date(t.callMs).toISOString()} | ${fmt(t.pnlSol)} | ${fmt(t.realizedMult,2)} |`)).join("\n");
const paired = ["fit", "val", "test"].map(split => {
  const a = results.find((r: any) => r.split === split && r.strategy === "flow300/trail40");
  const b = results.find((r: any) => r.split === split && r.strategy === selected);
  const old = new Map(a.trades.map((t: any) => [t.mint, t]));
  const delta = b.trades.map((t: any) => t.pnlSol - (old.get(t.mint) as any).pnlSol);
  return { split, n: delta.length, improved: delta.filter((x: number) => x > 1e-10).length, hurt: delta.filter((x: number) => x < -1e-10).length,
    same: delta.filter((x: number) => Math.abs(x) <= 1e-10).length, deltaTotal: delta.reduce((s: number, x: number) => s + x, 0),
    oldCapture: [a.captured5x,a.captured10x], newCapture: [b.captured5x,b.captured10x] };
});
writeFileSync(resolve(root, "work/codex-r2-paired.json"), JSON.stringify(paired, null, 2));
const pairedRows = paired.map(p => `| ${p.split} | ${nfmt(p.n)} | ${p.improved} | ${p.hurt} | ${p.same} | ${fmt(p.deltaTotal)} | ${p.oldCapture.join("/")} | ${p.newCapture.join("/")} |`).join("\n");
const report = `# Codex round 2: a fit-selected challenger, not a validated winner

Submitted: proposals/codex-r2.ts, **${selected}**. Entry: at the call, count buys plus sells in completed pre-call flow minutes; accept 1–300. Exit: -25% initial stop, arm at +200%, then trail 40%. Size defaults to 0.1 SOL. No preTrades, ctx.pre, caller identity or calendar exclusions. The six-hour count is a lower bound on lifetime activity, not proof of youth. This is a paper-debate challenger, not evidence for deploying a profitable rule.

## Reproduction

From D:/pumpfun (only this debate folder is written):

\`\`\`powershell
node --experimental-transform-types research/debate-calls/2026-09-30T21-10-56/work/codex-r2-experiment.ts > research/debate-calls/2026-09-30T21-10-56/work/codex-r2-experiment.out
node --experimental-transform-types research/debate-calls/2026-09-30T21-10-56/work/codex-r2-report.ts
$debateDir = 'research/debate-calls/2026-09-30T21-10-56'
node --experimental-transform-types scripts/calls-eval.ts $debateDir/proposals/codex-r2.ts --data $debateDir/data --to 2026-09-18T00:00:00Z --trades 0
node --experimental-transform-types scripts/calls-eval.ts $debateDir/proposals/codex-r2.ts --data $debateDir/data --from 2026-09-18T00:00:00Z --to 2026-09-26T00:00:00Z --trades 0
node --experimental-transform-types scripts/calls-eval.ts $debateDir/proposals/codex-r2.ts --data $debateDir/data --from 2026-09-26T00:00:00Z --to 2026-09-29T18:00:00Z --trades 0
\`\`\`

Node's TypeScript transform runs the original referee evaluate() and PolicyState without changes, using the read-only cache from grid.ts. The npx/tsx launcher failed in round 1; no dependency install or external data is needed. The first command produces all experiment numbers and trade records; the second produces the derived concentration and paired comparisons here. CLI verification JSON is stored in codex-r2-referee-{fit,val,test}.json. Every summary field except the strategy name matched the experiment on all three splits. No live data or post-snapshot cohort was accessed.

## Selection, search scope and rebuttal

Three entries times four exits = 12 candidates fixed in the experiment source before running. One entry repeats round 1's 1–300 completed-flow trade rule. The other entries require completed post-call flow confirmation between 5 and 15 minutes: more buy than sell USD during the most recent five minutes (at least four fully post-call minutes), plus a close above the last finished pre-call close with flow <=1,000, or above the prior 15-minute high without that count cap. All confirmation decisions use completed one-minute bars; fill is at the next bar's open.

Four exits: the prior +200% arm/40% trail/-50% stop; a wider 60% trail; half out at +100% then 60% trail with -50% initial stop; and the original trailing exit with a tighter -25% stop. The submitted rule has four numerical thresholds (300, 25, 200, 40); arm/trail were inherited, the count was explored in round 1, and the stop is the new change. Twelve candidate fits are not twelve independent discoveries. All three controls and all later-split outcomes are disclosed. Across my two rounds there were 24 candidate configurations including repeated references; Codex's round-1 report documents Claude's 98-exit exploratory grid, and Claude r2 adds four entry/exit candidates and 30 feature quintile cells under two exits. No one has a pristine internal test set now.

Selection gate: at least 30 fit trades, positive trimmed mean, positive total without best, then maximize trimmed mean. **One of 12 passes: ${selected}.** Selection was saved before later-split evaluation. I retain that selection rather than switching strategies after seeing validation. This is a rebuttal of the claim that no tested eligible causal-input rule can pass the fit gate, not a claim that fit selection proves an edge.

The selected rule's fit n=60, mean +0.03916, trimmed +0.00645 and total without best +1.1143 beat zero on fit. However, validation n=52 has trimmed -0.01085 and total without best -0.1914. Test n=16 is below the required minimum and is descriptive only. The live rule's trimmed means +0.01436/+0.03620/+0.02081 (n=110/73/37) exceed the submission on all three splits. **The all-splits bar is not met.**

Claude's proposal buys nothing: n=0 in each split, P&L=0, no influential trades/callers/days, zero fitted entry thresholds. It cannot demonstrate positive runner capture or statistically supported future superiority from a sample of zero trades. Its caution is justified: validation's strongest trade below contributes +0.84933 SOL against total +0.65796 (52 trades), so one runner carries that result. Removing the strongest validation caller leaves n=49, mean -0.00253; removing the strongest day leaves n=44, trimmed -0.01312. Even fit's positive trim fails after the best caller is excluded (n=50, trimmed -0.01475, without-best -0.3115). These are group exclusion diagnostics, not assertions of caller skill from small subgroups.

Concede Claude's critique of my earlier flow300/trail40: n=60 fit trimmed -0.00591 and n=52 validation without-best -0.1056. Also concede that buying all calls with trailing loses before trimming: mean -0.01848/-0.01320/-0.01164 (n=574/351/154); the trimmed-mean definition is not the cause of those losses. Trimming removes the top two P&Ls, an asymmetric robustness test rather than an unbiased estimate of expected return. Raw mean and runner capture must therefore be shown alongside it.

The historical event-count coverage concern remains unresolved; using completed flow avoids relying on that count, but does not prove the provider's entire historical dataset is free of revision or selection effects. I do not equate missing events with youth or claim all uses of ctx.pre are invalid: filtering to bars whose ends precede the decision is valid in principle. No new causal claim about the provider API is required by this proposal.

The reason to carry this challenger forward is testable: the tighter stop may reduce dead-call losses while retaining large runners. Its fit result supports that mechanism, but the paired validation comparison below contradicts a stable improvement. I make no claim that it should reliably win unseen calls. A true forward sample must resolve it; thresholds remain frozen.

## All referee results

Fit before Sep 18 UTC; validation Sep 18–26; test Sep 26–Sep 29 18:00 UTC. P&L is SOL per 0.1 SOL position after referee costs. Trim removes the best two trades when n>4. Capture uses proceeds/size after variable costs, before fixed leg costs. * means n<30: ignore as evidence. NA means undefined, not zero. All rows are generated by the experiment command above.

| Strategy | Split | n | Mean | Trim | Total | Without best | Win % | Captured5x/10x |
|---|---|---:|---:|---:|---:|---:|---:|---:|
${rows}

## Paired effect of reducing the stop from 50% to 25%

Same entries, arm and trail; only initial stop changes. Individual improved/hurt counts describe the complete cohorts; they are not separate small-sample significance claims.

| Split | n | Improved trades | Hurt trades | Unchanged | Change in total SOL | Old captures5x/10x | New captures5x/10x |
|---|---:|---:|---:|---:|---:|---:|---:|
${pairedRows}

## Exclude the largest P&L caller or UTC day

Exclusions are diagnostics only, selected separately within each split, never trading filters. The empty Claude strategy has no groups to exclude. Full group records for every candidate are in codex-r2-stress.json.

| Strategy | Split | Excluded group | Remaining n | Mean | Trim | Without best | Win % | Captured5x/10x |
|---|---|---|---:|---:|---:|---:|---:|---:|
${exclusions}

## Trades carrying the selected challenger

These are individual contribution records, not claims based on sub-30-trade effects.

| Split | Mint | Caller | Call UTC | P&L SOL | Realized multiple |
|---|---|---|---|---:|---:|
${best}
`;
writeFileSync(resolve(root, "work/codex-r2-report.md"), report);
console.log(JSON.stringify({ selected, paired, report: "work/codex-r2-report.md" }, null, 2));
