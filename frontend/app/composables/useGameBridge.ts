// The bridge between Vue and Phaser: a typed event emitter, in both directions.
//
// Owner: W3-C. The contract is complete even though no Phaser scene exists yet, because
// this is what W3-D, W4-D, W5-D and W5-E build against, and a bridge that grew one event
// per agent would be the panel registry problem all over again.
//
// Direction is the whole point. Phaser owns the canvas and owns nothing else (plan section
// 9): it publishes what the pointer did and what the camera is looking at, and it never
// writes a store. Vue publishes camera orders and reload requests, and never reaches into
// a scene. Everything either side needs from the other travels through the events declared
// here, and the ESLint zone rule that forbids `app/game` from importing `app/stores`
// enforces the half of it that a convention would not.
//
// It is a plain emitter and not `mitt` or an event bus of Vue: the whole implementation is
// forty lines, the alternative is a dependency in a frozen `package.json`, and a typed map
// gives the exhaustiveness a string keyed bus does not.

import { onScopeDispose } from 'vue';
import { type CellCoordWire, type SelectionPurpose } from '~/shared/index';

// ---------------------------------------------------------------------------
// Phaser to Vue
// ---------------------------------------------------------------------------

/** What the player clicked on, resolved by the scene to a domain subject. */
export interface CanvasPick {
  readonly cell: CellCoordWire;
  /** Entity under the pointer, when the scene resolved one. */
  readonly subjectKind: 'CELL' | 'FIELD' | 'BUILDING' | 'FOREST_PLOT' | 'MACHINE' | 'WORKER';
  readonly subjectId: string | null;
  /** Whether a modifier was held, which is what turns a drag into a subtraction. */
  readonly additive: boolean;
  readonly subtractive: boolean;
}

/** The camera, as the scene reports it. Read by the minimap and by the perf route. */
export interface CameraView {
  readonly centreCellX: number;
  readonly centreCellY: number;
  readonly zoom: number;
  /** Visible rectangle in cells, which is what the streaming ring is computed from. */
  readonly minCellX: number;
  readonly minCellY: number;
  readonly maxCellX: number;
  readonly maxCellY: number;
}

/** Rendering counters of the measurement route (plan section 9.3). */
export interface RenderStats {
  readonly fps: number;
  readonly drawCalls: number;
  readonly quads: number;
  readonly loadedChunks: number;
  readonly levelOfDetail: 'NEAR' | 'FAR';
}

// ---------------------------------------------------------------------------
// Vue to Phaser
// ---------------------------------------------------------------------------

/** An order to move the camera. `smooth` is a short transition, not an animation. */
export interface CameraOrder {
  readonly cellX: number;
  readonly cellY: number;
  readonly zoom?: number;
  readonly smooth?: boolean;
}

/** The interaction mode the scene must switch to. Null returns it to inspection. */
export interface SelectionMode {
  readonly purpose: SelectionPurpose | null;
  /** Cell count the footprint of a building fixes, when the mode places one. */
  readonly fixedWidthCells?: number;
  readonly fixedHeightCells?: number;
}

// ---------------------------------------------------------------------------
// The event map
// ---------------------------------------------------------------------------

/**
 * Every event of the bridge, with its payload. Adding one is a change here and a change
 * in both sides that use it, which is exactly the friction that keeps the surface small.
 */
export interface GameBridgeEvents {
  // --- published by Phaser ------------------------------------------------
  /** The scene finished booting and the canvas is live. */
  'scene:ready': { readonly width: number; readonly height: number };
  /** Progress of the texture factory, which generates every asset in code. */
  'scene:preload': { readonly ratio: number; readonly label: string };
  'scene:error': { readonly message: string };
  /** The pointer picked a cell or an entity. */
  'canvas:pick': CanvasPick;
  /** The pointer moved to another cell. Emitted only on crossing a cell border. */
  'canvas:hover': { readonly cell: CellCoordWire | null };
  /** A drag in progress, in cells. The store composes the set from it. */
  'canvas:drag': {
    readonly from: CellCoordWire;
    readonly to: CellCoordWire;
    readonly phase: 'START' | 'MOVE' | 'END';
    readonly additive: boolean;
    readonly subtractive: boolean;
  };
  /** The camera changed. Drives the streaming ring and the minimap. */
  'camera:changed': CameraView;
  /** Counters of the measurement route. */
  'render:stats': RenderStats;

