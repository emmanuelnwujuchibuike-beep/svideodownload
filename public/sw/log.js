/* Dev-only diagnostics — every module logs through this instead of raw
 * console calls, so production stays silent by construction (one flag to
 * flip, not a scattered set of debug conditionals). */
const SWX = (self.SWX = self.SWX || {});

SWX.log = function log(...args) {
  if (SWX.DEBUG) console.log("[sw]", ...args);
};
