# Contrato de API

Estado: completo y definitivo para las fases 0 a 8 del plan, incluida la silvicultura.
Propietario: flujo de trabajo W2, agente de contrato. Congelado al cierre de W2.

Este directorio y `shared/ws/` contienen la superficie de comunicacion completa entre el cliente y el
servidor: los esquemas Zod de peticion y respuesta, el mapa de rutas tipado, los errores y la union
discriminada de eventos de WebSocket. Ningun agente posterior necesita anadir aqui un endpoint, un
campo ni un tipo de evento para completar el alcance del plan.

## 1. Ficheros y capas

El orden de la lista es tambien el unico orden de dependencia admisible entre los ficheros.

| Fichero | Contenido |
|---|---|
| `schemas/common.ts` | Primitivas del cable: dinero, instantes, puntos base, identificadores, seleccion de celdas, sobre de mutacion, limites de transporte |
| `errors.ts` | Conjunto cerrado de codigos, tablas de mensajes, correspondencia con codigos HTTP, constructores tipados y la clase `ApiError` |
| `schemas/world.ts` | Descripcion del mundo y carga por lote de chunks |
| `schemas/land.ts` | Presupuesto y compra de celdas |
| `schemas/farms.ts` | Granjas, edificios y capacidades |
| `schemas/fields.ts` | Geometria de campos, maquina de estados y atributos proyectados |
| `schemas/machinery.ts` | Maquinaria, catalogo y reparacion |
| `schemas/workers.ts` | Plantilla y pool de contratacion |
| `schemas/tasks.ts` | Peticion de tarea por operacion, prevision, creacion y cancelacion |
| `schemas/economy.ts` | Inventario, mercado y libro mayor |
| `schemas/forestry.ts` | Parcelas forestales, arboles, tala, replantacion y desmonte |
| `schemas/state.ts` | Jugador, avisos, instantanea, consulta de reproduccion y resumen de regreso |
| `schemas/auth.ts` | Registro, sesion y ticket de WebSocket |
| `schemas/system.ts` | Salud, metricas, documentacion y endpoints de desarrollo |
| `routes.ts` | Mapa de rutas tipado y utilidades derivadas |
| `index.ts` | Barril |

`shared/ws/` depende de `shared/api/schemas/`, y no al contrario, con una unica excepcion
justificada: `routes.ts` importa de `shared/ws/envelope.ts` el esquema de respuesta de
`GET /api/events`, porque lo que esa ruta devuelve son sobres de WebSocket y duplicar la union seria
la unica forma de que las dos vias divergieran.

## 2. Convenios de serializacion

Cuatro reglas que se aplican en toda la superficie, sin excepcion por endpoint. Estan implementadas
una sola vez, en `schemas/common.ts`, y comprobadas en `__tests__/wire.test.ts`.

### 2.1 El dinero viaja como cadena decimal

Un importe es una cadena que cumple `^[+-]?\d{1,24}(\.\d{1,4})?$`. El servidor emite siempre la forma
canonica de cuatro decimales; una peticion puede enviar menos. Un numero JSON es un `double` de
IEEE 754 y perderia la cuarta decimal que conserva `numeric(20,4)`, de modo que el esquema rechaza
`160000` y acepta `"160000.0000"`.

La conversion en la frontera es explicita:

```ts
// Desde el backend, la copia sincronizada es `backend/src/shared`; desde el frontend,
// `frontend/app/shared`. Ninguno importa el directorio `shared/` de la raiz.
import { fromWireMoney, toWireMoney } from '../shared/api/index.js';

const wire = toWireMoney(player.balance); // '160000.0000'
const amount = fromWireMoney(reply.result.totalPaid); // Money
```

El servidor no devuelve nunca un importe ya formateado. El formato de dos decimales para la interfaz
es `Money.toDisplay`, que llama el cliente.

### 2.2 Los instantes de juego viajan como cadena de entero

