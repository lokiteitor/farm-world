// The normalised collection every entity store is built on.
//
// Owner: W3-C.
//
// Normalised means keyed by identifier and never an array: every frame of the contract
// is an upsert of one whole entity (`<ENTITY>_UPSERTED`, shared/ws/events.ts), so the
// reducer has to be able to replace one row in constant time and without caring where
// it sat in a list. The ordering a panel wants is a getter of that panel's store, not a
// property of the storage.
//
// It is a factory of plain reactive state and not a store of its own, because Pinia
// identifies a store by name and twelve entity stores need twelve names.

import { computed, ref, type ComputedRef, type Ref } from 'vue';

export interface Identified {
  readonly id: string;
}

export interface Collection<TEntity extends Identified> {
  /** Rows by identifier. Written only by the reducer. */
  readonly byId: Ref<Record<string, TEntity>>;
  /** Rows in insertion order, which is the order the server sent them in. */
  readonly all: ComputedRef<readonly TEntity[]>;
  readonly count: ComputedRef<number>;
  get: (id: string) => TEntity | undefined;
  has: (id: string) => boolean;
  upsert: (entity: TEntity) => void;
  upsertMany: (entities: readonly TEntity[]) => void;
  remove: (id: string) => void;
  removeMany: (ids: readonly string[]) => void;
  /** Replaces the whole collection. Used by the snapshot and by nothing else. */
  replaceAll: (entities: readonly TEntity[]) => void;
  clear: () => void;
  /** Rows that satisfy a predicate, as a plain array. */
  where: (predicate: (entity: TEntity) => boolean) => readonly TEntity[];
}

export function createCollection<TEntity extends Identified>(): Collection<TEntity> {
  const byId = ref<Record<string, TEntity>>({}) as Ref<Record<string, TEntity>>;
  const all = computed<readonly TEntity[]>(() => Object.values(byId.value));
  const count = computed(() => Object.keys(byId.value).length);

  return {
    byId,
    all,
    count,
    get: (id) => byId.value[id],
    has: (id) => Object.hasOwn(byId.value, id),
    upsert: (entity) => {
      byId.value[entity.id] = entity;
    },
    upsertMany: (entities) => {
      for (const entity of entities) {
        byId.value[entity.id] = entity;
      }
    },
    remove: (id) => {
      delete byId.value[id];
    },
    removeMany: (ids) => {
      for (const id of ids) {
        delete byId.value[id];
      }
    },
    replaceAll: (entities) => {
      const next: Record<string, TEntity> = {};
      for (const entity of entities) {
        next[entity.id] = entity;
      }
      byId.value = next;
    },
    clear: () => {
      byId.value = {};
    },
    where: (predicate) => all.value.filter(predicate),
  };
}
