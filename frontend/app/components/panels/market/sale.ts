// The sale decision, as a pure function.
//
// Owner: W5-F. Read by the market panel and by its suite.
//
// The price model of GDD section 123 is fixed and has no fluctuation, so there is nothing
// to time and nothing to negotiate: the only two things a sale can get wrong are asking for
// nothing and asking for more than there is. The server checks exactly those two, in this
// order (`backend/src/modules/economy/market.ts`), and this module is that order.
//
// The reservation is deliberately not subtracted from what may be sold. Reserved units are
// capacity committed to a harvest that has not arrived (plan section 5.4), not stock;
// selling grain frees no reservation and the server does not treat it as if it did.

import { ValidationCode, type StorageResource } from '~/shared/index';

/** Name of each tradable resource, in Spanish, with the section that prices it. */
export const STORAGE_RESOURCE_LABELS: Readonly<Record<StorageResource, string>> = {
  WHEAT_LITERS: 'Trigo',
  WOOD_M3: 'Madera',
};

export const STORAGE_RESOURCE_SECTIONS: Readonly<Record<StorageResource, number>> = {
  WHEAT_LITERS: 123,
  WOOD_M3: 133,
};

export interface SaleSituation {
  /** Quantity asked for, in the stored unit of the resource. */
  readonly quantityUnits: number;
  /** Stock actually held, in the stored unit. */
  readonly availableUnits: number;
}

/** Why a sale would be refused, or null when it would be accepted. */
export function sellBlockingCode(situation: SaleSituation): ValidationCode | null {
  if (!Number.isFinite(situation.quantityUnits) || situation.quantityUnits <= 0) {
    return ValidationCode.QUANTITY_NOT_POSITIVE;
  }
  if (situation.quantityUnits > situation.availableUnits) {
    return ValidationCode.INSUFFICIENT_STOCK;
  }
  return null;
}

/**
 * A quantity brought back into the range the contract accepts: a whole number of stored
 * units, at least zero and at most the stock.
 *
 * The truncation is what keeps the wire honest. `quantityUnits` is `storageUnits` in the
 * contract, that is an integer, and a slider over cubic decimetres or a text field can
 * easily produce a fraction; sending it would be rejected by the schema with an error about
 * a type instead of about the sale.
 */
export function clampQuantity(units: number, availableUnits: number): number {
  if (!Number.isFinite(units) || units <= 0) {
    return 0;
  }
  const whole = Math.trunc(units);
  return whole > availableUnits ? availableUnits : whole;
}
