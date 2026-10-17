// Tolerant borsh reader driven by IDL field lists. Pump events have had fields
// appended over time, so older-layout events on-chain must still decode: any
// field past the end of the buffer is left undefined instead of throwing.
import bs58 from "bs58";

export type IdlType =
  | string
  | { vec?: IdlType; array?: [IdlType, number]; option?: IdlType; defined?: { name: string } };
export interface IdlField { name: string; type: IdlType }
export interface IdlTypeDef { name: string; type: { kind: string; fields?: IdlField[] } }

export class Reader {
  off = 0;
  constructor(public buf: Buffer) {}
  left() { return this.buf.length - this.off; }
  need(n: number) { if (this.left() < n) throw new RangeError("eof"); }
  u8() { this.need(1); return this.buf.readUInt8(this.off++); }
  u16() { this.need(2); const v = this.buf.readUInt16LE(this.off); this.off += 2; return v; }
  u32() { this.need(4); const v = this.buf.readUInt32LE(this.off); this.off += 4; return v; }
  u64() { this.need(8); const v = this.buf.readBigUInt64LE(this.off); this.off += 8; return v; }
  i64() { this.need(8); const v = this.buf.readBigInt64LE(this.off); this.off += 8; return v; }
  u128() { this.need(16); const lo = this.buf.readBigUInt64LE(this.off); const hi = this.buf.readBigUInt64LE(this.off + 8); this.off += 16; return (hi << 64n) + lo; }
  i128() { this.need(16); const lo = this.buf.readBigUInt64LE(this.off); const hi = this.buf.readBigInt64LE(this.off + 8); this.off += 16; return (hi << 64n) + lo; }
  bool() { return this.u8() !== 0; }
  pubkey() { this.need(32); const s = bs58.encode(this.buf.subarray(this.off, this.off + 32)); this.off += 32; return s; }
  string() { const n = this.u32(); this.need(n); const s = this.buf.toString("utf8", this.off, this.off + n); this.off += n; return s; }
}

export function readType(r: Reader, t: IdlType, types: Map<string, IdlTypeDef>): unknown {
  if (typeof t === "string") {
    switch (t) {
      case "u8": return r.u8();
      case "u16": return r.u16();
      case "u32": return r.u32();
      case "u64": return r.u64();
      case "i64": return r.i64();
      case "u128": return r.u128();
      case "i128": return r.i128();
      case "bool": return r.bool();
      case "pubkey": return r.pubkey();
      case "string": return r.string();
      default: throw new Error("unsupported idl type " + t);
    }
  }
  if (t.vec) { const n = r.u32(); const out = []; for (let i = 0; i < n; i++) out.push(readType(r, t.vec, types)); return out; }
  if (t.array) { const out = []; for (let i = 0; i < t.array[1]; i++) out.push(readType(r, t.array[0], types)); return out; }
  if (t.option) return r.u8() ? readType(r, t.option, types) : null;
  if (t.defined) return readStruct(r, types.get(t.defined.name)!, types, false);
  throw new Error("unsupported idl type " + JSON.stringify(t));
}

/** Reads a struct. When tolerant, stops cleanly at end-of-buffer. */
export function readStruct(
  r: Reader,
  def: IdlTypeDef,
  types: Map<string, IdlTypeDef>,
  tolerant = true,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.type.fields ?? []) {
    if (tolerant && r.left() === 0) break;
    const start = r.off;
    try {
      out[f.name] = readType(r, f.type, types);
    } catch (e) {
      if (tolerant && e instanceof RangeError) { r.off = start; break; }
      throw e;
    }
  }
  return out;
}
