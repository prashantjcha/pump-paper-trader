// Runs one retrospective now: npm run retro [-- --force]
import "dotenv/config";
import { openDb } from "@pf/core/db";
import { runRetrospective } from "./learning.ts";

const db = openDb();
console.log(await runRetrospective(db, { force: process.argv.includes("--force") }));
