// Step-1 feed verification: subscribe to pump program logs for N seconds and report
// decode coverage, failed-tx share, truncation rate, and save fixtures for tests.
import "dotenv/config";
import WebSocket from "ws";
import { mkdirSync, writeFileSync } from "node:fs";
import { decodeLogs, PUMP_PROGRAM_ID } from "@pf/core/events";
import { price, solRaised } from "@pf/core/curve";

const secs = Number(process.argv[2] ?? 60);
const url = `wss://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const ws = new WebSocket(url);
const stats = { notifications: 0, failed: 0, truncated: 0, noEvents: 0, create: 0, trade: 0, complete: 0, usdc: 0, buys: 0, sells: 0, ixNames: {} as Record<string, number> };
const fixtures: unknown[] = [];
let sample: any = null;

ws.on("open", () => {
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params: [{ mentions: [PUMP_PROGRAM_ID] }, { commitment: "processed" }] }));
  console.log(`subscribed, collecting ${secs}s...`);
  setTimeout(() => ws.close(), secs * 1000);
});
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id === 1) { console.log("subscription id", msg.result ?? msg.error); return; }
  const v = msg.params?.result?.value;
  if (!v) return;
  stats.notifications++;
  if (fixtures.length < 400) fixtures.push({ slot: msg.params.result.context.slot, ...v });
  if (v.err) { stats.failed++; return; }
  const { events, truncated } = decodeLogs(v.logs, { slot: msg.params.result.context.slot, sig: v.signature, recvMs: Date.now() });
  if (truncated) stats.truncated++;
  if (!events.length) stats.noEvents++;
  for (const e of events) {
    stats[e.kind]++;
    if (e.kind === "trade") {
      if (!e.solQuote) stats.usdc++;
      e.isBuy ? stats.buys++ : stats.sells++;
      stats.ixNames[e.ix || "(none)"] = (stats.ixNames[e.ix || "(none)"] ?? 0) + 1;
      if (!sample && e.solQuote && e.sol > 0n) sample = e;
    }
  }
});
ws.on("error", (e) => console.error("ws error", e.message));
ws.on("close", () => {
  mkdirSync("packages/core/test/fixtures", { recursive: true });
  writeFileSync("packages/core/test/fixtures/logs.json", JSON.stringify(fixtures));
  console.log(JSON.stringify(stats, null, 2));
  console.log(`rate: ${(stats.notifications / secs).toFixed(1)} tx/s`);
  if (sample) {
    const execPrice = Number(sample.sol) / 1e9 / (Number(sample.tokens) / 1e6);
    console.log("sample trade", { mint: sample.mint, isBuy: sample.isBuy, sol: Number(sample.sol) / 1e9, execPrice, spotAfter: price(sample), solRaised: solRaised(sample.vSol), feeBps: sample.feeBps, creatorFeeBps: sample.creatorFeeBps });
  }
});
