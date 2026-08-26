// Closed sets of the domain: the vocabulary that the API schemas, the Prisma
// enums, the reducers of the client and the balance catalogues all share.
//
// Owner: workflow W2 (vocabulary).
//
// Form. Every set is a frozen object literal plus a union type of the same name,
// instead of a TypeScript `enum`. Three reasons: the runtime values are the plain
// strings that PostgreSQL and JSON carry, so nothing has to be mapped at the
// boundary; the union is assignable from a string literal, which keeps the Zod
// schemas of shared/api free of casts; and an object literal has no separate
// declaration merging rules, so `export *` from the barrel re-exports the value
// and the type as one name.
//
// Reserved values. Several members are declared but never produced by the MVP.
// They are here on purpose (plan section 5.2): adding a column to PostgreSQL is
// instantaneous, whereas migrating an enum in Prisma is not, so the enums reserve
// aggressively and each reserved member says so in its comment.

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/** Generated terrain of a cell (GDD section 8). */
export const TerrainType = {
  GRASS: 'GRASS',
  FOREST: 'FOREST',
  MOUNTAIN: 'MOUNTAIN',
  WATER: 'WATER',
} as const;
export type TerrainType = (typeof TerrainType)[keyof typeof TerrainType];
export const TERRAIN_TYPES: readonly TerrainType[] = Object.values(TerrainType);

/**
 * What a cell is being used for (GDD section 15). Exclusive by construction: a
 * cell taken by infrastructure cannot be farmed at the same time.
 *
 * `NONE` is unowned land, `OWNED` is owned land with no use assigned yet, and
 * `ROAD` is reserved: roads appear in GDD section 15 but not in the MVP list of
 * GDD section 69.
 */
export const LandUse = {
  NONE: 'NONE',
  OWNED: 'OWNED',
  FIELD: 'FIELD',
  FOREST_PLOT: 'FOREST_PLOT',
  BUILDING: 'BUILDING',
  ROAD: 'ROAD',
} as const;
export type LandUse = (typeof LandUse)[keyof typeof LandUse];
export const LAND_USES: readonly LandUse[] = Object.values(LandUse);

// ---------------------------------------------------------------------------
// Agriculture
// ---------------------------------------------------------------------------

/**
 * Main state machine of a field: the eight states of GDD sections 41 and 76, in
 * cycle order. The state lives only on the field and never on the cell (plan
 * section 5.1): duplicating it per cell would multiply the cost of every
 * transition by between 250 and 2 000.
 */
export const CropCycleState = {
  VIRGIN: 'VIRGIN',
  PLOWED: 'PLOWED',
  CULTIVATED: 'CULTIVATED',
  SEEDED: 'SEEDED',
  GERMINATING: 'GERMINATING',
  GROWING: 'GROWING',
  READY_TO_HARVEST: 'READY_TO_HARVEST',
  HARVESTED: 'HARVESTED',
} as const;
export type CropCycleState = (typeof CropCycleState)[keyof typeof CropCycleState];
export const CROP_CYCLE_STATES: readonly CropCycleState[] = Object.values(CropCycleState);

/**
 * Soil condition (GDD section 81). `COMPACTED` is reserved: GDD section 81 places
 * it explicitly outside the MVP, and GDD section 86 confirms it.
 */
export const SoilCondition = {
  UNTOUCHED: 'UNTOUCHED',
  PLOWED: 'PLOWED',
  CULTIVATED: 'CULTIVATED',
  COMPACTED: 'COMPACTED',
} as const;
export type SoilCondition = (typeof SoilCondition)[keyof typeof SoilCondition];
export const SOIL_CONDITIONS: readonly SoilCondition[] = Object.values(SoilCondition);

/**
 * Crops of the catalogue. Sixty two annual crops of a single destructive harvest,
 * grouped by family: the arrangement is documentation, since the family a crop
 * belongs to is a field of its catalogue entry and not a prefix of its name.
 *
 * GDD section 42 names eight future crops and section 86 keeps the MVP at one; the
 * expansion is a deliberate departure recorded in docs/erratas-gdd-stack.md. Wheat
 * keeps its identifier and every one of its published figures, because the balance
 * report and the golden tests are anchored on it.
 *
 * Perennials, ratooning crops, mushrooms and flooded rice are deliberately absent:
 * each needs a mechanic the field cycle does not have.
 */
