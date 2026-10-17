import type { CallStrategy } from '../../../../scripts/lib/callsSim.ts';
import type { PolicySpec } from '../../../../packages/core/src/callPolicy.ts';

export interface Config { wait: number; window: number; volumeRatio: number; exit: PolicySpec }
// Each comparison uses two adjacent, complete windows of observed one-minute bars.
// Prices and volume are available at the decision close; the referee buys next open.
export function makeStrategy(p: Config): CallStrategy {
  return {
    name: `sustained-recovery ${JSON.stringify(p)}`, maxWaitMin: 180,
    shouldEnter(c) {
      const cur = c.post.at(-1);
      if (!cur || cur.res !== 60 || cur.liq < 1000 || c.post[0].t > c.callMs + 600000) return false;
      const now = cur.t + 60000;
      if ((now - c.callMs) / 60000 < p.wait) return false;
      const recent = c.post.filter(b => b.t >= now - p.window * 60000 && b.t < now);
      const prior = c.post.filter(b => b.t >= now - 2 * p.window * 60000 && b.t < now - p.window * 60000);
      if (recent.length !== p.window || prior.length !== p.window || [...recent, ...prior].some(b => b.res !== 60)) return false;
      const avg = (bars: typeof recent) => bars.reduce((s,b) => s+b.c,0)/bars.length;
      const vol = (bars: typeof recent) => bars.reduce((s,b) => s+b.v,0);
      const vr = vol(recent), vp = vol(prior);
      const vwap = vr > 0 ? recent.reduce((s,b) => s+b.c*b.v,0)/vr : Infinity;
      return avg(recent) >= 1.1 * avg(prior) && cur.c > vwap && cur.c >= .5*c.post[0].o && vp > 0 && vr >= p.volumeRatio*vp;
    },
    exit: p.exit,
  };
}
