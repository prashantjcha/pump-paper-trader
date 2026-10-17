// The learning loop. Studies an older window, proposes bounded parameter changes
// (Claude when an API key is present, a data-driven proposer otherwise), validates
// each on a newer window it did not see, activates winners provisionally, and
// auto-reverts them if forward results are worse.
import Anthropic from "@anthropic-ai/sdk";
import { type DB, log as dblog, kvGet } from "@pf/core/db";
import {
  type StrategyParams, normalizeParams, loadBounds, clampToBounds, getParam, setParam, isTightening, saveStrategy, TIGHTEN_DIRECTION,
} from "@pf/core/config";
import { runReplay, type ReplayStats } from "@pf/core/replay";
import { replayContext } from "@pf/core/replayContext";
import { rawFiles } from "@pf/core/rawio";
import { runStudies } from "./study.ts";

const H = 3_600_000;
const cfg = {
  studyHours: Number(process.env.RETRO_STUDY_HOURS ?? 72),
  validateHours: Number(process.env.RETRO_VALIDATE_HOURS ?? 24),
  forwardHours: Number(process.env.RETRO_FORWARD_HOURS ?? 24),
  minReplayTrades: Number(process.env.RETRO_MIN_REPLAY_TRADES ?? 100),
  minOwnTradesToLoosen: 100,
  model: process.env.RETRO_MODEL ?? "claude-opus-5-5",
};
const log = (db: DB, level: "info" | "warn" | "error", msg: string) => dblog(db, "analyst", level, msg);

interface Proposal { param: string; to: number; hypothesis: string; evidence: string; expected_effect: string }
export interface RetroOutput { learned: string; observations: string[]; proposals: Proposal[] }

export function activeVersion(db: DB): { version: number; params: StrategyParams; status: string; parent: number | null; activated: number } {
  const r = db.prepare(`SELECT * FROM strategy_versions WHERE status IN ('active','provisional','confirmed') ORDER BY version DESC LIMIT 1`).get() as any;
  return { version: r.version, params: normalizeParams(JSON.parse(r.params_json)), status: r.status, parent: r.parent_version, activated: r.activated_ms };
}

function dataSpan(): { first: number; last: number } | null {
  const files = rawFiles(0, Date.now() + H);
  if (!files.length) return null;
  const hourOf = (f: string) => { const m = f.replace(/\\/g, "/").match(/(\d{4}-\d{2}-\d{2})\/(\d{2})\./); return m ? Date.parse(`${m[1]}T${m[2]}:00:00Z`) : 0; };
  return { first: hourOf(files[0]), last: hourOf(files[files.length - 1]) + H };
}

function ownMomentumTrades(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) n FROM positions WHERE book='momentum' AND status='closed'`).get() as any).n;
}

// ------------------------------------------------------------------ proposers

const SYSTEM = `You are the quantitative analyst for a paper-trading bot that trades brand-new pump.fun bonding-curve tokens on Solana.
The bot's rules are deterministic; you only tune numeric parameters. You receive aggregate statistics:
- market: outcomes of every launch (runner/graduated/rug/fizzle) by dev buy size, bundling, dev-sell timing, hour.
- behaviour: realized PnL of every wallet on every launch, bucketed by entry age, hold time, size and SOL raised at entry, plus profiles of the top and bottom decile of wallets. This is how real people make and lose money.
- shadow: counterfactual trades on every active launch using the bot's exit rules; per filter, how trades that failed that filter performed. This tells you what each entry filter costs or saves.
- own: the bot's actual paper trades by book and exit reason.
- mistakes: tags from post-mortems of the bot's trades (e.g. exit_too_early, stopped_then_recovered, dev_dump).
Your job: find the few parameter changes with the strongest evidence of improving expectancy per trade after all costs, and say plainly what you learned about winning versus losing behaviour.
Rules:
- Propose at most 3 changes, only for parameters listed in "tunable", with "to" inside its bounds.
- Every proposal must cite concrete numbers with their sample sizes. Ignore buckets with n < 30.
- Round-trip friction is about 8-9% at 0.1 SOL (curve fees both sides plus priority fee and tip), so an edge must clear that.
- If own momentum trades are fewer than 100, only risk-tightening changes can be accepted; say so if the evidence favours loosening.
- Prefer no change over a weakly supported one. An empty proposals list is a valid answer.
- Each change is replayed on newer data you have not seen; it is rejected unless expectancy and drawdown are not worse.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["learned", "observations", "proposals"],
  properties: {
    learned: { type: "string", description: "Plain-English summary (under 150 words) of what separates winning from losing behaviour and what the bot should do differently." },
    observations: { type: "array", items: { type: "string" }, description: "Up to 6 short, numeric findings." },
    proposals: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["param", "to", "hypothesis", "evidence", "expected_effect"],
        properties: {
          param: { type: "string" }, to: { type: "number" }, hypothesis: { type: "string" },
          evidence: { type: "string" }, expected_effect: { type: "string" },
        },
      },
    },
  },
} as const;

