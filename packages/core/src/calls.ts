// Extracts Solana token mint addresses from a caller's message text.
import bs58 from "bs58";

const BASE58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
// Well-known program/system addresses that show up in messages but are never tokens to buy.
const IGNORE = new Set([
  "So11111111111111111111111111111111111111112", "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
]);

/** Valid 32-byte base58 addresses in order of first appearance, pump.fun-style mints first. */
export function extractMints(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(BASE58)) {
    const a = m[0];
    if (IGNORE.has(a) || found.includes(a)) continue;
    try { if (bs58.decode(a).length !== 32) continue; } catch { continue; }
    found.push(a);
  }
  return found.sort((x, y) => Number(y.endsWith("pump")) - Number(x.endsWith("pump")));
}
