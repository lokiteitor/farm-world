// The WebSocket of the scenario, driven by the synchronisation rule of the real client.
//
// Owner: workflow W7-B. `scripts/smoke/**`.
//
// One connection for the whole run, opened once with a single use ticket and closed at the end,
// which is what plan section 12 step 4 asks the smoke test to demonstrate. What travels over it
// is the same envelope the browser client consumes, parsed with the same
// `wsServerFrameSchema`, and applied with the same rule (plan section 7):
//
//   seq == mark + 1  apply.
//   seq <= mark      discard as a duplicate.
//   seq >  mark + 1  there is a gap: replay from `GET /api/events?since` and only then apply.
//
// Reproducing the rule instead of asserting "no frame was ever lost" matters, because losing a
// frame from the live channel is legitimate: the publisher collapses a batch of more than ten
// frames on purpose and lets the client resynchronise once (`backend/src/lib/pubsub.ts`). What
// must hold, and what this module asserts, is the stronger statement: the sequence the client
// ends up having applied is strictly increasing and has no hole, whichever of the two paths each
// frame arrived by.
//
// `CLOCK` and `HELLO` consume no sequence, so they are counted and never applied. `HELLO` is
// still what starts the first reconciliation: the socket opens after the registration, so the
// greeting always reports a sequence above the mark of a client that has just been born.

import { setTimeout as delay } from 'node:timers/promises';
import {
  GameEventType,
  MAX_EVENT_REPLAY,
  WS_TRANSPORT_ONLY_EVENT_TYPES,
  wsServerFrameSchema,
  type WsFrameOf,
  type WsServerEventType,
  type WsServerFrame,
} from '../../shared/index.js';
import { type ApiClient } from './http.js';

/**
 * How often an unsatisfied wait looks again, in real milliseconds.
 *
 * Short on purpose. At the multiplier of the run one game hour lasts ten real milliseconds, so
 * every millisecond the scenario spends idle is a tenth of a game hour of wages and maintenance:
 * a lazy poll would not slow the run down, it would spend the money of the player.
 */
const POLL_INTERVAL_REAL_MS = 25;

/** How the client came by a frame. Both are legitimate; the mix is reported, not asserted. */
export type FrameSource = 'live' | 'replay';

export interface AppliedFrame {
  readonly frame: WsServerFrame;
  readonly source: FrameSource;
}

export interface SocketStats {
  /** Connections opened. The run asserts it stayed at one. */
  connections: number;
  /** Frames that arrived over the socket, including duplicates and transport only ones. */
  liveFramesReceived: number;
  /** Frames discarded because their sequence was at or below the mark. */
  duplicates: number;
  /** Times a live frame arrived above `mark + 1`, which is what triggers a replay. */
  gaps: number;
  /** Frames recovered through `GET /api/events?since`. */
  replayed: number;
  /** `CLOCK` and `HELLO`, which consume no sequence. */
  transportFrames: number;
}

export class GameSocket {
  private socket: WebSocket | null = null;
  private mark = 0;
  private readonly pending = new Map<number, WsServerFrame>();
  private readonly applied: AppliedFrame[] = [];
  private gapOpen = false;
  private helloSeq: number | null = null;
  private heartbeatIntervalRealMs: number | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private heartbeatsSent = 0;
  private closedUnexpectedly: string | null = null;

  readonly stats: SocketStats = {
    connections: 0,
    liveFramesReceived: 0,
    duplicates: 0,
    gaps: 0,
    replayed: 0,
    transportFrames: 0,
  };

  constructor(private readonly client: ApiClient) {}

  get appliedFrames(): readonly AppliedFrame[] {
    return this.applied;
  }

  get sequenceMark(): number {
    return this.mark;
  }

  get greetingSeq(): number | null {
    return this.helloSeq;
  }

  get unexpectedClose(): string | null {
    return this.closedUnexpectedly;
  }

