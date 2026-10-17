// Claude vs Codex research debate, refereed by data.
//
//   npx tsx scripts/debate.ts --rounds 3 --holdout-hours 6 [--topic "..."] [--dry-run]
//
// 1. Snapshots the database and raw archive up to a cutoff (now - holdout) into
//    research/debate/<id>/data. Both agents research ONLY that snapshot.
// 2. Alternates turns: `claude -p` and `codex exec`. Each turn reads the brief and the
//    transcript, runs experiments, rebuts the other side, and writes a proposal file.
// 3. The runner, not either model, scores every proposal and the live strategy on the
//    sealed holdout (cutoff -> now) that neither agent saw, and writes verdict.md.
// Nothing here changes the live strategy. Applying a winner is the user's decision.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ROOT, DATA_DIR } from "../packages/core/src/db.ts";
import { normalizeParams, loadStrategy, STRATEGY_PATH, type StrategyParams } from "../packages/core/src/config.ts";
import { runReplay, type ReplayStats } from "../packages/core/src/replay.ts";
import { replayContext } from "../packages/core/src/replayContext.ts";
import { rawFiles } from "../packages/core/src/rawio.ts";

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k: string) => args.includes("--" + k);
const rounds = Number(opt("rounds", "3"));
const holdoutH = Number(opt("holdout-hours", "6"));
const topic = opt("topic", "Find the entry and exit rules, and the market regime (time of day, launch activity, curve stage), that give positive expectancy per trade after all costs for a 0.1 SOL paper position.");
const dry = flag("dry-run");
const turnTimeoutMin = Number(opt("turn-minutes", "25"));

const now = Date.now();
const cutoff = now - holdoutH * 3_600_000;
const id = new Date(now).toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = resolve(ROOT, "research/debate", id);
const snap = resolve(dir, "data");
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");
mkdirSync(resolve(dir, "proposals"), { recursive: true });
mkdirSync(resolve(snap, "raw"), { recursive: true });

// ---------------------------------------------------------------- sealed snapshot
function snapshot() {
  const src = new DatabaseSync(resolve(DATA_DIR, "pumpfun.db"));
  src.exec(`VACUUM INTO '${resolve(snap, "pumpfun.db").replace(/'/g, "''")}'`);
  src.close();
  const db = new DatabaseSync(resolve(snap, "pumpfun.db"));
  // Remove everything at or after the cutoff so nothing from the holdout leaks.
  for (const [t, c] of [["trades_raw", "recv_ms"], ["tokens", "create_ms"], ["token_outcomes", "finalized_ms"], ["positions", "decision_ms"],
    ["postmortems", "created_ms"], ["wallet_positions", "first_buy_ms"], ["equity", "ts_ms"], ["metrics", "ts_ms"], ["logs", "ts_ms"],
    ["study_snapshots", "created_ms"], ["retrospectives", "created_ms"], ["learning_proposals", "created_ms"]] as const) {
    db.prepare(`DELETE FROM ${t} WHERE ${c} >= ?`).run(cutoff);
  }
  db.exec("DELETE FROM wallet_stats; DELETE FROM kv; VACUUM;");
  db.close();
  // Raw archive: copy whole hours strictly before the cutoff hour (partial hour dropped).
  const cutoffHour = Math.floor(cutoff / 3_600_000) * 3_600_000;
  let n = 0;
  for (const f of rawFiles(0, cutoffHour - 1)) {
    const m = f.replace(/\\/g, "/").match(/raw\/(\d{4}-\d{2}-\d{2})\/((\d{2})\..+)$/);
    if (!m || Date.parse(`${m[1]}T${m[3]}:00:00Z`) >= cutoffHour) continue;
    mkdirSync(resolve(snap, "raw", m[1]), { recursive: true });
    copyFileSync(f, resolve(snap, "raw", m[1], m[2]));
    n++;
  }
  return { rawFiles: n, researchTo: cutoffHour };
}

