import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./db.ts";

export interface EntryParams {
  minAgeS: number; maxAgeS: number; minSolRaised: number; maxSolRaised: number;
  devBuyMin: number; devBuyMax: number; devHoldMaxPct: number; maxSameSlotBuyers: number;
  top1MaxPct: number; top10MaxPct: number;
  windowS: number; minUniqueBuyers: number; minBuySellRatio: number; minNetInflowSol: number; minBuysLast5s: number;
  blacklistCreators: boolean; maxCreatorPriorLaunches: number;
  /** Young-token filter (runner-features study): enter only while the token has at most this many trades. 0 = off. */
  maxTradesAtEntry: number;
}
export interface ExitParams {
  tpRisingPct: number; tpFlatPct: number; tpFallingPct: number;
  trailArmPct: number; trailPct: number;
  slBasePct: number; slTightPct: number; noBuyTightenS: number; bsTightenRatio: number;
  bigSellSol: number; bigSellSupplyPct: number; timeStopS: number; maxProgressPct: number;
  exitOnDevSell: boolean; exitOnSmartExit: boolean;
}
export interface RiskParams { positionSol: number; maxOpen: number; dailyLossPct: number; dailyLossEnabled: boolean }
export interface ExecParams { latencyMs: number; priorityFeeSol: number; tipSol: number; maxEntrySlippagePct: number; landProbability: number; exitFailProbability: number }
export interface StrategyParams { entry: EntryParams; exit: ExitParams; risk: RiskParams; exec: ExecParams }

export const DEFAULT_PARAMS: StrategyParams = {
  entry: {
    minAgeS: 3, maxAgeS: 90, minSolRaised: 2, maxSolRaised: 25,
    devBuyMin: 0.3, devBuyMax: 4, devHoldMaxPct: 8, maxSameSlotBuyers: 2,
    top1MaxPct: 15, top10MaxPct: 40,
    windowS: 15, minUniqueBuyers: 8, minBuySellRatio: 2.5, minNetInflowSol: 1.0, minBuysLast5s: 3,
    blacklistCreators: true, maxCreatorPriorLaunches: 1, maxTradesAtEntry: 0,
  },
  exit: {
    tpRisingPct: 30, tpFlatPct: 25, tpFallingPct: 20,
    trailArmPct: 15, trailPct: 8,
    slBasePct: 10, slTightPct: 6, noBuyTightenS: 8, bsTightenRatio: 1.0,
    bigSellSol: 1.5, bigSellSupplyPct: 5, timeStopS: 120, maxProgressPct: 95,
    exitOnDevSell: true, exitOnSmartExit: true,
  },
  // Daily loss pause is off for paper trading (user decision 2026-09-30): paper losses buy samples. Turn on before any live trading.
  risk: { positionSol: 0.1, maxOpen: 4, dailyLossPct: 10, dailyLossEnabled: false },
  // exitFailProbability: chance an exit tx fails and is retried one latency later at the then-current price (assumption, not measured).
  exec: { latencyMs: 600, priorityFeeSol: 0.001, tipSol: 0.002, maxEntrySlippagePct: 15, landProbability: 1.0, exitFailProbability: 0.1 },
};

/** Hard bounds. The learning loop can never move a parameter outside these. */
export type Bounds = { [S in keyof StrategyParams]: Partial<Record<keyof StrategyParams[S], [number, number]>> };
export const DEFAULT_BOUNDS: Bounds = {
  entry: {
    minAgeS: [1, 60], maxAgeS: [20, 600], minSolRaised: [0, 20], maxSolRaised: [5, 70],
    devBuyMin: [0, 2], devBuyMax: [1, 20], devHoldMaxPct: [2, 20], maxSameSlotBuyers: [0, 6],
    top1MaxPct: [5, 30], top10MaxPct: [20, 70],
    windowS: [5, 60], minUniqueBuyers: [3, 40], minBuySellRatio: [1, 8], minNetInflowSol: [0.2, 10], minBuysLast5s: [1, 15],
    maxCreatorPriorLaunches: [0, 20], maxTradesAtEntry: [0, 10_000],
  },
  exit: {
    tpRisingPct: [15, 500], tpFlatPct: [12, 500], tpFallingPct: [10, 500],
    trailArmPct: [5, 1e9], trailPct: [3, 100],
    slBasePct: [4, 60], slTightPct: [2, 60], noBuyTightenS: [2, 1e9], bsTightenRatio: [0, 2],
    bigSellSol: [0.5, 1e9], bigSellSupplyPct: [1, 100], timeStopS: [15, 86_400], maxProgressPct: [70, 99],
  },
  // Hard risk caps from the plan: max position 0.2 SOL, max 6 open, daily loss 15%.
  risk: { positionSol: [0.05, 0.2], maxOpen: [1, 6], dailyLossPct: [2, 15] },
  exec: { latencyMs: [0, 5000], priorityFeeSol: [0, 0.01], tipSol: [0, 0.05], maxEntrySlippagePct: [1, 50], landProbability: [0.1, 1], exitFailProbability: [0, 0.5] },
};

