// The live connection: ticket, heartbeat, reconnection and the sequence rule.
//
// Owner: W3-C. Consumed by the `net` store, which supplies the reducer and the two
// resynchronisation calls; this module knows nothing about Pinia.
//
// Four things happen here and each of them is a decision of plan section 7:
//
//   1. A single use ticket authenticates the handshake. A browser cannot set a header
//      on a WebSocket upgrade and an access token in a query string ends up in the log
//      of every proxy on the way, so the client trades its session for a ticket that
//      lives thirty seconds and is spent on use (shared/api/schemas/auth.ts).
//   2. A heartbeat every twenty seconds, and two silent periods close the socket. In an
//      idle game a dead socket is indistinguishable from a world where nothing is
//      happening, so silence has to be detected rather than waited out.
//   3. Reconnection with exponential backoff and jitter, plus an immediate attempt when
//      connectivity or visibility returns: the usual case is a laptop that was asleep,
//      and making it wait out a thirty second backoff it did not cause is pointless.
//   4. The sequence rule, and the ladder a gap leads into. Reconnection and a gap share
//      the path, because `HELLO` reports the current sequence and the client compares it
//      against its own mark exactly as it does for a frame.
//
// On the heartbeat and the missing `pong`. The contract defines a `ping` from the client
// (shared/ws/envelope.ts) and no `pong` from the server: the union of server frames has
// no acknowledgement tag. What this module therefore measures is inbound traffic of any
// kind, which is the observable equivalent, and it treats two consecutive silent periods
// as a dead socket. The consequence for the backend is recorded in the handoff: the
// server has to answer a `ping` with some frame, and `CLOCK` is the natural one because
// it is already in the union and carries what the client wants anyway.

import { backoffDelayRealMs, DEFAULT_BACKOFF, type BackoffConfig } from '~/net/backoff';
import {
  decideFrame,
  FrameVerdict,
  nextResyncStep,
  type ResyncStep,
  type SequencedFrame,
} from '~/net/sequence';
import {
  WS_CLOSE_CODES,
  WS_HEARTBEAT_INTERVAL_REAL_MS,
  wsServerFrameSchema,
  type ChunkCoordWire,
  type HelloPayload,
  type WsClientMessage,
  type WsServerFrame,
} from '~/shared/index';

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const WsPhase = {
  /** Never started, or stopped on purpose. */
  IDLE: 'IDLE',
  /** Asking for a ticket, or waiting for the handshake. */
  CONNECTING: 'CONNECTING',
  /** Open and in sequence. */
  OPEN: 'OPEN',
  /** Open, with a gap being closed by a replay or a snapshot. */
  RESYNCING: 'RESYNCING',
  /** Closed, waiting out a backoff before the next attempt. */
  BACKOFF: 'BACKOFF',
} as const;
export type WsPhase = (typeof WsPhase)[keyof typeof WsPhase];

export interface WsStatus {
  readonly phase: WsPhase;
  /** Consecutive failed attempts. Zero while open. */
  readonly attempt: number;
  readonly nextRetryAtRealMs: number | null;
  readonly lastFrameAtRealMs: number | null;
  readonly missedHeartbeats: number;
  readonly closeCode: number | null;
  /** Sequence the server last reported, from `HELLO` or from a frame. */
  readonly serverSeq: number;
  readonly oldestReplaySeq: number;
  readonly resyncCount: number;
  readonly snapshotCount: number;
  readonly discardedFrameCount: number;
  /** Version of the contract the server reports, from `HELLO`. */
  readonly serverContractVersion: string | null;
}

// ---------------------------------------------------------------------------
// The socket seam
// ---------------------------------------------------------------------------

/**
 * The part of `WebSocket` this module uses. Narrowed to a seam so that a test drives a
 * fake socket and the simulated server plugs its own in, with no global to patch.
 */
export interface WsSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
}

export type WsSocketFactory = (url: string) => WsSocketLike;