// ---------------------------------------------------------------- brief
const live = loadStrategy(STRATEGY_PATH);
const liveVersion = JSON.parse(readFileSync(STRATEGY_PATH, "utf8")).version;
function brief(researchTo: number) {
  return `# Research debate ${id}

You are one of two researchers (Claude and Codex) debating how to trade brand-new pump.fun bonding-curve tokens profitably.
The data referees; rhetoric does not. You win by making claims the other side cannot refute with experiments.

## Topic
${topic}

## Data you may use (sealed snapshot)
- Set \`PF_DATA_DIR=${rel(snap)}\` for every command. Research data ends at ${new Date(researchTo).toISOString()}.
- Do NOT read \`data/\` (the live directory) or anything after that time. The runner scores all proposals on a sealed holdout after the cutoff; results you have not seen decide the winner.
- Database: \`${rel(snap)}/pumpfun.db\` (SQLite; tables: tokens, trades_raw, token_outcomes, wallet_positions, positions incl. book='shadow', postmortems).
- Raw event archive: \`${rel(snap)}/raw/\` (gzip JSONL; read with packages/core/src/rawio.ts readRaw).
- Existing research by Codex: \`research/launches-2026-09-30/\` and \`scripts/research-*.ts\` (read-only reference).

## Tools
- Replay any strategy file through the exact live engine (600 ms latency, fees, slippage failures):
  \`PF_DATA_DIR=${rel(snap)} npx tsx apps/bot/src/replay.ts --strategy <file.json> --from <iso> --to <iso> --unlimited\`
- Parameter schema, defaults and hard bounds: packages/core/src/config.ts. Entry/exit logic: packages/core/src/strategy.ts and engine.ts.
- You may write analysis scripts under \`${rel(dir)}/work/\`. Do not edit anything outside \`${rel(dir)}\`.

## Rules of engagement
1. Every claim needs a number, its sample size, and the command that produced it.
2. Split your research window: fit on the earlier part, check on the later part. Report both. Ignore results with fewer than 30 trades.
3. Round-trip friction is about 8-9% at 0.1 SOL. An edge that does not clear it is not an edge.
4. Attack the other side's latest proposal: find where it overfits, which trades carry it, whether it survives a latency sweep (0/600/1500 ms).
5. Concede explicitly when their evidence beats yours. Converging is allowed; agreeing without evidence is not.
6. If a better rule cannot be expressed with existing parameters (e.g. time-of-day filter), describe it precisely under "new_rules"; it will be listed for implementation but not scored.

## Your output each turn
- Write your current proposal to \`${rel(dir)}/proposals/<you>-r<round>.json\` as:
  \`{ "params": <full StrategyParams>, "regime": "<when to trade>", "new_rules": ["..."], "evidence": ["claim (n=, command)"], "confidence": "low|medium|high" }\`
- Your final message (under 400 words): what you tested, what you concede, what you dispute in the other's proposal, and why yours should win.

## Live strategy right now (v${liveVersion})
\`\`\`json
${JSON.stringify(live, null, 2)}
\`\`\`
`;
}

// ---------------------------------------------------------------- turns
type Agent = "claude" | "codex";
const transcript = resolve(dir, "transcript.md");

function runTurn(agent: Agent, round: number): string {
  const promptFile = resolve(dir, `prompt-${agent}-r${round}.md`);
  const other = agent === "claude" ? "Codex" : "Claude";
  writeFileSync(promptFile, `${readFileSync(resolve(dir, "brief.md"), "utf8")}

## Your turn: you are ${agent === "claude" ? "Claude" : "Codex"}, round ${round} of ${rounds}
Read the transcript at \`${rel(transcript)}\` and ${other}'s latest proposal in \`${rel(dir)}/proposals/\`.
${round === 1 && agent === "claude" ? "You open the debate: propose a regime and rules with evidence." : `Rebut ${other}'s latest position with experiments, then improve your own.`}
${round === rounds ? "This is the final round: make your best final proposal and state plainly where you and the other side still disagree." : ""}
Write your proposal file to \`${rel(dir)}/proposals/${agent}-r${round}.json\`, then end with your message.
`);
  const short = `Read and follow the instructions in ${rel(promptFile)}. Work only inside ${rel(dir)} and read-only elsewhere.`;
  const env = { ...process.env, PF_DATA_DIR: snap };
  const lastMsg = resolve(dir, `reply-${agent}-r${round}.md`);
  if (dry) { writeFileSync(lastMsg, `(dry run: ${agent} round ${round})`); return readFileSync(lastMsg, "utf8"); }
  const opts = { cwd: ROOT, env, encoding: "utf8" as const, timeout: turnTimeoutMin * 60_000, maxBuffer: 64 * 1024 * 1024, shell: true };
  let r;
  if (agent === "claude") {
    r = spawnSync("claude", ["-p", JSON.stringify(short), "--permission-mode", "acceptEdits",
      "--allowedTools", JSON.stringify("Bash(npx tsx:*) Bash(node:*) Bash(PF_DATA_DIR=*) Read Grep Glob Write Edit"), "--output-format", "text"], opts);
    writeFileSync(lastMsg, r.stdout ?? "");
  } else {
    r = spawnSync("codex", ["exec", "-s", "workspace-write", "--skip-git-repo-check", "-C", JSON.stringify(ROOT), "-o", JSON.stringify(lastMsg), JSON.stringify(short)], opts);
    if (!existsSync(lastMsg)) writeFileSync(lastMsg, r.stdout ?? "");
  }
  if (r.status !== 0) appendFileSync(resolve(dir, "errors.log"), `${agent} r${round} exit ${r.status}\n${r.stderr}\n`);
  return readFileSync(lastMsg, "utf8").trim() || `(${agent} produced no message; see errors.log)`;
}