export const CropId = {
  // Cereal
  MAIZ: 'MAIZ',
  WHEAT: 'WHEAT',
  CEBADA: 'CEBADA',
  AVENA: 'AVENA',
  CENTENO: 'CENTENO',
  SORGO: 'SORGO',
  TRITICALE: 'TRITICALE',
  MIJO: 'MIJO',
  QUINOA: 'QUINOA',
  AMARANTO: 'AMARANTO',
  // Legume
  FRIJOL: 'FRIJOL',
  GARBANZO: 'GARBANZO',
  LENTEJA: 'LENTEJA',
  CHICHARO: 'CHICHARO',
  HABA: 'HABA',
  SOYA: 'SOYA',
  CACAHUATE: 'CACAHUATE',
  // Oilseed
  CANOLA: 'CANOLA',
  GIRASOL: 'GIRASOL',
  AJONJOLI: 'AJONJOLI',
  LINAZA: 'LINAZA',
  MOSTAZA: 'MOSTAZA',
  // Industrial
  ALGODON: 'ALGODON',
  TABACO: 'TABACO',
  // Root
  PAPA: 'PAPA',
  JICAMA: 'JICAMA',
  BETABEL: 'BETABEL',
  ZANAHORIA: 'ZANAHORIA',
  RABANO: 'RABANO',
  CHIRIVIA: 'CHIRIVIA',
  CEBOLLA: 'CEBOLLA',
  AJO: 'AJO',
  // Leafy
  LECHUGA: 'LECHUGA',
  ESPINACA: 'ESPINACA',
  ACELGA: 'ACELGA',
  COL: 'COL',
  COLIFLOR: 'COLIFLOR',
  BROCOLI: 'BROCOLI',
  // Fruiting
  PEPINO: 'PEPINO',
  CALABACITA: 'CALABACITA',
  CALABAZA: 'CALABAZA',
  MELON: 'MELON',
  SANDIA: 'SANDIA',
  BERENJENA: 'BERENJENA',
  TOMATE: 'TOMATE',
  TOMATILLO: 'TOMATILLO',
  CHILE: 'CHILE',
  PIMIENTO: 'PIMIENTO',
  EJOTE: 'EJOTE',
  // Herb
  CILANTRO: 'CILANTRO',
  PEREJIL: 'PEREJIL',
  ALBAHACA: 'ALBAHACA',
  MANZANILLA: 'MANZANILLA',
  // Flower
  CEMPASUCHIL: 'CEMPASUCHIL',
  GIRASOL_ORNAMENTAL: 'GIRASOL_ORNAMENTAL',
  CRISANTEMO: 'CRISANTEMO',
  TULIPAN: 'TULIPAN',
  DALIA: 'DALIA',
  // Forage
  MAIZ_FORRAJERO: 'MAIZ_FORRAJERO',
  SORGO_FORRAJERO: 'SORGO_FORRAJERO',
  AVENA_FORRAJERA: 'AVENA_FORRAJERA',
  CENTENO_FORRAJERO: 'CENTENO_FORRAJERO',
} as const;
export type CropId = (typeof CropId)[keyof typeof CropId];
export const CROP_IDS: readonly CropId[] = Object.values(CropId);

/**
 * Family of a crop. It groups the catalogue for the interface and, more importantly,
 * is the key of the baseline every crop derives its redundant magnitudes from
 * (shared/config/crops/families.ts), so that sixty two entries need sixty two
 * decisions and not seven hundred invented numbers.
 *
 * Not persisted: it is a property of the catalogue, never of a row.
 */
export const CropFamily = {
  CEREAL: 'CEREAL',
  LEGUME: 'LEGUME',
  OILSEED: 'OILSEED',
  INDUSTRIAL: 'INDUSTRIAL',
  ROOT: 'ROOT',
  LEAFY: 'LEAFY',
  FRUITING: 'FRUITING',
  HERB: 'HERB',
  FLOWER: 'FLOWER',
  FORAGE: 'FORAGE',
} as const;
export type CropFamily = (typeof CropFamily)[keyof typeof CropFamily];
export const CROP_FAMILIES: readonly CropFamily[] = Object.values(CropFamily);

/**
 * Silhouette a crop is drawn with. Deliberately coarser than the family, because two
 * families can share a drawing: what the canvas has to convey at sixteen pixels is
 * the shape of the plant, and the crop itself is told apart by its tint.
 *
 * Four of the eight cycle states show no plant at all, so the atlas only varies over
 * the other four: seven looks times four states plus the fifteen tiles that already
 * exist (plan section 4.1). Not persisted.
 */
export const CropLook = {
  /** Cereals and forages: an eared stalk. */
  SPIKE: 'SPIKE',
  /** Pulses: a low bush carrying pods. */
  POD: 'POD',
  /** Oilseeds: a single tall flower head. */
  HEAD: 'HEAD',
  /** Roots and bulbs: foliage over a mounded ridge. */
  TUBER: 'TUBER',
  /** Leafy crops: a ground hugging rosette. */
  ROSETTE: 'ROSETTE',
  /** Fruiting and industrial crops: a bush with hanging fruit. */
  BUSH: 'BUSH',
  /** Flowers and herbs: slender stems with blossoms. */
  BLOOM: 'BLOOM',
} as const;
export type CropLook = (typeof CropLook)[keyof typeof CropLook];
export const CROP_LOOKS: readonly CropLook[] = Object.values(CropLook);

/**
 * Season of the world (GDD section 82, where it is listed as future work, and section
 * 86, which puts it outside the strict MVP). It is added here as a pure derivation of
 * the world clock, with no dynamic weather and no yield modifier, which is what keeps
 * the reason section 86 gives for the exclusion satisfied; the departure is recorded
 * in docs/erratas-gdd-stack.md.
 *
 * Not persisted, and that is the whole point: the season is always a function of
 * `gameMs`, exactly as a tree stage is always a function of its planting instant
 * (backend/prisma/schema.prisma, `TreeGrowthStage`). Nothing can drift.
 */
export const Season = {
  SPRING: 'SPRING',
  SUMMER: 'SUMMER',
  AUTUMN: 'AUTUMN',
  WINTER: 'WINTER',
} as const;
export type Season = (typeof Season)[keyof typeof Season];
/** The four seasons in cycle order, which is the order the clock advances them. */
export const SEASONS: readonly Season[] = Object.values(Season);