async function claudeProposer(input: unknown): Promise<{ out: RetroOutput; model: string }> {
  // Keys not scoped to a workspace must name one on every request.
  const ws = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic(ws ? { defaultHeaders: { "anthropic-workspace-id": ws } } : {});
  // Server-side fallback: if the model declines, the API re-runs the request on a fallback model in the same call.
  const req: any = {
    model: cfg.model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: "Statistics for the study window (JSON):\n" + JSON.stringify(input) }],
  };
  const res: any = await client.beta.messages.create(req);
  if (res.stop_reason === "refusal") throw new Error(`model declined: ${JSON.stringify(res.stop_details)}`);
  const text = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { out: JSON.parse(text) as RetroOutput, model: res.model };
}

/** Deterministic proposer used when no API key is configured. Reads shadow attribution and post-mortems. */
function dataProposer(studies: ReturnType<typeof runStudies>, params: StrategyParams): RetroOutput {
  const LOOSEN: Record<string, [string, number]> = {
    too_young: ["entry.minAgeS", -2], too_old: ["entry.maxAgeS", 30], sol_raised_low: ["entry.minSolRaised", -1],
    sol_raised_high: ["entry.maxSolRaised", 5], dev_buy_small: ["entry.devBuyMin", -0.1], dev_buy_large: ["entry.devBuyMax", 1],
    few_buyers: ["entry.minUniqueBuyers", -2], bs_ratio: ["entry.minBuySellRatio", -0.5], inflow: ["entry.minNetInflowSol", -0.25],
    velocity: ["entry.minBuysLast5s", -1], dev_hold: ["entry.devHoldMaxPct", 2], bundle: ["entry.maxSameSlotBuyers", 1],
    top1: ["entry.top1MaxPct", 3], top10: ["entry.top10MaxPct", 5],
  };
  const sh = studies.shadow;
  const base = sh.momentumPass.avgPnlPct ?? sh.all.avgPnlPct ?? 0;
  const cands: (Proposal & { score: number })[] = [];
  for (const pf of sh.perFilter) {
    const m = LOOSEN[pf.filter];
    const o = pf.onlyFailing;
    if (m && o.n >= 30 && (o.avgPnlPct ?? -99) > 0 && (o.avgPnlPct ?? -99) > base) {
      const cur = Number(getParam(params, m[0]));
      cands.push({ param: m[0], to: cur + m[1], score: (o.avgPnlPct! - base) * Math.sqrt(o.n),
        hypothesis: `Filter "${pf.filter}" blocks trades that were profitable on their own.`,
        evidence: `Shadow trades failing only this filter: n=${o.n}, avg ${o.avgPnlPct}% vs ${base}% for trades passing all filters.`,
        expected_effect: "More trades with positive expectancy." });
    }
    // A filter whose passing trades lose while failing ones lose more is doing its job; one whose passing trades lose is a tightening candidate.
    if (m && pf.passing.n >= 50 && (pf.passing.avgPnlPct ?? 0) < -2 && pf.failing.n >= 50 && (pf.failing.avgPnlPct ?? 0) > (pf.passing.avgPnlPct ?? 0)) {
      /* passing is worse than failing: the filter is not predictive; leave it for Claude to reason about */
    }
  }
  const tags = studies.mistakes.tags;
  const reviewed = Math.max(1, studies.mistakes.reviewed);
  if ((tags.exit_too_early ?? 0) / reviewed > 0.3 && studies.mistakes.reviewed >= 30)
    cands.push({ param: "exit.tpFlatPct", to: params.exit.tpFlatPct + 5, score: 1, hypothesis: "Take-profit exits leave money on the table.",
      evidence: `${tags.exit_too_early} of ${reviewed} reviewed trades ran 30%+ further within 5 minutes of exit.`, expected_effect: "Larger average winner." });
  if ((tags.stopped_then_recovered ?? 0) / reviewed > 0.3 && studies.mistakes.reviewed >= 30)
    cands.push({ param: "exit.slBasePct", to: params.exit.slBasePct + 2, score: 1, hypothesis: "Stops are inside normal noise.",
      evidence: `${tags.stopped_then_recovered} of ${reviewed} stopped trades recovered 20%+ within 5 minutes.`, expected_effect: "Fewer noise stop-outs." });
  const ts = sh.exitReasons.find((e) => e.bucket === "time_stop");
  if (ts && ts.n >= 50 && (ts.avg ?? 0) < -3)
    cands.push({ param: "exit.timeStopS", to: Math.round(params.exit.timeStopS * 0.75), score: 0.5, hypothesis: "Stalled positions bleed; exit sooner.",
      evidence: `Shadow time-stop exits: n=${ts.n}, avg ${ts.avg}%.`, expected_effect: "Smaller losses on stalled tokens." });
  cands.sort((a, b) => b.score - a.score);
  return {
    learned: cands.length ? "Data-driven proposer (no Claude API key configured): changes come from shadow-trade filter attribution and post-mortem tags." : "Data-driven proposer found no change with enough evidence.",
    observations: [
      `Shadow trades: n=${sh.all.n}, avg ${sh.all.avgPnlPct}%; passing all filters: n=${sh.momentumPass.n}, avg ${sh.momentumPass.avgPnlPct}%.`,
      `Market win rate for non-creator wallets: ${studies.behaviour.marketWinRate}.`,
    ],
    proposals: cands.slice(0, 3).map(({ score: _s, ...p }) => p),
  };
}

