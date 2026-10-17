import { makeStrategy } from './codex-r2-candidates.ts';
// Frozen using only the fit-window trimmed mean. Research control, not submission.
export default makeStrategy({wait:15,window:5,volumeRatio:1,exit:{family:'fixed',tp:50,sl:30}});
