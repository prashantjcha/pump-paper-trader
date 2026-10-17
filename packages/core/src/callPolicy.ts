// Exit policies for called tokens, as a bar-by-bar state machine shared by the backtest (minute bars)
// and the live call trader (each price poll is a bar with open = high = low = close).
// Within a bar the stop is checked before any target (stop wins ties); a gap through the stop fills at the open.

export type PolicySpec =
  | { family: "fixed"; tp: number; sl: number }
  | { family: "trailing"; arm: number; trail: number; sl: number }
  | { family: "scale-out"; x: number; trail: number; sl: number }
  | { family: "hold-runner"; x: number; tMin: number; trail: number; sl?: number }
  | { family: "time"; hMin: number; sl: number | null };

export interface PBar { t: number; o: number; h: number; l: number; c: number }
export interface PFill { px: number; frac: number; t: number; reason: string }

export const HORIZON_MS = 72 * 3_600_000;

export function policyName(p: PolicySpec): string {
  switch (p.family) {
    case "fixed": return `fixed tp${p.tp} sl${p.sl}`;
    case "trailing": return `trail arm${p.arm} trail${p.trail} sl${p.sl}`;
    case "scale-out": return `half at +${p.x}% then trail${p.trail} sl${p.sl}`;
    case "hold-runner": return `runner +${p.x}% in ${p.tMin}m then trail${p.trail}${p.sl ? ` sl${p.sl}` : ""}`;
    case "time": return `hold ${p.hMin >= 60 ? p.hMin / 60 + "h" : p.hMin + "m"}${p.sl ? ` sl${p.sl}` : ""}`;
  }
}

export class PolicyState {
  peak: number;
  left = 1;
  armed: boolean;
  runner = false;
  done = false;
  constructor(public spec: PolicySpec, public entry: number, public entryMs: number) {
    this.peak = entry;
    this.armed = spec.family === "trailing" && spec.arm === 0;
  }

  private stopPx(): number {
    const s = this.spec, e = this.entry;
    switch (s.family) {
      case "fixed": return e * (1 - s.sl / 100);
      case "trailing": return Math.max(e * (1 - s.sl / 100), this.armed ? this.peak * (1 - s.trail / 100) : 0);
      case "scale-out": return this.left < 1 ? this.peak * (1 - s.trail / 100) : e * (1 - s.sl / 100);
      case "hold-runner": return this.runner ? this.peak * (1 - s.trail / 100) : e * (1 - (s.sl ?? 35) / 100);
      case "time": return s.sl ? e * (1 - s.sl / 100) : 0;
    }
  }

  /** Advances one bar; returns the fills it produced (possibly several for scale-out). */
  onBar(b: PBar): PFill[] {
    if (this.done) return [];
    const s = this.spec, e = this.entry, out: PFill[] = [];
    const exitAll = (px: number, reason: string) => { out.push({ px, frac: this.left, t: b.t, reason }); this.left = 0; this.done = true; return out; };
    const stop = this.stopPx();
    if (stop > 0 && b.l <= stop) return exitAll(b.o <= stop ? b.o : stop, "stop");
    this.peak = Math.max(this.peak, b.h);
    const age = b.t - this.entryMs;
    switch (s.family) {
      case "fixed":
        if (b.h >= e * (1 + s.tp / 100)) return exitAll(Math.max(e * (1 + s.tp / 100), b.o), "take_profit");
        break;
      case "trailing":
        if (!this.armed && this.peak >= e * (1 + s.arm / 100)) this.armed = true;
        break;
      case "scale-out":
        if (this.left === 1 && b.h >= e * (1 + s.x / 100)) { out.push({ px: Math.max(e * (1 + s.x / 100), b.o), frac: 0.5, t: b.t, reason: "scale_out" }); this.left = 0.5; }
        break;
      case "hold-runner": {
        const early = age <= s.tMin * 60_000;
        if (!this.runner && early && this.peak >= e * (1 + s.x / 100)) this.runner = true;
        if (!this.runner && !early) return exitAll(b.o, "no_run");
        break;
      }
      case "time":
        if (age >= s.hMin * 60_000) return exitAll(b.o, "time");
        break;
    }
    if (age >= HORIZON_MS) return exitAll(b.c, "horizon");
    return out;
  }

  /** Forces the remaining position out (end of data). */
  close(b: PBar, reason = "end_of_data"): PFill[] {
    if (this.done) return [];
    this.done = true;
    const f = { px: b.c, frac: this.left, t: b.t, reason };
    this.left = 0;
    return [f];
  }
}

export const POLICY_GRID: PolicySpec[] = [
  ...[30, 50, 100, 200, 500].flatMap((tp) => [20, 35, 50].map((sl) => ({ family: "fixed" as const, tp, sl }))),
  ...[0, 30, 100].flatMap((arm) => [20, 35, 50].flatMap((trail) => [35, 50].map((sl) => ({ family: "trailing" as const, arm, trail, sl })))),
  ...[100, 200].flatMap((x) => [35, 50].flatMap((trail) => [35, 50].map((sl) => ({ family: "scale-out" as const, x, trail, sl })))),
  ...[50, 100].flatMap((x) => [15, 60].flatMap((tMin) => [40, 60].map((trail) => ({ family: "hold-runner" as const, x, tMin, trail })))),
  // Added after the first run (post hoc): fail fast unless already running, then ride with a wide trail.
  ...[30, 50].flatMap((x) => [3, 5].flatMap((tMin) => [40, 50].flatMap((trail) => [20, 30].map((sl) => ({ family: "hold-runner" as const, x, tMin, trail, sl }))))),
  ...[15, 60, 360, 1440, 4320].flatMap((hMin) => [35, 60, null].map((sl) => ({ family: "time" as const, hMin, sl }))),
];

/** Venue fee per side in percent. Curve 1.25%; PumpSwap about 1% at small caps; Raydium and Meteora lower. */
export function venueFeePct(venue: string): number {
  if (venue === "pump-fun" || venue === "pumpfun") return 1.25;
  if (venue === "pumpswap") return 1.0;
  if (venue.startsWith("raydium")) return 0.5;
  if (venue.startsWith("meteora")) return 0.8;
  return 1.0;
}
