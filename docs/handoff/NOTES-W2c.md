# NOTES-W2c

Agente de contrato de API. Fase W2. Ambito escrito: `shared/api/` y `shared/ws/`, con sus
directorios `__tests__/`.

Este fichero recoge lo que otros agentes deben hacer y que W2c no podia hacer, las decisiones del
contrato que condicionan al resto, y las discrepancias detectadas entre el brief, el plan, el GDD y el
vocabulario ya escrito por W2a.

## 1. Pendiente para otros agentes

Siguen abiertas las notas 1.3, 1.4 y 1.5, que dependen de fases posteriores. Las notas 1.1, 1.2 y 1.6
estan aplicadas y se conservan con su numeracion original en el apartado «Resuelto» del final del
fichero, porque otros documentos y varios comentarios de codigo las citan por numero.

### 1.3 El backend debe honrar `expectedTotal`

Categoria: contrato
Propietario del cambio: W4-A (`land`), W4-B (`farms`), W5-A (`machinery`)

Tres cuerpos declaran `expectedTotal` opcional: `POST /api/land/purchase`,
`POST /api/farms/:farmId/buildings` y `POST /api/machines`. Cuando el campo esta presente, el servidor
debe comparar su propio total con el recibido y rechazar la peticion si difieren, en lugar de cobrar en
silencio un presupuesto caducado. El codigo a devolver es `VALIDATION_FAILED` con
`details.expected` y `details.actual`, que es lo que el esquema de detalles ya contempla. Un campo
declarado en el contrato y no comprobado es peor que no declararlo.

### 1.4 La cabecera de idempotencia es una guarda del registro, no del manejador

Categoria: contrato
Propietario del cambio: W3-A (`app.ts`, plugins)

`IDEMPOTENT_ROUTE_KEYS` enumera las rutas que exigen `Idempotency-Key`. La guarda debe derivarse de la
bandera `requiresIdempotencyKey` del mapa, no de una lista escrita a mano en el registro, para que
anadir una ruta que mueve dinero no pueda olvidar la cabecera. La constante existe precisamente para
eso. `shared/api/errors.ts` aporta `idempotencyKeyRequired()`.

Rutas afectadas hoy, ocho: `POST /api/land/purchase`, `POST /api/farms/:farmId/buildings`,
`DELETE /api/buildings/:buildingId`, `POST /api/machines`, `POST /api/machines/:machineId/sell`,
`POST /api/machines/:machineId/repair`, `POST /api/market/sell` y `POST /api/dev/grant`.

### 1.5 El terreno de un chunk no viaja en la respuesta

Categoria: contrato
Propietario del cambio: W3-B (`world`), W4-D (`game/world`)

`POST /api/world/chunks` devuelve solo la capa de modificaciones y la version del chunk. El terreno
generado no viaja: es funcion pura de la semilla y de la coordenada, y el generador determinista de
`shared/world/` lo reproduce en el cliente exactamente igual que en el servidor. Es lo que la seccion
9.5 del plan da por supuesto al decir que solo la capa de modificaciones lleva revision.

Si W4-D concluye que el cliente no puede generar terreno con el presupuesto de rendimiento de la
seccion 9.3, hace falta un campo adicional en `chunkStateSchema` (por ejemplo `terrain` como cadena en
base64 de un byte por celda). Es una adicion compatible, pero afecta a este directorio congelado: se
anota en el `handoff` del agente que lo necesite y lo aplica W7.

## 2. Decisiones del contrato que condicionan a las fases siguientes

### 2.1 La respuesta mutante lleva `seq` y entidades completas, no una lista de eventos

La seccion 7 del plan dice que «las respuestas REST mutantes viajan por el mismo reductor con su
`seq`». Hay dos lecturas posibles y la eleccion no es neutral.

Lectura descartada: la respuesta incluye la lista de sobres de WebSocket que la mutacion produjo. Es
la mas literal, y crea un ciclo de importacion inevitable, porque los sobres llevan los modelos de
lectura que define `shared/api/schemas/`, de modo que `api` importaria `ws` y `ws` importaria `api`.

