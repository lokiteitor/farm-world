// Modulo `machinery`. Maquinaria: catalogo, compra con plaza de garaje, venta y reparacion.
//
// Andamiaje creado por W3-A con la ruta y la firma definitivas. Propietario del contenido:
// W5-A, que sustituye el cuerpo de este fichero sin tocar `src/app.ts` ni el registro de
// rutas (plan seccion 11, regla 3).
//
// Rutas del area `machinery` que le corresponden, en el orden del contrato:
//
//   GET /api/machines
//   GET /api/machines/catalog
//   POST /api/machines
//   POST /api/machines/:machineId/sell
//   POST /api/machines/:machineId/repair
//
// Cada una responde hoy 501 con el codigo `NOT_IMPLEMENTED` y su clave en los detalles, y ya
// valida su peticion, arrastra sus guardas y figura en la documentacion OpenAPI: lo unico que
// falta es el cuerpo.
//
// La reparacion es un evento agendado con duracion, exige taller y activa `IN_REPAIR` (plan 2.2,
// resolucion de §93, §29 y §95). El desgaste se aplica por evento y prorrateado sobre las
// horas trabajadas, nunca por inactividad (§93).
//
// Como sustituirlo: cambiar cada `defineStubRoute(app, clave)` por
// `defineRoute(app, clave, manejador)` con el manejador tipado, que recibe la peticion con
// `params`, `query` y `body` ya validados y devuelve exactamente `RouteReply<clave>`. Todo
// camino mutante pasa por `withPlayerAdvanced` de `lib/advancePlayer.ts`, que es lo que
// devuelve el `seq` que la respuesta secuenciada tiene que llevar.

import { type FastifyInstance } from 'fastify';
import { defineStubRoute } from '../../plugins/routes.js';
import { routeKeysOfArea } from '../../shared/index.js';

/** Registra las rutas del area `machinery`. Invocada una vez por `src/app.ts`. */
export function registerMachineryRoutes(app: FastifyInstance): void {
  for (const key of routeKeysOfArea('machinery')) {
    defineStubRoute(app, key);
  }
}
