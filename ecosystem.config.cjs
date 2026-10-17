// pm2 process file: npm run up  (start all)  |  npm run down  |  npx pm2 logs
const tsx = "node_modules/tsx/dist/cli.mjs";
const common = { cwd: __dirname, interpreter: "node", autorestart: true, max_restarts: 1000, restart_delay: 3000, time: true };
module.exports = {
  apps: [
    { ...common, name: "pf-bot", script: tsx, args: "apps/bot/src/main.ts", max_memory_restart: "1500M" },
    { ...common, name: "pf-analyst", script: tsx, args: "apps/analyst/src/main.ts", max_memory_restart: "3000M", node_args: "--max-old-space-size=3072" },
    { ...common, name: "pf-telegram", script: tsx, args: "apps/telegram/src/main.ts", max_memory_restart: "500M" },
    { ...common, name: "pf-dashboard", cwd: __dirname + "/apps/dashboard", script: "../../node_modules/next/dist/bin/next", args: "start -p 3077 -H 127.0.0.1" },
  ],
};