Un instante es una cadena de digitos sin ceros a la izquierda, con hasta diecinueve digitos, que es
la serializacion de un `bigint`. Todo instante con significado de simulacion o economico se almacena
como `gameMs` y ninguna cifra de tiempo de juego viaja como numero: 2^53 milisegundos de juego son
unos 285.000 anos, y un cliente que recibiera el valor como numero perderia los digitos bajos sin
error alguno.

```ts
import { fromWireGameMs, toWireGameMs } from '../shared/api/index.js';
```

Las duraciones en horas de juego si viajan como numero, porque son unidades de presentacion y de
catalogo, no instantes almacenados.

### 2.3 Los porcentajes viajan en puntos base

Habilidad, condicion, fertilidad, malezas, fertilizacion, ocupacion y progreso son enteros de 0 a
10.000. Es la misma representacion con la que se almacenan, de modo que no hay redondeo en la
frontera y la acumulacion perezosa es reproducible.

### 2.4 Las cantidades fungibles son enteros en su unidad almacenada

El trigo se cuenta en litros y la madera en decimetros cubicos. La interfaz divide por
`displayDivisor`, que viaja en el inventario y en los precios de mercado; el servidor no divide
nunca, para que una cifra redondeada no vuelva a entrar en un calculo.

### 2.5 Identificadores

Todo identificador es una cadena de 1 a 64 caracteres. Los tipos marcados de `shared/domain/ids.ts`
no se reproducen en los esquemas: un tipo marcado no puede construirse desde Zod sin una
transformacion, y una transformacion haria que el tipo de peticion y el de respuesta del mismo campo
difirieran, lo que rompe la simetria de la que depende el servidor simulado. La frontera convierte con
los constructores del dominio (`fieldId(params.fieldId)`), y la direccion queda visible en cada punto
de llamada.

## 3. Errores

Todo error, cualquiera que sea su origen, tiene la misma forma:

```json
{ "error": { "code": "GARAGE_CAPACITY_EXCEEDED", "message": "No queda plaza libre de garaje.", "details": { "occupancy": 4, "capacity": 4 } } }
```

`code` pertenece a un conjunto cerrado, `message` procede de la tabla compartida y `details` lleva las
cifras. Un codigo nombra una regla y nunca un campo: el campo, la celda o el identificador infractor
viajan en `details`, de modo que el cliente compone un mensaje accionable sin analizar texto y el
motivo por el que una seleccion se resalta en rojo y el motivo por el que el servidor rechaza la
peticion no pueden divergir.

Hay dos familias de codigo:

- `ValidationCode`, de `shared/domain/enums.ts`: las reglas del dominio. Es el conjunto que producen
  las reglas puras de `shared/rules/` y sobre el que conmuta el cliente cuando valida en local.
- `ApiTransportCode`, declarado en `errors.ts`: los fallos que no son reglas de dominio, que son
  autenticacion, limite de peticiones y salud del servicio.

La segunda familia es una desviacion documentada respecto al brief del agente, que pedia
`code: ValidationCode`. El motivo figura en `docs/handoff/NOTES-W2c.md`: `ValidationCode` no tiene
miembro para «falta el token» ni para «las credenciales no son validas», una respuesta 401 debe llevar
un codigo sobre el que el cliente pueda conmutar, y `shared/domain/` esta fuera del ambito de escritura
de este agente.

Correspondencia con codigos HTTP, en `API_ERROR_HTTP_STATUS`, asignada por una regla uniforme para que
ninguna ruta necesite tabla propia:

| Codigo | Significado en este contrato |
|---|---|
| 400 | La peticion no se puede leer o es internamente incoherente, con independencia del estado del mundo |
| 401 | La peticion no lleva una sesion valida |
| 402 | La peticion es legal y el jugador no puede pagarla |
| 403 | El recurso existe y pertenece a otro, o la ruta esta deshabilitada |
| 404 | El recurso no existe |
| 409 | La peticion es correcta y el estado actual del mundo la prohibe |
| 429 | Se supero el limite de peticiones |
| 500, 501, 503 | Imprevisto, declarado y no implementado, dependencia caida |

