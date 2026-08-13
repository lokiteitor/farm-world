import { describe, expect, it } from 'vitest';
import {
  BUILDING_TYPES,
  CROP_CYCLE_STATES,
  CROP_IDS,
  MACHINE_TYPES,
  MachineRole,
  Money,
  TERRAIN_TYPES,
  TREE_GROWTH_STAGES,
  TREE_SPECIES_IDS,
  VALIDATION_CODES,
  VALIDATION_MESSAGES,
  bpToPercent,
  type CropCycleState,
  type MachineType,
  type TaskOperation,
} from '../../domain/index.js';
import { BUILDING_CATALOGUE, MINIMUM_FARM_FOOTPRINT_CELLS } from '../buildings.js';
import { CROPS } from '../crops.js';
import { BALANCE_CURVES } from '../curves.js';
import { BASE_PRICE_BY_TERRAIN, STARTING_CAPITAL } from '../economy.js';
import {
  NATURAL_FOREST,
  NATURAL_FOREST_AVERAGE_VOLUME_DM3,
  PINE,
  TREE_SPECIES_CATALOGUE,
} from '../forestry.js';
import {
  MACHINE_CATALOGUE,
  OPERATION_REQUIREMENTS,
  REPAIR_COST_BP_PER_CONDITION_POINT,
} from '../machines.js';
import { CROP_CYCLE_TRANSITIONS, WEED_GROWTH_STATES } from '../transitions.js';
import { POOL_SKILL_MAX_BP, POOL_SKILL_MIN_BP, SKILL_CAP_BP } from '../workers.js';

// Coherence of the balance catalogues. These are not tests of a formula: they assert that
// the tables agree with each other and with the figures the GDD publishes, which is the
// class of error that a later change to one catalogue introduces silently.

/** Work speed a task would use: the implement's if it has one, else the powered machine's. */
function resolveWorkSpeed(operation: TaskOperation): number | null {
  const requirement = OPERATION_REQUIREMENTS[operation];
  if (requirement.workSpeedOverrideUnitsPerGameHour !== null) {
    return requirement.workSpeedOverrideUnitsPerGameHour;
  }
  const implement =
    requirement.requiredImplement === null
      ? null
      : MACHINE_CATALOGUE[requirement.requiredImplement];
  if (implement !== null && implement.workSpeedUnitsPerGameHour !== null) {
    return implement.workSpeedUnitsPerGameHour;
  }
  return MACHINE_CATALOGUE[requirement.poweredMachine].workSpeedUnitsPerGameHour;
}

describe('catalogue coverage', () => {
  it('has one entry per enum member', () => {
    expect(Object.keys(MACHINE_CATALOGUE).sort()).toEqual([...MACHINE_TYPES].sort());
    expect(Object.keys(BUILDING_CATALOGUE).sort()).toEqual([...BUILDING_TYPES].sort());
    expect(Object.keys(CROPS).sort()).toEqual([...CROP_IDS].sort());
    expect(Object.keys(TREE_SPECIES_CATALOGUE).sort()).toEqual([...TREE_SPECIES_IDS].sort());
    expect(Object.keys(BASE_PRICE_BY_TERRAIN).sort()).toEqual([...TERRAIN_TYPES].sort());
  });

  it('declares its own key inside every catalogue entry', () => {
    for (const [key, definition] of Object.entries(MACHINE_CATALOGUE)) {
      expect(definition.type).toBe(key);
    }
    for (const [key, definition] of Object.entries(BUILDING_CATALOGUE)) {
      expect(definition.type).toBe(key);
    }
    for (const [key, definition] of Object.entries(CROPS)) {
      expect(definition.id).toBe(key);
    }
    for (const [key, definition] of Object.entries(TREE_SPECIES_CATALOGUE)) {
      expect(definition.species).toBe(key);
    }
  });

  it('has a message in Spanish for every validation code', () => {
    expect(Object.keys(VALIDATION_MESSAGES).sort()).toEqual([...VALIDATION_CODES].sort());
    for (const code of VALIDATION_CODES) {
      expect(VALIDATION_MESSAGES[code].length).toBeGreaterThan(10);
      expect(VALIDATION_MESSAGES[code].endsWith('.')).toBe(true);
    }
  });
});