export const STRATEGY_PATH = process.env.PF_STRATEGY_PATH ?? resolve(ROOT, "config/strategy.json");
export const BOUNDS_PATH = resolve(ROOT, "config/bounds.json");

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object") return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(over as object)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" ? merge(out[k], v) : v;
  }
  return out;
}

export function loadBounds(): Bounds {
  if (!existsSync(BOUNDS_PATH)) return DEFAULT_BOUNDS;
  return merge(DEFAULT_BOUNDS, JSON.parse(readFileSync(BOUNDS_PATH, "utf8")));
}

/** Clamps every numeric param to bounds; returns the clamped params and what changed. */
export function clampToBounds(p: StrategyParams, b: Bounds = loadBounds()): { params: StrategyParams; clamped: string[] } {
  const out = structuredClone(p);
  const clamped: string[] = [];
  for (const section of Object.keys(b) as (keyof StrategyParams)[]) {
    for (const [k, range] of Object.entries(b[section]) as [string, [number, number]][]) {
      const cur = (out[section] as any)[k];
      if (typeof cur !== "number") continue;
      const v = Math.min(range[1], Math.max(range[0], cur));
      if (v !== cur) { clamped.push(`${section}.${k}`); (out[section] as any)[k] = v; }
    }
  }
  return { params: out, clamped };
}

/** Fills parameters added after a version was stored, then clamps to bounds. */
export function normalizeParams(raw: unknown): StrategyParams {
  return clampToBounds(merge(DEFAULT_PARAMS, raw)).params;
}

export function loadStrategy(path = STRATEGY_PATH): StrategyParams {
  const raw = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const { params } = clampToBounds(merge(DEFAULT_PARAMS, raw.params ?? raw));
  return params;
}

export function saveStrategy(params: StrategyParams, version: number, path = STRATEGY_PATH) {
  writeFileSync(path, JSON.stringify({ version, updated: new Date().toISOString(), params }, null, 2) + "\n");
}

export function strategyFileVersion(path = STRATEGY_PATH): number {
  if (!existsSync(path)) return 0;
  try { return Number(JSON.parse(readFileSync(path, "utf8")).version ?? 0); } catch { return 0; }
}

/** Dotted-path get/set used by the learning loop ("exit.slBasePct"). */
export function getParam(p: StrategyParams, path: string): unknown {
  const [s, k] = path.split(".");
  return (p as any)[s]?.[k];
}
export function setParam(p: StrategyParams, path: string, v: number): StrategyParams {
  const out = structuredClone(p);
  const [s, k] = path.split(".");
  if (!(s in out) || !(k in (out as any)[s])) throw new Error("unknown param " + path);
  (out as any)[s][k] = v;
  return out;
}

/**
 * Direction in which a change *reduces* risk. Used to gate proposals when the
 * own-trade sample is too small to justify loosening anything.
 */
export const TIGHTEN_DIRECTION: Record<string, 1 | -1> = {
  "entry.minAgeS": 1, "entry.maxAgeS": -1, "entry.minSolRaised": 1, "entry.maxSolRaised": -1,
  "entry.devBuyMin": 1, "entry.devBuyMax": -1, "entry.devHoldMaxPct": -1, "entry.maxSameSlotBuyers": -1,
  "entry.top1MaxPct": -1, "entry.top10MaxPct": -1, "entry.minUniqueBuyers": 1, "entry.minBuySellRatio": 1,
  "entry.minNetInflowSol": 1, "entry.minBuysLast5s": 1, "entry.maxCreatorPriorLaunches": -1,
  "exit.slBasePct": -1, "exit.slTightPct": -1, "exit.timeStopS": -1, "exit.trailPct": -1, "exit.trailArmPct": -1,
  "exit.tpRisingPct": -1, "exit.tpFlatPct": -1, "exit.tpFallingPct": -1, "exit.noBuyTightenS": -1,
  "exit.bsTightenRatio": 1, "exit.bigSellSol": -1, "exit.bigSellSupplyPct": -1, "exit.maxProgressPct": -1,
  "risk.positionSol": -1, "risk.maxOpen": -1, "risk.dailyLossPct": -1,
};
export const isTightening = (param: string, from: number, to: number) => {
  const d = TIGHTEN_DIRECTION[param];
  return d !== undefined && Math.sign(to - from) === d;
};
