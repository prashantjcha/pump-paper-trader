import { describe, it, expect } from "vitest";
import { extractMints } from "../src/calls.ts";

describe("extractMints", () => {
  it("finds pump mints in plain text and URLs", () => {
    const t = "🚀 new call $CAT  CA: HdV17YZbXy8isu3VyvrPWdoUwB8MXDkDHrrr3SfHpump\nhttps://pump.fun/coin/2ruME28a36i98F9vu8DgeoxCaefDZCeJVZ9eXPQ4pump";
    expect(extractMints(t)).toEqual(["HdV17YZbXy8isu3VyvrPWdoUwB8MXDkDHrrr3SfHpump", "2ruME28a36i98F9vu8DgeoxCaefDZCeJVZ9eXPQ4pump"]);
  });
  it("ignores system addresses, duplicates and non-addresses", () => {
    const t = "So11111111111111111111111111111111111111112 hello 0xdeadbeef HdV17YZbXy8isu3VyvrPWdoUwB8MXDkDHrrr3SfHpump HdV17YZbXy8isu3VyvrPWdoUwB8MXDkDHrrr3SfHpump";
    expect(extractMints(t)).toEqual(["HdV17YZbXy8isu3VyvrPWdoUwB8MXDkDHrrr3SfHpump"]);
  });
  it("rejects base58 strings that are not 32 bytes", () => {
    expect(extractMints("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toEqual([]);
  });
});