// ---------------------------------------------------------------------------
// Machinery
// ---------------------------------------------------------------------------

/**
 * Machine types of the catalogue: GDD section 89 for agriculture and GDD section
 * 134 for forestry, which is a separate catalogue by design and not a reuse of
 * the tractor.
 */
export const MachineType = {
  TRACTOR: 'TRACTOR',
  PLOW: 'PLOW',
  CULTIVATOR: 'CULTIVATOR',
  SEEDER: 'SEEDER',
  HARVESTER: 'HARVESTER',
  TRAILER: 'TRAILER',
  HARVESTER_FORESTRY: 'HARVESTER_FORESTRY',
  FORWARDER: 'FORWARDER',
} as const;
export type MachineType = (typeof MachineType)[keyof typeof MachineType];
export const MACHINE_TYPES: readonly MachineType[] = Object.values(MachineType);

/**
 * Self propelled machine or towed implement (GDD section 88). An implement needs
 * a free powered machine; a harvester is a valid work unit on its own. Engine
 * power is not modelled as a numeric restriction in the MVP (GDD sections 88
 * and 99).
 */
export const MachineRole = {
  POWERED: 'POWERED',
  IMPLEMENT: 'IMPLEMENT',
} as const;
export type MachineRole = (typeof MachineRole)[keyof typeof MachineRole];
export const MACHINE_ROLES: readonly MachineRole[] = Object.values(MachineRole);

/**
 * Machine status (GDD section 95). `BROKEN` is reserved: random breakdowns are
 * explicitly outside the strict MVP because they are unfair in idle play, and the
 * value exists from the start as GDD section 95 requires. `IN_REPAIR` is active,
 * unlike in GDD section 95: plan section 2.2 turns repair into a scheduled event
 * with a duration, so a machine is unavailable while it is being repaired.
 */
export const MachineStatus = {
  IDLE: 'IDLE',
  WORKING: 'WORKING',
  BROKEN: 'BROKEN',
  IN_REPAIR: 'IN_REPAIR',
} as const;
export type MachineStatus = (typeof MachineStatus)[keyof typeof MachineStatus];
export const MACHINE_STATUSES: readonly MachineStatus[] = Object.values(MachineStatus);

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

/**
 * Worker status (GDD sections 35 and 101). Only `IDLE` and `WORKING` are produced
 * by the MVP; `TRAVELING`, `UNAVAILABLE`, `RESTING` and `INJURED` are reserved by
 * GDD sections 35, 101 and 112.
 */
export const WorkerStatus = {
  IDLE: 'IDLE',
  WORKING: 'WORKING',
  TRAVELING: 'TRAVELING',
  UNAVAILABLE: 'UNAVAILABLE',
  RESTING: 'RESTING',
  INJURED: 'INJURED',
} as const;
export type WorkerStatus = (typeof WorkerStatus)[keyof typeof WorkerStatus];
export const WORKER_STATUSES: readonly WorkerStatus[] = Object.values(WorkerStatus);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * Operations that a worker can execute with machinery (GDD sections 111 and 137,
 * plus the clearing of GDD section 10). The compatibility of each one with the
 * machinery is a datum of the catalogue, not a branch of code (GDD section 90,
 * plan section 5.4).
 */
export const TaskOperation = {
  PLOW: 'PLOW',
  CULTIVATE: 'CULTIVATE',
  SEED: 'SEED',
  HARVEST: 'HARVEST',
  FELL: 'FELL',
  REPLANT: 'REPLANT',
  CLEAR_LAND: 'CLEAR_LAND',
} as const;
export type TaskOperation = (typeof TaskOperation)[keyof typeof TaskOperation];
export const TASK_OPERATIONS: readonly TaskOperation[] = Object.values(TaskOperation);

/** Task status (GDD section 111). */
export const TaskStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUSES: readonly TaskStatus[] = Object.values(TaskStatus);

// ---------------------------------------------------------------------------
// Farm and storage
// ---------------------------------------------------------------------------

/**
 * Buildings of the catalogue: the four of GDD section 116 plus the wood store of
 * GDD section 136, which is a separate building and not a flag on the silo.
 */
export const BuildingType = {
  GARAGE: 'GARAGE',
  SILO: 'SILO',
  WORKER_HOME: 'WORKER_HOME',
  WORKSHOP: 'WORKSHOP',
  WOOD_STORAGE: 'WOOD_STORAGE',
  /** Bales and silage of the forage crops. */
  HAY_BARN: 'HAY_BARN',
  /** Roots, leaves, fruit, herbs and cut flowers, all of them perishable. */
  COLD_STORE: 'COLD_STORE',
  /** Cotton and tobacco, which keep dry and need neither cold nor a silo. */
  WAREHOUSE: 'WAREHOUSE',
} as const;
export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType];
export const BUILDING_TYPES: readonly BuildingType[] = Object.values(BuildingType);