Lectura adoptada: la respuesta es `{ seq, atGameMs, result }`, donde `result` lleva el estado nuevo y
completo de todas las entidades que la mutacion toco, con los mismos modelos de lectura que llevan los
eventos. El reductor la consume igual que un sobre, y como toda entidad es un reemplazo completo y no
un delta, aplicar la respuesta y descartar despues el eco converge al mismo estado que el orden
inverso. `seq` es la secuencia del ultimo evento que la mutacion produjo.

Consecuencia para W3-C y para los agentes de paneles: el reductor necesita una funcion por porcion de
estado (`applyPlayer`, `applyField`, ...) y dos puntos de entrada que la usan, uno para el sobre de
WebSocket y otro para el `result` de una respuesta mutante. No hay una tercera via.

### 2.2 La union de eventos se construye sobre `GameEventType`, mas `HELLO`

Conforme al apartado 1.2 de `NOTES-W2a`. El brief de W2c enumeraba los eventos por accion
(`MONEY_CHANGED`, `LAND_PURCHASED`, `FIELD_CREATED`, `TASK_STARTED`, `TASK_COMPLETED`,
`TASK_CANCELED`, ...) y `GameEventType` los nombra por entidad. La correspondencia completa esta en el
apartado 9.1 de `shared/api/README.md`.

`HELLO` se declara en `shared/ws/events.ts` como etiqueta de transporte, no como `GameEventType`: no es
un `GameEvent`, no llega a esa tabla y no consume numero de secuencia. La prueba de exhaustividad
comprueba las dos direcciones y que la union tiene exactamente `GAME_EVENT_TYPES.length + 1` miembros.

### 2.3 Los tipos marcados no cruzan el cable

`Money`, `GameMs`, `Bp` y los identificadores marcados de `shared/domain/` no aparecen en ningun
esquema. Un esquema Zod no puede producir un tipo marcado sin una transformacion, y una transformacion
haria que el tipo de entrada y el de salida del mismo campo difirieran, lo que rompe la simetria de la
que dependen el servidor simulado y las pruebas de contrato.

La frontera convierte explicitamente, con `toWireMoney`, `fromWireMoney`, `toWireGameMs`,
`fromWireGameMs`, `toWireRealMs` y `fromWireRealMs` en un sentido, y con los constructores del dominio
(`bp`, `fieldId`, ...) en el otro. `Money` es un subtipo de `string`, asi que un valor `Money` se
asigna a un campo de respuesta sin conversion; `GameMs` es un `bigint` y no, de modo que ahi la
llamada al conversor es obligatoria y visible.

### 2.4 La peticion de tarea es una union discriminada por operacion

`POST /api/tasks` acepta las cuatro operaciones agricolas y `POST /api/tasks/estimate` las siete. Cada
miembro declara exactamente los campos que su operacion necesita, de modo que sembrar sin cultivo,
talar contra un campo o desmontar sin celdas son peticiones mal formadas y no conflictos de dominio.
Las comprobaciones tres a seis de §104 quedan asi repartidas entre el esquema, que decide la forma, y
el modulo de tareas, que decide el estado.

Consecuencia para W6-A: la validacion de dominio no tiene que comprobar presencia de campos, solo
compatibilidad real contra `OPERATION_REQUIREMENTS`, estado del campo, reserva de recursos y capacidad
de almacenamiento.

### 2.5 Reparto de las tres operaciones forestales

La seccion 7 del plan enumera `forest-plots/:id/fell`, `:id/replant` y `land/clear` bajo silvicultura.
Se han declarado como rutas propias, y `POST /api/tasks` no las acepta. El motivo es la regla 4 de la
seccion 11 del plan: `forestry` y `tasks` son modulos hermanos de la misma fase (W6-C y W6-A) y las
zonas de eslint prohiben que uno importe del otro, de modo que una unica ruta generica habria obligado
a que el modulo de tareas conociera la silvicultura o a mover la logica compartida a
`backend/src/lib`.

`POST /api/land/clear` vive en el area de silvicultura del contrato aunque su ruta pertenezca al
espacio de nombres de `land`. Lo registra el modulo `forestry`. Es deliberado y literal respecto al
plan.

### 2.6 `POST /api/land/quote` y `POST /api/tasks/estimate` son POST y no mutan

