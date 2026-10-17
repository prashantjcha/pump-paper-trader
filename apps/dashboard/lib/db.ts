import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { statSync, existsSync } from "node:fs";

export const DATA_DIR = process.env.PF_DATA_DIR ?? resolve(process.cwd(), "../../data");
export const DB_PATH = resolve(DATA_DIR, "pumpfun.db");
export const KILL_PATH = resolve(DATA_DIR, "KILL");

let ro: DatabaseSync | null = null;

/** Read-only connection shared across requests. The bot and analyst own all writes. */
export function db(): DatabaseSync {
  if (!ro) {
    ro = new DatabaseSync(DB_PATH, { readOnly: true });
    ro.exec("PRAGMA busy_timeout = 5000;");
  }
  return ro;
}

/** Short-lived write connection for the two dashboard controls (manual signal, nothing else). */
export function withWriteDb<T>(fn: (d: DatabaseSync) => T): T {
  const w = new DatabaseSync(DB_PATH);
  w.exec("PRAGMA busy_timeout = 5000;");
  try { return fn(w); } finally { w.close(); }
}

export const all = <T = Record<string, any>>(sql: string, ...args: any[]) => db().prepare(sql).all(...args) as T[];
export const one = <T = Record<string, any>>(sql: string, ...args: any[]) => db().prepare(sql).get(...args) as T | undefined;

export function kv(key: string): any {
  const r = one<{ value: string }>("SELECT value FROM kv WHERE key = ?", key);
  return r ? JSON.parse(r.value) : null;
}

export function dbSizeMb(): number {
  let total = 0;
  for (const f of [DB_PATH, DB_PATH + "-wal"]) if (existsSync(/*turbopackIgnore: true*/ f)) total += statSync(/*turbopackIgnore: true*/ f).size;
  return total / 1e6;
}
