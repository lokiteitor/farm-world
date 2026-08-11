// Branded identifier types.
//
// Owner: workflow W2 (vocabulary).
//
// Every identifier is a string at runtime (PostgreSQL generates them), but a
// `FieldId` must not be accepted where a `FarmId` is expected: the API surface of
// plan section 7 passes identifiers through several layers, and the compiler is
// the only cheap defence against swapping two of them.

import type { Brand } from './units.js';

/** Builds a constructor for a branded identifier of the given tag. */
function identifier<TTag extends string>(tag: TTag): (value: string) => Brand<string, TTag> {
  return (value: string): Brand<string, TTag> => {
    if (value.length === 0) {
      throw new RangeError(`An identifier of ${tag} cannot be empty`);
    }
    return value as Brand<string, TTag>;
  };
}

export type WorldId = Brand<string, 'WorldId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type RefreshTokenId = Brand<string, 'RefreshTokenId'>;
export type FarmId = Brand<string, 'FarmId'>;
export type BuildingId = Brand<string, 'BuildingId'>;
export type FieldId = Brand<string, 'FieldId'>;
export type MachineId = Brand<string, 'MachineId'>;
export type WorkerId = Brand<string, 'WorkerId'>;
export type WorkerCandidateId = Brand<string, 'WorkerCandidateId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type ForestPlotId = Brand<string, 'ForestPlotId'>;
export type TreeId = Brand<string, 'TreeId'>;
export type LedgerEntryId = Brand<string, 'LedgerEntryId'>;
export type ScheduledEventId = Brand<string, 'ScheduledEventId'>;
export type GameEventId = Brand<string, 'GameEventId'>;

/**
 * Client supplied key that makes a money moving POST idempotent (plan section
 * 6.3). It is not a database identifier, but it is branded for the same reason.
 */
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

export const worldId = identifier('WorldId');
export const playerId = identifier('PlayerId');
export const refreshTokenId = identifier('RefreshTokenId');
export const farmId = identifier('FarmId');
export const buildingId = identifier('BuildingId');
export const fieldId = identifier('FieldId');
export const machineId = identifier('MachineId');
export const workerId = identifier('WorkerId');
export const workerCandidateId = identifier('WorkerCandidateId');
export const taskId = identifier('TaskId');
export const forestPlotId = identifier('ForestPlotId');
export const treeId = identifier('TreeId');
export const ledgerEntryId = identifier('LedgerEntryId');
export const scheduledEventId = identifier('ScheduledEventId');
export const gameEventId = identifier('GameEventId');
export const idempotencyKey = identifier('IdempotencyKey');
