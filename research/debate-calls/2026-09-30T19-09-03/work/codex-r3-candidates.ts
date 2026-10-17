import type { CallStrategy, CallCtx } from '../../../../scripts/lib/callsSim.ts';
import type { PolicySpec } from '../../../../packages/core/src/callPolicy.ts';

export function preFeatures(c: CallCtx) {
  const done = c.pre.filter(b => b.t + b.res * 1000 <= c.callMs);
  const w = done.filter(b => b.t >= c.callMs - 15 * 60000);
  return { r15: w.length >= 2 ? w.at(-1)!.c / w[0].o : 0, liq: done.at(-1)?.liq ?? 0,
    volumePerSecond: w.reduce((s,b) => s+b.v,0) / Math.max(1,w.reduce((s,b) => s+b.res,0)) };
}
export function immediate(r15: number, liq: number, size: number): CallStrategy {
  return { name: `pre r15>=${r15} liq>=${liq} size=${size}`, maxWaitMin: 0,
    shouldEnter(c) { const f=preFeatures(c); return f.r15>=r15 && f.liq>=liq; },
    size: () => size, exit: {family:'fixed',tp:50,sl:30} };
}
export interface Config { delay: number; momentum: number; exit: PolicySpec }
export function confirmed(p: Config): CallStrategy {
  return { name: `pre momentum plus post confirmation ${JSON.stringify(p)}`, maxWaitMin: 30,
    shouldEnter(c) {
      const f=preFeatures(c), cur=c.post.at(-1), first=c.post[0];
      if(f.r15<4 || f.liq<5000 || !cur || cur.res!==60 || cur.liq<5000 || first.t>c.callMs+120000) return false;
      const now=cur.t+60000, elapsed=(now-c.callMs)/60000;
      if(elapsed<p.delay || elapsed>30) return false;
      const recent=c.post.filter(b=>b.t>=now-3*60000);
      if(recent.length!==3 || recent.some(b=>b.res!==60)) return false;
      const vr=recent.reduce((s,b)=>s+b.v,0)/180;
      return f.volumePerSecond>0 && vr>=f.volumePerSecond && cur.c>=p.momentum*first.o;
    }, size:()=>0.1, exit:p.exit };
}