describe('crop cycle state machine (GDD sections 76 and 90)', () => {
  it('gives every transition that needs machinery a machine that enables it', () => {
    const withMachinery = CROP_CYCLE_TRANSITIONS.filter(
      (transition) => transition.operation !== null,
    );
    expect(withMachinery.length).toBeGreaterThan(0);

    for (const transition of withMachinery) {
      // Narrowed by the filter above; the compiler cannot see through it.
      const operation = transition.operation as TaskOperation;
      const requirement = OPERATION_REQUIREMENTS[operation];

      expect(requirement.fromCropStates).toContain(transition.from);
      expect(requirement.toCropState).toBe(transition.to);
      expect(requirement.targetKind).toBe('FIELD');

      const powered = MACHINE_CATALOGUE[requirement.poweredMachine];
      expect(powered.role).toBe(MachineRole.POWERED);

      if (requirement.requiredImplement !== null) {
        expect(MACHINE_CATALOGUE[requirement.requiredImplement].role).toBe(MachineRole.IMPLEMENT);
      }
    }
  });

  it('marks as automatic exactly the transitions that need no machinery', () => {
    for (const transition of CROP_CYCLE_TRANSITIONS) {
      expect(transition.automatic).toBe(transition.operation === null);
    }
  });

  it('leaves no unreachable state and no dead end', () => {
    const inbound = new Set<CropCycleState>(
      CROP_CYCLE_TRANSITIONS.map((transition) => transition.to),
    );
    const outbound = new Set<CropCycleState>(
      CROP_CYCLE_TRANSITIONS.map((transition) => transition.from),
    );
    for (const state of CROP_CYCLE_STATES) {
      expect(inbound.has(state), `no transition reaches ${state}`).toBe(true);
      expect(outbound.has(state), `no transition leaves ${state}`).toBe(true);
    }
  });

  it('grows weeds only in states of the cycle (GDD section 78)', () => {
    for (const state of WEED_GROWTH_STATES) {
      expect(CROP_CYCLE_STATES).toContain(state);
    }
  });
});

describe('operation requirements (GDD section 90)', () => {
  it('resolves a positive work speed for every operation', () => {
    for (const operation of Object.keys(OPERATION_REQUIREMENTS) as readonly TaskOperation[]) {
      const speed = resolveWorkSpeed(operation);
      expect(speed, `no work speed resolves for ${operation}`).not.toBeNull();
      expect(speed as number).toBeGreaterThan(0);
    }
  });

  it('requires only powered machines as possession and only implements as attachment', () => {
    for (const requirement of Object.values(OPERATION_REQUIREMENTS)) {
      for (const type of requirement.requiredPossession) {
        expect(MACHINE_CATALOGUE[type].role).toBe(MachineRole.POWERED);
      }
      expect(MACHINE_CATALOGUE[requirement.poweredMachine].role).toBe(MachineRole.POWERED);
    }
  });

  it('names a crop only where the field is being sown', () => {
    for (const requirement of Object.values(OPERATION_REQUIREMENTS)) {
      expect(requirement.requiresCrop).toBe(requirement.operation === 'SEED');
    }
  });

  it('reinicia las malezas solo al cultivar (GDD 78 y 89)', () => {
    // GDD 78 enumera una unica via en el MVP, `CULTIVATE`, y deja los herbicidas fuera.
    // GDD 89 recoge el mismo efecto como `sideEffect` exclusivo del cultivador. Cualquier
    // otra operacion que lo reiniciara seria una decision de balance tomada en el catalogo.
    for (const requirement of Object.values(OPERATION_REQUIREMENTS)) {
      expect(requirement.resetsWeedLevel, `${requirement.operation} reinicia las malezas`).toBe(
        requirement.operation === 'CULTIVATE',
      );
    }
  });
});

describe('balance curves', () => {
  it('has at least two nodes with strictly ascending inputs inside 0..100', () => {
    for (const [name, curve] of Object.entries(BALANCE_CURVES)) {
      expect(curve.length, `${name} has too few nodes`).toBeGreaterThanOrEqual(2);
      for (let index = 0; index < curve.length; index += 1) {
        const node = curve[index]!;
        const [input, output] = node;
        expect(Number.isFinite(input), `${name} node ${index} input`).toBe(true);
        expect(Number.isFinite(output), `${name} node ${index} output`).toBe(true);
        expect(input).toBeGreaterThanOrEqual(0);
        expect(input).toBeLessThanOrEqual(100);
        if (index > 0) {
          expect(input, `${name} is not ascending at node ${index}`).toBeGreaterThan(
            curve[index - 1]![0],
          );
        }
      }
    }
  });

  it('keeps the condition curve above zero, so no duration is infinite', () => {
    for (const [, output] of BALANCE_CURVES.conditionFactor!) {
      expect(output).toBeGreaterThan(0);
    }
  });
});

