// The connection, as the interface sees it.
//
// Owner: W3-C.
//
// This store owns three things: the lifecycle of the live connection, the two REST calls
// that close a sequence gap, and the connection state the shell shows. The last one is
// not decoration: in an idle game a socket that died in silence is indistinguishable from
// a world where nothing is happening, so plan section 7 requires the state to be visible
// at all times.
//
// The ladder is here rather than in net/ws.ts because closing a gap is a pair of REST
// calls and a decision between them, and the socket has no business knowing about REST.
// The order is fixed: replay the bounded ring first, and fall back to a full snapshot only
// when the ring cannot reach the first missing sequence. Escalating too eagerly would
// download the whole holding for a single dropped frame; escalating too late would leave a
// frame missing for good, which is the one failure this design must not have.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { apiCall, apiWsTicket } from '~/net/api';
import { isApiClientError } from '~/net/errors';
import { ResyncAction, type ResyncStep } from '~/net/sequence';
import { WsPhase, createWsClient, type WsClient, type WsStatus } from '~/net/ws';
import { MAX_EVENT_REPLAY, SHARED_CONTRACT_VERSION, type ChunkCoordWire } from '~/shared/index';
import { useSyncStore } from '~/stores/sync';

/** What the shell shows about the connection. */
export const ConnectionState = {
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  ONLINE: 'ONLINE',
  RESYNCING: 'RESYNCING',
  /** The server runs another version of the shared contract: a reload is required. */
  CONTRACT_MISMATCH: 'CONTRACT_MISMATCH',
} as const;
export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState];

export const useNetStore = defineStore('net', () => {
  const sync = useSyncStore();

  const status = ref<WsStatus | null>(null);
  const started = ref(false);
  const contractMismatch = ref(false);
  const lastErrorCode = ref<string | null>(null);

  let client: WsClient | null = null;
  let detachEnvironment: (() => void) | null = null;

  const state = computed<ConnectionState>(() => {
    if (contractMismatch.value) {
      return ConnectionState.CONTRACT_MISMATCH;
    }
    const current = status.value;
    if (current === null || !started.value) {
      return ConnectionState.OFFLINE;
    }
    switch (current.phase) {
      case WsPhase.OPEN:
        return ConnectionState.ONLINE;
      case WsPhase.RESYNCING:
        return ConnectionState.RESYNCING;
      case WsPhase.CONNECTING:
        return ConnectionState.CONNECTING;
      case WsPhase.BACKOFF:
      case WsPhase.IDLE:
        return ConnectionState.OFFLINE;
    }
  });

  const online = computed(() => state.value === ConnectionState.ONLINE);
  const lastAppliedSeq = computed(() => sync.lastAppliedSeq);
  const serverSeq = computed(() => status.value?.serverSeq ?? 0);
  const behindBy = computed(() => Math.max(0, serverSeq.value - lastAppliedSeq.value));
  const nextRetryAtRealMs = computed(() => status.value?.nextRetryAtRealMs ?? null);
  const resyncCount = computed(() => status.value?.resyncCount ?? 0);
  const snapshotCount = computed(() => status.value?.snapshotCount ?? 0);

  /**
   * Performs one rung of the ladder.
   *
   * A replay that comes back truncated is not an error: it is the ring saying it cannot
   * help, and the caller in net/ws.ts re-evaluates and lands on the snapshot. The failure
   * of the request itself is different and is left to propagate, so that the socket layer
   * counts it and the backoff applies.
   */
  async function resynchronise(step: ResyncStep): Promise<void> {
    if (step.action === ResyncAction.REPLAY) {
      const reply = await apiCall('GET /api/events', {
        query: { since: step.sinceSeq, limit: MAX_EVENT_REPLAY },
      });
      sync.applyReplay(reply);
      if (!reply.truncated) {
        return;
      }
      // Fall through: the ring did not reach back far enough.
    }
    const snapshot = await apiCall('GET /api/state/snapshot');
    sync.applySnapshot(snapshot);
  }

  /** Loads the world description and the full state. The first call of the game page. */
  async function bootstrap(): Promise<void> {
    const snapshot = await apiCall('GET /api/state/snapshot');
    sync.applySnapshot(snapshot);
  }

  function ensureClient(): WsClient {
    if (client !== null) {
      return client;
    }
    client = createWsClient({
      requestTicket: apiWsTicket,
      lastAppliedSeq: () => sync.lastAppliedSeq,
      applyFrame: (frame) => {
        sync.applyFrame(frame);
      },
      resynchronise,
      onStatus: (next) => {
        status.value = next;
      },
      onHello: (payload) => {
        // A contract the client was not built against is not something to work around: a
        // silent divergence between two versions of the reducer is worse than a reload
        // (plan section 7).
        contractMismatch.value = payload.contractVersion !== SHARED_CONTRACT_VERSION;
      },
    });
    return client;
  }

  function start(): void {
    if (started.value) {
      return;
    }
    started.value = true;
    const instance = ensureClient();
    instance.start();
    detachEnvironment = instance.attachEnvironmentListeners();
  }

  function stop(): void {
    started.value = false;
    detachEnvironment?.();
    detachEnvironment = null;
    client?.stop();
    status.value = client?.status() ?? null;
  }

  function reconnectNow(reason = 'manual'): void {
    client?.reconnectNow(reason);
  }

  function subscribeChunks(chunks: readonly ChunkCoordWire[]): void {
    client?.subscribeChunks(chunks);
  }

  function unsubscribeChunks(chunks: readonly ChunkCoordWire[]): void {
    client?.unsubscribeChunks(chunks);
  }

  /** Records the code of the last failed call, so the shell can explain a red state. */
  function noteFailure(error: unknown): void {
    lastErrorCode.value = isApiClientError(error) ? error.code : null;
  }

  function reset(): void {
    stop();
    client = null;
    status.value = null;
    contractMismatch.value = false;
    lastErrorCode.value = null;
  }

  return {
    status,
    started,
    contractMismatch,
    lastErrorCode,
    state,
    online,
    lastAppliedSeq,
    serverSeq,
    behindBy,
    nextRetryAtRealMs,
    resyncCount,
    snapshotCount,
    resynchronise,
    bootstrap,
    start,
    stop,
    reconnectNow,
    subscribeChunks,
    unsubscribeChunks,
    noteFailure,
    reset,
  };
});