El cliente no ramifica por el codigo HTTP: ramifica por `code`. El codigo HTTP existe para que los
proxies, los registros y las metricas clasifiquen correctamente.

Constructores tipados disponibles: `notFound`, `notOwned`, `insufficientFunds`,
`spendingBlockedInDebt`, `insufficientStock`, `selectionTooLarge`, `selectionNotContiguous`,
`capacityExceeded`, `fieldStateNotAllowed`, `machineTypeNotCompatible`, `machineConditionTooLow`,
`validationFailed`, `contractVersionMismatch`, `idempotencyKeyRequired`, `authRequired` y
`notImplemented`. Todos devuelven una `ApiError`, que deriva el codigo HTTP y el mensaje del propio
codigo, de modo que un punto de lanzamiento no puede elegir un estado que contradiga la tabla.

## 4. Respuestas mutantes y secuencia

Toda ruta marcada como `sequenced` responde con el mismo sobre:

```ts
{ seq: number, atGameMs: string, result: <especifico de la ruta> }
```

`seq` es el valor de la secuencia de eventos del jugador una vez confirmada la mutacion, es decir la
secuencia del ultimo evento que produjo. El cliente aplica la respuesta si `seq` es mayor que la
ultima secuencia que aplico y la descarta en caso contrario, que es la misma regla que aplica a un
sobre de WebSocket. Como toda entidad de `result` es un reemplazo completo y no un delta, aplicar la
respuesta y descartar despues el eco converge al mismo estado que el orden inverso, sin importar cual
de los dos llegue primero.

`result` lleva el estado nuevo de todas las entidades que la mutacion toco, de modo que el reductor no
necesita conocimiento por endpoint mas alla de a que porcion del estado pertenece cada campo.

El sobre se construye siempre con `mutationReplySchema`, que registra el esquema en un `WeakSet`. La
prueba de contrato comprueba, estructuralmente y no por convencion, que las rutas marcadas como
`sequenced` son exactamente aquellas cuya respuesta salio de esa factoria.

## 5. El mapa de rutas

`API_ROUTES` es un objeto cuya clave es `METODO /ruta`, que es exactamente lo que identifica una ruta
HTTP. De el derivan cuatro cosas que de otro modo se escribirian cuatro veces y divergerian: el
registro en Fastify, el cliente tipado del frontend, el servidor simulado y la documentacion OpenAPI.

Cada entrada declara, ademas de sus esquemas, seis banderas. Todas se comprueban en
`__tests__/routes.test.ts`, no se confian:

| Bandera | Significado |
|---|---|
| `requiresAuth` | La ruta exige una sesion valida |
| `advancesPlayer` | El manejador ejecuta `advancePlayer` antes de nada |
| `sequenced` | La respuesta es un sobre de mutacion con `seq` |
| `movesMoney` | La ruta carga o abona al jugador |
| `requiresIdempotencyKey` | Presente exactamente cuando `movesMoney` lo esta |
| `devOnly` | Se rechaza salvo con la bandera de desarrollo activa |

Invariantes que la prueba exige:

- Toda ruta tiene esquema de respuesta.
- La clave coincide con el metodo y la ruta que repite, y no hay claves duplicadas.
- Toda ruta vive bajo `/api/` salvo `/health`, `/metrics` y `/docs`, que no se publican por el proxy.
- Una ruta declara esquema de parametros exactamente para los marcadores de su ruta, y las claves del
  esquema coinciden con los nombres de los marcadores.
- `requiresIdempotencyKey` equivale a `movesMoney`, que es la regla de la seccion 6.3 del plan
  expresada como invariante y no como convencion.
- Solo `POST` y `DELETE` mueven dinero; ningun `GET` es `sequenced` ni mueve dinero.
- Toda ruta `sequenced` declara al menos un tipo de evento en `emits`, y ninguna declara `CLOCK`.
- Toda ruta que mueve dinero emite `PLAYER_UPSERTED` y `LEDGER_APPENDED`.