/**
 * Fungible resources held in storage. They are aggregated per farm and not per
 * building, because they have no individual identity (plan section 5.4).
 *
 * With sixty two crops the resource stops being the crop and becomes the *category*
 * that decides which building can hold it. The relation to the building stays one to
 * one, which is what `BuildingDefinition.capacityResource` already assumes: a store
 * that granted room to two categories would have to either add up units of unlike
 * goods or hand out its capacity twice.
 *
 * Every farmed category counts in litres, exactly as wheat already did. A second unit
 * would fork the yield formula and the price type for no gain in play; wood keeps its
 * cubic decimetre because its catalogue prices by cubic metre.
 */
export const StorageResource = {
  /** Cereals, pulses and oilseeds. Held in the silo of GDD section 27. */
  GRAIN_LITERS: 'GRAIN_LITERS',
  /** Forage crops. Held in the hay barn. */
  FORAGE_LITERS: 'FORAGE_LITERS',
  /** Roots, leaves, fruit, herbs and flowers. Held in the cold store. */
  PRODUCE_LITERS: 'PRODUCE_LITERS',
  /** Cotton and tobacco. Held in the warehouse. */
  INDUSTRIAL_LITERS: 'INDUSTRIAL_LITERS',
  /** Timber (GDD section 136). */
  WOOD_M3: 'WOOD_M3',
} as const;
export type StorageResource = (typeof StorageResource)[keyof typeof StorageResource];
export const STORAGE_RESOURCES: readonly StorageResource[] = Object.values(StorageResource);

/**
 * A fungible good as it sits in a farm's stock: one pile per crop, plus timber.
 *
 * The category above answers "which building may hold this"; the item answers "what
 * exactly is this, and therefore what is it worth". Both are needed because the price
 * belongs to the crop: pricing by category would make the twenty two crops of
 * `GRAIN_LITERS` worth the same per litre, and the player would always sow whichever
 * yields the most litres per hour, collapsing sixty two crops into four decisions.
 */
export const StockItem = {
  ...CropId,
  WOOD: 'WOOD',
} as const;
export type StockItem = (typeof StockItem)[keyof typeof StockItem];
export const STOCK_ITEMS: readonly StockItem[] = Object.values(StockItem);

// ---------------------------------------------------------------------------
// Forestry
// ---------------------------------------------------------------------------

/** Tree species. One species in the MVP (GDD sections 133 and 141). */
export const TreeSpecies = {
  PINE: 'PINE',
} as const;
export type TreeSpecies = (typeof TreeSpecies)[keyof typeof TreeSpecies];
export const TREE_SPECIES_IDS: readonly TreeSpecies[] = Object.values(TreeSpecies);

/**
 * Life stage of a tree (GDD section 131), in ascending order of volume. It is
 * always derived from the age and never stored (plan section 2.2, resolution of
 * GDD sections 130 and 140).
 */
export const TreeGrowthStage = {
  SAPLING: 'SAPLING',
  YOUNG: 'YOUNG',
  MATURE: 'MATURE',
  OLD_GROWTH: 'OLD_GROWTH',
} as const;
export type TreeGrowthStage = (typeof TreeGrowthStage)[keyof typeof TreeGrowthStage];
export const TREE_GROWTH_STAGES: readonly TreeGrowthStage[] = Object.values(TreeGrowthStage);

/**
 * Tree status (GDD sections 130 and 132). `MARKED_FOR_HARVEST` is reserved:
 * GDD section 132 keeps individual marking outside the MVP, where felling is by
 * batch. `FELLED` is a logical deletion: the row stays with `felledAtGameMs` set,
 * and it also reserves the meaning "felled and awaiting transport" for when the
 * forwarder of GDD section 134 stops being a mere ownership requirement.
 */
export const TreeStatus = {
  STANDING: 'STANDING',
  MARKED_FOR_HARVEST: 'MARKED_FOR_HARVEST',
  FELLED: 'FELLED',
} as const;
export type TreeStatus = (typeof TreeStatus)[keyof typeof TreeStatus];
export const TREE_STATUSES: readonly TreeStatus[] = Object.values(TreeStatus);

// ---------------------------------------------------------------------------
// Player and ledger
// ---------------------------------------------------------------------------

/**
 * Player status. `IN_DEBT` is derived from a negative settled balance and blocks
 * discretionary spending but never selling or assigning tasks, which are the only
 * source of income (plan section 6.6). `BANKRUPT` is reserved and never produced:
 * ending the game of somebody who was offline is not acceptable in an
 * asynchronous game.
 */
export const PlayerStatus = {
  ACTIVE: 'ACTIVE',
  IN_DEBT: 'IN_DEBT',
  BANKRUPT: 'BANKRUPT',
} as const;
export type PlayerStatus = (typeof PlayerStatus)[keyof typeof PlayerStatus];
export const PLAYER_STATUSES: readonly PlayerStatus[] = Object.values(PlayerStatus);