// ------------------------------------------------------------------ validation

function better(c: ReplayStats, b: ReplayStats) {
  return c.trades >= cfg.minReplayTrades && c.expectancySol >= b.expectancySol && c.maxDrawdownSol <= b.maxDrawdownSol * 1.05 + 1e-9;
}
const brief = (s: ReplayStats) => ({ trades: s.trades, failed: s.failed, winRate: s.winRate, expectancySol: s.expectancySol, totalPnlSol: s.totalPnlSol, maxDrawdownSol: s.maxDrawdownSol, profitFactor: isFinite(s.profitFactor) ? s.profitFactor : null, exitReasons: s.exitReasons });

export async function runRetrospective(db: DB, opts: { force?: boolean; proposer?: (studies: ReturnType<typeof runStudies>, p: StrategyParams) => RetroOutput } = {}): Promise<string> {
  const span = dataSpan();
  const now = Date.now();
  if (!span) return "no recorded data yet";
  const available = (Math.min(now, span.last) - span.first) / H;
  const need = cfg.validateHours + 6;
  if (available < need && !opts.force) return `waiting for data: ${available.toFixed(1)}h recorded, need ${need}h (study window + ${cfg.validateHours}h validation)`;

  const valTo = now, valFrom = now - cfg.validateHours * H;
  const studyTo = valFrom, studyFrom = Math.max(span.first, studyTo - cfg.studyHours * H);
  const act = activeVersion(db);
  const bounds = loadBounds();
  const studies = runStudies(db, studyFrom, studyTo);
  const ownN = ownMomentumTrades(db);
  const tunable = Object.fromEntries(Object.entries(bounds).flatMap(([s, ks]) => Object.entries(ks as Record<string, [number, number]>)
    .filter(([k]) => TIGHTEN_DIRECTION[`${s}.${k}`] !== undefined)
    .map(([k, b]) => [`${s}.${k}`, { current: getParam(act.params, `${s}.${k}`), bounds: b, tightenDirection: TIGHTEN_DIRECTION[`${s}.${k}`] > 0 ? "increase" : "decrease" }])));
  const history = db.prepare(`SELECT param, from_val, to_val, status, replay_json FROM learning_proposals ORDER BY id DESC LIMIT 12`).all();
  const input = { studyWindowHours: (studyTo - studyFrom) / H, ownMomentumTrades: ownN, strategyVersion: act.version, tunable, studies, previousProposals: history };

  const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  let out: RetroOutput, model = "data-proposer", error: string | null = null;
  try {
    if (opts.proposer) { out = opts.proposer(studies, act.params); model = "test-proposer"; }
    else if (hasKey) ({ out, model } = await claudeProposer(input));
    else out = dataProposer(studies, act.params);
  } catch (e) {
    error = (e as Error).message;
    log(db, "error", `retrospective proposer failed, falling back to data proposer: ${error}`);
    out = dataProposer(studies, act.params);
    model = "data-proposer (fallback)";
  }
  const retro = db.prepare(`INSERT INTO retrospectives(created_ms,kind,model,n_own_trades,input_json,output_json,learned,status,error) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(now, "scheduled", model, ownN, JSON.stringify(input), JSON.stringify(out), out.learned, "validating", error);
  const retroId = Number(retro.lastInsertRowid);

  if (act.status === "provisional") {
    for (const p of out.proposals) insertProposal(db, retroId, act.params, p, "deferred", { reason: `v${act.version} is still in its forward-test window` });
    db.prepare(`UPDATE retrospectives SET status='done' WHERE id=?`).run(retroId);
    return `retrospective #${retroId}: ${out.proposals.length} proposals deferred (provisional v${act.version} in forward test)`;
  }

  const ctx = replayContext(db, valFrom);
  // Validate on the newer window the study did not see. Unlimited capital measures the rule's edge, not capacity.
  const baseline = runReplay({ params: act.params, from: valFrom, to: valTo, unlimited: true, ...ctx }).stats;
  const accepted: { p: Proposal; params: StrategyParams; stats: ReplayStats }[] = [];
  for (const p of out.proposals.slice(0, 3)) {
    const from = Number(getParam(act.params, p.param));
    if (typeof getParam(act.params, p.param) !== "number" || TIGHTEN_DIRECTION[p.param] === undefined) { insertProposal(db, retroId, act.params, p, "rejected", { reason: "unknown or non-tunable parameter" }); continue; }
    const { params: cand, clamped } = clampToBounds(setParam(act.params, p.param, p.to), bounds);
    const to = Number(getParam(cand, p.param));
    if (to === from) { insertProposal(db, retroId, act.params, { ...p, to }, "rejected", { reason: "no change after clamping to bounds", clamped }); continue; }
    if (ownN < cfg.minOwnTradesToLoosen && !isTightening(p.param, from, to)) {
      insertProposal(db, retroId, act.params, { ...p, to }, "rejected", { reason: `loosening needs ${cfg.minOwnTradesToLoosen} own momentum trades, have ${ownN}` });
      continue;
    }
    const stats = runReplay({ params: cand, from: valFrom, to: valTo, unlimited: true, ...ctx }).stats;
    const ok = better(stats, baseline);
    insertProposal(db, retroId, act.params, { ...p, to }, ok ? "passed" : "rejected", { baseline: brief(baseline), candidate: brief(stats), window: { from: valFrom, to: valTo } });
    if (ok) accepted.push({ p: { ...p, to }, params: cand, stats });
  }

  let result = `retrospective #${retroId} (${model}): ${out.proposals.length} proposals, ${accepted.length} passed replay`;
  if (accepted.length) {
    let chosen = accepted.sort((a, b) => b.stats.expectancySol - a.stats.expectancySol)[0];
    if (accepted.length > 1) {
      let combined = act.params;
      for (const a of accepted) combined = setParam(combined, a.p.param, a.p.to);
      const cs = runReplay({ params: combined, from: valFrom, to: valTo, unlimited: true, ...ctx }).stats;
      if (better(cs, chosen.stats)) chosen = { p: { ...chosen.p, param: accepted.map((a) => a.p.param).join("+") }, params: combined, stats: cs };
    }
    const reason = `retrospective #${retroId}: ${chosen.p.param} (${chosen.p.hypothesis}); replay ${cfg.validateHours}h expectancy ${baseline.expectancySol.toFixed(5)} -> ${chosen.stats.expectancySol.toFixed(5)} SOL/trade`;
    const r = db.prepare(`INSERT INTO strategy_versions(params_json,status,parent_version,reason,created_ms,activated_ms,eval_json) VALUES (?,?,?,?,?,?,?)`)
      .run(JSON.stringify(chosen.params), "provisional", act.version, reason, now, now, JSON.stringify({ validation: { baseline: brief(baseline), candidate: brief(chosen.stats) } }));
    const v = Number(r.lastInsertRowid);
    db.prepare(`UPDATE learning_proposals SET status='accepted', version=? WHERE retro_id=? AND status='passed'`).run(v, retroId);
    saveStrategy(chosen.params, v);
    result += `; activated v${v} (provisional)`;
    log(db, "info", `learning: activated strategy v${v} provisionally: ${reason}`);
  }
  db.prepare(`UPDATE retrospectives SET status='done' WHERE id=?`).run(retroId);
  return result;
}

