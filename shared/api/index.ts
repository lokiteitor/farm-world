// Barrel of the REST contract.
//
// Owner: workflow W2 (API contract).
//
// Order of re-export follows the layering of the module, which is also the only order in
// which the files may depend on each other:
//
//   1. `schemas/common`  the wire primitives. Depends on shared/domain and shared/config.
//   2. `errors`          the codes, their HTTP status and the typed constructors.
//   3. the area files     one per area of plan section 7. They depend on 1 and 2, and
//                        `state` additionally depends on the other area files, because the
//                        snapshot is the union of their read models.
//   4. `routes`          the map, which depends on every area file and on shared/ws, whose
//                        frame union is the reply of the event replay route.
//
// shared/ws depends on this module and never the other way round, apart from that one
// reply schema, which is why the dependency stays acyclic.

export * from './schemas/common.js';
export * from './errors.js';
export * from './schemas/world.js';
export * from './schemas/land.js';
export * from './schemas/farms.js';
export * from './schemas/fields.js';
export * from './schemas/machinery.js';
export * from './schemas/workers.js';
export * from './schemas/tasks.js';
export * from './schemas/economy.js';
export * from './schemas/forestry.js';
export * from './schemas/state.js';
export * from './schemas/auth.js';
export * from './schemas/system.js';
export * from './routes.js';
