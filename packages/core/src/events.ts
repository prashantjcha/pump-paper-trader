import { createRequire } from "node:module";
import { Reader, readStruct, type IdlTypeDef } from "./borsh.ts";

const require = createRequire(import.meta.url);
const idl = require("../idl/pump.json") as {
  address: string;
  events: { name: string; discriminator: number[] }[];
  types: IdlTypeDef[];
};

export const PUMP_PROGRAM_ID = idl.address; // 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
const types = new Map(idl.types.map((t) => [t.name, t]));
const byDisc = new Map<string, string>();
for (const e of idl.events) byDisc.set(Buffer.from(e.discriminator).toString("hex"), e.name);

const ZERO_KEY = "11111111111111111111111111111111";
const WSOL = "So11111111111111111111111111111111111111112";
export const isSolQuote = (q: unknown) => q === undefined || q === null || q === ZERO_KEY || q === WSOL;

export interface Meta { slot: number; sig: string; recvMs: number }

export interface CreateEv extends Meta {
  kind: "create";
  mint: string; bondingCurve: string; creator: string; user: string;
  name: string; symbol: string; uri: string; chainTs: number;
  vTok: bigint; vSol: bigint; rTok: bigint; supply: bigint;
  solQuote: boolean; mayhem: boolean;
}
export interface TradeEv extends Meta {
  kind: "trade";
  mint: string; user: string; isBuy: boolean; sol: bigint; tokens: bigint; chainTs: number;
  vSol: bigint; vTok: bigint; rSol: bigint; rTok: bigint;
  feeBps: number; creatorFeeBps: number; creator: string; ix: string; solQuote: boolean; mayhem: boolean;
}
export interface CompleteEv extends Meta { kind: "complete"; mint: string; user: string; chainTs: number }
export type PumpEvent = CreateEv | TradeEv | CompleteEv;

const big = (v: unknown) => (typeof v === "bigint" ? v : 0n);
/** v2 events carry *_quote_* fields; legacy events only the *_sol_* fields. */
const quote = (legacy: unknown, q: unknown) => (big(q) > 0n ? big(q) : big(legacy));

export function decodeEventData(b64: string, meta: Meta): PumpEvent | null {
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 8) return null;
  const name = byDisc.get(buf.subarray(0, 8).toString("hex"));
  if (name !== "CreateEvent" && name !== "TradeEvent" && name !== "CompleteEvent") return null;
  const d = readStruct(new Reader(buf.subarray(8)), types.get(name)!, types) as Record<string, any>;

  if (name === "TradeEvent") {
    if (d.virtual_token_reserves === undefined) return null;
    return {
      kind: "trade", ...meta,
      mint: d.mint, user: d.user, isBuy: d.is_buy,
      sol: quote(d.sol_amount, d.quote_amount), tokens: big(d.token_amount), chainTs: Number(d.timestamp),
      vSol: quote(d.virtual_sol_reserves, d.virtual_quote_reserves), vTok: big(d.virtual_token_reserves),
      rSol: quote(d.real_sol_reserves, d.real_quote_reserves), rTok: big(d.real_token_reserves),
      feeBps: Number(d.fee_basis_points ?? 0n), creatorFeeBps: Number(d.creator_fee_basis_points ?? 0n),
      creator: d.creator ?? "", ix: d.ix_name ?? "", solQuote: isSolQuote(d.quote_mint), mayhem: !!d.mayhem_mode,
    };
  }
  if (name === "CreateEvent") {
    if (d.user === undefined) return null;
    return {
      kind: "create", ...meta,
      mint: d.mint, bondingCurve: d.bonding_curve, user: d.user, creator: d.creator ?? d.user,
      name: d.name, symbol: d.symbol, uri: d.uri, chainTs: Number(d.timestamp ?? 0n),
      vTok: big(d.virtual_token_reserves), vSol: quote(d.virtual_sol_reserves, d.virtual_quote_reserves),
      rTok: big(d.real_token_reserves), supply: big(d.token_total_supply),
      solQuote: isSolQuote(d.quote_mint), mayhem: !!d.is_mayhem_mode,
    };
  }
  return { kind: "complete", ...meta, mint: d.mint, user: d.user, chainTs: Number(d.timestamp ?? 0n) };
}

/**
 * Extracts pump events from a transaction's log lines. Only "Program data:" lines
 * emitted while the pump program is the executing program are considered.
 */
export function decodeLogs(logs: string[], meta: Meta): { events: PumpEvent[]; truncated: boolean } {
  const events: PumpEvent[] = [];
  const stack: string[] = [];
  let truncated = false;
  for (const line of logs) {
    if (line.startsWith("Program ") && line.includes(" invoke [")) { stack.push(line.split(" ")[1]); continue; }
    if (line.startsWith("Program ") && (line.endsWith(" success") || line.includes(" failed"))) { stack.pop(); continue; }
    if (line === "Log truncated") { truncated = true; continue; }
    if (line.startsWith("Program data: ") && stack[stack.length - 1] === PUMP_PROGRAM_ID) {
      try {
        const ev = decodeEventData(line.slice(14), meta);
        if (ev) events.push(ev);
      } catch {
        /* unknown layout: skip */
      }
    }
  }
  return { events, truncated };
}
