// Barrel of the shared contract.
//
// This is the single source of truth of the project: the vocabulary of the domain, the
// balance catalogues, the pure rules, the Zod schemas of the API, the WebSocket events
// and the deterministic terrain generator. It is synchronised into `backend/src/shared`
// and `frontend/app/shared` by scripts/sync-shared-types.sh, and both copies are ignored
// by git (plan section 4).
//
// Owner: workflow W2. The vocabulary agent wrote `./domain` and `./config`; the four
// remaining re-exports were left commented because the four agents of that phase worked
// in parallel on this one file and a full write would have discarded the others. The
// W2.5 patching window enabled them in place, without reordering the file, so the whole
// contract is importable from the root of the package and neither the backend nor the
// frontend has to reach for a deep path.

export * from './domain/index.js';
export * from './config/index.js';
export * from './rules/index.js';
export * from './api/index.js';
export * from './ws/index.js';
export * from './world/index.js';

/**
 * Version of the shared contract.
 *
 * Bumped by hand whenever a change to the schemas, the event union or the catalogues is
 * not backwards compatible for an already connected client. The client compares it
 * against the value the server reports in `world/info` and forces a full snapshot
 * resynchronisation when they differ (plan section 7).
 */
export const SHARED_CONTRACT_VERSION = '0.1.0' as const;
