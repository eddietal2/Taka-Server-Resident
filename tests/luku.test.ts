import { describe, expect, it } from 'vitest';

import { classifyMeter } from '../src/services/luku';

/**
 * The classifier is pure on purpose: the route's decision depends on two
 * database reads that the unit suite cannot reach, so the decision itself is
 * pulled out here where it can be covered without one.
 */
describe('classifyMeter', () => {
  it('reports a meter on a live account as claimed', () => {
    expect(classifyMeter({ claimedByAccount: true, hasSavedAddress: false })).toBe('claimed');
  });

  it('lets a claim outrank a saved address', () => {
    expect(classifyMeter({ claimedByAccount: true, hasSavedAddress: true })).toBe('claimed');
  });

  it('reports an address with no account holding it as mapped', () => {
    expect(classifyMeter({ claimedByAccount: false, hasSavedAddress: true })).toBe('mapped');
  });

  it('reports a meter the database has never seen as new', () => {
    expect(classifyMeter({ claimedByAccount: false, hasSavedAddress: false })).toBe('new');
  });
});
