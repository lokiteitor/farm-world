// Bridge between the canvas and the rest of the client.
//
// Owner: workflow W3-D (rendering core). Plan section 9 draws a hard line: Phaser
// owns the world canvas and nothing else, Pinia holds the state received from the
// server, and Phaser never mutates it. The eslint zone rules enforce the line
// mechanically, forbidding `frontend/app/game` from importing
// `frontend/app/stores`, so the two sides need a channel that belongs to neither.
//
// This is that channel, and it is deliberately minimal: a typed emitter. The canvas
// publishes what the interface has to show (boot phase, generation progress, the
// texture report) and later workflows add their own event maps for the state that
// flows the other way. Nothing here knows about Pinia, about Vue reactivity or about
// the HTTP client, which is what lets the inspection route of this phase drive the
// engine with no store at all.

import { type TextureGenerationReport, type TextureProgress } from '../textures/factory';

/**
 * Phase of the canvas. It is what the viewport component shows while the textures
 * are being generated, and what tells it that starting the world scene is safe.
 */
export const GamePhase = {
  /** No game instance yet. */
  IDLE: 'IDLE',
  /** The instance exists and the boot scene is configuring the renderer. */
  BOOTING: 'BOOTING',
  /** Textures are being generated. `progress` is being emitted. */
  GENERATING: 'GENERATING',
  /** Every texture exists. The world scene can run. */
  READY: 'READY',
  /** Generation failed beyond recovery. `error` carries the reason. */
  FAILED: 'FAILED',
} as const;
export type GamePhase = (typeof GamePhase)[keyof typeof GamePhase];

/** Events the canvas publishes during boot. */
export interface GameBridgeEvents {
  phase: GamePhase;
  progress: TextureProgress;
  ready: TextureGenerationReport;
  failed: { readonly reason: string };
}

/** Listener of one event. */
export type BridgeListener<TPayload> = (payload: TPayload) => void;

/**
 * A typed emitter.
 *
 * Generic rather than hard coded to `GameBridgeEvents` so the entity, overlay and
 * selection layers of W5 can declare their own map and reuse the implementation
 * instead of each inventing an emitter. A listener that throws is isolated: one
 * broken panel must not stop the canvas from emitting to the others.
 */
export interface Emitter<TEvents> {
  on<TName extends keyof TEvents>(
    name: TName,
    listener: BridgeListener<TEvents[TName]>,
  ): () => void;
  off<TName extends keyof TEvents>(name: TName, listener: BridgeListener<TEvents[TName]>): void;
  emit<TName extends keyof TEvents>(name: TName, payload: TEvents[TName]): void;
  /** Drops every listener. Called when the game is destroyed. */
  clear(): void;
}

export function createEmitter<TEvents>(): Emitter<TEvents> {
  const listeners = new Map<keyof TEvents, Set<BridgeListener<never>>>();

  return {
    on(name, listener) {
      const existing = listeners.get(name) ?? new Set<BridgeListener<never>>();
      existing.add(listener as BridgeListener<never>);
      listeners.set(name, existing);
      return () => {
        existing.delete(listener as BridgeListener<never>);
      };
    },
    off(name, listener) {
      listeners.get(name)?.delete(listener as BridgeListener<never>);
    },
    emit(name, payload) {
      const registered = listeners.get(name);
      if (registered === undefined) {
        return;
      }
      for (const listener of [...registered]) {
        try {
          (listener as BridgeListener<typeof payload>)(payload);
        } catch (error) {
          // Never let a listener break the emitter: the canvas is mid boot and the
          // alternative is a blank viewport with no explanation.
          console.error('[game] a bridge listener threw', error);
        }
      }
    },
    clear() {
      listeners.clear();
    },
  };
}

/**
 * The bridge of the boot path. It keeps the last phase and the last report, because
 * a panel that mounts after the textures were generated still has to know that they
 * were: an event-only channel would leave a late subscriber waiting for an event
 * that already happened.
 */
export interface GameBridge extends Emitter<GameBridgeEvents> {
  readonly phase: GamePhase;
  readonly report: TextureGenerationReport | null;
  /** Sets the phase and emits it. Called by the boot scenes. */
  setPhase(phase: GamePhase): void;
  /** Publishes the texture report and moves to `READY`. */
  setReport(report: TextureGenerationReport): void;
}

export function createGameBridge(): GameBridge {
  const emitter = createEmitter<GameBridgeEvents>();
  let phase: GamePhase = GamePhase.IDLE;
  let report: TextureGenerationReport | null = null;

  return {
    ...emitter,
    get phase() {
      return phase;
    },
    get report() {
      return report;
    },
    setPhase(next) {
      phase = next;
      emitter.emit('phase', next);
    },
    setReport(next) {
      report = next;
      phase = GamePhase.READY;
      // The phase first and the report second, both after the state is stored: a
      // listener of `ready` that reads `phase` has to see `READY`, and one that only
      // watches `phase` can read the report from the bridge. The reverse order was the
      // first version and it published a report while the phase still said
      // `GENERATING`, which is the kind of inconsistency a consumer cannot work around.
      emitter.emit('phase', GamePhase.READY);
      emitter.emit('ready', next);
    },
  };
}
