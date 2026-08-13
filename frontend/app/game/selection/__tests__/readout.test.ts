// The live reading beside the cursor.
//
// Owner: workflow W4-G. Plan section 9.5 asks for the count, the price and the number of
// invalid cells, and the ceiling warning is what explains a drag that stopped growing
// instead of leaving it looking broken.

import { describe, expect, it } from 'vitest';
import { SelectionToolMode } from '../modes';
import { readoutText } from '../readout';
import { MAX_SELECTION_CELLS, Money } from '~/shared/index';

const base = {
  mode: SelectionToolMode.PURCHASE,
  cellCount: 0,
  invalidCellCount: 0,
  unresolvedCount: 0,
  price: null,
  capped: false,
} as const;

describe('readoutText', () => {
  it('says nothing when there is nothing selected', () => {
    expect(readoutText(base)).toBe('');
  });

  it('gives the count on its own', () => {
    expect(readoutText({ ...base, cellCount: 250 })).toBe('250 celdas');
  });

  it('adds the price in the units the player sees, not the canonical four decimals', () => {
    const text = readoutText({
      ...base,
      cellCount: 2,
      price: Money.fromString('240.0000'),
    });
    expect(text).toBe('2 celdas · 240.00 $');
  });

  it('omits a price of zero, which is what a mode that buys nothing reports', () => {
    const text = readoutText({
      ...base,
      mode: SelectionToolMode.FIELD_CREATE,
      cellCount: 9,
      price: Money.ZERO,
    });
    expect(text).toBe('9 celdas');
  });

  it('counts the invalid cells and the ones whose chunk has not arrived apart', () => {
    const text = readoutText({
      ...base,
      cellCount: 10,
      invalidCellCount: 3,
      unresolvedCount: 2,
    });
    expect(text).toBe('12 celdas · 3 no validas · 2 sin cargar');
  });

  it('explains a drag that stopped at the shared ceiling', () => {
    const text = readoutText({ ...base, cellCount: MAX_SELECTION_CELLS, capped: true });
    expect(text).toContain(`tope de ${MAX_SELECTION_CELLS} celdas`);
  });

  it('speaks about cells that are still unknown even with none resolved', () => {
    expect(readoutText({ ...base, unresolvedCount: 4 })).toBe('4 celdas · 4 sin cargar');
  });
});