  // --- published by Vue ---------------------------------------------------
  /** Move the camera. Used by the return summary and by "jump to the conflict". */
  'camera:goto': CameraOrder;
  /** Change the interaction mode of the scene. */
  'selection:mode': SelectionMode;
  /** The selection changed in the store and the highlight must be redrawn. */
  'selection:changed': { readonly cellCount: number; readonly valid: boolean };
  /** Chunks whose cached data changed and whose tilemap must be rebuilt. */
  'chunks:invalidated': { readonly keys: readonly string[] };
  /** Redraw everything: after a full snapshot resynchronisation. */
  'world:reload': Record<string, never>;
  /** Whether the world layer accepts input. Written only by the input arbiter. */
  'input:enabled': { readonly enabled: boolean; readonly reason: string };
  /** The viewport was resized by the CSS grid, which is what decides the size. */
  'viewport:resized': { readonly width: number; readonly height: number };
}

export type GameBridgeEvent = keyof GameBridgeEvents;
export type GameBridgeHandler<TEvent extends GameBridgeEvent> = (
  payload: GameBridgeEvents[TEvent],
) => void;

export interface GameBridge {
  on: <TEvent extends GameBridgeEvent>(
    event: TEvent,
    handler: GameBridgeHandler<TEvent>,
  ) => () => void;
  once: <TEvent extends GameBridgeEvent>(
    event: TEvent,
    handler: GameBridgeHandler<TEvent>,
  ) => () => void;
  off: <TEvent extends GameBridgeEvent>(event: TEvent, handler: GameBridgeHandler<TEvent>) => void;
  emit: <TEvent extends GameBridgeEvent>(event: TEvent, payload: GameBridgeEvents[TEvent]) => void;
  /** Last payload of an event, for a late subscriber. Only the two state-like ones. */
  latest: <TEvent extends 'camera:changed' | 'render:stats' | 'scene:ready'>(
    event: TEvent,
  ) => GameBridgeEvents[TEvent] | undefined;
  clear: () => void;
  /** Handlers currently registered. Diagnostics and tests only. */
  handlerCount: () => number;
}

type HandlerSet = Set<(payload: never) => void>;

function createBridge(): GameBridge {
  const handlers = new Map<GameBridgeEvent, HandlerSet>();
  const retained = new Map<GameBridgeEvent, unknown>();
  const RETAINED_EVENTS: readonly GameBridgeEvent[] = [
    'camera:changed',
    'render:stats',
    'scene:ready',
  ];

  function setFor(event: GameBridgeEvent): HandlerSet {
    let set = handlers.get(event);
    if (set === undefined) {
      set = new Set();
      handlers.set(event, set);
    }
    return set;
  }

  return {
    on(event, handler) {
      const set = setFor(event);
      set.add(handler as (payload: never) => void);
      return () => {
        set.delete(handler as (payload: never) => void);
      };
    },
    once(event, handler) {
      const set = setFor(event);
      const wrapped = ((payload: GameBridgeEvents[typeof event]) => {
        set.delete(wrapped as (payload: never) => void);
        handler(payload);
      }) as GameBridgeHandler<typeof event>;
      set.add(wrapped as (payload: never) => void);
      return () => {
        set.delete(wrapped as (payload: never) => void);
      };
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler as (payload: never) => void);
    },
    emit(event, payload) {
      if (RETAINED_EVENTS.includes(event)) {
        retained.set(event, payload);
      }
      const set = handlers.get(event);
      if (set === undefined) {
        return;
      }
      // A copy, because a handler is allowed to unsubscribe itself while being called.
      for (const handler of [...set]) {
        (handler as (value: GameBridgeEvents[typeof event]) => void)(payload);
      }
    },
    latest(event) {
      return retained.get(event) as GameBridgeEvents[typeof event] | undefined;
    },
    clear() {
      handlers.clear();
      retained.clear();
    },
    handlerCount() {
      let total = 0;
      for (const set of handlers.values()) {
        total += set.size;
      }
      return total;
    },
  };
}

/**
 * One bridge per page load. It is module scoped rather than provided through Vue's
 * injection because Phaser lives outside the component tree: a scene cannot call `inject`,
 * and threading a provider into the scene constructor would put the bridge in two places.
 */
const bridge = createBridge();

/**
 * The bridge, with automatic unsubscription for a component.
 *
 * A handler registered through the returned `on` is removed when the calling scope is
 * disposed, which is what stops a panel that was closed from keeping the camera handler of
 * a page that no longer exists alive.
 */
export function useGameBridge(): GameBridge {
  const disposers: (() => void)[] = [];

  const scoped: GameBridge = {
    ...bridge,
    on(event, handler) {
      const dispose = bridge.on(event, handler);
      disposers.push(dispose);
      return dispose;
    },
    once(event, handler) {
      const dispose = bridge.once(event, handler);
      disposers.push(dispose);
      return dispose;
    },
  };

  onScopeDispose(() => {
    for (const dispose of disposers) {
      dispose();
    }
  }, true);

  return scoped;
}

/** The bridge without scope tracking, for a Phaser scene and for the tests. */
export function gameBridge(): GameBridge {
  return bridge;
}