/**
 * Kinds of ledger entry (plan section 5.3). Single entry with a signed amount:
 * negative is an outflow for the player, positive an inflow. The market, the
 * labour pool and the land vendor are "the world", so there is no double entry
 * counterparty to model.
 *
 * Reserved kinds, declared so that they are levers available without a migration:
 * `OVERDRAFT_INTEREST` (rate zero by default, plan section 6.6), `LIQUIDATION`
 * (the aggregate entry of a forced liquidation; the per asset entries use the
 * corresponding sale kinds), `COMPENSATION` (an incident is compensated with an
 * entry and never by rewinding the clock, plan section 6.1) and `SEED_PURCHASE`
 * (GDD section 117 does not cost the seed although the seeder sows from nothing;
 * activating it would worsen an already loss making first cycle).
 *
 * `STARTING_CAPITAL` is last because the PostgreSQL enum grows by appending: a new
 * player opens with the 160 000 of GDD section 117 and that amount needs an entry,
 * since the ledger is auditable precisely because the sum of its entries equals the
 * balance. Without it the invariant breaks on the first player. The idempotency key
 * is `starting-capital:<playerId>`, both in the seed and in the registration path
 * (added by the W2.5 patching window, docs/handoff/NOTES-w2d.md item 3).
 */
export const LedgerType = {
  LAND_PURCHASE: 'LAND_PURCHASE',
  LAND_SALE: 'LAND_SALE',
  BUILDING_PURCHASE: 'BUILDING_PURCHASE',
  BUILDING_SALE: 'BUILDING_SALE',
  MACHINE_PURCHASE: 'MACHINE_PURCHASE',
  MACHINE_SALE: 'MACHINE_SALE',
  MACHINE_REPAIR: 'MACHINE_REPAIR',
  CROP_SALE: 'CROP_SALE',
  WOOD_SALE: 'WOOD_SALE',
  HARVEST_WASTE: 'HARVEST_WASTE',
  WORKER_WAGES: 'WORKER_WAGES',
  MACHINE_MAINTENANCE: 'MACHINE_MAINTENANCE',
  MACHINE_OPERATING: 'MACHINE_OPERATING',
  OVERDRAFT_INTEREST: 'OVERDRAFT_INTEREST',
  LIQUIDATION: 'LIQUIDATION',
  COMPENSATION: 'COMPENSATION',
  SEED_PURCHASE: 'SEED_PURCHASE',
  STARTING_CAPITAL: 'STARTING_CAPITAL',
} as const;
export type LedgerType = (typeof LedgerType)[keyof typeof LedgerType];
export const LEDGER_TYPES: readonly LedgerType[] = Object.values(LedgerType);

/**
 * The four continuous accruals of GDD sections 107 and 124 plus the overdraft
 * interest of plan section 6.6. They are the only kinds whose amount is an
 * integral over an interval, and therefore the only ones whose idempotency key
 * carries the interval (plan section 6.3).
 */
export const ACCRUAL_LEDGER_TYPES: readonly LedgerType[] = [
  LedgerType.WORKER_WAGES,
  LedgerType.MACHINE_MAINTENANCE,
  LedgerType.MACHINE_OPERATING,
  LedgerType.OVERDRAFT_INTEREST,
];

/**
 * Kinds whose entry carries no money and exists only so that the return summary
 * can explain a physical loss: the grain that did not fit in the silo (plan
 * section 2.2, resolution of GDD sections 83 and 97). The wasted volume travels
 * in `meta`.
 */
export const NON_MONETARY_LEDGER_TYPES: readonly LedgerType[] = [LedgerType.HARVEST_WASTE];

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * Kinds of row in the `ScheduledEvent` outbox, which is the authoritative list of
 * what must happen (plan section 6.4). Redis only holds alarm clocks for the
 * subset inside the scheduling horizon.
 *
 * The recurring `sim.reconcile` job of plan section 6.4 is not listed here: it has
 * no domain row, it is a periodic job of the queue that enqueues everything
 * already due.
 */
export const ScheduledEventKind = {
  TASK_COMPLETE: 'TASK_COMPLETE',
  FIELD_ADVANCE_PHASE: 'FIELD_ADVANCE_PHASE',
  MACHINE_REPAIR_COMPLETE: 'MACHINE_REPAIR_COMPLETE',
  PLAYER_SETTLE_SWEEP: 'PLAYER_SETTLE_SWEEP',
  WORKER_POOL_REFRESH: 'WORKER_POOL_REFRESH',
  FOREST_NOTIFY_MILESTONE: 'FOREST_NOTIFY_MILESTONE',
} as const;
export type ScheduledEventKind = (typeof ScheduledEventKind)[keyof typeof ScheduledEventKind];
export const SCHEDULED_EVENT_KINDS: readonly ScheduledEventKind[] =
  Object.values(ScheduledEventKind);

/**
 * Lifecycle of an outbox row. The three values and their order mirror the
 * PostgreSQL enum of the same name exactly, so that enum parity between the schema
 * and the shared vocabulary stays a mechanical check (docs/handoff/NOTES-w2d.md,
 * item 4).
 *
 * A pending row whose due instant is in the past is simply late, which is what the
 * reconciliation sweep looks for. A paused world parks the row instead of
 * re-enqueueing it, and parking is the absence of an alarm clock in Redis and not a
 * status of its own (plan section 6.4).
 */
export const ScheduledEventStatus = {
  PENDING: 'PENDING',
  PROCESSED: 'PROCESSED',
  CANCELED: 'CANCELED',
} as const;
export type ScheduledEventStatus = (typeof ScheduledEventStatus)[keyof typeof ScheduledEventStatus];
export const SCHEDULED_EVENT_STATUSES: readonly ScheduledEventStatus[] =
  Object.values(ScheduledEventStatus);