// ---------------------------------------------------------------- verdict
function score(p: StrategyParams, from: number, to: number, ctxDb: DatabaseSync | null): ReplayStats {
  const ctx = ctxDb ? replayContext(ctxDb as any, from) : {};
  return runReplay({ params: p, from, to, unlimited: true, ...ctx }).stats;
}

function verdict(researchTo: number) {
  const liveDb = new DatabaseSync(resolve(DATA_DIR, "pumpfun.db"), { readOnly: true });
  const cands: { name: string; params: StrategyParams; regime?: string; newRules?: string[] }[] = [{ name: `live v${liveVersion}`, params: live }];
  for (const f of readdirSync(resolve(dir, "proposals")).sort()) {
    try {
      const j = JSON.parse(readFileSync(resolve(dir, "proposals", f), "utf8"));
      cands.push({ name: f.replace(".json", ""), params: normalizeParams(j.params ?? j), regime: j.regime, newRules: j.new_rules });
    } catch (e) { appendFileSync(resolve(dir, "errors.log"), `bad proposal ${f}: ${(e as Error).message}\n`); }
  }
  const rows = cands.map((c) => ({ ...c, s: score(c.params, cutoff, now, liveDb) }));
  const f = (v: number, d = 5) => (isFinite(v) ? v.toFixed(d) : "inf");
  let md = `# Verdict ${id}\n\nHoldout (never shown to either agent): ${new Date(cutoff).toISOString()} to ${new Date(now).toISOString()}.\n`;
  md += `Research data ended ${new Date(researchTo).toISOString()}. Scored with the live engine, unlimited capital, 600 ms latency.\n\n`;
  md += `| Proposal | Trades | Failed | Win rate | Expectancy SOL/trade | Total SOL | Max DD SOL | Profit factor |\n|---|---|---|---|---|---|---|---|\n`;
  for (const r of rows) md += `| ${r.name} | ${r.s.trades} | ${r.s.failed} | ${(r.s.winRate * 100).toFixed(0)}% | ${f(r.s.expectancySol)} | ${f(r.s.totalPnlSol, 4)} | ${f(r.s.maxDrawdownSol, 4)} | ${f(r.s.profitFactor, 2)} |\n`;
  md += `\nFewer than 30 holdout trades means the comparison is not meaningful yet; rerun with a longer holdout.\n`;
  for (const r of rows.filter((x) => x.regime || x.newRules?.length)) md += `\n## ${r.name}\n- Regime: ${r.regime ?? "–"}\n${(r.newRules ?? []).map((x) => `- New rule (not scored): ${x}`).join("\n")}\n`;
  writeFileSync(resolve(dir, "verdict.md"), md);
  return md;
}

// ---------------------------------------------------------------- main
const snapInfo = snapshot();
writeFileSync(resolve(dir, "brief.md"), brief(snapInfo.researchTo));
writeFileSync(transcript, `# Transcript ${id}\n\n`);
console.log(`debate ${id}: ${snapInfo.rawFiles} archive hours for research, holdout ${holdoutH}h, ${rounds} rounds${dry ? " (dry run)" : ""}`);
for (let r = 1; r <= rounds; r++) {
  for (const a of ["claude", "codex"] as Agent[]) {
    const t0 = Date.now();
    const msg = runTurn(a, r);
    appendFileSync(transcript, `## Round ${r}: ${a === "claude" ? "Claude" : "Codex"}\n\n${msg}\n\n`);
    console.log(`round ${r} ${a} done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  }
}
console.log(verdict(snapInfo.researchTo));
console.log(`files: ${rel(dir)}`);