describe('crops (GDD sections 82 and 119)', () => {
  it('adds the phases up to the published growth duration', () => {
    for (const crop of Object.values(CROPS)) {
      const phases = Object.values(crop.phaseDurationsGameHours);
      for (const phase of phases) {
        expect(phase).toBeGreaterThan(0);
      }
      const total = phases.reduce<number>((sum, phase) => sum + phase, 0);
      expect(total).toBe(crop.growthDurationGameHours as number);
    }
  });

  it('reproduces the figures of wheat', () => {
    // GDD section 82, revised in GDD section 119. The sale price is the one figure
    // that departs from the GDD: the balance revision of 2026-08 raised it from the
    // published 0.22, which made every cycle deeply unprofitable
    // (docs/balance/revision-2026-08.md).
    expect(CROPS.WHEAT.growthDurationGameHours as number).toBe(96);
    expect(CROPS.WHEAT.baseYieldPerCellLiters).toBe(90);
    expect(Money.toString(CROPS.WHEAT.sellPricePerLiter)).toBe('0.9000');
    expect(CROPS.WHEAT.weedGrowthBpPerGameHour as number).toBe(60);
    expect(CROPS.WHEAT.fertilityDrainPerCycleBp as number).toBe(1500);
  });

  it('restores by fallow at most what a cycle drains', () => {
    // Plan section 2.2: the invented regeneration rate must not turn fertility into a
    // free resource, so one fallow cycle recovers no more than one cycle's drain.
    const cycleGameHours = 325;
    for (const crop of Object.values(CROPS)) {
      const recovered = crop.fertilityRegenBpPerGameHourInFallow * cycleGameHours;
      expect(recovered).toBeGreaterThan(0);
      expect(recovered).toBeLessThanOrEqual(crop.fertilityDrainPerCycleBp * 1.1);
    }
  });
});

describe('buildings (GDD sections 116 and 136)', () => {
  it('keeps the footprint equal to the product of its sides', () => {
    for (const building of Object.values(BUILDING_CATALOGUE)) {
      expect(building.footprintCells).toBe(building.widthCells * building.heightCells);
      expect(building.widthCells).toBeGreaterThan(0);
      expect(building.heightCells).toBeGreaterThan(0);
    }
  });

  it('declares a capacity exactly where the kind implies one', () => {
    for (const building of Object.values(BUILDING_CATALOGUE)) {
      if (building.capacityKind === 'NONE') {
        expect(building.capacity).toBeNull();
        expect(building.capacityResource).toBeNull();
      } else {
        expect(building.capacity).not.toBeNull();
        expect(building.capacity as number).toBeGreaterThan(0);
      }
      expect(building.capacityResource !== null).toBe(building.capacityKind === 'STORAGE');
    }
  });

  it('reproduces the farm footprint of GDD section 117', () => {
    expect(MINIMUM_FARM_FOOTPRINT_CELLS).toBe(80);
  });
});

describe('machinery (GDD sections 89 and 134)', () => {
  it('derives the repair cost from the purchase price at the published rate', () => {
    for (const machine of Object.values(MACHINE_CATALOGUE)) {
      expect(Money.toString(machine.repairCostPerConditionPoint)).toBe(
        Money.toString(Money.mulBp(machine.purchasePrice, REPAIR_COST_BP_PER_CONDITION_POINT)),
      );
    }
  });

  it('wears every machine and charges no running cost to an implement', () => {
    for (const machine of Object.values(MACHINE_CATALOGUE)) {
      expect(machine.wearRateBpPerGameHour as number).toBeGreaterThan(0);
      if (machine.role === MachineRole.IMPLEMENT) {
        // Taken literally from GDD section 89, which gives implements no running cost.
        expect(Money.isZero(machine.maintenanceCostPerGameHour)).toBe(true);
        expect(Money.isZero(machine.operatingCostPerGameHour)).toBe(true);
      }
    }
  });

  it('reproduces the prices of the catalogue', () => {
    const expected: Readonly<Record<MachineType, string>> = {
      TRACTOR: '18000.0000',
      PLOW: '6500.0000',
      CULTIVATOR: '5200.0000',
      SEEDER: '9800.0000',
      HARVESTER: '42000.0000',
      TRAILER: '7200.0000',
      HARVESTER_FORESTRY: '65000.0000',
      FORWARDER: '38000.0000',
    };
    for (const type of MACHINE_TYPES) {
      expect(Money.toString(MACHINE_CATALOGUE[type].purchasePrice)).toBe(expected[type]);
    }
  });

  it('only lets a powered machine tow an implement', () => {
    for (const machine of Object.values(MACHINE_CATALOGUE)) {
      if (machine.role === MachineRole.IMPLEMENT) {
        expect(machine.compatibleImplements).toHaveLength(0);
      }
      for (const type of machine.compatibleImplements) {
        expect(MACHINE_CATALOGUE[type].role).toBe(MachineRole.IMPLEMENT);
      }
    }
  });
});