function insertProposal(db: DB, retroId: number, params: StrategyParams, p: Proposal, status: string, replay: unknown) {
  db.prepare(`INSERT INTO learning_proposals(retro_id,created_ms,param,from_val,to_val,hypothesis,evidence,expected_effect,status,replay_json) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(retroId, Date.now(), p.param, Number(getParam(params, p.param) ?? NaN), p.to, p.hypothesis, p.evidence, p.expected_effect, status, JSON.stringify(replay));
}

/** Confirms or auto-reverts a provisional version after its forward window, on data that arrived after activation. */
export function forwardEvaluate(db: DB): string | null {
  const act = activeVersion(db);
  if (act.status !== "provisional" || !act.parent) return null;
  const end = act.activated + cfg.forwardHours * H;
  if (Date.now() < end) return null;
  const parent = db.prepare(`SELECT * FROM strategy_versions WHERE version = ?`).get(act.parent) as any;
  const parentParams = normalizeParams(JSON.parse(parent.params_json));
  const fctx = replayContext(db, act.activated);
  const cand = runReplay({ params: act.params, from: act.activated, to: end, unlimited: true, ...fctx }).stats;
  const base = runReplay({ params: parentParams, from: act.activated, to: end, unlimited: true, ...fctx }).stats;
  const live = db.prepare(`SELECT COUNT(*) n, SUM(pnl_sol) pnl FROM positions WHERE book='momentum' AND status='closed' AND strategy_version=?`).get(act.version) as any;
  const ok = cand.expectancySol >= base.expectancySol;
  const evalJson = JSON.stringify({ forward: { candidate: brief(cand), parent: brief(base), live, window: { from: act.activated, to: end } } });
  if (ok) {
    db.prepare(`UPDATE strategy_versions SET status='confirmed', evaluated_ms=?, eval_json=? WHERE version=?`).run(Date.now(), evalJson, act.version);
    log(db, "info", `learning: v${act.version} confirmed after forward test (${cand.expectancySol.toFixed(5)} vs ${base.expectancySol.toFixed(5)} SOL/trade)`);
    return `v${act.version} confirmed`;
  }
  db.prepare(`UPDATE strategy_versions SET status='reverted', evaluated_ms=?, eval_json=? WHERE version=?`).run(Date.now(), evalJson, act.version);
  db.prepare(`UPDATE strategy_versions SET status='confirmed' WHERE version=? AND status NOT IN ('confirmed','active')`).run(act.parent);
  saveStrategy(parentParams, act.parent);
  log(db, "warn", `learning: v${act.version} reverted to v${act.parent}: forward expectancy ${cand.expectancySol.toFixed(5)} < ${base.expectancySol.toFixed(5)} SOL/trade`);
  return `v${act.version} reverted`;
}

export function lastRetroMs(db: DB): number {
  return Number((db.prepare(`SELECT MAX(created_ms) m FROM retrospectives`).get() as any)?.m ?? kvGet(db, "never") ?? 0);
}
