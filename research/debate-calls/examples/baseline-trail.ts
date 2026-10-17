// Example strategy (the live forward-test rule): buy every call at the first bar, trail 20% from entry, hard stop -35%.
import type { CallStrategy } from "../../../scripts/lib/callsSim.ts";

const strategy: CallStrategy = {
  name: "baseline: every call, trail 20%, stop -35%",
  maxWaitMin: 0,
  shouldEnter: () => true,
  exit: { family: "trailing", arm: 0, trail: 20, sl: 35 },
};
export default strategy;