  /** Asks for a ticket, opens the socket and waits until the greeting has been processed. */
  async connect(baseUrl: string): Promise<void> {
    const ticket = await this.client.call('POST /api/auth/ws-ticket');
    const url = new URL(ticket.path, baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket.ticket);

    const socket = new WebSocket(url);
    this.socket = socket;
    this.stats.connections += 1;

    socket.addEventListener('message', (event) => {
      const data: unknown = event.data;
      if (typeof data !== 'string') {
        return;
      }
      this.stats.liveFramesReceived += 1;
      this.apply(wsServerFrameSchema.parse(JSON.parse(data)), 'live');
    });
    socket.addEventListener('close', (event) => {
      if (this.socket === socket) {
        this.closedUnexpectedly = `codigo ${String(event.code)}: ${event.reason}`;
      }
    });

    await new Promise<void>((resolveOpen, rejectOpen) => {
      const timer = setTimeout(() => {
        rejectOpen(new Error('El WebSocket no se abrio en 15 s.'));
      }, 15_000);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolveOpen();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          rejectOpen(new Error('El WebSocket fallo al abrirse.'));
        },
        { once: true },
      );
    });

    const deadline = Date.now() + 15_000;
    while (this.helloSeq === null && Date.now() < deadline) {
      await delay(20);
    }
    if (this.helloSeq === null) {
      throw new Error('El WebSocket se abrio pero no envio HELLO en 15 s.');
    }
    this.startHeartbeat(socket);
    await this.reconcile();
  }

  /**
   * Starts the heartbeat, at half the period the greeting asked for.
   *
   * It is not optional and it is not decoration: the server closes a connection whose heartbeat
   * stops arriving with `HEARTBEAT_TIMEOUT` (`shared/ws/envelope.ts`), and a run of the whole
   * loop lasts well over the twenty seconds of the period. Half the period is what leaves room
   * for one lost beat, which is the same margin the browser client keeps.
   */
  private startHeartbeat(socket: WebSocket): void {
    const period = Math.max(1000, Math.floor((this.heartbeatIntervalRealMs ?? 20_000) / 2));
    this.heartbeat = setInterval(() => {
      if (socket.readyState !== 1) {
        return;
      }
      socket.send(JSON.stringify({ type: 'ping', atRealMs: String(Date.now()) }));
      this.heartbeatsSent += 1;
    }, period);
    this.heartbeat.unref();
  }

  /** Heartbeats sent, reported so the closing block can say the connection was kept alive. */
  get heartbeatCount(): number {
    return this.heartbeatsSent;
  }

  /** Closes the socket. Idempotent, and it stops a later close from reading as unexpected. */
  close(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'smoke complete');
  }

  private apply(frame: WsServerFrame, source: FrameSource): void {
    if (WS_TRANSPORT_ONLY_EVENT_TYPES.includes(frame.type)) {
      this.stats.transportFrames += 1;
      if (frame.type === 'HELLO') {
        this.helloSeq = frame.payload.seq;
        this.heartbeatIntervalRealMs = frame.payload.heartbeatIntervalRealMs;
      }
      if (frame.seq > this.mark) {
        this.gapOpen = true;
      }
      return;
    }
    if (frame.seq <= this.mark) {
      this.stats.duplicates += 1;
      return;
    }
    if (frame.seq > this.mark + 1) {
      this.pending.set(frame.seq, frame);
      if (source === 'live') {
        this.stats.gaps += 1;
      }
      this.gapOpen = true;
      return;
    }
    this.append(frame, source);
    for (;;) {
      const next = this.pending.get(this.mark + 1);
      if (next === undefined) {
        break;
      }
      this.pending.delete(this.mark + 1);
      this.append(next, 'live');
    }
    this.gapOpen = this.pending.size > 0;
  }

  private append(frame: WsServerFrame, source: FrameSource): void {
    this.applied.push({ frame, source });
    this.mark = frame.seq;
    if (source === 'replay') {
      this.stats.replayed += 1;
    }
  }

  /**
   * Closes every gap by replaying the ring, and returns once the applied sequence reaches the
   * sequence the server reports. It is the same route the browser client uses and the same
   * decision it makes; `truncated` is fatal here because the ring is far larger than a run.
   */
  async reconcile(): Promise<void> {
    for (let round = 0; round < 64; round += 1) {
      const reply = await this.client.call('GET /api/events', {
        query: { since: this.mark, limit: MAX_EVENT_REPLAY },
      });
      if (reply.truncated) {
        throw new Error(
          `El anillo de eventos ya no cubre la secuencia ${String(this.mark)}; ` +
            `el mas antiguo disponible es ${String(reply.oldestReplaySeq)}.`,
        );
      }
      for (const frame of reply.frames) {
        this.apply(frame, 'replay');
      }
      if (reply.frames.length === 0 || reply.currentSeq <= this.mark) {
        this.gapOpen = this.pending.size > 0;
        return;
      }
    }
    throw new Error('La reconciliacion del anillo de eventos no converge.');
  }

  /** Applied frames of one tag, in the order they were applied. */
  framesOf<TType extends WsServerEventType>(type: TType): readonly WsFrameOf<TType>[] {
    const matches: WsFrameOf<TType>[] = [];
    for (const entry of this.applied) {
      if (entry.frame.type === type) {
        matches.push(entry.frame as WsFrameOf<TType>);
      }
    }
    return matches;
  }

  /**
   * Waits until an applied frame satisfies the predicate.
   *
   * The live channel is the fast path and the replay is the backstop: a gap is closed as soon
   * as it is noticed, and the ring is consulted once a second anyway, so a frame the publisher
   * collapsed never turns into a hang. Nothing polls a domain route, which is what keeps the
   * wait an observation of the queue and not a poll of the state.
   */
  async waitFor(
    description: string,
    predicate: (frame: WsServerFrame) => boolean,
    timeoutRealMs: number,
  ): Promise<WsServerFrame> {
    const deadline = Date.now() + timeoutRealMs;
    let polls = 0;
    for (;;) {
      const found = this.applied.find((entry) => predicate(entry.frame));
      if (found !== undefined) {
        return found.frame;
      }
      if (this.closedUnexpectedly !== null) {
        throw new Error(
          `El WebSocket se cerro mientras se esperaba ${description}: ${this.closedUnexpectedly}`,
        );
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Se agoto la espera de ${description} tras ${String(timeoutRealMs)} ms reales. ` +
            `Secuencia aplicada: ${String(this.mark)}.`,
        );
      }
      if (this.gapOpen || polls % 20 === 19) {
        await this.reconcile();
      }
      polls += 1;
      await delay(POLL_INTERVAL_REAL_MS);
    }
  }

  /**
   * Whether the applied sequence is strictly increasing and free of holes, which is the
   * assertion of plan section 12 step 4 about the socket.
   */
  sequenceIntegrity(): { readonly ok: boolean; readonly detail: string } {
    if (this.applied.length === 0) {
      return { ok: false, detail: 'no se aplico ningun fotograma' };
    }
    let previous: number | null = null;
    for (const entry of this.applied) {
      const seq = entry.frame.seq;
      if (previous !== null && seq !== previous + 1) {
        return {
          ok: false,
          detail: `salto de ${String(previous)} a ${String(seq)} en ${entry.frame.type}`,
        };
      }
      previous = seq;
    }
    const first = this.applied[0];
    return {
      ok: true,
      detail:
        `${String(this.applied.length)} fotogramas, seq ` +
        `${String(first === undefined ? 0 : first.frame.seq)}..${String(previous ?? 0)}`,
    };
  }
}

/** The tag of a frame that reports a change of money, for readability at the call sites. */
export const PLAYER_UPSERTED: WsServerEventType = GameEventType.PLAYER_UPSERTED;
