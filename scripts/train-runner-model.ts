// Trains the early-runner model on recent archive data and installs it for the runner book.
//   npx tsx scripts/train-runner-model.ts [--hours 48] [--quantile 0.95] [--dry-run]
// The bot hot-reloads config/runner-model.json within a few seconds. Each version only ever trades
// on data after its training cutoff, so the runner book is an honest forward test.
import { loadRunnerModel, saveRunnerModel, trainRunnerModel, RUNNER_MODEL_PATH } from "../packages/core/src/runnerModel.ts";

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const hours = Number(opt("hours", "48"));
const to = Date.now(), from = to - hours * 3_600_000;
const prev = loadRunnerModel();
const version = (prev?.version ?? 0) + 1;
const t0 = Date.now();
const m = trainRunnerModel({ from, to, version, quantile: Number(opt("quantile", "0.95")) });
if (!m) { console.log("not enough data to train (need 1000 snapshots and 50 positives)"); process.exit(1); }
console.log(JSON.stringify({ version: m.version, threshold: m.threshold, trainFrom: new Date(m.trainFrom).toISOString(), trainTo: new Date(m.trainTo).toISOString(), stats: m.stats, tookMs: Date.now() - t0 }, null, 2));
if (!args.includes("--dry-run")) { saveRunnerModel(m); console.log(`saved ${RUNNER_MODEL_PATH} (v${m.version})`); }
