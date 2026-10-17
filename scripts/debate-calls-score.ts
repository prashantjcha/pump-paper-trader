// Scores a finished debate's proposals on calls made after its snapshot (the forward holdout), once they have 24 h of data.
//   npx tsx scripts/debate-calls-score.ts research/debate-calls/<id> [--from ISO] [--fetch]
// --fetch first pulls Codex data for new calls (price bars, pre-call trades, order flow).
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, DATA_DIR } from "../packages/core/src/db.ts";
import { evaluate } from "./lib/callsSim.ts";

const args = process.argv.slice(2);
const dir = resolve(args[0]);
const opt = (k: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : undefined; };
const brief = readFileSync(resolve(dir, "brief.md"), "utf8");
const from = opt("from") ? Date.parse(opt("from")!) : Date.parse(brief.match(/ending (\S+)\)/)![1]);
const to = Date.now() - 24 * 3_600_000;
if (args.includes("--fetch")) for (const s of ["scripts/calls-fetch-codex.ts", "scripts/calls-fetch-flow.ts"]) spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", s], { cwd: ROOT, stdio: "inherit" });
const files = [...["young-token.ts", "baseline-trail.ts"].map((f) => resolve(ROOT, "research/debate-calls/examples", f)),
  ...readdirSync(resolve(dir, "proposals")).filter((f) => f.endsWith(".ts")).sort().map((f) => resolve(dir, "proposals", f))];
let md = `# Forward holdout score\n\nCalls from ${new Date(from).toISOString()} to ${new Date(to).toISOString()} (each with 24 h of data), scored ${new Date().toISOString()}.\n\n| Strategy | Trades | Mean SOL | Trimmed mean | Total SOL | Total w/o best | Win | 5x captured |\n|---|---|---|---|---|---|---|---|\n`;
for (const f of files) {
  try {
    const s = (await import(pathToFileURL(f).href)).default;
    const r = evaluate(s, DATA_DIR, from, to);
    md += `| ${f.split(/[\\/]/).pop()} — ${s.name} | ${r.entries} | ${r.meanSol ?? "–"} | ${r.trimmedMeanSol ?? "–"} | ${r.totalSol} | ${r.totalWithoutBestSol} | ${r.winRate ?? "–"}% | ${r.captured5x}/${r.tokensThatRan5x} |\n`;
  } catch (e) { md += `| ${f} | error: ${(e as Error).message.slice(0, 100)} |\n`; }
}
writeFileSync(resolve(dir, `holdout-${new Date().toISOString().slice(0, 10)}.md`), md);
console.log(md);
