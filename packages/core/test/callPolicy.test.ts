import { describe, it, expect } from "vitest";
import { PolicyState, type PBar } from "../src/callPolicy.ts";

const bar = (t: number, o: number, h: number, l: number, c: number): PBar => ({ t: t * 60_000, o, h, l, c });

describe("call policies", () => {
  it("stop wins when one bar touches both the stop and the target", () => {
    const st = new PolicyState({ family: "fixed", tp: 50, sl: 20 }, 1, 0);
    expect(st.onBar(bar(0, 1, 1.6, 0.7, 1.2))).toEqual([{ px: 0.8, frac: 1, t: 0, reason: "stop" }]);
  });
  it("a gap through the stop fills at the bar open", () => {
    const st = new PolicyState({ family: "fixed", tp: 50, sl: 20 }, 1, 0);
    st.onBar(bar(0, 1, 1.05, 0.95, 1));
    expect(st.onBar(bar(1, 0.5, 0.6, 0.4, 0.45))[0].px).toBe(0.5);
  });
  it("trailing stop arms at the arm level and trails the peak from the previous bars", () => {
    const st = new PolicyState({ family: "trailing", arm: 100, trail: 30, sl: 50 }, 1, 0);
    expect(st.onBar(bar(0, 1, 2.2, 0.9, 2))).toEqual([]); // armed, peak 2.2
    expect(st.onBar(bar(1, 2, 2.1, 1.5, 1.7))[0]).toMatchObject({ px: 2.2 * 0.7, reason: "stop" });
  });
  it("scale-out sells half at the target and trails the rest", () => {
    const st = new PolicyState({ family: "scale-out", x: 100, trail: 50, sl: 50 }, 1, 0);
    expect(st.onBar(bar(0, 1, 2.5, 0.9, 2.4))).toEqual([{ px: 2, frac: 0.5, t: 0, reason: "scale_out" }]);
    const f = st.onBar(bar(1, 2.4, 10, 2.3, 9)); expect(f).toEqual([]);
    expect(st.onBar(bar(2, 9, 9, 4, 4.5))[0]).toMatchObject({ px: 5, frac: 0.5 });
  });
  it("hold-runner exits at the deadline if the token did not run, and holds a runner", () => {
    const flat = new PolicyState({ family: "hold-runner", x: 100, tMin: 15, trail: 40 }, 1, 0);
    expect(flat.onBar(bar(5, 1, 1.2, 0.9, 1.1))).toEqual([]);
    expect(flat.onBar(bar(16, 1.1, 1.2, 1, 1.05))[0]).toMatchObject({ px: 1.1, reason: "no_run" });
    const run = new PolicyState({ family: "hold-runner", x: 100, tMin: 15, trail: 40 }, 1, 0);
    run.onBar(bar(5, 1, 3, 0.9, 2.8));
    expect(run.onBar(bar(30, 2.8, 50, 2.7, 45))).toEqual([]); // 50x without a 40% pullback: still holding
    expect(run.onBar(bar(40, 45, 46, 20, 25))[0]).toMatchObject({ px: 30, reason: "stop" });
  });
  it("time stop exits at the open once the holding time is reached", () => {
    const st = new PolicyState({ family: "time", hMin: 60, sl: null }, 1, 0);
    expect(st.onBar(bar(30, 1, 5, 0.1, 3))).toEqual([]);
    expect(st.onBar(bar(61, 3, 3, 2, 2))[0]).toMatchObject({ px: 3, reason: "time" });
  });
});
