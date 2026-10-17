import { connection } from "next/server";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { KILL_PATH, withWriteDb } from "@/lib/db";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function POST(req: Request) {
  await connection();
  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case "kill":
      writeFileSync(/*turbopackIgnore: true*/ KILL_PATH, `engaged from dashboard ${new Date().toISOString()}\n`);
      return Response.json({ killed: true });
    case "unkill":
      if (existsSync(/*turbopackIgnore: true*/ KILL_PATH)) rmSync(/*turbopackIgnore: true*/ KILL_PATH);
      return Response.json({ killed: false });
    case "signal": {
      const mint = String(body.mint ?? "").trim();
      if (!MINT_RE.test(mint)) return Response.json({ error: "not a valid mint address" }, { status: 400 });
      const source = String(body.source ?? "manual").slice(0, 60);
      const id = withWriteDb((d) => Number(d.prepare(`INSERT INTO manual_signals(mint,source,note,created_ms) VALUES (?,?,?,?)`).run(mint, source, String(body.note ?? "").slice(0, 200), Date.now()).lastInsertRowid));
      return Response.json({ id });
    }
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
}
