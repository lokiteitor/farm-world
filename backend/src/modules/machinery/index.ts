// Module `machinery`: the catalogue, the purchase with a garage slot, the sale, the repair
// and the wear (GDD sections 87 to 99).
//
// Owner: workflow W5-A. It replaces the scaffolding workflow W3-A left with the definitive
// path and signature (plan section 11, rule 3): `src/app.ts`, `src/handlers.ts` and the route
// registry were not touched, only the body of this module. `defineStubRoute` became
// `defineRoute`, in place.
//
// The shape of the module, which is a chain and never a loop:
//
//   `record.ts`    the row, its four derived readings and the reading side. No writes.
//   `readModel.ts` the entities of the contract and the catalogue reply.
//   `service.ts`   the domain: buying, selling, repairing, completing a repair and wearing.
//   `jobs.ts`      the handler of `MACHINE_REPAIR_COMPLETE`.
//   `routes.ts`    the HTTP surface, which converts between wire and domain types.
//
// WHAT ENTERS THE MVP OF THIS SYSTEM (GDD section 99), and where each item is:
//
//   Catalogue of six agricultural machines            `shared/config/machines.ts`
//   Operation to machinery compatibility table        `shared/rules/machinery.ts`
//   Duration from workSpeed, condition and skill      `shared/rules/duration.ts`, used by W6
//   Wear per hour worked                              `applyMachineWear` of `service.ts`
//   maintenanceCost and operatingCost as separate     `shared/rules/holding.ts`, `lib/accrual`
//   Repair in the workshop                            `repairMachine` of `service.ts`
//   Garage limit blocking purchases                   `resolveGarageSlot` of `service.ts`
//
// And what does not: random breakdowns, so `BROKEN` is never written; the incremental filling
// of the trailer, so the harvest goes straight to the silo (GDD section 97); required power
// as a numeric restriction; and degradation while idle, which is why the wear mark only moves
// when hours worked are accounted for.
//
// WHAT THIS MODULE DOES NOT DO. It does not create, validate or complete a task: that is the
// engine of workflow W6-A, which imports the two pieces this module exposes for it,
// `requireAssignableMachines` and `applyMachineWear`. Nor does it charge maintenance or
// operation: both are integrals over validity intervals computed by `lib/accrual.ts`, and
// this module's whole contribution to them is writing `acquiredGameMs` and `disposedGameMs`.

export { registerMachineryRoutes } from './routes.js';

export {
  MACHINE_REF_TYPE,
  MACHINE_SELECT,
  REPAIR_MS_PER_CONDITION_POINT,
  assignmentError,
  definitionOf,
  findLiveMachine,
  isAssignable,
  loadMachines,
  machineAssignmentRefusal,
  repairCostBetween,
  repairDurationBetween,
  requireMachine,
  resaleValueOf,
  scheduledRestorationBp,
  type MachineRecord,
} from './record.js';

export { buildCatalogReply, machineUpsertedFrame, toMachineDto } from './readModel.js';

export {
  applyMachineWear,
  applyMachineWearOverInterval,
  buyMachine,
  completeRepair,
  garageSlotsOf,
  repairMachine,
  requireAssignableMachines,
  sellMachine,
  type BuyMachineInput,
  type BuyMachineOutcome,
  type RepairMachineInput,
  type RepairMachineOutcome,
  type SellMachineInput,
  type SellMachineOutcome,
} from './service.js';

export { OWNED_EVENT_KIND, machineRepairCompleteHandler } from './jobs.js';