/**
 * Tags of the events that the server pushes to the client, backed by the
 * `GameEvent` table and ordered by a per player sequence (plan section 7).
 * shared/ws builds its discriminated union over exactly these tags, so that the
 * envelope, the reducers of the client and the stored rows cannot diverge.
 *
 * `UPSERTED` means "this is the current state of this entity, apply it as a
 * whole": the client is a cache and never an authority, so a full replacement is
 * both simpler and idempotent. `CLOCK` is the only tag that is transport only: it
 * is periodic, carries no domain change and is not persisted with a sequence.
 */
export const GameEventType = {
  CLOCK: 'CLOCK',
  PLAYER_UPSERTED: 'PLAYER_UPSERTED',
  LEDGER_APPENDED: 'LEDGER_APPENDED',
  INVENTORY_UPSERTED: 'INVENTORY_UPSERTED',
  CHUNK_PATCHED: 'CHUNK_PATCHED',
  FARM_UPSERTED: 'FARM_UPSERTED',
  BUILDING_UPSERTED: 'BUILDING_UPSERTED',
  BUILDING_REMOVED: 'BUILDING_REMOVED',
  FIELD_UPSERTED: 'FIELD_UPSERTED',
  FIELD_REMOVED: 'FIELD_REMOVED',
  MACHINE_UPSERTED: 'MACHINE_UPSERTED',
  MACHINE_REMOVED: 'MACHINE_REMOVED',
  WORKER_UPSERTED: 'WORKER_UPSERTED',
  WORKER_REMOVED: 'WORKER_REMOVED',
  WORKER_POOL_UPSERTED: 'WORKER_POOL_UPSERTED',
  TASK_UPSERTED: 'TASK_UPSERTED',
  FOREST_PLOT_UPSERTED: 'FOREST_PLOT_UPSERTED',
  FOREST_PLOT_REMOVED: 'FOREST_PLOT_REMOVED',
  TREES_UPSERTED: 'TREES_UPSERTED',
  NOTICE: 'NOTICE',
} as const;
export type GameEventType = (typeof GameEventType)[keyof typeof GameEventType];
export const GAME_EVENT_TYPES: readonly GameEventType[] = Object.values(GameEventType);

/** Tags that are not persisted in `GameEvent` and consume no sequence number. */
export const TRANSPORT_ONLY_GAME_EVENT_TYPES: readonly GameEventType[] = [GameEventType.CLOCK];

// ---------------------------------------------------------------------------
// Validation codes
// ---------------------------------------------------------------------------

/**
 * Exhaustive set of validation codes. The same code travels in the error body of
 * the REST API and is looked up by the client in the message table below, so that
 * the reason a selection is highlighted in red and the reason the server returns
 * 400 cannot diverge (plan section 8).
 *
 * A code names a rule, never a field: the offending field, cell or identifier
 * travels in the details of the error, which shared/api defines.
 *
 * The authentication group is here and not in `ApiTransportCode` of
 * shared/api/errors.ts because a rejected session is a rule the client switches on
 * exactly like any other, and having a single set is what keeps one lookup table.
 * The transport module keeps the six failures that are properties of the service
 * and not of the player: idempotency header, rate limit, development flag, stub,
 * dependency down and unforeseen error (docs/handoff/NOTES-W2c.md, item 1.2,
 * applied by the W2.5 patching window).
 */
