// Claude vs Codex debate on the Telegram call data, refereed by a sealed holdout.
//   npx tsx scripts/debate-calls.ts [--rounds 3] [--research-to 2026-09-26] [--holdout-to 2026-09-29T18:00Z] [--dry-run]
// Both agents research only a snapshot of calls before --research-to. Each turn they write a strategy file
// (scripts/lib/callsSim.ts interface) and rebut the other side. The runner, not either model, scores every
// proposal on the calls between --research-to and --holdout-to and writes verdict.md.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, readdirSync, cpSync, copyFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ROOT, DATA_DIR } from "../packages/core/src/db.ts";
import { evaluate, type EvalResult } from "./lib/callsSim.ts";
import { cleanEnv } from "./lib/agentEnv.ts";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const rounds = Number(opt("rounds", "3"));
const researchTo = Date.parse(opt("research-to", "2026-09-29T18:00:00Z"));
const holdoutTo = Date.parse(opt("holdout-to", "2100-01-01T00:00:00Z")); // default: score later on future calls
const dry = args.includes("--dry-run");
const turnMin = Number(opt("turn-minutes", "30"));
const id = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = resolve(ROOT, "research/debate-calls", id);
const snap = resolve(dir, "data");
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");
mkdirSync(resolve(dir, "proposals"), { recursive: true });
mkdirSync(resolve(dir, "work"), { recursive: true });

