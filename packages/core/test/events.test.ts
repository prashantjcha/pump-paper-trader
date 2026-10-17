import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { decodeLogs, type TradeEv } from "../src/events.ts";
import { price } from "../src/curve.ts";
import { serialize, deserialize } from "../src/rawio.ts";

const fx = resolve(import.meta.dirname, "fixtures/logs.json");

describe.skipIf(!existsSync(fx))("event decoder on live fixtures", () => {
  const rows = JSON.parse(readFileSync(fx, "utf8")) as { slot: number; signature: string; err: unknown; logs: string[] }[];
  const events = rows
    .filter((r) => !r.err)
    .flatMap((r) => decodeLogs(r.logs, { slot: r.slot, sig: r.signature, recvMs: 0 }).events);
  const trades = events.filter((e): e is TradeEv => e.kind === "trade");

  it("decodes trades", () => {
    expect(trades.length).toBeGreaterThan(50);
  });
  it("failed txs produce no events", () => {
    const n = rows.filter((r) => r.err).flatMap((r) => decodeLogs(r.logs, { slot: 0, sig: "", recvMs: 0 }).events).length;
    expect(n).toBe(0);
  });
  it("fee bps match the published schedule (1.25% = 95 protocol + 30 creator)", () => {
    const sol = trades.filter((t) => t.solQuote && !t.mayhem);
    const share = sol.filter((t) => t.feeBps + t.creatorFeeBps === 125).length / sol.length;
    expect(share).toBeGreaterThan(0.9);
  });
  it("execution price of small trades is consistent with post-trade reserves", () => {
    const small = trades.filter((t) => t.solQuote && !t.mayhem && t.sol > 0n && t.tokens > 0n && Number(t.sol) < 5e8);
    let ok = 0;
    for (const t of small) {
      const exec = Number(t.sol) / 1e9 / (Number(t.tokens) / 1e6);
      if (Math.abs(exec / price(t) - 1) < 0.1) ok++;
    }
    expect(ok / small.length).toBeGreaterThan(0.97);
  });
  it("round-trips through the raw archive format", () => {
    expect(deserialize(serialize(trades[0]))).toEqual(trades[0]);
  });
});