export const ValidationCode = {
  // Generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  NOT_OWNED: 'NOT_OWNED',
  WORLD_PAUSED: 'WORLD_PAUSED',
  CONTRACT_VERSION_MISMATCH: 'CONTRACT_VERSION_MISMATCH',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',

  // Authentication and session
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_TICKET_INVALID: 'AUTH_TICKET_INVALID',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',

  // Economy
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  SPENDING_BLOCKED_IN_DEBT: 'SPENDING_BLOCKED_IN_DEBT',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  QUANTITY_NOT_POSITIVE: 'QUANTITY_NOT_POSITIVE',

  // Selection and land
  SELECTION_EMPTY: 'SELECTION_EMPTY',
  SELECTION_TOO_LARGE: 'SELECTION_TOO_LARGE',
  SELECTION_NOT_CONTIGUOUS: 'SELECTION_NOT_CONTIGUOUS',
  SELECTION_NOT_ADJACENT: 'SELECTION_NOT_ADJACENT',
  TERRAIN_NOT_PURCHASABLE: 'TERRAIN_NOT_PURCHASABLE',
  TERRAIN_NOT_ARABLE: 'TERRAIN_NOT_ARABLE',
  TERRAIN_NOT_BUILDABLE: 'TERRAIN_NOT_BUILDABLE',
  TERRAIN_NOT_FORESTABLE: 'TERRAIN_NOT_FORESTABLE',
  CELL_ALREADY_OWNED: 'CELL_ALREADY_OWNED',
  CELL_NOT_OWNED: 'CELL_NOT_OWNED',
  CELL_IN_USE: 'CELL_IN_USE',
  CELL_HAS_STANDING_TREE: 'CELL_HAS_STANDING_TREE',
  CELL_ALREADY_HAS_TREE: 'CELL_ALREADY_HAS_TREE',
  NATURAL_TREES_ALREADY_CONSUMED: 'NATURAL_TREES_ALREADY_CONSUMED',

  // Fields
  FIELD_STATE_NOT_ALLOWED: 'FIELD_STATE_NOT_ALLOWED',
  FIELD_HAS_ACTIVE_TASK: 'FIELD_HAS_ACTIVE_TASK',
  FIELD_CROP_REQUIRED: 'FIELD_CROP_REQUIRED',
  FIELD_CROP_NOT_ALLOWED: 'FIELD_CROP_NOT_ALLOWED',
  FIELD_MERGE_INCOMPATIBLE: 'FIELD_MERGE_INCOMPATIBLE',
  FIELD_SPLIT_INCOMPLETE: 'FIELD_SPLIT_INCOMPLETE',
  CROP_UNKNOWN: 'CROP_UNKNOWN',
  CROP_OUT_OF_SEASON: 'CROP_OUT_OF_SEASON',

  // Farm and buildings
  BUILDING_FOOTPRINT_OVERLAPS: 'BUILDING_FOOTPRINT_OVERLAPS',
  BUILDING_NOT_EMPTY: 'BUILDING_NOT_EMPTY',
  GARAGE_CAPACITY_EXCEEDED: 'GARAGE_CAPACITY_EXCEEDED',
  HOME_CAPACITY_EXCEEDED: 'HOME_CAPACITY_EXCEEDED',
  STORAGE_CAPACITY_EXCEEDED: 'STORAGE_CAPACITY_EXCEEDED',
  WORKSHOP_REQUIRED: 'WORKSHOP_REQUIRED',
  STORAGE_REQUIRED: 'STORAGE_REQUIRED',

  // Machinery
  MACHINE_NOT_IDLE: 'MACHINE_NOT_IDLE',
  MACHINE_TYPE_NOT_COMPATIBLE: 'MACHINE_TYPE_NOT_COMPATIBLE',
  POWERED_MACHINE_REQUIRED: 'POWERED_MACHINE_REQUIRED',
  IMPLEMENT_REQUIRED: 'IMPLEMENT_REQUIRED',
  IMPLEMENT_NOT_ALLOWED: 'IMPLEMENT_NOT_ALLOWED',
  TRAILER_REQUIRED: 'TRAILER_REQUIRED',
  FORWARDER_REQUIRED: 'FORWARDER_REQUIRED',
  MACHINE_CONDITION_TOO_LOW: 'MACHINE_CONDITION_TOO_LOW',
  MACHINE_CONDITION_ALREADY_FULL: 'MACHINE_CONDITION_ALREADY_FULL',
  MACHINE_NOT_REPAIRABLE: 'MACHINE_NOT_REPAIRABLE',
  MACHINE_WRONG_FARM: 'MACHINE_WRONG_FARM',

  // Workers
  WORKER_NOT_IDLE: 'WORKER_NOT_IDLE',
  WORKER_WRONG_FARM: 'WORKER_WRONG_FARM',
  CANDIDATE_NOT_AVAILABLE: 'CANDIDATE_NOT_AVAILABLE',

  // Tasks
  TASK_NOT_CANCELABLE: 'TASK_NOT_CANCELABLE',
  TASK_ALREADY_FINISHED: 'TASK_ALREADY_FINISHED',
  OPERATION_NOT_SUPPORTED: 'OPERATION_NOT_SUPPORTED',
  TARGET_KIND_MISMATCH: 'TARGET_KIND_MISMATCH',

  // Forestry
  NO_FELLABLE_TREES: 'NO_FELLABLE_TREES',
  TREE_STAGE_NOT_FELLABLE: 'TREE_STAGE_NOT_FELLABLE',
} as const;
export type ValidationCode = (typeof ValidationCode)[keyof typeof ValidationCode];
export const VALIDATION_CODES: readonly ValidationCode[] = Object.values(ValidationCode);

/**
 * Message table, in Spanish, which is the language of the interface. Impersonal
 * voice and no interpolation: a message describes the rule that was not met, and
 * the concrete figures travel in the details of the error so that the client can
 * compose them without parsing text.
 */
