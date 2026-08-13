// Module `fields`: the geometry of a field, the crop cycle state machine and the growth
// jobs.
//
// Owner: workflow W4-C. Replaces the scaffolding workflow W3-A left with the definitive
// path and signature (plan section 11, rule 3): `src/app.ts` and the route registry were
// not touched, only the body of this module.
//
// The shape of the module, and why it is split the way it is:
//
//   - `projection.ts` is pure. It answers what a field is at an instant, delegating every
//     rate and every curve to `shared/rules/yield.ts`, and adds the one thing a shared rule
//     cannot know: how the interval since an attribute was last settled is cut by the phase
//     timeline of GDD section 76. That cut is what makes the weed level of GDD section 78
//     grow during `GROWING` and not during `GERMINATING` on a field nobody has touched for
//     two hundred hours.
//   - `stateMachine.ts` interrogates the two tables of `shared/config`: the transitions of
//     GDD section 76 and the operation requirements of GDD section 90. It decides what is
//     legal and refuses with the reason the client renders; it never writes.
//   - `service.ts` is the internal API. It reads and writes the row, applies one transition
//     at a time at the instant of its boundary, keeps exactly one pending
//     `FIELD_ADVANCE_PHASE` per field, and implements the four geometry operations of GDD
//     sections 19 to 22. It is what `modules/tasks` of workflow W6-A consumes so that the
//     crop cycle has one implementation and the task engine has none of it.
//   - `jobs.ts` is the handler of the scheduled event, registered for real by
//     `src/handlers.ts`, so `farm_world_scheduled_events_unhandled_total` no longer counts
//     this module.
//   - `routes.ts` is the HTTP surface, deliberately thin.
//
// The cells are claimed and released through `modules/world/service.ts`, a module of an
// earlier phase, and never with a statement written here. `land` and `farms` are siblings
// of this phase and are not imported (plan section 11, rule 4).

export { registerFieldsRoutes } from './routes.js';

export { OWNED_EVENT_KIND, fieldAdvancePhaseHandler } from './jobs.js';

export {
  FALLOW_RATE_CROP,
  MAX_PHASE_SEGMENTS,
  availableOperations,
  cropOf,
  expectedYieldLiters,
  isTimedPhase,
  nextTimedState,
  phaseBoundaryAfter,
  phaseSegments,
  projectFieldPhase,
  settleAttributes,
  settleFertility,
  settleFertilization,
  settleWeedLevel,
  type FieldAttributes,
  type FieldPhaseProjection,
  type PhaseSegment,
  type SettledAttributes,
} from './projection.js';

export {
  EXTENDABLE_STATES,
  fieldOperationRequirement,
  requireExtendable,
  requireOperationAllowed,
  requireTransition,
  statesReachableFrom,
  transitionBetween,
} from './stateMachine.js';

export {
  FIELD_REF_TYPE,
  applyFieldOperation,
  applyTransition,
  buildFieldDto,
  chunkFrames,
  createField,
  dedupeCells,
  extendField,
  fieldCells,
  fieldUpsertedFrame,
  findLiveField,
  loadPlayerFields,
  materializeProjectedPhase,
  mergeFields,
  refuseSelection,
  requireFarmOfPlayer,
  requireField,
  requireIdleField,
  splitField,
  syncPhaseSchedule,
  toFieldRecord,
  weightedBp,
  writeSettledField,
  type CreateFieldInput,
  type FieldMutation,
  type FieldOperationInput,
  type FieldOperationOutcome,
  type FieldRecord,
  type MergeFieldsOutcome,
  type SplitFieldOutcome,
} from './service.js';
