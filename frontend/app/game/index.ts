// Creation and destruction of the game.
//
// Owner: workflow W3-D (rendering core). This is the only entry point of the canvas.
// The viewport component of W3-C calls `createGame` with its own element and calls
// `destroyGame` when it unmounts; nothing else in the client constructs a
// `Phaser.Game`.
//
// Three rules the module exists to enforce:
//
//   1. Phaser is mounted on the element the CSS grid sizes, with `Scale.RESIZE`, and
//      a `ResizeObserver` tells it about every change. The grid decides and Phaser
//      obeys (plan section 9.1). Without the observer, `RESIZE` only reacts to window
//      resizes, so opening the side panel would leave the canvas the wrong size.
//   2. No coupling to Pinia. The eslint zone rules forbid `frontend/app/game` from
//      importing `frontend/app/stores`, and this module holds that line: everything
//      that has to travel in either direction travels through the bridge.
//   3. Destruction is complete. A single page application mounts and unmounts the
//      viewport on every navigation, and a leaked `Phaser.Game` keeps its WebGL
//      context, its ticker and its listeners alive. The browser gives out a handful of
//      WebGL contexts and then starts dropping the oldest, which shows up as a canvas
//      that renders once and then goes black.

import Phaser from 'phaser';
import { BootScene } from './boot/BootScene';
import { createGameBridge, GamePhase, type GameBridge } from './boot/bridge';
import { createGameConfig } from './boot/config';
import { PreloadScene } from './boot/PreloadScene';
import { SCENE_KEYS } from './boot/scenes';

export interface CreateGameOptions {
  /** Element the canvas is appended to. Sized by the CSS grid, never by Phaser. */
  readonly host: HTMLElement;
  /**
   * Bridge to publish through. Optional: a caller that only needs the canvas can let
   * this module create one and read it back from the handle.
   */
  readonly bridge?: GameBridge;
  /**
   * Scenes of the world, written by W4 (world) and W5 (entities, overlay, selection).
   * They are a parameter and not an import so that this module does not depend on
   * directories that do not exist yet, which is rule 3 of plan section 11: the
   * registry is written once, with the final shape, and the later workflow plugs into
   * it instead of editing it.
   */
  readonly worldScenes?: readonly Phaser.Types.Scenes.SceneType[];
  /**
   * Scene the preload scene starts once every texture exists. Defaults to the world
   * scene; when it is not registered, the preload scene simply stops, which is what
   * the inspection route relies on.
   */
  readonly startSceneKey?: string;
}

/** What the caller keeps. Everything needed to observe and to tear down. */
export interface GameHandle {
  readonly game: Phaser.Game;
  readonly bridge: GameBridge;
  /** Destroys the game, the observer and the bridge listeners. Idempotent. */
  destroy(): void;
}

/**
 * Creates the game on a host element.
 *
 * The boot scenes are passed as instances and not as classes, which is what lets the
 * bridge be injected through their constructors instead of being fetched from a
 * global or from the untyped scene registry.
 */
export function createGame(options: CreateGameOptions): GameHandle {
  const bridge = options.bridge ?? createGameBridge();
  const startSceneKey = options.startSceneKey ?? SCENE_KEYS.WORLD;

  const scenes: Phaser.Types.Scenes.SceneType[] = [
    new BootScene(bridge),
    new PreloadScene(bridge, startSceneKey),
    ...(options.worldScenes ?? []),
  ];

  const game = new Phaser.Game(createGameConfig(options.host, scenes));

  // The observer, and not a window listener: the viewport changes size when a panel
  // opens or the grid reflows, and neither of those is a window resize.
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      const width = options.host.clientWidth;
      const height = options.host.clientHeight;
      if (width > 0 && height > 0) {
        game.scale.resize(width, height);
      }
    });
    observer.observe(options.host);
  }

  let destroyed = false;
  return {
    game,
    bridge,
    destroy(): void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      observer?.disconnect();
      observer = null;
      bridge.setPhase(GamePhase.IDLE);
      bridge.clear();
      // `true` removes the canvas from the DOM: the host element belongs to the Vue
      // component, and leaving an orphan canvas inside it would stack a second one on
      // the next mount.
      game.destroy(true);
    },
  };
}

/** Destroys a handle. A named function, because a component calls it on unmount. */
export function destroyGame(handle: GameHandle | null): void {
  handle?.destroy();
}

/**
 * The three boot events the shell of the client listens for, as
 * `app/composables/useGameBridge.ts` declares them.
 *
 * Declared structurally and not imported. The composables of the shell and the canvas
 * are two modules of the same workflow, and rule 4 of plan section 11 forbids imports
 * between siblings of one phase, for the good reason that a signature agreed on
 * Wednesday is not the signature that exists on Friday. A structural interface gets the
 * type checking without the dependency: if the shell renames an event, the assignment at
 * the call site stops compiling, which is where the mismatch belongs.
 */
export interface ShellBridgeLike {
  emit(name: 'scene:preload', payload: { readonly ratio: number; readonly label: string }): void;
  emit(name: 'scene:ready', payload: { readonly width: number; readonly height: number }): void;
  emit(name: 'scene:error', payload: { readonly message: string }): void;
}

/**
 * Republishes the boot events of the canvas onto the bridge of the shell.
 *
 * One line at the call site, which belongs to the viewport component:
 *
 * ```ts
 * const handle = createGame({ host: element });
 * const stop = connectShellBridge(handle, gameBridge());
 * ```
 *
 * Compatibility with the real shell bridge was verified by type check against
 * `app/composables/useGameBridge.ts` as it stands at the close of this phase.
 *
 * Two bridges and not one is deliberate. The canvas bridge carries the whole texture
 * report, which is what the inspection route and the measurement route need, and it has
 * no dependency on Vue, so the boot path can be driven with no shell at all. The shell
 * bridge carries the ratio and the label, which is all a loading state has to show.
 * This function is the seam, it is the only place that knows both, and it returns the
 * unsubscribe so a component can drop it on unmount.
 */
export function connectShellBridge(handle: GameHandle, shell: ShellBridgeLike): () => void {
  const stopProgress = handle.bridge.on('progress', (progress) => {
    shell.emit('scene:preload', { ratio: progress.ratio, label: progress.label });
  });
  const stopReady = handle.bridge.on('ready', () => {
    const size = handle.game.scale.gameSize;
    shell.emit('scene:ready', { width: size.width, height: size.height });
  });
  const stopFailed = handle.bridge.on('failed', (failure) => {
    shell.emit('scene:error', { message: failure.reason });
  });
  return () => {
    stopProgress();
    stopReady();
    stopFailed();
  };
}

export { GamePhase, createGameBridge, type GameBridge } from './boot/bridge';
export { SCENE_KEYS, type SceneKey } from './boot/scenes';
export {
  TEXTURE_BUDGET_MS,
  type TextureGenerationReport,
  type TextureProgress,
} from './textures/factory';
export { TEXTURE_KEYS } from './textures/keys';
