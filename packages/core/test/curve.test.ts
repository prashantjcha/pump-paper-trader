import { describe, it, expect } from "vitest";
import {
  buyQuote, sellQuote, price, mcapSol, applyBuy, progressPct, solRaised,
  INITIAL_REAL_TOKENS, INITIAL_VIRTUAL_SOL, INITIAL_VIRTUAL_TOKENS, LAMPORTS,
} from "../src/curve.ts";

const fresh = { vSol: INITIAL_VIRTUAL_SOL, vTok: INITIAL_VIRTUAL_TOKENS, rTok: INITIAL_REAL_TOKENS };

describe("curve", () => {
  it("initial mcap is ~28 SOL", () => {
    expect(mcapSol(fresh)).toBeCloseTo(27.96, 1);
  });
  it("buying out the real reserves raises ~85 SOL and ends above 400 SOL mcap", () => {
    const vTokEnd = fresh.vTok - fresh.rTok;
    const vSolEnd = (fresh.vSol * fresh.vTok) / vTokEnd;
    expect(solRaised(vSolEnd)).toBeCloseTo(85, 0);
    expect(mcapSol({ vSol: vSolEnd, vTok: vTokEnd })).toBeGreaterThan(400);
    expect(progressPct(0n)).toBe(100);
    expect(progressPct(INITIAL_REAL_TOKENS)).toBe(0);
  });
  it("round trip on an unchanged curve loses about two fees", () => {
    const b = buyQuote(fresh, LAMPORTS / 10n, 125);
    const after = applyBuy(fresh, b.net, b.tokens);
    const s = sellQuote(after, b.tokens, 125);
    const loss = 1 - Number(s.net) / 1e8;
    expect(loss).toBeGreaterThan(0.024);
    expect(loss).toBeLessThan(0.026);
  });
  it("buy moves price up", () => {
    const b = buyQuote(fresh, 3n * LAMPORTS, 125);
    expect(price(applyBuy(fresh, b.net, b.tokens))).toBeGreaterThan(price(fresh));
  });
});
