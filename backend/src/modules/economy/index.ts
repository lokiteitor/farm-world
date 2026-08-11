// Modulo `economy`. Economia: existencias, precios fijos, libro mayor y venta.
//
// Andamiaje creado por W3-A con la ruta y la firma definitivas. Propietario del contenido:
// W5-C, que sustituye el cuerpo de este fichero sin tocar `src/app.ts` ni el registro de
// rutas (plan seccion 11, regla 3).
//
// Rutas del area `economy` que le corresponden, en el orden del contrato:
//
//   GET /api/inventory
//   GET /api/market/prices
//   GET /api/economy/ledger
//   POST /api/market/sell
//
// Cada una responde hoy 501 con el codigo `NOT_IMPLEMENTED` y su clave en los detalles, y ya
// valida su peticion, arrastra sus guardas y figura en la documentacion OpenAPI: lo unico que
// falta es el cuerpo.
//
// Vender es la unica via de ingreso y por tanto sigue disponible con saldo negativo (plan 6.6).
// La liquidacion forzosa se registra como extension del barrido con
// `registerSettleSweepHook` de `lib/jobs.ts`, sin reabrir `lib/advancePlayer.ts`.
//
// Como sustituirlo: cambiar cada `defineStubRoute(app, clave)` por
// `defineRoute(app, clave, manejador)` con el manejador tipado, que recibe la peticion con
// `params`, `query` y `body` ya validados y devuelve exactamente `RouteReply<clave>`. Todo
// camino mutante pasa por `withPlayerAdvanced` de `lib/advancePlayer.ts`, que es lo que
// devuelve el `seq` que la respuesta secuenciada tiene que llevar.

import { type FastifyInstance } from 'fastify';
import { defineStubRoute } from '../../plugins/routes.js';
import { routeKeysOfArea } from '../../shared/index.js';

/** Registra las rutas del area `economy`. Invocada una vez por `src/app.ts`. */
export function registerEconomyRoutes(app: FastifyInstance): void {
  for (const key of routeKeysOfArea('economy')) {
    defineStubRoute(app, key);
  }
}