Utilidades derivadas: `ApiRouteKey`, `RouteParams`, `RouteQuery`, `RouteBody`, `RouteReply`,
`routeKey`, `pathParamNames`, `buildPath`, `routeDefinition`, `routeDefinitions`,
`IDEMPOTENT_ROUTE_KEYS`, `SEQUENCED_ROUTE_KEYS`, `DEV_ROUTE_KEYS` y `routeKeysOfArea`.

### 5.1 Superficie completa

```text
auth       POST /api/auth/register · login · refresh · logout · ws-ticket
           GET  /api/auth/me
state      GET  /api/state/snapshot · /api/events?since · /api/session/welcome-back
           POST /api/session/welcome-back/ack
world      GET  /api/world/info                POST /api/world/chunks
land       POST /api/land/quote · /api/land/purchase
farms      GET  /api/farms                     POST /api/farms · /api/farms/:farmId/buildings
           DELETE /api/buildings/:buildingId
fields     GET  /api/fields · /api/fields/:fieldId
           POST /api/fields · :fieldId/extend · :fieldId/split · /api/fields/merge
machinery  GET  /api/machines · /api/machines/catalog
           POST /api/machines · :machineId/sell · :machineId/repair
workers    GET  /api/workers · /api/workers/pool
           POST /api/workers/hire · :workerId/fire
tasks      GET  /api/tasks · /api/tasks/:taskId
           POST /api/tasks/estimate · /api/tasks · :taskId/cancel
economy    GET  /api/inventory · /api/market/prices · /api/economy/ledger
           POST /api/market/sell
forestry   GET  /api/forest-plots · /api/forest-plots/:forestPlotId
           POST /api/forest-plots · :forestPlotId/fell · :forestPlotId/replant · /api/land/clear
sistema    GET  /health · /metrics · /docs
           POST /api/dev/retime · advance-player · grant · reconcile
```

Reparto de las operaciones entre `tasks` y `forestry`: `POST /api/tasks` admite las cuatro
operaciones agricolas y las tres forestales tienen ruta propia, que es como las enumera la seccion 7
del plan. `POST /api/tasks/estimate` admite las siete, porque calcula y no muta. El reparto evita dos
vias para el mismo hecho y respeta las zonas de eslint, que prohiben que el modulo `forestry` importe
del modulo `tasks`.

## 6. Uso desde el backend

El registro recorre el mapa y no enumera rutas. Fragmento ilustrativo:

```ts
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { API_ROUTES, apiErrorReplySchema, routeDefinitions } from '../shared/api/index.js';

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

for (const [key, route] of routeDefinitions()) {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: route.method,
    url: route.path,
    schema: {
      ...(route.params ? { params: route.params } : {}),
      ...(route.query ? { querystring: route.query } : {}),
      ...(route.body ? { body: route.body } : {}),
      response: { 200: route.reply, '4xx': apiErrorReplySchema, '5xx': apiErrorReplySchema },
      summary: route.summary,
      tags: [route.area],
    },
    preHandler: buildPreHandlers(route), // sesion, idempotencia, avance del jugador, bandera de desarrollo
    handler: handlerFor(key),
  });
}
```

Los cuatro `preHandler` derivan de las banderas y no de una lista escrita a mano:

- `requiresAuth` anade la comprobacion del token de acceso.
- `requiresIdempotencyKey` anade la lectura de la cabecera `Idempotency-Key` y la consulta de la
  respuesta ya persistida para esa clave.
- `advancesPlayer` envuelve el manejador en `withPlayerAdvanced`.
- `devOnly` anade la guarda de la bandera de desarrollo.

El manejador construye la respuesta con los tipos inferidos:

```ts
import { toWireGameMs, toWireMoney, type RouteReply } from '../shared/api/index.js';

const reply: RouteReply<'POST /api/land/purchase'> = {
  seq: player.eventSeq,
  atGameMs: toWireGameMs(gameNow),
  result: {
    purchasedCells: acquired,
    purchasedCount: acquired.length,
    skippedCount: requested.length - acquired.length,
    totalPaid: toWireMoney(total),
    balanceAfter: toWireMoney(balance),
  },
};
```

