// Modulo `fields`. Campos: geometria, maquina de estados del ciclo y trabajos de crecimiento.
//
// Andamiaje creado por W3-A con la ruta y la firma definitivas. Propietario del contenido:
// W4-C, que sustituye el cuerpo de este fichero sin tocar `src/app.ts` ni el registro de
// rutas (plan seccion 11, regla 3).
//
// Rutas del area `fields` que le corresponden, en el orden del contrato:
//
//   GET /api/fields
//   GET /api/fields/:fieldId
//   POST /api/fields
//   POST /api/fields/:fieldId/extend
//   POST /api/fields/:fieldId/split
//   POST /api/fields/merge
//
// Cada una responde hoy 501 con el codigo `NOT_IMPLEMENTED` y su clave en los detalles, y ya
// valida su peticion, arrastra sus guardas y figura en la documentacion OpenAPI: lo unico que
// falta es el cuerpo.
//
// La contiguidad se valida con el recorrido en anchura de `shared/rules/geometry.ts`, que es la
// misma funcion que usa el cliente al arrastrar, de modo que el resaltado verde y el 400 del
// servidor no pueden divergir (plan 5.2). La fase del cultivo es proyeccion autoritativa mas
// trabajo materializador: el manejador de `FIELD_ADVANCE_PHASE` de `jobs.ts` la recalcula con
// la misma funcion pura y solo notifica (plan 6.5).
//
// Como sustituirlo: cambiar cada `defineStubRoute(app, clave)` por
// `defineRoute(app, clave, manejador)` con el manejador tipado, que recibe la peticion con
// `params`, `query` y `body` ya validados y devuelve exactamente `RouteReply<clave>`. Todo
// camino mutante pasa por `withPlayerAdvanced` de `lib/advancePlayer.ts`, que es lo que
// devuelve el `seq` que la respuesta secuenciada tiene que llevar.

import { type FastifyInstance } from 'fastify';
import { defineStubRoute } from '../../plugins/routes.js';
import { routeKeysOfArea } from '../../shared/index.js';

/** Registra las rutas del area `fields`. Invocada una vez por `src/app.ts`. */
export function registerFieldsRoutes(app: FastifyInstance): void {
  for (const key of routeKeysOfArea('fields')) {
    defineStubRoute(app, key);
  }
}
