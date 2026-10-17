// Raw event archive: one gzip JSONL file per UTC hour. This is the replay corpus.
import { createGzip, gunzipSync } from "node:zlib";
import { createWriteStream, mkdirSync, existsSync, readdirSync, rmSync, type WriteStream } from "node:fs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PumpEvent } from "./events.ts";
import { DATA_DIR } from "./db.ts";

export const RAW_DIR = resolve(DATA_DIR, "raw");

const BIG_FIELDS = ["sol", "tokens", "vSol", "vTok", "rSol", "rTok", "supply"] as const;

export function serialize(e: PumpEvent): string {
  return JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}
export function deserialize(line: string): PumpEvent {
  const o = JSON.parse(line);
  for (const k of BIG_FIELDS) if (typeof o[k] === "string") o[k] = BigInt(o[k]);
  return o as PumpEvent;
}

const hourKey = (ms: number) => new Date(ms).toISOString().slice(0, 13); // YYYY-MM-DDTHH
const hourPath = (key: string) => resolve(RAW_DIR, key.slice(0, 10), `${key.slice(11, 13)}.${process.pid}.jsonl.gz`);

export class RawWriter {
  private key = "";
  private gz: ReturnType<typeof createGzip> | null = null;
  private out: WriteStream | null = null;
  write(e: PumpEvent) {
    const key = hourKey(e.recvMs);
    if (key !== this.key) this.rotate(key);
    this.gz!.write(serialize(e) + "\n");
  }
  private rotate(key: string) {
    this.close();
    this.key = key;
    const path = hourPath(key);
    mkdirSync(resolve(path, ".."), { recursive: true });
    this.gz = createGzip();
    this.out = createWriteStream(path, { flags: "a" }); // a new gzip member per process start; gunzip handles concatenation
    this.gz.pipe(this.out);
  }
  flush() { this.gz?.flush(); }
  close() { this.gz?.end(); this.gz = null; this.out = null; }
}

/** Lists archive files overlapping [fromMs, toMs], in time order. */
export function rawFiles(fromMs: number, toMs: number): string[] {
  if (!existsSync(RAW_DIR)) return [];
  const out: string[] = [];
  for (const day of readdirSync(RAW_DIR).sort()) {
    for (const f of readdirSync(resolve(RAW_DIR, day)).sort()) {
      const hourStart = Date.parse(`${day}T${f.slice(0, 2)}:00:00Z`);
      if (hourStart + 3_600_000 < fromMs || hourStart > toMs) continue;
      out.push(resolve(RAW_DIR, day, f));
    }
  }
  return out;
}

/** Yields events in [fromMs, toMs] sorted by receive time (files from several processes are merged per hour). */
export function* readRaw(fromMs: number, toMs: number): Generator<PumpEvent> {
  const files = rawFiles(fromMs, toMs);
  const byHour = new Map<string, string[]>();
  for (const f of files) { const k = f.replace(/\.\d+\.jsonl\.gz$/, ""); byHour.set(k, [...(byHour.get(k) ?? []), f]); }
  for (const group of [...byHour.keys()].sort()) {
    const evs: PumpEvent[] = [];
    for (const f of byHour.get(group)!) {
      let text = "";
      try { text = gunzipSync(readFileSync(f), { finishFlush: 2 /* Z_SYNC_FLUSH */ }).toString("utf8"); } catch { continue; }
      for (const line of text.split("\n")) {
        if (!line) continue;
        try { const e = deserialize(line); if (e.recvMs >= fromMs && e.recvMs <= toMs) evs.push(e); } catch { /* partial last line */ }
      }
    }
    evs.sort((a, b) => a.recvMs - b.recvMs);
    yield* evs;
  }
}

export function pruneRaw(keepDays: number) {
  if (!existsSync(RAW_DIR)) return;
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 10);
  for (const day of readdirSync(RAW_DIR)) if (day < cutoff) rmSync(resolve(RAW_DIR, day), { recursive: true, force: true });
}
