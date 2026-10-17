import type { CallStrategy } from '../../../../scripts/lib/callsSim.ts';
export function makeStrategy(p:any):CallStrategy {
  return {name:JSON.stringify(p),maxWaitMin:p.family==='delayed'?p.delay+2:180,
    shouldEnter(c) {
      const b=c.post,cur=b.at(-1);if(!cur||cur.res!==60||cur.liq<1000||b[0].t>c.callMs+10*60000)return false;
      if(p.family==='delayed')return c.minutesSinceCall>=p.delay;
      if(p.family==='dip')return c.minutesSinceCall>=p.wait && cur.c/b[0].o<=p.dip && (!p.recovery||(b.length>=3&&cur.c>b.at(-2)!.c&&cur.c>cur.o));
      if(b.length<5||c.minutesSinceCall>60)return false;
      const prior=b.slice(0,-1),v=prior.reduce((s,b)=>s+b.v,0)/prior.length;
      return cur.c/b[0].o>=p.mult&&cur.c>Math.max(...prior.map(b=>b.h))&&cur.v>=p.volume*v;
    },exit:{family:'fixed',tp:p.tp,sl:p.sl}};
}