Los importes y los instantes se convierten explicitamente, endpoint por endpoint. No se parchea la
serializacion de forma global: un parche global convierte cualquier `bigint` o `Decimal` que aparezca
en la respuesta, incluidos los que no deberian estar ahi.

## 7. Uso desde el cliente

El cliente tipado construye la peticion desde la misma entrada del mapa, de modo que no concatena una
URL a mano ni puede olvidarse de codificar un valor:

```ts
import { API_ROUTES, buildPath, isApiErrorReply, type ApiRouteKey, type RouteBody, type RouteReply } from '~/shared/api/index.js';

async function call<K extends ApiRouteKey>(key: K, options: {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: RouteBody<K>;
  idempotencyKey?: string;
}): Promise<RouteReply<K>> {
  const route = API_ROUTES[key];
  const url = buildPath(route.path, options.params ?? {});
  // ... fetch, cabecera Idempotency-Key si route.requiresIdempotencyKey, y validacion con route.reply
}
```

Reglas de uso, todas derivadas de la seccion 7 del plan:

1. La respuesta se valida con `route.reply` en desarrollo. En produccion la validacion puede omitirse
   por coste, pero nunca se omite la comprobacion de `seq`.
2. Si `route.sequenced`, la respuesta se pasa al mismo reductor que consume los sobres de WebSocket, y
   se aplica solo si `seq` es mayor que la ultima secuencia aplicada.
3. Si `route.requiresIdempotencyKey`, la clave se genera una sola vez por intento del usuario y se
   reutiliza en cada reintento. El estado optimista se indexa por esa misma clave y solo decora el
   renderizado.
4. Un error se detecta con `isApiErrorReply` y se traduce con `apiErrorMessage(code)`, jamas con el
   texto que llego por el cable, que existe para los registros y para un cliente sin la tabla.
5. La validacion previa de un formulario o de una seleccion usa el mismo esquema Zod que el servidor,
   de modo que el boton se deshabilita por el mismo motivo por el que el servidor rechazaria.

## 8. Uso desde el servidor simulado

El servidor simulado del frontend responde las mismas claves con fixtures. Los fixtures de partida
estan en `shared/api/__tests__/fixtures.ts`, con un ejemplar de cada modelo de lectura, tipado contra
el esquema que lo describe. Como cada esquema de respuesta es una funcion total del mapa, el servidor
simulado se recorre igual que el registro de Fastify y no puede quedarse sin cubrir una ruta nueva.

## 9. WebSocket

El detalle vive en `shared/ws/`. Lo imprescindible para leer este contrato:

- El sobre es `{ seq, atGameMs, type, payload }`. `seq` es monotona por jugador y esta respaldada por
  la tabla `GameEvent`.
- La union esta discriminada por `GameEventType`, de `shared/domain/enums.ts`, sin anadidos, mas la
  etiqueta de transporte `HELLO`, que no es un `GameEvent` y no llega a esa tabla.
- `CLOCK` y `HELLO` no consumen numero de secuencia: el servidor los envia con la ultima secuencia
  asignada y el cliente aplica el contenido dejando su marca donde estaba.
- El cliente solo puede enviar `ping`, `subscribeChunks` y `unsubscribeChunks`. Ninguna accion viaja
  por el socket, porque una accion necesita clave de idempotencia, codigo de estado y un cuerpo que se
  pueda reintentar.
- La regla de huecos: si `seq` es la ultima aplicada mas uno, se aplica; si es menor o igual, se
  descarta; si hay hueco, se reproduce con `GET /api/events?since` y, si el anillo ya no cubre
  (`truncated`), se pide `GET /api/state/snapshot` y se invalidan los chunks cargados.

### 9.1 Correspondencia de nombres

El brief de este agente enumeraba los eventos por accion. La union se construye sobre
`GameEventType`, que los nombra por entidad, porque es el conjunto que persiste la tabla `GameEvent` y
sobre el que conmuta el reductor. Correspondencia:

