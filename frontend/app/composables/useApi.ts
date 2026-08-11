// The one path a panel sends a request through.
//
// Owner: W3-C. Used by every panel of W4 to W6.
//
// It exists so that three things that must happen together cannot be done separately: the
// reply of a sequenced route goes through the reducer, the optimistic marker of a money
// moving route is opened and closed around the attempt, and the idempotency key of an
// attempt is generated once and reused by every retry of that same attempt.
//
// Done by hand at each call site, the third one is what fails: a panel that retries with a
// fresh key turns a doubtful purchase into two purchases, and no amount of care at the call
// site is a defence, because the retry is often the browser's and not the panel's.
//
// `query` and `mutate` are separate on purpose. A read needs no key, no marker and no
// reducer pass; a write needs all three. Making them one function with flags would let a
// write be issued as a read by omission.

import { apiCall, newIdempotencyKey, type ApiCallOptions } from '~/net/api';
import { isApiClientError } from '~/net/errors';
import { routeDefinition, type ApiRouteKey, type RouteReply } from '~/shared/index';
import { useNetStore } from '~/stores/net';
import { usePendingStore } from '~/stores/pending';
import { useSyncStore } from '~/stores/sync';

/** Extra context of a mutating call, used only to decorate the rendering. */
export interface MutateOptions<TKey extends ApiRouteKey> extends ApiCallOptions<TKey> {
  /** Entity the operation is about, so a row can show a spinner while it is in flight. */
  readonly subjectKind?: string;
  readonly subjectId?: string;
}

export interface ApiFacade {
  /** A read. Nothing is sequenced and nothing is marked. */
  query: <TKey extends ApiRouteKey>(
    routeKey: TKey,
    options?: ApiCallOptions<TKey>,
  ) => Promise<RouteReply<TKey>>;
  /**
   * A write. The reply goes through the reducer when the route is sequenced, the pending
   * marker is opened and closed, and the idempotency key is generated once per attempt.
   */
  mutate: <TKey extends ApiRouteKey>(
    routeKey: TKey,
    options?: MutateOptions<TKey>,
  ) => Promise<RouteReply<TKey>>;
  /** A key for an attempt the caller will retry itself. */
  newIdempotencyKey: typeof newIdempotencyKey;
}

/** True when the reply is the mutation envelope of the contract. */
function isMutationReply(
  value: unknown,
): value is { seq: number; atGameMs: string; result: unknown } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { seq?: unknown; atGameMs?: unknown };
  return typeof candidate.seq === 'number' && typeof candidate.atGameMs === 'string';
}

export function useApi(): ApiFacade {
  const sync = useSyncStore();
  const pending = usePendingStore();
  const net = useNetStore();

  async function query<TKey extends ApiRouteKey>(
    routeKey: TKey,
    options: ApiCallOptions<TKey> = {},
  ): Promise<RouteReply<TKey>> {
    try {
      return await apiCall(routeKey, options);
    } catch (error) {
      net.noteFailure(error);
      throw error;
    }
  }

  async function mutate<TKey extends ApiRouteKey>(
    routeKey: TKey,
    options: MutateOptions<TKey> = {},
  ): Promise<RouteReply<TKey>> {
    const route = routeDefinition(routeKey);
    const needsKey = route.requiresIdempotencyKey === true;
    const idempotencyKey = needsKey ? (options.idempotencyKey ?? newIdempotencyKey()) : undefined;
    const startedAtRealMs = Date.now();

    if (idempotencyKey !== undefined) {
      pending.start({
        idempotencyKey,
        routeKey,
        startedAtRealMs,
        ...(options.subjectKind === undefined ? {} : { subjectKind: options.subjectKind }),
        ...(options.subjectId === undefined ? {} : { subjectId: options.subjectId }),
      });
    }

    try {
      const reply = await apiCall(routeKey, {
        ...options,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      });
      // The reply of a sequenced route is fed to the same reducer as a WebSocket frame,
      // with its own sequence. Whichever of the two arrives first, the state converges.
      if (route.sequenced && isMutationReply(reply)) {
        sync.applyMutationReply(reply);
      }
      if (idempotencyKey !== undefined) {
        pending.confirm(idempotencyKey, Date.now());
      }
      return reply;
    } catch (error) {
      net.noteFailure(error);
      if (idempotencyKey !== undefined && isApiClientError(error)) {
        pending.fail(idempotencyKey, error.code, Date.now());
      } else if (idempotencyKey !== undefined) {
        pending.forget(idempotencyKey);
      }
      throw error;
    }
  }

  return { query, mutate, newIdempotencyKey };
}