/** Resolves the handshake path against the page origin. */
export function absoluteWsUrl(pathWithQuery: string): string {
  if (/^wss?:/.test(pathWithQuery)) {
    return pathWithQuery;
  }
  if (typeof window === 'undefined') {
    return pathWithQuery;
  }
  const base = new URL(window.location.href);
  const url = new URL(pathWithQuery, base);
  url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

const defaultSocketFactory: WsSocketFactory = (url) =>
  new WebSocket(absoluteWsUrl(url)) as unknown as WsSocketLike;

let activeSocketFactory: WsSocketFactory = defaultSocketFactory;

/** The factory in force. Used when `WsClientOptions` names none. */
export function wsSocketFactory(): WsSocketFactory {
  return activeSocketFactory;
}

/**
 * Replaces the factory. This is the seam the simulated server plugs into, and it is a
 * seam and not a patched global for the same reason as the HTTP transport: nothing in the
 * application constructs a `WebSocket` directly, so nothing can bypass it.
 */
export function setWsSocketFactory(factory: WsSocketFactory): void {
  activeSocketFactory = factory;
}

export function resetWsSocketFactory(): void {
  activeSocketFactory = defaultSocketFactory;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface WsClientOptions {
  /** Trades the session for a single use ticket and returns the handshake path. */
  readonly requestTicket: () => Promise<{ url: string; expiresAtRealMs: number }>;
  /** The mark of the client: the sequence of the last domain frame applied. */
  readonly lastAppliedSeq: () => number;
  /** The reducer. One of the two entry points of plan section 7. */
  readonly applyFrame: (frame: WsServerFrame) => void;
  /**
   * Performs one rung of the ladder: a replay or a full snapshot. It returns when the
   * mark has been moved, so this module can re-evaluate whether the gap is closed.
   */
  readonly resynchronise: (step: ResyncStep) => Promise<void>;
  readonly onStatus?: (status: WsStatus) => void;
  readonly onHello?: (payload: HelloPayload) => void;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly socketFactory?: WsSocketFactory;
  readonly backoff?: BackoffConfig;
  readonly heartbeatIntervalRealMs?: number;
  /** Silent heartbeat periods tolerated before the socket is declared dead. */
  readonly missedHeartbeatLimit?: number;
}

export interface WsClient {
  start(): void;
  stop(): void;
  /** Closes and reconnects now, resetting the backoff. */
  reconnectNow(reason: string): void;
  subscribeChunks(chunks: readonly ChunkCoordWire[]): void;
  unsubscribeChunks(chunks: readonly ChunkCoordWire[]): void;
  status(): WsStatus;
  /** Registers the browser listeners. Returns the function that removes them. */
  attachEnvironmentListeners(): () => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function chunkKey(chunk: ChunkCoordWire): string {
  return `${chunk.chunkX}:${chunk.chunkY}`;
}

export function createWsClient(options: WsClientOptions): WsClient {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? (() => Math.random());
  const factory = options.socketFactory ?? wsSocketFactory();
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const missedLimit = options.missedHeartbeatLimit ?? 2;

  let phase: WsPhase = WsPhase.IDLE;
  let attempt = 0;
  let nextRetryAtRealMs: number | null = null;
  let lastFrameAtRealMs: number | null = null;
  let missedHeartbeats = 0;
  let closeCode: number | null = null;
  let serverSeq = 0;
  let oldestReplaySeq = 0;
  let resyncCount = 0;
  let snapshotCount = 0;
  let discardedFrameCount = 0;
  let serverContractVersion: string | null = null;

  let heartbeatPeriod = options.heartbeatIntervalRealMs ?? WS_HEARTBEAT_INTERVAL_REAL_MS;
  let socket: WsSocketLike | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let connectSequence = 0;
  let resyncInFlight: Promise<void> | null = null;

  /** Chunks the renderer wants live updates for, as the truth to replay on reconnect. */
  const subscribed = new Map<string, ChunkCoordWire>();
  const pendingSubscribe = new Map<string, ChunkCoordWire>();
  const pendingUnsubscribe = new Map<string, ChunkCoordWire>();

  function snapshotStatus(): WsStatus {
    return {
      phase,
      attempt,
      nextRetryAtRealMs,
      lastFrameAtRealMs,
      missedHeartbeats,
      closeCode,
      serverSeq,
      oldestReplaySeq,
      resyncCount,
      snapshotCount,
      discardedFrameCount,
      serverContractVersion,
    };
  }

  function publish(): void {
    options.onStatus?.(snapshotStatus());
  }

  function setPhase(next: WsPhase): void {
    if (phase !== next) {
      phase = next;
      publish();
    }
  }

  function send(message: WsClientMessage): void {
    if (socket === null) {
      return;
    }
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      // A send on a socket the browser already tore down is not worth a reconnection of
      // its own: the close handler is about to run and will schedule one.
      console.warn('[ws] no se pudo enviar el mensaje', error);
    }
  }

  function stopTimers(): void {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function detach(current: WsSocketLike): void {
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
  }

  function closeSocket(code: number, reason: string): void {
    const current = socket;
    socket = null;
    if (current === null) {
      return;
    }
    detach(current);
    try {
      current.close(code, reason);
    } catch {
      // Closing a socket that is already closed is not an error worth reporting.
    }
  }

  function scheduleRetry(): void {
    if (!running) {
      return;
    }
    const delay = backoffDelayRealMs(attempt, random, backoff);
    attempt += 1;
    nextRetryAtRealMs = now() + delay;
    setPhase(WsPhase.BACKOFF);
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  }

  function onHeartbeat(): void {
    if (socket === null) {
      return;
    }
    // Silence is counted per period. Any inbound frame resets the counter, so a busy
    // connection never trips it and an idle one is still verified every period.
    missedHeartbeats += 1;
    if (missedHeartbeats >= missedLimit) {
      console.warn('[ws] dos latidos sin respuesta, se corta la conexion');
      closeCode = WS_CLOSE_CODES.HEARTBEAT_TIMEOUT;
      closeSocket(WS_CLOSE_CODES.HEARTBEAT_TIMEOUT, 'heartbeat timeout');
      stopTimers();
      publish();
      scheduleRetry();
      return;
    }
    send({ type: 'ping', atRealMs: String(Math.trunc(now())) });
    publish();
  }

  function flushSubscriptions(): void {
    // On a fresh connection the server knows nothing about what this client is looking
    // at, so the whole set is replayed rather than the pending delta.
    const toAdd = new Map<string, ChunkCoordWire>(subscribed);
    for (const [key, chunk] of pendingSubscribe) {
      toAdd.set(key, chunk);
      subscribed.set(key, chunk);
    }
    pendingSubscribe.clear();
    for (const [key] of pendingUnsubscribe) {
      toAdd.delete(key);
      subscribed.delete(key);
    }
    pendingUnsubscribe.clear();
    if (toAdd.size > 0) {
      send({ type: 'subscribeChunks', chunks: [...toAdd.values()] });
    }
  }

  function runResync(step: ResyncStep): void {
    if (step.action === 'NONE') {
      setPhase(socket === null ? phase : WsPhase.OPEN);
      return;
    }
    if (resyncInFlight !== null) {
      return;
    }
    resyncCount += 1;
    if (step.action === 'SNAPSHOT') {
      snapshotCount += 1;
    }
    setPhase(WsPhase.RESYNCING);
    const task = options
      .resynchronise(step)
      .then(() => {
        // Re-evaluate: a replay may have filled only part of the gap, or the ring may
        // have reported that it could not reach back far enough, in which case the next
        // rung is the full snapshot.
        const again = nextResyncStep({
          lastAppliedSeq: options.lastAppliedSeq(),
          currentSeq: serverSeq,
          oldestReplaySeq,
        });
        if (again.action !== 'NONE') {
          resyncInFlight = null;
          runResync(again);
          return;
        }
        setPhase(socket === null ? WsPhase.BACKOFF : WsPhase.OPEN);
      })
      .catch((error: unknown) => {
        console.error('[ws] fallo la resincronizacion', error);
        setPhase(socket === null ? WsPhase.BACKOFF : WsPhase.OPEN);
      })
      .finally(() => {
        if (resyncInFlight === task) {
          resyncInFlight = null;
        }
      });
    resyncInFlight = task;
  }

  function requestResync(reportedSeq: number, truncated?: boolean): void {
    serverSeq = Math.max(serverSeq, reportedSeq);
    const step = nextResyncStep({
      lastAppliedSeq: options.lastAppliedSeq(),
      currentSeq: serverSeq,
      oldestReplaySeq,
      ...(truncated === undefined ? {} : { truncated }),
    });
    runResync(step);
  }

  function handleHello(payload: HelloPayload): void {
    serverSeq = payload.seq;
    oldestReplaySeq = payload.oldestReplaySeq;
    serverContractVersion = payload.contractVersion;
    if (payload.heartbeatIntervalRealMs > 0) {
      heartbeatPeriod = payload.heartbeatIntervalRealMs;
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(onHeartbeat, heartbeatPeriod);
      }
    }
    options.onHello?.(payload);
    // Reconnection and a gap share this call, which is the point of `HELLO` carrying
    // the sequence at all.
    requestResync(payload.seq);
  }

  function handleFrame(frame: WsServerFrame): void {
    lastFrameAtRealMs = now();
    missedHeartbeats = 0;
    if (frame.type === 'HELLO') {
      options.applyFrame(frame);
      handleHello(frame.payload);
      publish();
      return;
    }
    const decision = decideFrame(options.lastAppliedSeq(), frame as SequencedFrame);
    switch (decision) {
      case FrameVerdict.APPLY:
      case FrameVerdict.APPLY_TRANSPORT:
        serverSeq = Math.max(serverSeq, frame.seq);
        options.applyFrame(frame);
        break;
      case FrameVerdict.DISCARD:
        discardedFrameCount += 1;
        break;
      case FrameVerdict.GAP:
        requestResync(frame.seq);
        break;
    }
    publish();
  }

  function handleMessage(data: unknown): void {
    let parsedJson: unknown;
    if (typeof data === 'string') {
      try {
        parsedJson = JSON.parse(data) as unknown;
      } catch (error) {
        console.error('[ws] trama no es JSON', error);
        return;
      }
    } else {
      // Binary frames are not part of the contract. Reporting and dropping is right:
      // a client that guessed at a decoding would be inventing a second wire format.
      console.error('[ws] trama binaria inesperada');
      return;
    }
    const frame = wsServerFrameSchema.safeParse(parsedJson);
    if (!frame.success) {
      console.error('[ws] trama que no cumple el contrato', frame.error.issues[0]?.message);
      return;
    }
    handleFrame(frame.data);
  }

  async function connect(): Promise<void> {
    if (!running || socket !== null) {
      return;
    }
    connectSequence += 1;
    const generation = connectSequence;
    setPhase(WsPhase.CONNECTING);
    nextRetryAtRealMs = null;

    let handshake: { url: string; expiresAtRealMs: number };
    try {
      handshake = await options.requestTicket();
    } catch (error) {
      console.warn('[ws] no se pudo obtener el ticket', error);
      scheduleRetry();
      return;
    }
    if (!running || generation !== connectSequence) {
      return;
    }

    let created: WsSocketLike;
    try {
      created = factory(handshake.url);
    } catch (error) {
      console.warn('[ws] no se pudo abrir el socket', error);
      scheduleRetry();
      return;
    }
    socket = created;

    created.onopen = () => {
      if (generation !== connectSequence) {
        return;
      }
      attempt = 0;
      missedHeartbeats = 0;
      closeCode = null;
      lastFrameAtRealMs = now();
      setPhase(WsPhase.OPEN);
      flushSubscriptions();
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      heartbeatTimer = setInterval(onHeartbeat, heartbeatPeriod);
      publish();
    };
    created.onmessage = (event) => {
      if (generation === connectSequence) {
        handleMessage(event.data);
      }
    };
    created.onerror = () => {
      // The close handler always follows an error, and it is the one that schedules the
      // retry; doing it twice would double the backoff for a single failure.
      console.warn('[ws] error de socket');
    };
    created.onclose = (event) => {
      if (generation !== connectSequence) {
        return;
      }
      closeCode = event.code ?? null;
      detach(created);
      socket = null;
      stopTimers();
      if (closeCode === WS_CLOSE_CODES.CONTRACT_MISMATCH) {
        // Reconnecting would fail for the same reason on every attempt. The `net` store
        // turns this into the reload the contract asks for (plan section 7).
        running = false;
        setPhase(WsPhase.IDLE);
        publish();
        return;
      }
      publish();
      scheduleRetry();
    };
  }

  function reconnectNow(reason: string): void {
    if (!running) {
      return;
    }
    attempt = 0;
    nextRetryAtRealMs = null;
    stopTimers();
    if (socket !== null) {
      // 1000 and not one of the 4000 range codes: those belong to the server
      // (shared/ws/envelope.ts) and a client that borrowed one would make a log line
      // say the server closed a connection the client closed.
      closeSocket(1000, reason);
    }
    void connect();
  }

  return {
    start(): void {
      if (running) {
        return;
      }
      running = true;
      attempt = 0;
      void connect();
    },

    stop(): void {
      running = false;
      stopTimers();
      closeSocket(1000, 'client stop');
      setPhase(WsPhase.IDLE);
    },

    reconnectNow,

    subscribeChunks(chunks): void {
      for (const chunk of chunks) {
        const key = chunkKey(chunk);
        pendingUnsubscribe.delete(key);
        if (!subscribed.has(key)) {
          pendingSubscribe.set(key, chunk);
        }
      }
      if (phase !== WsPhase.OPEN && phase !== WsPhase.RESYNCING) {
        return;
      }
      const additions = [...pendingSubscribe.values()];
      if (additions.length === 0) {
        return;
      }
      for (const [key, chunk] of pendingSubscribe) {
        subscribed.set(key, chunk);
      }
      pendingSubscribe.clear();
      send({ type: 'subscribeChunks', chunks: additions });
    },

    unsubscribeChunks(chunks): void {
      for (const chunk of chunks) {
        const key = chunkKey(chunk);
        pendingSubscribe.delete(key);
        if (subscribed.has(key)) {
          pendingUnsubscribe.set(key, chunk);
        }
      }
      if (phase !== WsPhase.OPEN && phase !== WsPhase.RESYNCING) {
        return;
      }
      const removals = [...pendingUnsubscribe.values()];
      if (removals.length === 0) {
        return;
      }
      for (const [key] of pendingUnsubscribe) {
        subscribed.delete(key);
      }
      pendingUnsubscribe.clear();
      send({ type: 'unsubscribeChunks', chunks: removals });
    },

    status: snapshotStatus,

    attachEnvironmentListeners(): () => void {
      if (typeof window === 'undefined') {
        return () => undefined;
      }
      const onOnline = (): void => {
        reconnectNow('connectivity returned');
      };
      const onVisible = (): void => {
        if (document.visibilityState === 'visible' && socket === null) {
          reconnectNow('page became visible');
        }
      };
      window.addEventListener('online', onOnline);
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        window.removeEventListener('online', onOnline);
        document.removeEventListener('visibilitychange', onVisible);
      };
    },
  };
}
