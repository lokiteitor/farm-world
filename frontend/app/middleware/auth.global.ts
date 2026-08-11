// The route guard.
//
// Owner: W3-C.
//
// It is global and not per page, so that a route added later is protected by default rather
// than by remembering to protect it. The public list is short and explicit.
//
// The check is `GET /api/auth/me` and not the presence of a token, and the difference matters:
// after a reload there is no access token in memory, because it is deliberately never
// persisted, and the session lives in the `httpOnly` refresh cookie the page cannot read
// (net/session.ts). So the guard first tries to trade the cookie for a token and only then
// asks who the player is. A client that decided from `localStorage` would send a logged out
// player to the game and a logged in one to the login form.

import { apiCall, apiResumeSession } from '~/net/api';
import { ensureClientBootstrapped } from '~/net/bootstrap';
import { isApiClientError } from '~/net/errors';
import { hasSession } from '~/net/session';
import { usePlayerStore } from '~/stores/player';

/** Routes reachable without a session. */
const PUBLIC_ROUTES: readonly string[] = ['/login'];

/** Route the guard sends an authenticated player to. */
const HOME_ROUTE = '/game';

export default defineNuxtRouteMiddleware(async (to) => {
  const config = useRuntimeConfig();
  await ensureClientBootstrapped(config.public);

  const isPublic = PUBLIC_ROUTES.includes(to.path);

  if (!hasSession()) {
    // No token in memory. Either this is the first load of the page or the session expired;
    // both are answered by the cookie.
    await apiResumeSession();
  }

  if (!hasSession()) {
    return isPublic ? undefined : navigateTo('/login');
  }

  try {
    const me = await apiCall('GET /api/auth/me');
    usePlayerStore().applyPlayer(me.player);
  } catch (error) {
    if (isApiClientError(error) && error.status === 401) {
      return isPublic ? undefined : navigateTo('/login');
    }
    // A transport failure is not a reason to log the player out: the shell shows the
    // connection state and the panels retry (plan section 7).
    return undefined;
  }

  return isPublic ? navigateTo(HOME_ROUTE) : undefined;
});
