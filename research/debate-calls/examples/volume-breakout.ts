// Example of a confirmation entry with a custom exit: wait up to 30 minutes after the call for a 1-minute bar
// that breaks the post-call high on at least 3x the average volume, then ride with a 40% trail from the peak.
import type { CallStrategy } from "../../../scripts/lib/callsSim.ts";

const strategy: CallStrategy = {
  name: "example: volume breakout within 30 min, trail 40% from peak",
  maxWaitMin: 30,
  shouldEnter: ({ post }) => {
    if (post.length < 4) return false;
    const cur = post[post.length - 1];
    const prior = post.slice(0, -1);
    const hi = Math.max(...prior.map((b) => b.h));
    const avgVol = prior.reduce((a, b) => a + b.v, 0) / prior.length;
    return cur.c > hi && cur.v >= 3 * avgVol;
  },
  hardStop: 0.3,
  exit: ({ post, peak }) => (post[post.length - 1].c < peak * 0.6 ? 1 : 0),
};
export default strategy;
