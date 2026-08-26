// Barrel of the balance catalogues.
//
// Owner: workflow W2 (vocabulary).
//
// Everything here is a constant versioned with the code and never a database row: these
// are balance data that the backend, the frontend and the KPI calculator must all import
// at the same time (plan section 5.2). Every figure carries the GDD section it comes
// from, and every invented figure says so and why.

export * from './world.js';
export * from './time.js';
export * from './economy.js';
export * from './curves.js';
export * from './crops/index.js';
export * from './machines.js';
export * from './buildings.js';
export * from './workers.js';
export * from './forestry.js';
export * from './transitions.js';
