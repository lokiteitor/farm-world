// The clock of the client: local extrapolation from the anchor.
//
// Owner: W3-C.
//
// No counter asks the server for the time (plan section 7). The server sends an anchor
// with a rational multiplier, and every countdown in the interface is a function of that
// anchor and of the wall clock of the machine, evaluated with `gameMsAt` from
// shared/rules: the same function the server uses, so the two cannot drift by
// construction of the arithmetic.
//
// Two things it still has to handle.
//
// A machine whose wall clock is wrong, or that was suspended, produces an extrapolation
// that is off. When a fresh reading from the server differs from the local one by more
// than a few game minutes, the clock is moved to the server value in one step rather than
// eased towards it: a countdown that slides is worse than one that corrects, because it
// makes every duration in the interface subtly wrong for as long as the easing lasts. The
// threshold is `CLOCK_RESYNC_THRESHOLD_GAME_MS` from shared/config.
//
// A paused world (`rateNum = 0`) must stop, and must be visible as stopped. The
// extrapolation returns the anchor instant, which is correct, and `paused` is what the
// shell shows so that a stopped clock is not read as a broken client.

import { computed, onScopeDispose, readonly, ref, watch, type ComputedRef, type Ref } from 'vue';
import { CLOCK_RESYNC_THRESHOLD_GAME_MS, gameMs, type GameMs } from '~/shared/index';
import { useClockStore } from '~/stores/clock';

/** How often the displayed instant is recomputed. */
export const CLOCK_TICK_REAL_MS = 250;

export interface GameClockOptions {
  /** Source of wall time. Injected so the tests are deterministic. */
  readonly now?: () => number;
  readonly tickRealMs?: number;
  /** Drift beyond which the clock jumps instead of continuing to extrapolate. */
  readonly resyncThresholdGameMs?: bigint;
  /** False in a test that drives `tick()` by hand. */
  readonly autoStart?: boolean;
}

export interface GameClock {
  /** Current game instant, extrapolated locally. */
  readonly gameMs: Readonly<Ref<GameMs>>;
  readonly paused: ComputedRef<boolean>;
  readonly ready: ComputedRef<boolean>;
  /** Hard corrections applied so far. Visible so a wrong wall clock is diagnosable. */
  readonly hardJumps: Readonly<Ref<number>>;
  /** Recomputes now. The interval calls it; a test calls it directly. */
  tick: () => GameMs;
  start: () => void;
  stop: () => void;
}

/**
 * The extrapolating clock. One instance per component tree is enough, and several are
 * harmless: they all read the same anchor from the store and write the same value.
 */
export function useGameClock(options: GameClockOptions = {}): GameClock {
  const store = useClockStore();
  const now = options.now ?? (() => Date.now());
  const tickRealMs = options.tickRealMs ?? CLOCK_TICK_REAL_MS;
  const threshold = options.resyncThresholdGameMs ?? CLOCK_RESYNC_THRESHOLD_GAME_MS;

  const current = ref<GameMs>(store.displayGameMs);
  const hardJumps = ref(store.hardJumpCount);
  let timer: ReturnType<typeof setInterval> | null = null;
  /**
   * Whether a reading has ever been applied. The first one moves the clock from nothing to the
   * instant of the world, which is initialisation and not drift: counting it as a hard jump
   * would make the counter say the local clock is wrong on every page load, and the counter
   * exists precisely to make a wrong local clock visible.
   */
  let initialised = false;

  function tick(): GameMs {
    const extrapolated = store.gameMsAtRealMs(now());
    if (extrapolated === null) {
      return current.value;
    }
    // The clock never goes backwards. The anchor guarantees monotonicity in the real
    // instant, but the real instant of this machine does not: a corrected system clock
    // could otherwise make a progress bar retreat.
    const next = extrapolated < current.value ? current.value : extrapolated;
    current.value = next;
    store.setDisplayGameMs(next);
    return next;
  }

  /**
   * Applies a fresh reading. Called by the watcher on the anchor: if the new anchor
   * implies an instant far from the one being shown, the difference is not drift to be
   * absorbed but a wrong local clock, and the value jumps.
   */
  function reconcile(): void {
    const fromAnchor = store.gameMsAtRealMs(now());
    if (fromAnchor === null) {
      return;
    }
    if (!initialised) {
      initialised = true;
      current.value = fromAnchor;
      store.setDisplayGameMs(fromAnchor);
      return;
    }
    const drift = fromAnchor - current.value;
    const magnitude = drift < 0n ? -drift : drift;
    if (magnitude > threshold) {
      current.value = gameMs(fromAnchor);
      store.setDisplayGameMs(current.value);
      store.countHardJump();
      hardJumps.value = store.hardJumpCount;
      return;
    }
    tick();
  }

  function start(): void {
    if (timer !== null) {
      return;
    }
    tick();
    timer = setInterval(tick, tickRealMs);
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  // `flush: 'sync'` and not the default: a reading arrives from the reducer, and every
  // countdown that reads the clock in the same turn has to see the corrected value. With the
  // default deferred flush the interface would render one frame with the stale extrapolation
  // after a hard jump, which is exactly the flicker the jump exists to avoid. The cost is
  // nothing here, because a reading arrives once a minute and not once a frame.
  watch(
    () => store.dto,
    (reading) => {
      if (reading !== null) {
        reconcile();
      }
    },
    { immediate: true, flush: 'sync' },
  );

  if (options.autoStart !== false) {
    start();
    // `failSilently` is passed because this composable is also used outside a component
    // scope, by the tests that drive `tick()` by hand.
    onScopeDispose(stop, true);
  }

  const paused = computed(() => store.paused);
  const ready = computed(() => store.ready);

  return {
    gameMs: readonly(current) as Readonly<Ref<GameMs>>,
    paused,
    ready,
    hardJumps: readonly(hardJumps) as Readonly<Ref<number>>,
    tick,
    start,
    stop,
  };
}
