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
import { type BuildingType, type CellCoordWire, type SelectionPurpose } from '~/shared/index';

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

/**
 * Names of the nine modes of the selection tool (`game/selection/modes.ts`).
 *
 * They are written out here instead of imported so that this module keeps depending on
 * nothing but `shared/`, which is what lets a Phaser scene and a Vue panel both hold it.
 * The correspondence is not left to trust: `pages/game.vue` declares the table from
 * `SelectionToolMode` to this union, exhaustive by its type in both directions, so a mode
 * added on either side stops the compilation.
 */
export type SelectionToolModeName =
  | 'INSPECT'
  | 'PURCHASE'
  | 'FIELD_CREATE'
  | 'FIELD_EXTEND'
  | 'FIELD_SPLIT'
  | 'FOREST_PLOT'
  | 'FELL_AREA'
  | 'CLEAR_LAND'
  | 'BUILDING';

/**
 * The interaction mode the scene must switch to. Null returns it to inspection.
 *
 * `purpose` is the shared vocabulary of `SelectionPurpose` and it cannot name every mode:
 * felling an area and splitting a field have no purpose of their own, so both used to
 * arrive as the nearest one, which for a felling is `CLEAR_LAND` -- the mode whose per
 * cell rule requires exactly the opposite, a cell with no standing tree
 * (`game/selection/rules.ts`). `mode` names the mode when the caller needs that
 * precision; the tool keeps reading `purpose`, and the page applies `mode` after it.
 *
 * The three subject fields are the other half of the same gap. A mode armed from a panel
 * used to arrive without the field, the plot or the building type it acts on, so the
 * panel that the confirmation opens received a null subject
 * (docs/handoff/NOTES-w4g.md 1.2, docs/handoff/NOTES-w5w.md 4.6). They are declared here
 * and applied by the page, which is the only place that may read a store and reach the
 * tool at the same time.
 */
export interface SelectionMode {
  readonly purpose: SelectionPurpose | null;
  /** The mode itself, when the purpose cannot name it. */
  readonly mode?: SelectionToolModeName;
  /** Field being extended (GDD section 20) or split (GDD section 21). */
  readonly fieldId?: string | null;
  /** Forest plot a felling works in (GDD section 135), or the cells are leaving. */
  readonly forestPlotId?: string | null;
  /** Building being placed, whose footprint fixes the cell count (GDD section 116). */
  readonly buildingType?: BuildingType | null;
  /** Cell count the footprint of a building fixes, when the mode places one. */
  readonly fixedWidthCells?: number;
  readonly fixedHeightCells?: number;
}

/**
 * Rendering preferences of this browser, as the settings panel keeps them.
 *
 * They are not server state and they are not domain state: they are five decisions about
 * how the canvas draws, persisted in `localStorage` by
 * `components/panels/settings/preferences.ts`. The event exists because none of the
 * fifteen original events of this bridge meant "the render settings changed", so the
 * panel had to fall back to `world:reload`, which rebuilds every chunk to change the
 * colour of a grid (docs/handoff/NOTES-w4e.md, section 1.2).
 *
 * The whole set travels on every change, not a delta. The payload is five scalars, the
 * scene applies what it owns and ignores the rest, and a receiver that missed one event
 * is still correct after the next one.
 */
export interface RenderPreferences {
  readonly gridVisible: boolean;
  readonly outlinesVisible: boolean;
  /** Zoom at or above which the near level of detail is used. */
  readonly lodThresholdZoom: number;
  /** Multiplier over one discrete zoom step per wheel notch. */
  readonly zoomSensitivity: number;
  /** Suppresses the camera flight and the zoom transition. */
  readonly reducedMotion: boolean;
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
  /** Client rendering preferences changed. The scene applies what it owns. */
  'settings:changed': RenderPreferences;
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
  /**
   * Last payload of an event, for a late subscriber. Only the state-like ones.
   *
   * `settings:changed` is one of them, and it has to be: the world scene subscribes in
   * its own `create`, which runs after the boot and preload scenes, so a page that
   * published the stored preferences while mounting the canvas would have published them
   * to nobody. Retaining the payload is what makes the order of the two irrelevant.
   */
  latest: <TEvent extends 'camera:changed' | 'render:stats' | 'scene:ready' | 'settings:changed'>(
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
    'settings:changed',
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
