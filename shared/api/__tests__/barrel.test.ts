// The two barrels can be re-exported side by side.
//
// Owner: workflow W2 (API contract).
//
// `shared/index.ts` re-exports `./api/index.js` and `./ws/index.js` with `export *`, which
// fails at build time if the two share an exported name. This test checks the property
// here, where the fix is cheap, instead of leaving it to the agent that uncomments those
// two lines (docs/handoff/NOTES-W2c.md, item 1.1).
//
// It also checks that neither barrel is empty and that both load without a circular
// initialisation problem: importing them at all is what proves the second point, because a
// cycle over a top level `const` would throw before the first assertion ran.

import { describe, expect, it } from 'vitest';
import * as ws from '../../ws/index.js';
import * as api from '../index.js';

describe('barrels', () => {
  it('export something', () => {
    expect(Object.keys(api).length).toBeGreaterThan(100);
    expect(Object.keys(ws).length).toBeGreaterThan(20);
  });

  it('export disjoint names, so shared/index.ts can re-export both', () => {
    const shared = Object.keys(api).filter((name) => name in ws);
    expect(shared).toEqual([]);
  });

  it('expose the four pieces the rest of the project reaches for', () => {
    expect(typeof api.API_ROUTES).toBe('object');
    expect(typeof api.apiErrorReply).toBe('function');
    expect(typeof api.mutationReplySchema).toBe('function');
    expect(typeof ws.wsServerFrameSchema.safeParse).toBe('function');
  });
});