Ambas llevan un cuerpo que no cabe en una cadena de consulta: hasta dos mil celdas la primera, la
peticion de tarea completa la segunda. Estan marcadas `sequenced: false` y `movesMoney: false`, y
`advancesPlayer: true`, porque las dos necesitan el saldo liquidado y los atributos proyectados al
instante actual para responder algo util.

### 2.7 Un campo opcional y un campo nulo significan cosas distintas

Convenio aplicado en toda la superficie: `.optional()` cuando la ausencia significa algo distinto de
un valor nulo, y `.nullable()` cuando el valor nulo es un estado legitimo del dominio. El caso que lo
ilustra es `cells` en `FIELD_UPSERTED`: `null` significa «la geometria no cambio» y ahorra reenviar dos
mil celdas cada vez que se liquida el nivel de malezas, mientras que omitir el campo seria un sobre
incompleto.

### 2.8 Limites de transporte

`MAX_CHUNKS_PER_REQUEST` 64, `MAX_CHUNK_SUBSCRIPTIONS` 512, `MAX_EVENT_REPLAY` 500,
`MAX_LEDGER_PAGE` 200, `MAX_LIST_PAGE` 500, `MAX_TREES_PER_REPLY` 2.000, `MAX_NAME_LENGTH` 48 y
`MAX_ID_LENGTH` 64. Son limites del transporte y no numeros de balance, motivo por el que viven en
`shared/api/schemas/common.ts` y no en `shared/config/`. `MAX_SELECTION_CELLS` si viene de
`shared/config/world.ts`, porque lo comparten el cliente al arrastrar y el servidor al validar.

## 3. Discrepancias detectadas

### 3.1 El brief pedia `code: ValidationCode` y el conjunto no cubre la autenticacion

Detallado en el apartado 1.2. Resuelto con `ApiTransportCode` en `shared/api/errors.ts`.

### 3.2 Los nombres de evento del brief no coinciden con `GameEventType`

Detallado en el apartado 2.2. Resuelto usando `GameEventType`, que es la instruccion explicita del
apartado 1.2 de `NOTES-W2a` y lo que persiste la tabla `GameEvent`.

### 3.3 El plan no lista un endpoint de detalle de parcela forestal

La seccion 7 del plan enumera solo `GET forest-plots`, pero `TREES_UPSERTED` existe como evento, lo que
implica que el cliente mantiene arboles individuales, y una parcela puede tener tantos arboles como
celdas. Se ha anadido `GET /api/forest-plots/:forestPlotId`, con pagina de arboles acotada por
`MAX_TREES_PER_REPLY`. Sin ella no habria forma de poblar el estado inicial de una parcela sin meter
decenas de miles de arboles en la instantanea.

### 3.4 El plan no lista un endpoint de detalle de campo

Mismo caso: la seccion 7 enumera `GET fields · fields/:id`, que si esta previsto, y ahi si coincide. Se
ha respetado literalmente. La geometria viaja en el detalle y no en el listado, para que un jugador con
muchos campos no descargue toda la geometria de la explotacion en cada refresco.

### 3.5 `DELETE` que mueve dinero

El brief pide marcar `requiresIdempotencyKey` «en todos los POST que mueven dinero».
`DELETE /api/buildings/:buildingId` devuelve el factor de reventa, es decir mueve dinero, y tambien lo
lleva. La regla implementada y comprobada por la prueba es la mas fuerte y la mas simple de razonar:
`requiresIdempotencyKey` equivale a `movesMoney`, sin importar el metodo.

### 3.6 Las rutas de desarrollo no encajan en la regla de secuencia

`POST /api/dev/retime` y `POST /api/dev/advance-player` cambian el estado y no devuelven un sobre de
mutacion: la primera afecta al reloj del mundo, que se propaga por `CLOCK`, y la segunda procesa
eventos vencidos, que se propagan por sus propios sobres. Estan marcadas `sequenced: false`.
`POST /api/dev/grant` si mueve dinero y si es `sequenced`, con clave de idempotencia, para no abrir una
excepcion a la regla de la seccion 6.3 del plan en el unico camino que la deja pasar.

### 3.7 El area `system` publica dos respuestas que no son JSON

