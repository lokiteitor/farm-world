// Modulo `session`. Sesion: instantanea, anillo de eventos y resumen de regreso.
//
// Andamiaje creado por W3-A con la ruta y la firma definitivas. Propietario del contenido:
// W6-B, que sustituye el cuerpo de este fichero sin tocar `src/app.ts` ni el registro de
// rutas (plan seccion 11, regla 3).
//
// Rutas del area `state` que le corresponden, en el orden del contrato:
//
//   GET /api/state/snapshot
//   GET /api/events
//   GET /api/session/welcome-back
//   POST /api/session/welcome-back/ack
//
// Cada una responde hoy 501 con el codigo `NOT_IMPLEMENTED` y su clave en los detalles, y ya
// valida su peticion, arrastra sus guardas y figura en la documentacion OpenAPI: lo unico que
// falta es el cuerpo.
//
// Las tres vias de sincronizacion comparten secuencia y reductor (plan 7). El anillo y su lectura
// ya existen en `lib/events.ts` (`readRing` y `readLog`), y el saldo proyectado y los
// contadores derivados en `lib/playerView.ts`: la instantanea los compone y no los reescribe.
//
// Como sustituirlo: cambiar cada `defineStubRoute(app, clave)` por
// `defineRoute(app, clave, manejador)` con el manejador tipado, que recibe la peticion con
// `params`, `query` y `body` ya validados y devuelve exactamente `RouteReply<clave>`. Todo
// camino mutante pasa por `withPlayerAdvanced` de `lib/advancePlayer.ts`, que es lo que
// devuelve el `seq` que la respuesta secuenciada tiene que llevar.

import { type FastifyInstance } from 'fastify';
import { defineStubRoute } from '../../plugins/routes.js';
import { routeKeysOfArea } from '../../shared/index.js';

/** Registra las rutas del area `state`. Invocada una vez por `src/app.ts`. */
export function registerSessionRoutes(app: FastifyInstance): void {
  for (const key of routeKeysOfArea('state')) {
    defineStubRoute(app, key);
  }
}
