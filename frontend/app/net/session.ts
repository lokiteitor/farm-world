// The session of the client: the access token in memory and the single refresh.
//
// Owner: W3-C.
//
// The access token lives in memory only and never in `localStorage`: it is short
// lived (fifteen minutes, stack section 6) and the durable half of the session is the
// rotating refresh token, which is an `httpOnly` cookie the JavaScript of the page
// cannot read by design. Reloading the page therefore starts with no access token and
// obtains one from the cookie, which is exactly the intended flow.
//
// The one piece of real machinery here is the single flight refresh. A page that opens
// the game runs several calls at once, and if the access token has expired every one of
// them comes back 401 at the same time. Refreshing once per failing call would rotate
// the refresh token several times concurrently, and rotation invalidates the token it
// consumed, so all but one of those refreshes would fail and the session would be
// destroyed by its own recovery. One shared promise per burst is not an optimisation:
// it is what makes rotation and concurrency compatible.

/** Outcome of one refresh attempt. */
export interface RefreshOutcome {
  readonly accessToken: string;
  readonly expiresAtRealMs: number;
}

export type RefreshFn = () => Promise<RefreshOutcome>;

interface SessionState {
  accessToken: string | null;
  expiresAtRealMs: number | null;
  /**
   * Incremented every time the session is replaced or cleared. A reply that was in
   * flight across a session change carries the old revision and must not resurrect it.
   */
  revision: number;
}

const state: SessionState = { accessToken: null, expiresAtRealMs: null, revision: 0 };

let pending: Promise<string | null> | null = null;
let attempts = 0;

export function accessToken(): string | null {
  return state.accessToken;
}

export function sessionRevision(): number {
  return state.revision;
}

/** Whether a session is held at all. Not a claim that the token is still valid. */
export function hasSession(): boolean {
  return state.accessToken !== null;
}

export function setSession(outcome: RefreshOutcome): void {
  state.accessToken = outcome.accessToken;
  state.expiresAtRealMs = outcome.expiresAtRealMs;
  state.revision += 1;
}

export function clearSession(): void {
  state.accessToken = null;
  state.expiresAtRealMs = null;
  state.revision += 1;
  pending = null;
}

/** Instant the access token expires at, in real milliseconds, or null. */
export function accessTokenExpiresAtRealMs(): number | null {
  return state.expiresAtRealMs;
}

/**
 * Obtains a fresh access token, coalescing every concurrent caller onto one attempt.
 *
 * Returns the new token, or null when the refresh failed, which means the session is
 * over and the caller has to send the player to the login page. The failure is not
 * rethrown: several callers share this promise and a rejection would surface as an
 * unhandled rejection in whichever of them did not await it.
 */
export function refreshAccessToken(refresh: RefreshFn): Promise<string | null> {
  const inFlight = pending;
  if (inFlight !== null) {
    return inFlight;
  }
  attempts += 1;
  const started = refresh().then(
    (outcome) => {
      setSession(outcome);
      return outcome.accessToken;
    },
    () => {
      clearSession();
      return null;
    },
  );
  // `pending` is set before the first `await` of any caller, so no caller of the same
  // burst can miss it, and it is cleared unconditionally on settlement because only
  // one attempt is ever in flight: a caller that arrives afterwards starts a new one.
  const settled = started.finally(() => {
    pending = null;
  });
  pending = settled;
  return settled;
}

/** Whether a refresh is in flight. Diagnostics and tests only. */
export function isRefreshing(): boolean {
  return pending !== null;
}

/** Total refresh attempts since the counter was last reset. Tests only. */
export function refreshAttemptCount(): number {
  return attempts;
}

/** Clears the session and the counters. Used by the tests between cases. */
export function resetSession(): void {
  state.accessToken = null;
  state.expiresAtRealMs = null;
  state.revision = 0;
  pending = null;
  attempts = 0;
}
