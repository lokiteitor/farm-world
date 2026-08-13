// The live readout that follows the cursor.
//
// Owner: workflow W4-G (selection tool). Pure: a model in, a line of text out.
//
// Plan section 9.5 asks for a live reading beside the cursor with the count, the price
// and the number of invalid cells, and for the aggregated reasons to live in the side
// panel. The division of labour is deliberate: the reading beside the cursor answers "how
// much of this am I taking and what does it cost", which is the question a hand on the
// mouse is asking, and it has to be short enough to read without stopping the drag. The
// reasons are a list, and a list under a moving cursor is unreadable, so they go to the
// panel through the port together with the jump to the first conflict.
//
// The text is Spanish because it is interface, and the units are the ones the player
// sees: `Money.toDisplay` and not the four decimal canonical form, which is the domain
// unit and not a presentation (ADR-0008).

import { type SelectionToolMode } from './modes';
import { MAX_SELECTION_CELLS, Money } from '~/shared/index';

export interface ReadoutModel {
  readonly mode: SelectionToolMode;
  readonly cellCount: number;
  readonly invalidCellCount: number;
  readonly unresolvedCount: number;
  /** Price of the purchasable part, or null for a mode that buys nothing. */
  readonly price: Money | null;
  /** True when the drag stopped growing at the shared ceiling. */
  readonly capped: boolean;
}

/** The line beside the cursor. Empty when there is nothing to say. */
export function readoutText(model: ReadoutModel): string {
  if (model.cellCount === 0 && model.unresolvedCount === 0) {
    return '';
  }
  const parts: string[] = [`${model.cellCount + model.unresolvedCount} celdas`];
  if (model.price !== null && Money.compare(model.price, Money.ZERO) > 0) {
    parts.push(`${Money.toDisplay(model.price)} $`);
  }
  if (model.invalidCellCount > 0) {
    parts.push(`${model.invalidCellCount} no validas`);
  }
  if (model.unresolvedCount > 0) {
    parts.push(`${model.unresolvedCount} sin cargar`);
  }
  if (model.capped) {
    parts.push(`tope de ${MAX_SELECTION_CELLS} celdas`);
  }
  return parts.join(' · ');
}