export const VALIDATION_MESSAGES: Readonly<Record<ValidationCode, string>> = {
  VALIDATION_FAILED: 'La peticion no cumple el esquema esperado.',
  NOT_FOUND: 'El recurso solicitado no existe.',
  NOT_OWNED: 'El recurso no pertenece al jugador.',
  WORLD_PAUSED: 'El mundo esta pausado y no admite operaciones de simulacion.',
  CONTRACT_VERSION_MISMATCH:
    'La version del contrato del cliente no coincide con la del servidor. Es necesario recargar.',
  IDEMPOTENCY_KEY_REUSED:
    'La clave de idempotencia ya se empleo con una peticion de contenido distinto.',

  AUTH_REQUIRED: 'La peticion exige una sesion valida.',
  AUTH_INVALID_CREDENTIALS: 'Las credenciales indicadas no son validas.',
  AUTH_TOKEN_EXPIRED: 'La sesion ha caducado. Es necesario renovarla.',
  AUTH_TICKET_INVALID: 'El ticket de conexion no es valido o ya se ha consumido.',
  EMAIL_ALREADY_REGISTERED: 'La direccion de correo ya figura registrada.',

  INSUFFICIENT_FUNDS: 'El saldo disponible no cubre el importe de la operacion.',
  SPENDING_BLOCKED_IN_DEBT:
    'Con saldo negativo no se admite gasto discrecional. Vender produccion o completar tareas restablece el saldo.',
  INSUFFICIENT_STOCK: 'Las existencias almacenadas no alcanzan la cantidad indicada.',
  QUANTITY_NOT_POSITIVE: 'La cantidad debe ser mayor que cero.',

  SELECTION_EMPTY: 'La seleccion no contiene ninguna celda.',
  SELECTION_TOO_LARGE: 'La seleccion supera el numero maximo de celdas admitido.',
  SELECTION_NOT_CONTIGUOUS: 'Las celdas seleccionadas no forman una superficie contigua.',
  SELECTION_NOT_ADJACENT: 'La seleccion no es adyacente a la superficie de destino.',
  TERRAIN_NOT_PURCHASABLE: 'El terreno seleccionado no es comprable.',
  TERRAIN_NOT_ARABLE: 'El terreno seleccionado no admite agricultura.',
  TERRAIN_NOT_BUILDABLE: 'El terreno seleccionado no admite construccion.',
  TERRAIN_NOT_FORESTABLE: 'El terreno seleccionado no admite silvicultura.',
  CELL_ALREADY_OWNED: 'Alguna de las celdas ya tiene propietario.',
  CELL_NOT_OWNED: 'Alguna de las celdas no pertenece al jugador.',
  CELL_IN_USE: 'Alguna de las celdas ya tiene un uso asignado.',
  CELL_HAS_STANDING_TREE: 'Alguna de las celdas contiene un arbol en pie.',
  CELL_ALREADY_HAS_TREE: 'Alguna de las celdas ya contiene un arbol.',
  NATURAL_TREES_ALREADY_CONSUMED:
    'Las celdas ya se poblaron una vez y no vuelven a generar arbolado natural.',

  FIELD_STATE_NOT_ALLOWED: 'El estado del campo no admite la operacion solicitada.',
  FIELD_HAS_ACTIVE_TASK: 'El campo tiene una tarea en curso.',
  FIELD_CROP_REQUIRED: 'La siembra exige indicar el cultivo.',
  FIELD_CROP_NOT_ALLOWED: 'La operacion solicitada no admite indicar cultivo.',
  FIELD_MERGE_INCOMPATIBLE: 'Los campos indicados no son compatibles para fusionarse.',
  FIELD_SPLIT_INCOMPLETE: 'La division propuesta no produce dos campos contiguos y completos.',
  CROP_UNKNOWN: 'El cultivo indicado no figura en el catalogo.',
  CROP_OUT_OF_SEASON: 'El cultivo indicado no se siembra en la estacion vigente.',

  BUILDING_FOOTPRINT_OVERLAPS: 'La huella del edificio solapa con otro uso del suelo.',
  BUILDING_NOT_EMPTY: 'El edificio conserva contenido asignado y no puede retirarse.',
  GARAGE_CAPACITY_EXCEEDED: 'No queda plaza libre de garaje.',
  HOME_CAPACITY_EXCEEDED: 'No queda plaza libre de vivienda para trabajadores.',
  STORAGE_CAPACITY_EXCEEDED: 'La capacidad de almacen disponible no admite la cantidad prevista.',
  WORKSHOP_REQUIRED: 'La reparacion exige un taller en la granja.',
  STORAGE_REQUIRED: 'La operacion exige almacenamiento con capacidad en la granja de destino.',

  MACHINE_NOT_IDLE: 'La maquina no esta disponible.',
  MACHINE_TYPE_NOT_COMPATIBLE: 'El tipo de maquina no es compatible con la operacion.',
  POWERED_MACHINE_REQUIRED: 'La operacion exige una maquina propulsada del tipo indicado.',
  IMPLEMENT_REQUIRED: 'La operacion exige un implemento libre del tipo indicado.',
  IMPLEMENT_NOT_ALLOWED: 'La operacion no admite el implemento indicado.',
  TRAILER_REQUIRED: 'La cosecha exige un remolque libre.',
  FORWARDER_REQUIRED: 'La tala exige disponer de autocargador.',
  MACHINE_CONDITION_TOO_LOW: 'La condicion de la maquina esta por debajo del minimo exigido.',
  MACHINE_CONDITION_ALREADY_FULL: 'La maquina esta en condicion plena.',
  MACHINE_NOT_REPAIRABLE: 'La maquina no admite reparacion en su estado actual.',
  MACHINE_WRONG_FARM: 'La maquina pertenece a otra granja.',

  WORKER_NOT_IDLE: 'El trabajador no esta disponible.',
  WORKER_WRONG_FARM: 'El trabajador pertenece a otra granja.',
  CANDIDATE_NOT_AVAILABLE: 'El candidato ya no figura en el pool de contratacion.',

  TASK_NOT_CANCELABLE: 'La tarea no admite cancelacion.',
  TASK_ALREADY_FINISHED: 'La tarea ya esta finalizada.',
  OPERATION_NOT_SUPPORTED: 'La operacion solicitada no esta soportada.',
  TARGET_KIND_MISMATCH: 'El objetivo indicado no corresponde con la operacion.',

  NO_FELLABLE_TREES: 'La seleccion no contiene arboles talables.',
  TREE_STAGE_NOT_FELLABLE: 'La fase de crecimiento del arbol no admite tala.',
};
