// Barrel of the pure rules.
//
// Owner: workflow W2 (pure rules).
//
// Every function re-exported here is deterministic, total, free of input and output,
// free of `Date.now` and of `Math.random`, and takes its configuration as a parameter
// with the catalogue as the default (plan section 8). The backend validator and the
// client import the same functions, so the green highlight of a selection and the 400
// of the server cannot diverge.
//
// Order of re-export: the primitives first (clock, curves), then the domain rules that
// build on them, and last the ones that combine several (balance).

export * from './clock.js';
export * from './curves.js';
export * from './duration.js';
export * from './geometry.js';
export * from './skill.js';
export * from './yield.js';
export * from './machinery.js';
export * from './forestry.js';
export * from './pricing.js';
export * from './holding.js';
export * from './selection.js';
export * from './balance.js';
