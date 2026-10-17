import { resolve } from "node:path";
import { ROOT } from "../../packages/core/src/db.ts";

/**
 * A lean environment for the agent CLIs. Process managers (pm2) inject large variables that push Windows
 * command lines past their length limit, and node must be on PATH for the agents' own shells.
 */
export function cleanEnv(): NodeJS.ProcessEnv {
  const keep: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(pm_|PM2|axm|pm2_|unique_id|NODE_APP_INSTANCE|namespace|exit_code|status|restart_time|created_at|pm_uptime|versioning|node_version|version|autorestart|instances|exec_mode|merge_logs|vizion|watch|treekill|automation|username|windowsHide|kill_retry_time|unstable_restarts|prev_restart_delay|kill_timeout|instance_var|filter_env|env)$/i.test(k)) continue;
    if (k.toUpperCase() !== "PATH" && v.length > 2000) continue;
    keep[k] = v;
  }
  const nodeDir = resolve(process.execPath, "..");
  const pathKey = Object.keys(keep).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  keep[pathKey] = `${nodeDir};${resolve(ROOT, "node_modules/.bin")};${keep[pathKey] ?? ""}`;
  return keep;
}