`GET /metrics` devuelve el formato de exposicion de Prometheus y `GET /docs` devuelve HTML. Ambas
figuran en el mapa con esquema de respuesta `z.string()` y con `replyContentType` declarado. La
alternativa, excluirlas del mapa, habria hecho imposible la invariante «toda ruta declarada tiene
esquema de respuesta»: no se podria distinguir una ruta que devuelve texto de una a la que se le olvido
el esquema.

## 4. Decisiones para ADR

Reparto previsto por la seccion 11 del plan. W2c aporta a la entrada 0006 y sugiere una precision en la
0008.

- 0006 Zod como esquema unico de API, tipos y formularios. Ampliaciones que conviene recoger:
  1. El mapa de rutas tipado con clave `METODO /ruta` como fuente unica de la que derivan el registro
     en Fastify, el cliente del frontend, el servidor simulado y la documentacion OpenAPI.
  2. Las reglas transversales del plan expresadas como banderas del mapa y comprobadas por pruebas de
     invariante, no por convencion: `requiresIdempotencyKey` equivale a `movesMoney`, `sequenced`
     equivale a que la respuesta salga de `mutationReplySchema`, y toda ruta `sequenced` declara los
     eventos que puede producir.
  3. Todo objeto del contrato es estricto. Descartar una clave desconocida convierte un campo
     renombrado en un valor por omision silencioso.
  4. La union discriminada de eventos se escribe miembro a miembro y no se genera de una tabla, porque
     una union generada pierde la correlacion entre etiqueta y contenido en el nivel de tipos, y esa
     correlacion es lo que permite al reductor conmutar sobre `type` sin conversiones.
  5. Dos familias de codigo de error en un solo campo `code`: las reglas del dominio, de
     `shared/domain`, y los fallos de transporte, declarados en `shared/api/errors.ts`. Correspondencia
     con codigos HTTP por regla uniforme, y el cliente ramifica por codigo y nunca por estado HTTP.
- 0008 Dinero en decimal exacto. Precision que aporta el contrato: el tipo marcado `Money` no cruza el
  cable, de modo que el campo del esquema es `string` con patron y la conversion en la frontera es
  explicita en los dos sentidos. El motivo es que una transformacion de Zod haria diferir el tipo de
  entrada y el de salida del mismo campo, lo que rompe la simetria del servidor simulado.
- Entrada nueva sugerida, si el redactor lo considera: la respuesta mutante lleva entidades completas y
  no una lista de eventos, con el motivo del apartado 2.1 (el ciclo de importacion) y la consecuencia
  para el reductor del cliente.

## 5. Verificacion ejecutada

| Comando | Resultado |
|---|---|
| `cd shared && npx tsc --noEmit` | Sin errores en `api/` ni en `ws/` |
| `cd shared && npx vitest run api ws` | 5 ficheros, 106 pruebas en verde |
| `npx eslint shared/api shared/ws` | Sin hallazgos |
| `npx prettier --check "shared/api/**/*.ts" "shared/ws/**/*.ts"` | Conforme |

No ejecutado, conforme al brief: `git`, `npm install`, `prisma generate`, `docker compose`,
compilaciones de produccion y `make sync-types`.

---

## Resuelto

| Nota | Quien la aplico | Como |
|---|---|---|
| 1.1 Reexportaciones de `shared/index.ts` | Ventana de parcheo W2.5 | Las cuatro lineas descomentadas en su sitio. El backend y el frontend pueden importar por el barril y ya no por subruta |
| 1.2 Cinco codigos de validacion que faltan | Ventana de parcheo W2.5 | Los cinco de autenticacion (`AUTH_REQUIRED`, `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_EXPIRED`, `AUTH_TICKET_INVALID`, `EMAIL_ALREADY_REGISTERED`) se movieron a `ValidationCode`, con su mensaje en `VALIDATION_MESSAGES`, y salieron de `ApiTransportCode`, que conserva los seis fallos del servicio. `ApiTransportCode` no queda vacio, que era la otra posibilidad que la nota preveia: la cabecera de idempotencia, el limite de peticiones, la bandera de desarrollo, el stub declarado, la caida de una dependencia y el error imprevisto no son reglas del jugador. Ningun consumidor cambio, porque todos leen `ApiErrorCode`, `API_ERROR_MESSAGES` y `API_ERROR_HTTP_STATUS`; la prueba de disyuncion entre las dos familias sigue en verde |
| 1.6 Sincronizacion de copias | Ventana de parcheo W2.5 | `make sync-types` ejecutado; `make check-sync` devuelve 0 |