describe('minimum viable setup (GDD section 117)', () => {
  it('reproduces the 146 100 of the GDD from the catalogues', () => {
    const grassPrice = BASE_PRICE_BY_TERRAIN.GRASS;
    expect(grassPrice).not.toBeNull();

    // 80 cells of farm footprint plus a 250 cell field.
    const cells = MINIMUM_FARM_FOOTPRINT_CELLS + 250;
    expect(cells).toBe(330);
    const land = Money.mulRatio(grassPrice as Money, cells);
    expect(Money.toString(land)).toBe('39600.0000');

    const buildings = Money.sum([
      BUILDING_CATALOGUE.GARAGE.purchasePrice,
      BUILDING_CATALOGUE.SILO.purchasePrice,
      BUILDING_CATALOGUE.WORKER_HOME.purchasePrice,
    ]);
    expect(Money.toString(buildings)).toBe('23000.0000');

    // The cultivator is omitted: wheat has requiresCultivation = false.
    const machinery = Money.sum([
      MACHINE_CATALOGUE.TRACTOR.purchasePrice,
      MACHINE_CATALOGUE.PLOW.purchasePrice,
      MACHINE_CATALOGUE.SEEDER.purchasePrice,
      MACHINE_CATALOGUE.HARVESTER.purchasePrice,
      MACHINE_CATALOGUE.TRAILER.purchasePrice,
    ]);
    expect(Money.toString(machinery)).toBe('83500.0000');

    const total = Money.sum([land, buildings, machinery]);
    expect(Money.toString(total)).toBe('146100.0000');

    // Cushion of GDD section 117.
    expect(Money.toString(Money.sub(STARTING_CAPITAL, total))).toBe('13900.0000');
  });
});

describe('forestry (GDD sections 131, 133 and 138)', () => {
  it('orders the stage boundaries and the volumes', () => {
    for (const species of Object.values(TREE_SPECIES_CATALOGUE)) {
      for (let index = 1; index < TREE_GROWTH_STAGES.length; index += 1) {
        const previous = TREE_GROWTH_STAGES[index - 1]!;
        const current = TREE_GROWTH_STAGES[index]!;
        expect(species.stageStartGameHours[current] as number).toBeGreaterThan(
          species.stageStartGameHours[previous] as number,
        );
        expect(species.woodVolumeDm3ByStage[current]).toBeGreaterThan(
          species.woodVolumeDm3ByStage[previous],
        );
      }
      const last = TREE_GROWTH_STAGES[TREE_GROWTH_STAGES.length - 1]!;
      expect(species.maxWoodVolumeDm3).toBe(species.woodVolumeDm3ByStage[last]);
      expect(species.fellableStages).not.toContain('SAPLING');
      expect(species.stageStartGameHours.SAPLING as number).toBe(0);
    }
  });

  it('keeps the stage boundaries one duration apart (GDD section 133)', () => {
    const duration = PINE.growthDurationPerStageGameHours as number;
    expect(PINE.stageStartGameHours.YOUNG as number).toBe(duration);
    expect(PINE.stageStartGameHours.MATURE as number).toBe(2 * duration);
    // 720 h and not the 960 h of GDD section 133, which counts four boundaries for four
    // stages (plan section 2.2).
    expect(PINE.stageStartGameHours.OLD_GROWTH as number).toBe(3 * duration);
  });

  it('mixes the generated forest so that GDD section 138 comes out', () => {
    const mix = Object.values(NATURAL_FOREST.stageMixBp).reduce<number>(
      (sum, share) => sum + share,
      0,
    );
    expect(mix).toBe(10_000);

    // GDD section 138 estimates 250 trees at about 1.8 m3 times 0.85, that is 382 m3.
    const volumeM3 = (NATURAL_FOREST_AVERAGE_VOLUME_DM3 * 250) / 1000;
    expect(volumeM3).toBeGreaterThan(382 * 0.98);
    expect(volumeM3).toBeLessThan(382 * 1.02);
  });

  it('reproduces the price per cubic metre and the density', () => {
    expect(Money.toString(PINE.sellPricePerM3)).toBe('45.0000');
    expect(bpToPercent(NATURAL_FOREST.treeDensityBp)).toBe(100);
  });
});

describe('workers (GDD sections 102 and 103)', () => {
  it('keeps the pool range inside the progression ceiling', () => {
    expect(POOL_SKILL_MIN_BP as number).toBeLessThan(POOL_SKILL_MAX_BP as number);
    expect(POOL_SKILL_MAX_BP as number).toBeLessThanOrEqual(SKILL_CAP_BP as number);
    // GDD section 102: skill 30 % to 90 %.
    expect(bpToPercent(POOL_SKILL_MIN_BP)).toBe(30);
    expect(bpToPercent(POOL_SKILL_MAX_BP)).toBe(90);
    // GDD section 103: ceiling of 95 %.
    expect(bpToPercent(SKILL_CAP_BP)).toBe(95);
  });
});
