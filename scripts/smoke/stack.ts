// The two Node processes the scenario runs against, and their orderly shutdown.
//
// Owner: workflow W7-B. `scripts/smoke/**`.
//
// `make smoke` raises PostgreSQL and Redis with Compose and applies the migrations; what this
// module adds are the two entry points of the backend, `src/server.ts` and `src/worker.ts`,
// started under the interpreter and the environment of `env.ts`. They are real processes and
// not an injected Fastify instance, which is the whole point of plan section 12 step 4: the
// scenario talks HTTP over a socket, the completions arrive through BullMQ and Redis, and the
// frames reach the WebSocket through the Redis channel exactly as they do in the compose stack.
//
// The worker is not optional. Without it the alarm clocks would still fire on the request path,
// because `advancePlayer` repairs the world on the first request of the player (plan section
// 6.3), and the scenario would then be asserting the repair path and calling it the queue. With
// it, a completion arrives without anybody asking, which is what the WebSocket assertions
// observe.
//
// Both are stopped in `stop()`, which is called from the `finally` of the scenario: SIGTERM
// first, because both install an orderly shutdown, and SIGKILL only when a process ignores it.
// The output of both is buffered and printed on failure only, so a passing run stays readable
// and a failing one still says what the server thought.

import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKEND_DIR, TSX_BIN, type SmokeEnvironment } from './env.js';

/** Lines of output kept per process. Enough to carry a stack trace and its context. */
const LOG_TAIL_LINES = 120;

/** How long a process is given to answer its health probe before the run gives up. */
const STARTUP_TIMEOUT_MS = 90_000;

/** How long a process is given to exit on SIGTERM before it is killed. */
const SHUTDOWN_TIMEOUT_MS = 15_000;

interface ManagedProcess {
  readonly name: string;
  readonly child: ChildProcess;
  readonly lines: string[];
  exited: boolean;
}

export class SmokeStack {
  private readonly processes: ManagedProcess[] = [];

  constructor(private readonly env: SmokeEnvironment) {}

  /** Starts the server and the worker and waits until both answer `/health`. */
  async start(): Promise<void> {
    await this.requireFreePort(this.env.backendPort);
    await this.requireFreePort(this.env.workerMetricsPort);

    this.processes.push(this.launch('server', 'src/server.ts'));
    this.processes.push(this.launch('worker', 'src/worker.ts'));

    await Promise.all([
      this.waitForHealth('server', `${this.env.baseUrl}/health`),
      this.waitForHealth(
        'worker',
        `http://${this.env.host}:${String(this.env.workerMetricsPort)}/health`,
      ),
    ]);
  }

  /** Stops both processes. Safe to call twice, and safe to call when start failed halfway. */
  async stop(): Promise<void> {
    await Promise.all(this.processes.map(async (managed) => this.terminate(managed)));
    this.processes.length = 0;
  }

  /** The buffered output of both processes, newest last. Printed only when something failed. */
  logTail(): string {
    return this.processes
      .map((managed) => `--- ${managed.name} ---\n${managed.lines.join('\n')}`)
      .join('\n');
  }

  private launch(name: string, entry: string): ManagedProcess {
    const child = spawn(TSX_BIN, [entry], {
      cwd: BACKEND_DIR,
      env: { ...this.env.childEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const managed: ManagedProcess = { name, child, lines: [], exited: false };
    const record = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.length === 0) {
          continue;
        }
        managed.lines.push(line);
        if (managed.lines.length > LOG_TAIL_LINES) {
          managed.lines.shift();
        }
      }
    };
    child.stdout?.on('data', record);
    child.stderr?.on('data', record);
    child.on('exit', (code, signal) => {
      managed.exited = true;
      managed.lines.push(`[proceso terminado] code=${String(code)} signal=${String(signal)}`);
    });
    return managed;
  }

  private async terminate(managed: ManagedProcess): Promise<void> {
    if (managed.exited || managed.child.pid === undefined) {
      return;
    }
    managed.child.kill('SIGTERM');
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    while (!managed.exited && Date.now() < deadline) {
      await delay(50);
    }
    if (!managed.exited) {
      managed.child.kill('SIGKILL');
      await delay(200);
    }
  }

  private async waitForHealth(name: string, url: string): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let lastFailure = 'sin intento';
    while (Date.now() < deadline) {
      const managed = this.processes.find((candidate) => candidate.name === name);
      if (managed !== undefined && managed.exited) {
        throw new Error(
          `El proceso ${name} termino antes de responder a ${url}.\n${managed.lines.join('\n')}`,
        );
      }
      try {
        const response = await fetch(url);
        if (response.ok) {
          return;
        }
        lastFailure = `HTTP ${String(response.status)}`;
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
      }
      await delay(250);
    }
    throw new Error(`${name} no respondio a ${url} en 90 s. Ultimo intento: ${lastFailure}`);
  }

  /** Refuses to start on a port another process holds, which is the clearest failure available. */
  private async requireFreePort(port: number): Promise<void> {
    const busy = await new Promise<boolean>((resolveBusy) => {
      const socket = createConnection({ host: this.env.host, port });
      const finish = (value: boolean): void => {
        socket.destroy();
        resolveBusy(value);
      };
      socket.once('connect', () => {
        finish(true);
      });
      socket.once('error', () => {
        finish(false);
      });
      socket.setTimeout(1000, () => {
        finish(false);
      });
    });
    if (busy) {
      throw new Error(
        `El puerto ${String(port)} de ${this.env.host} esta ocupado. ` +
          'Ajustar SMOKE_BACKEND_PORT o SMOKE_WORKER_METRICS_PORT.',
      );
    }
  }
}

/** Installs the handlers that stop the stack when the run is interrupted from the terminal. */
export function stopStackOnSignals(stack: SmokeStack): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stack.stop().then(() => {
        process.exit(130);
      });
    });
  }
}
