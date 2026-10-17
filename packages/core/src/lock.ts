// Single-instance guard: two bots writing the same database double-count every
// trade and both paper-trade the same books.
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "./db.ts";

function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

export function acquireLock(name: string): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const path = resolve(DATA_DIR, `${name}.lock`);
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, "utf8").trim());
    if (pid && pid !== process.pid && alive(pid)) {
      console.error(`${name} is already running as pid ${pid} (lock ${path}). Refusing to start a second instance.`);
      process.exit(1);
    }
  }
  writeFileSync(path, String(process.pid));
  const release = () => { try { if (readFileSync(path, "utf8").trim() === String(process.pid)) rmSync(path); } catch { /* ignore */ } };
  process.on("exit", release);
}
