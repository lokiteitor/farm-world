// The rates of land with no crop on it.
//
// Owner: workflow W2 (vocabulary).
//
// A field without a crop still accrues: weeds grow on it and fertility recovers while
// it lies fallow. Before the catalogue held more than one crop those rates were read
// off the wheat entry through a `FALLOW_RATE_CROP` constant, which quietly made one
// member of the catalogue a global constant of the simulation. With sixty two crops
// that would have become an arbitrary choice, so the rates are stated here as what they
// always were: a property of the land, not of a plant that is not growing on it.
//
// The values are the ones wheat carried, so no fallow field changes behaviour.

import { bp } from '../../domain/units.js';
import type { LandRates } from './types.js';

export const FALLOW_LAND: LandRates = {
  // GDD section 82, the same 0.6 %/h the cereals use.
  weedGrowthBpPerGameHour: bp(60),
  // GDD section 77 admits fallow as the restoration route, and without it the MVP would
  // be irreversible, since section 77 only ever subtracts fertility (plan section 2.2).
  // 1 500 basis points recovered over 300 game hours: one idle cycle restores what one
  // harvested cereal cycle drains.
  fertilityRegenBpPerGameHourInFallow: bp(5),
};
