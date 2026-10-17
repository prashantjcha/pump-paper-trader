// Redundant pump.fun log feed. Connects to several free public RPC WebSockets at
// once and de-duplicates by signature: whichever endpoint delivers first wins,
// which is both failover and a latency improvement. Helius is used only when all
// public feeds are down, under a daily byte budget (it bills per MB streamed).
import WebSocket from "ws";
import { PUMP_PROGRAM_ID } from "@pf/core/events";

export interface Notification { slot: number; signature: string; err: unknown; logs: string[]; recvMs: number; source: string }

interface Endpoint { name: string; url: string; fallback?: boolean }

export interface FeedStats {
  endpoints: Record<string, { connected: boolean; msgs: number; bytes: number; firsts: number; reconnects: number; lastMsgMs: number }>;
  delivered: number; duplicates: number; failedTx: number; heliusBytesToday: number; heliusDay: string;
}

export class Feed {
  private sockets = new Map<string, WebSocket>();
  private seen = new Map<string, number>();
  private allDownSince = 0;
  private timer?: NodeJS.Timeout;
  stats: FeedStats = { endpoints: {}, delivered: 0, duplicates: 0, failedTx: 0, heliusBytesToday: 0, heliusDay: "" };

  constructor(
    private endpoints: Endpoint[],
    private onNote: (n: Notification) => void,
    private log: (level: "info" | "warn" | "error", msg: string) => void,
    private heliusDailyMb = Number(process.env.HELIUS_DAILY_MB ?? 1000),
  ) {
    for (const e of endpoints) this.stats.endpoints[e.name] = { connected: false, msgs: 0, bytes: 0, firsts: 0, reconnects: 0, lastMsgMs: 0 };
  }

  start() {
    for (const e of this.endpoints) if (!e.fallback) this.connect(e);
    this.timer = setInterval(() => this.watchdog(), 2000);
  }

  stop() {
    clearInterval(this.timer);
    for (const ws of this.sockets.values()) ws.terminate();
  }

  private connect(e: Endpoint) {
    if (this.sockets.has(e.name)) return;
    const st = this.stats.endpoints[e.name];
    const ws = new WebSocket(e.url, { perMessageDeflate: false });
    this.sockets.set(e.name, ws);
    ws.on("open", () => {
      st.connected = true;
      st.lastMsgMs = Date.now();
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params: [{ mentions: [PUMP_PROGRAM_ID] }, { commitment: "processed" }] }));
      this.log("info", `feed ${e.name} connected`);
    });
    ws.on("message", (raw: Buffer) => {
      const now = Date.now();
      st.msgs++; st.bytes += raw.length; st.lastMsgMs = now;
      if (e.fallback) this.countHelius(raw.length);
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.id === 1) { if (msg.error) this.log("error", `feed ${e.name} subscribe error ${JSON.stringify(msg.error)}`); return; }
      const v = msg.params?.result?.value;
      if (!v?.signature) return;
      if (this.seen.has(v.signature)) { this.stats.duplicates++; return; }
      this.seen.set(v.signature, now);
      st.firsts++;
      if (v.err) { this.stats.failedTx++; }
      this.stats.delivered++;
      this.onNote({ slot: msg.params.result.context.slot, signature: v.signature, err: v.err, logs: v.logs ?? [], recvMs: now, source: e.name });
    });
    const drop = (why: string) => {
      if (this.sockets.get(e.name) !== ws) return;
      this.sockets.delete(e.name);
      st.connected = false;
      st.reconnects++;
      this.log("warn", `feed ${e.name} down (${why})`);
      if (!e.fallback) setTimeout(() => this.connect(e), Math.min(30_000, 1000 * 2 ** Math.min(st.reconnects, 5)));
    };
    ws.on("close", (code) => drop("close " + code));
    ws.on("error", (err) => { drop("error " + err.message); try { ws.terminate(); } catch { /* ignore */ } });
  }

  private countHelius(bytes: number) {
    const day = new Date().toISOString().slice(0, 10);
    if (this.stats.heliusDay !== day) { this.stats.heliusDay = day; this.stats.heliusBytesToday = 0; }
    this.stats.heliusBytesToday += bytes;
  }

  private watchdog() {
    const now = Date.now();
    // Stale sockets (connected but silent) are recycled.
    for (const e of this.endpoints) {
      const ws = this.sockets.get(e.name);
      const st = this.stats.endpoints[e.name];
      if (ws && st.connected && now - st.lastMsgMs > 20_000) { this.log("warn", `feed ${e.name} silent 20s, recycling`); ws.terminate(); }
    }
    // Trim the de-dup set.
    if (this.seen.size > 200_000) for (const [k, t] of this.seen) { if (now - t > 60_000) this.seen.delete(k); }
    // Fallback: only while every public feed is down, and within the daily budget.
    const publicUp = this.endpoints.some((e) => !e.fallback && this.stats.endpoints[e.name].connected);
    if (publicUp) this.allDownSince = 0; else if (!this.allDownSince) this.allDownSince = now;
    for (const e of this.endpoints.filter((x) => x.fallback)) {
      const within = this.stats.heliusBytesToday / 1e6 < this.heliusDailyMb;
      const want = !publicUp && now - this.allDownSince > 15_000 && within;
      const ws = this.sockets.get(e.name);
      if (want && !ws) { this.log("warn", `all public feeds down, starting fallback ${e.name}`); this.connect(e); }
      if (!want && ws) { this.log("info", `stopping fallback ${e.name} (${within ? "public feed back" : "daily budget reached"})`); this.sockets.delete(e.name); this.stats.endpoints[e.name].connected = false; ws.terminate(); }
    }
  }
}

export function defaultEndpoints(): Endpoint[] {
  const list: Endpoint[] = [
    { name: "publicnode", url: "wss://solana-rpc.publicnode.com" },
    { name: "solana-mainnet", url: "wss://api.mainnet-beta.solana.com" },
  ];
  for (const extra of (process.env.EXTRA_WS ?? "").split(",").filter(Boolean)) list.push({ name: new URL(extra).host, url: extra });
  if (process.env.HELIUS_API_KEY) list.push({ name: "helius", url: `wss://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, fallback: true });
  return list;
}
