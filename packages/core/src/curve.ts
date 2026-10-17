// Pump.fun bonding curve math (constant product on virtual reserves).
// Mirrors @pump-fun/pump-sdk bondingCurve.ts. Raw units throughout:
// lamports for SOL (1e9), token base units (6 decimals).
export const LAMPORTS = 1_000_000_000n;
export const TOKEN_UNIT = 1_000_000n;
export const TOTAL_SUPPLY = 1_000_000_000n * TOKEN_UNIT;
export const INITIAL_REAL_TOKENS = 793_100_000n * TOKEN_UNIT;
export const INITIAL_VIRTUAL_SOL = 30n * LAMPORTS;
export const INITIAL_VIRTUAL_TOKENS = 1_073_000_000n * TOKEN_UNIT;

export interface Reserves { vSol: bigint; vTok: bigint; rTok: bigint }

export const lamportsToSol = (l: bigint | number) => Number(l) / 1e9;
export const solToLamports = (s: number) => BigInt(Math.round(s * 1e9));

/** Spot price in SOL per whole token. */
export function price(r: Pick<Reserves, "vSol" | "vTok">): number {
  if (r.vTok === 0n) return 0;
  return Number(r.vSol) / 1e9 / (Number(r.vTok) / 1e6);
}

/** Market cap in SOL for a 1B supply. */
export const mcapSol = (r: Pick<Reserves, "vSol" | "vTok">) => price(r) * 1e9;

/** Tokens received for a buy of `lamportsIn` gross (fee deducted first, as the SDK does). */
export function buyQuote(r: Reserves, lamportsIn: bigint, feeBps: number): { tokens: bigint; net: bigint } {
  if (lamportsIn <= 1n || r.vTok === 0n) return { tokens: 0n, net: 0n };
  const net = ((lamportsIn - 1n) * 10_000n) / BigInt(10_000 + feeBps);
  const out = (net * r.vTok) / (r.vSol + net);
  return { tokens: out < r.rTok ? out : r.rTok, net };
}

/** Lamports received for selling `tokensIn` (fee deducted from gross proceeds). */
export function sellQuote(r: Reserves, tokensIn: bigint, feeBps: number): { net: bigint; gross: bigint } {
  if (tokensIn <= 0n || r.vTok === 0n) return { net: 0n, gross: 0n };
  const gross = (tokensIn * r.vSol) / (r.vTok + tokensIn);
  const fee = (gross * BigInt(feeBps) + 9_999n) / 10_000n;
  return { net: gross - fee, gross };
}

export function applyBuy(r: Reserves, lamportsNet: bigint, tokensOut: bigint): Reserves {
  return { vSol: r.vSol + lamportsNet, vTok: r.vTok - tokensOut, rTok: r.rTok - tokensOut };
}
export function applySell(r: Reserves, tokensIn: bigint, lamportsGross: bigint): Reserves {
  return { vSol: r.vSol - lamportsGross, vTok: r.vTok + tokensIn, rTok: r.rTok + tokensIn };
}

/** Bonding curve progress 0..100 from real token reserves. */
export function progressPct(rTok: bigint, initialRealTok = INITIAL_REAL_TOKENS): number {
  const p = 100 - (Number(rTok) / Number(initialRealTok)) * 100;
  return Math.max(0, Math.min(100, p));
}

/** SOL raised so far (virtual SOL minus the initial virtual 30 SOL). */
export const solRaised = (vSol: bigint, initialVSol = INITIAL_VIRTUAL_SOL) => lamportsToSol(vSol - initialVSol);