// ---------------------------------------------------------------- sealed snapshot: calls before researchTo only
function snapshot() {
  mkdirSync(resolve(snap, "ohlcv"), { recursive: true });
  const src = new DatabaseSync(resolve(DATA_DIR, "pumpfun.db"), { readOnly: true });
  const rows = src.prepare(`SELECT id, mint, source, created_ms, status, book, chat, msg_id, caller, msg_text, call_ms FROM manual_signals WHERE book='telegram' AND call_ms < ?`).all(researchTo) as any[];
  src.close();
  const db = new DatabaseSync(resolve(snap, "pumpfun.db"));
  db.exec(`CREATE TABLE manual_signals (id INTEGER PRIMARY KEY, mint TEXT, source TEXT, created_ms INTEGER, status TEXT, book TEXT, chat TEXT, msg_id INTEGER, caller TEXT, msg_text TEXT, call_ms INTEGER)`);
  const ins = db.prepare(`INSERT INTO manual_signals VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for (const r of rows) ins.run(r.id, r.mint, r.source, r.created_ms, r.status, r.book, r.chat, r.msg_id, r.caller, r.msg_text, r.call_ms);
  db.close();
  const mints = new Set(rows.map((r) => r.mint));
  for (const m of mints) { const s = resolve(DATA_DIR, "ohlcv", m); if (existsSync(s)) cpSync(s, resolve(snap, "ohlcv", m), { recursive: true }); }
  copyFileSync(resolve(DATA_DIR, "ohlcv/_solusd.json"), resolve(snap, "ohlcv/_solusd.json"));
  return { calls: rows.length, tokens: mints.size };
}

function brief(info: { calls: number; tokens: number }) {
  const ev = `npx tsx scripts/calls-eval.ts <strategy.ts> --data ${rel(snap)} [--from ISO] [--to ISO] [--trades N]`;
  return `# Call-strategy debate ${id}

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

## Data you may use (sealed snapshot: ${info.calls} calls on ${info.tokens} tokens, ending ${new Date(researchTo).toISOString()})
- ${rel(snap)}/pumpfun.db: table manual_signals (mint, caller, call_ms, msg_text).
- ${rel(snap)}/ohlcv/<mint>/: codex_m1_*.json / codex_m15_*.json price bars; codex_events_pre.json (every trade before the call:
  [unix_s, side +1/-1, maker, usd, tokens, walletAgeSeconds, wash, sandwich, block]); codex_flow_m1.json (minute bars with
  buys, sells, buyers, sellers, buy/sell USD volume, 6 h before to ~19 h after the call); codex_h1.json hourly bars.
- The simulator already hands your strategy ctx.preTrades (trades before the call), ctx.preTradesComplete and ctx.flow
  (order-flow bars finished by the current bar). Use those rather than reading files inside the strategy.
- Do NOT read data/ (live directory) or anything dated after the snapshot. The winner is decided on calls made AFTER the
  snapshot (a true forward holdout), scored by the runner once they have 24 h of data.

## Tools
- Evaluate any strategy on the snapshot with the exact referee simulator:
  \`${ev}\`
  It feeds bars one at a time (no lookahead): entry and custom-exit decisions at a bar's close fill at the next bar's open; policy stops act inside bars (stop first).
  Costs: venue fee per side, 0.003 SOL fixed per leg, price impact from each bar's liquidity. Horizon 24 h after the call.
- Strategy interface and context fields: scripts/lib/callsSim.ts (CallStrategy, CallCtx, HoldCtx, PreTrade, FlowBar). Shared exit policies: packages/core/src/callPolicy.ts.
- Examples: research/debate-calls/examples/young-token.ts (the live rule), baseline-trail.ts, volume-breakout.ts.
- Put analysis scripts in ${rel(dir)}/work/. Do not edit files outside ${rel(dir)}.

## Rules of engagement
1. Use three splits inside the snapshot: fit before 2026-09-18, validate 2026-09-18 to 2026-09-26, test 2026-09-26 onward. Choose on fit, report all three with n.
2. Report mean, trimmed mean, total without best, win rate, and captured5x / captured10x.
3. Every claim needs a number, its sample size and the command that produced it. Ignore effects with fewer than 30 trades.
4. Attack the other side's latest proposal: which trades carry it, does it hold on every split, is it one caller or one lucky day, how many knobs were tuned.
5. Concede when the evidence beats yours. Do not agree without evidence. Beating the live rule on all three splits is the bar.
6. Keep strategies simple enough to run live: use only ctx fields (bars up to the current one, pre-call trades, finished flow bars, caller history, call time). Fewer parameters beat more.

## Your output each turn
- Write your current strategy to ${rel(dir)}/proposals/<you>-r<round>.ts (default export implementing CallStrategy; import types from "../../../../scripts/lib/callsSim.ts").
- End with a message under 400 words: what you tested, the numbers, what you concede, what you dispute, and why your strategy should win on unseen calls.
`;
}

type Agent = "claude" | "codex";
const transcript = resolve(dir, "transcript.md");
function turn(agent: Agent, round: number): string {
  const other = agent === "claude" ? "Codex" : "Claude";
  const promptFile = resolve(dir, `prompt-${agent}-r${round}.md`);
  writeFileSync(promptFile, `${readFileSync(resolve(dir, "brief.md"), "utf8")}
## Your turn: ${agent === "claude" ? "Claude" : "Codex"}, round ${round} of ${rounds}
Read ${rel(transcript)} and ${other}'s latest file in ${rel(dir)}/proposals/.
${round === 1 && agent === "claude" ? "You open: propose a runner-detection entry and an exit, with evidence." : `Rebut ${other}'s latest strategy with experiments, then improve yours.`}
${round === rounds ? "Final round: submit your best strategy and state plainly where you still disagree." : ""}
Write ${rel(dir)}/proposals/${agent}-r${round}.ts, then end with your message.
`);
  const short = `Read and follow ${rel(promptFile)}. Work inside ${rel(dir)}; everything else is read-only.`;
  const reply = resolve(dir, `reply-${agent}-r${round}.md`);
  if (dry) { writeFileSync(reply, `(dry run ${agent} r${round})`); return "(dry run)"; }
  const opts = { cwd: ROOT, env: cleanEnv(), encoding: "utf8" as const, timeout: turnMin * 60_000, maxBuffer: 64 * 1024 * 1024, shell: true };
  let r;
  if (agent === "claude") {
    r = spawnSync("claude", ["-p", JSON.stringify(short), "--permission-mode", "acceptEdits",
      "--allowedTools", JSON.stringify("Bash(npx tsx:*) Bash(npx:*) Bash(node:*) Bash(tsx:*) Bash(ls:*) Bash(cat:*) Bash(head:*) Bash(tail:*) PowerShell(npx tsx:*) PowerShell(node:*) Read Grep Glob Write Edit"), "--output-format", "text"], opts);
    writeFileSync(reply, r.stdout ?? "");
  } else {
    r = spawnSync("codex", ["exec", "-s", "workspace-write", "--skip-git-repo-check", "-C", JSON.stringify(ROOT), "-o", JSON.stringify(reply), JSON.stringify(short)], opts);
    if (!existsSync(reply)) writeFileSync(reply, r.stdout ?? "");
  }
  if (r.status !== 0) appendFileSync(resolve(dir, "errors.log"), `${agent} r${round} exit ${r.status}\n${(r.stderr ?? "").slice(-4000)}\n`);
  return readFileSync(reply, "utf8").trim() || `(${agent} produced no message; see errors.log)`;
}

async function verdict() {
  const files = [
    ...["young-token.ts", "baseline-trail.ts"].map((f) => resolve(ROOT, "research/debate-calls/examples", f)),
    ...readdirSync(resolve(dir, "proposals")).filter((f) => f.endsWith(".ts")).sort().map((f) => resolve(dir, "proposals", f)),
  ];
  const row = (name: string, h: EvalResult, r: EvalResult) =>
    `| ${name} | ${h.entries} | ${h.meanSol ?? "–"} | ${h.trimmedMeanSol ?? "–"} | ${h.totalSol} | ${h.totalWithoutBestSol} | ${h.winRate ?? "–"}% | ${h.captured5x}/${h.tokensThatRan5x} | ${h.captured10x}/${h.tokensThatRan10x} | ${r.entries} | ${r.meanSol ?? "–"} | ${r.totalSol} |`;
  let md = `# Verdict ${id}\n\nHoldout (never shown to either agent): calls from ${new Date(researchTo).toISOString()} to ${new Date(holdoutTo).toISOString()}, scored on live data with the same simulator.\n\n`;
  md += `| Strategy | Holdout trades | Mean SOL | Trimmed mean | Total SOL | Total w/o best | Win | 5x captured | 10x captured | Research trades | Research mean | Research total |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  const out: any[] = [];
  for (const f of files) {
    try {
      const s = (await import(pathToFileURL(f).href + `?v=${Date.now()}`)).default;
      const scoreTo = Math.min(holdoutTo, Date.now() - 24 * 3_600_000); // calls need 24 h of data
      const h = evaluate(s, DATA_DIR, researchTo, scoreTo);
      const r = evaluate(s, snap, 0, researchTo);
      md += row(`${rel(f).split("/").pop()} — ${s.name}`, h, r) + "\n";
      out.push({ file: rel(f), name: s.name, holdout: { ...h, trades: undefined }, research: { ...r, trades: undefined }, holdoutTrades: h.trades });
    } catch (e) { md += `| ${rel(f)} | error: ${(e as Error).message.slice(0, 120)} |\n`; }
  }
  md += `\nA strategy is worth a forward test only if its holdout trimmed mean is positive and it did not depend on its single best trade.\n`;
  writeFileSync(resolve(dir, "verdict.md"), md);
  writeFileSync(resolve(dir, "verdict.json"), JSON.stringify(out, null, 1));
  return md;
}

const info = snapshot();
writeFileSync(resolve(dir, "brief.md"), brief(info));
writeFileSync(transcript, `# Transcript ${id}\n\n`);
console.log(`debate ${id}: research snapshot ${info.calls} calls / ${info.tokens} tokens; holdout ${new Date(researchTo).toISOString()} -> ${new Date(holdoutTo).toISOString()}${dry ? " (dry run)" : ""}`);
for (let r = 1; r <= rounds; r++) for (const a of ["claude", "codex"] as Agent[]) {
  const t0 = Date.now();
  const msg = turn(a, r);
  appendFileSync(transcript, `## Round ${r}: ${a === "claude" ? "Claude" : "Codex"}\n\n${msg}\n\n`);
  console.log(`round ${r} ${a}: ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
console.log(await verdict());
console.log(`files: ${rel(dir)}`);