### 1.1 Reexportaciones de `shared/index.ts`

Categoria: cambio en fichero fuera del ambito
Ficheros afectados: `shared/index.ts`, lineas 17 y 18
Propietario del cambio: W7-A, o el agente designado para cerrar el barril de `shared/`

`shared/index.ts` declara las cuatro reexportaciones pendientes como comentarios. `NOTES-W2a`,
apartado 1.1, asigna a cada agente descomentar la suya. W2c no lo ha hecho, porque el brief de este
agente es explicito en que solo escribe dentro de `shared/api/` y `shared/ws/` y en que cualquier
cambio fuera de ese ambito se anota en lugar de aplicarse. Como los cuatro agentes de W2 trabajan en
paralelo sobre el mismo fichero de una sola linea cada uno, y una escritura completa del fichero
descarta la de los demas, aplicarlo habria sido la via mas rapida de perder el trabajo de otro.

Lineas que hay que descomentar, sin reordenar el fichero:

```ts
export * from './api/index.js';
export * from './ws/index.js';
```

Comprobado que el orden actual del fichero es correcto: `api` antes de `ws` es tambien el orden de
dependencia real, y ningun ciclo se cierra. Mientras las lineas sigan comentadas, el backend y el
frontend pueden importar por subruta (`../shared/api/index.js`, `../shared/ws/index.js`), que es lo
que hacen los ejemplos de `shared/api/README.md`.

### 1.2 Cinco codigos de validacion que faltan en `shared/domain/enums.ts`

Categoria: campo que falta en el contrato
Ficheros afectados: `shared/domain/enums.ts` (`ValidationCode` y `VALIDATION_MESSAGES`)
Propietario del cambio: W7-A, si se considera que deben unificarse

`ValidationCode` no tiene ningun miembro para los fallos que no son reglas del dominio, y una
respuesta 401 debe llevar un codigo sobre el que el cliente pueda conmutar. Faltan, como minimo:
`AUTH_REQUIRED`, `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_EXPIRED`, `AUTH_TICKET_INVALID` y
`EMAIL_ALREADY_REGISTERED`; y para completar la superficie, `IDEMPOTENCY_KEY_REQUIRED`,
`RATE_LIMITED`, `DEV_ENDPOINT_DISABLED`, `NOT_IMPLEMENTED`, `SERVICE_UNAVAILABLE` e
`INTERNAL_ERROR`.

Solucion adoptada, que es funcional y no un andamiaje: `shared/api/errors.ts` declara
`ApiTransportCode` con esos once valores y su tabla de mensajes en espanol, y el tipo del campo `code`
es `ApiErrorCode = ValidationCode | ApiTransportCode`. Sigue siendo un conjunto cerrado, sigue habiendo
un solo campo `code`, y la tabla de codigos HTTP los cubre todos. Si mas adelante se decide moverlos a
`ValidationCode`, este modulo conserva su forma y `API_TRANSPORT_CODES` queda vacio; ningun consumidor
tiene que cambiar, porque todos leen `ApiErrorCode`, `API_ERROR_MESSAGES` y
`API_ERROR_HTTP_STATUS`.

Desviacion respecto al brief, que pedia literalmente `{ code: ValidationCode, message, details? }`.
Queda documentada tambien en el apartado 3 de `shared/api/README.md`.

### 1.6 Sincronizacion de copias

Categoria: orden que hay que ejecutar
Propietario del cambio: W3 y W7

`shared/api/` y `shared/ws/` son directorios nuevos, de modo que `backend/src/shared` y
`frontend/app/shared` no los contienen hasta que se ejecute `make sync-types`. W2c no lo ejecuta
porque escribiria fuera de su ambito.

Comprobado sobre `scripts/sync-shared-types.sh` que los patrones de exclusion cubren lo que no debe
copiarse: `shared/api/__tests__/` y `shared/ws/__tests__/` casan con `__tests__/` a cualquier
profundidad, y `shared/api/README.md` casa con la exclusion `README.md`, que el script aplica a
cualquier profundidad porque el patron no lleva barra. No hace falta ningun ajuste del script.
