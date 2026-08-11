import { describe, expect, it } from 'vitest';
import { SHARED_CONTRACT_VERSION } from '../index.js';

// W1 scaffolding. It asserts that the test harness of shared/ is wired up
// (resolver, NodeNext specifiers, strict TypeScript) rather than any domain
// rule. Workflow W2 replaces it with the real suites: accrual additivity, clock
// monotonicity, curve tables and terrain determinism (plan section 8).
describe('shared contract scaffolding', () => {
  it('exposes a semantic contract version', () => {
    expect(SHARED_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