| Nombre del brief | Etiqueta real |
|---|---|
| `HELLO` | `HELLO`, declarada en `shared/ws/events.ts` como etiqueta de transporte |
| `CLOCK` | `CLOCK` |
| `MONEY_CHANGED` | `PLAYER_UPSERTED`, acompanada de `LEDGER_APPENDED` |
| `LAND_PURCHASED` | `CHUNK_PATCHED`, acompanada de `PLAYER_UPSERTED` y `LEDGER_APPENDED` |
| `CHUNK_PATCH` | `CHUNK_PATCHED` |
| `FIELD_CREATED`, `FIELD_CHANGED` | `FIELD_UPSERTED`, y `FIELD_REMOVED` al fusionar |
| `TASK_STARTED`, `TASK_COMPLETED`, `TASK_CANCELED` | `TASK_UPSERTED`, cuyo `status` distingue los tres |
| `WORKER_CHANGED` | `WORKER_UPSERTED` y `WORKER_REMOVED` |
| `MACHINE_CHANGED` | `MACHINE_UPSERTED` y `MACHINE_REMOVED` |
| `BUILDING_CHANGED` | `BUILDING_UPSERTED` y `BUILDING_REMOVED` |
| `STORAGE_CHANGED` | `INVENTORY_UPSERTED`, acompanada de `FARM_UPSERTED` |
| `LABOR_POOL_REFRESHED` | `WORKER_POOL_UPSERTED` |
| `TREE_STAGE_CHANGED` | `TREES_UPSERTED` |
| `NOTICE` | `NOTICE` |

Etiquetas de `GameEventType` que el brief no enumeraba y que la union cubre igualmente:
`FARM_UPSERTED`, `FOREST_PLOT_UPSERTED` y `FOREST_PLOT_REMOVED`.

## 10. Limites de transporte

Acotan el tamano de una peticion o de una respuesta y no son numeros de balance, motivo por el que
viven en `schemas/common.ts` y no en `shared/config/`:

| Constante | Valor | Uso |
|---|---|---|
| `MAX_SELECTION_CELLS` | 2.000 (de `shared/config/world.ts`) | Celdas de una seleccion |
| `MAX_CHUNKS_PER_REQUEST` | 64 | Chunks por lote |
| `MAX_CHUNK_SUBSCRIPTIONS` | 512 | Chunks suscritos por conexion |
| `MAX_EVENT_REPLAY` | 500 | Sobres por pagina de reproduccion |
| `MAX_LEDGER_PAGE` | 200 | Asientos por pagina |
| `MAX_LIST_PAGE` | 500 | Filas por pagina de listado |
| `MAX_TREES_PER_REPLY` | 2.000 | Arboles por pagina |
| `MAX_NAME_LENGTH` | 48 | Nombre puesto por el jugador |
| `MAX_ID_LENGTH` | 64 | Identificador en el cable |

## 11. Reglas para ampliar el contrato

1. Un endpoint nuevo se anade al mapa y a su fichero de area, nunca solo a uno de los dos. La prueba
   de contrato falla si el mapa y la ruta no concuerdan.
2. Un tipo de evento nuevo exige un miembro nuevo en `GameEventType`, en `shared/domain/enums.ts`. La
   union no puede tener etiquetas que esa tabla no persista, y la prueba de exhaustividad lo comprueba
   en ambas direcciones.
3. Un objeto del contrato es estricto (`z.strictObject`). Descartar una clave desconocida convierte un
   campo renombrado en un valor por omision silencioso.
4. Un campo que puede faltar se declara `.optional()` si su ausencia significa algo distinto de un
   valor nulo, y `.nullable()` si el valor nulo es un estado legitimo del dominio. La diferencia
   importa: `cells: null` en `FIELD_UPSERTED` significa «la geometria no cambio», mientras que
   omitir `cells` seria un sobre incompleto.
5. Un cambio incompatible para un cliente ya conectado obliga a incrementar
   `SHARED_CONTRACT_VERSION` en `shared/index.ts`. El cliente lo compara con el valor que el servidor
   publica en `world/info` y en `HELLO`, y fuerza una recarga en lugar de divergir en silencio.
