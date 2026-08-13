# NOTES-w3a

Agente de esqueleto de backend. Fase W3. Ambito escrito: `backend/src/app.ts`, `server.ts`,
`worker.ts`, `handlers.ts`, `plugins/**`, `lib/**`, `modules/auth/**`, `backend/src/__tests__/**` y la
creacion de los andamiajes de los diez modulos restantes.

Este fichero recoge lo que otros agentes deben hacer y que W3-A no podia hacer, las decisiones que
condicionan al resto de la fase y las discrepancias detectadas entre el brief, el plan, el contrato y
la tabla de propiedad.

## 1. Pendiente para otros agentes

### 1.3 `docs/ownership.md` no recoge cuatro rutas nuevas ni la convencion de pruebas

Categoria: cambio en fichero de otro propietario
Ficheros afectados: `docs/ownership.md`, apartado 3.5
Propietario del cambio: W2-E o W7-D

Rutas nuevas bajo `backend/src/`, todas de W3-A y congeladas tras W3:

| Ruta | Que es |
|---|---|
| `backend/src/handlers.ts` | El unico fichero que conoce los once modulos: conecta el registro de manejadores de evento agendado y el de trabajos de la cola con el modulo que posee cada uno. Existe para que ni `lib/queue.ts` ni `lib/advancePlayer.ts` importen un modulo, que las zonas de ESLint prohiben |
| `backend/src/plugins/routes.ts` | `defineRoute` y `defineStubRoute`: el registro de una ruta a partir de su clave del contrato, con las cuatro guardas derivadas de las banderas |
| `backend/src/plugins/systemRoutes.ts` | El area `system`: `/health`, `/metrics` y las cuatro rutas de desarrollo |
| `backend/src/modules/<modulo>/jobs.ts` | Andamiaje del manejador de evento agendado de los cinco modulos que poseen uno: `fields`, `machinery`, `workers`, `tasks` y `forestry` |

Convencion de pruebas, que conviene fijar en la tabla porque la fila actual es ambigua: las pruebas
de un modulo viven en `backend/src/__tests__/<modulo>/` y no dentro del modulo. No es una preferencia:
la zona de ESLint impide que un fichero de `backend/src/modules/<x>/` importe cualquier cosa que no
sea su propio directorio, `lib`, `plugins` o `shared`, de modo que una prueba que necesite el arnes
de integracion no puede estar ahi. Comprobado al mover
`modules/auth/__tests__/auth.int.test.ts` a `__tests__/auth/auth.int.test.ts`.

Mitigacion adoptada: ninguna necesaria. Ninguna ruta queda sin dueno; falta la fila.

### 1.4 Entradas de ADR 0015-0020

Categoria: cambio en fichero de otro propietario
Ficheros afectados: `docs/adr.md`
Propietario del cambio: el agente de cierre de W3

El apartado 3.3 de `docs/ownership.md` asigna a W3-A la redaccion de las entradas 0015 a 0020. No se
ha escrito ninguna, por dos motivos: el brief de este agente no incluye `docs/adr.md` entre los
directorios que puede escribir, y los cuatro agentes de W3 trabajan en paralelo, de modo que un
escritor que abra el fichero ahora no puede recoger las decisiones de los otros tres. El apartado 3
de este fichero lleva el material de las seis entradas, redactado para que el agente de cierre lo
incorpore con `scripts/adr-append.mjs`.

Conviene ademas corregir los tres pasajes desfasados que `NOTES-w2-5-parcheo` 2.1 enumera, ya que el
proximo escritor abrira el fichero de todos modos.

### 1.5 Lo que cada modulo posterior encuentra ya hecho

Categoria: contrato
Propietario: W3-B, W4, W5 y W6

No es una peticion, es lo que hay que leer antes de escribir un modulo, porque esta pensado para que
nadie tenga que tocar un fichero compartido (plan seccion 11, regla 3):

- `defineRoute(app, clave, manejador)` de `plugins/routes.ts` registra una ruta del contrato. El
  manejador recibe `params`, `query` y `body` ya validados con los esquemas del contrato y debe
  devolver exactamente `RouteReply<clave>`. Las cuatro guardas (bandera de desarrollo, sesion,
  cabecera de idempotencia y avance del jugador) se derivan de las banderas del mapa y no se anaden a
  mano. Sustituir el andamiaje de un modulo es cambiar `defineStubRoute(app, clave)` por
  `defineRoute(app, clave, manejador)`; `src/app.ts` no se toca.
- Todo camino mutante pasa por `withPlayerAdvanced(services, playerId, cuerpo)` de
  `lib/advancePlayer.ts`, que abre una transaccion, bloquea al jugador, aplica los eventos vencidos,
  liquida los devengos, ejecuta el cuerpo, escribe los sobres que el cuerpo declaro con `ctx.emit` y
  vacia el outbox despues del commit. Devuelve `{ result, seq, atGameMs }`, que es exactamente el
  sobre que una respuesta secuenciada tiene que llevar.
- El dinero se mueve unicamente con `charge`, `credit`, `accrue` y `compensate` de `lib/ledger.ts`, y
  las cuatro exigen un `PlayerLock` en la firma, de modo que un cobro sin bloqueo no compila.
  `charge` devuelve `{ ok: false, reason: 'INSUFFICIENT_FUNDS' }` en lugar de lanzar: el modulo
  decide si eso es 402 o un motivo por celda.
- Agendar es `scheduleEvent(tx, outbox, reading, ...)` de `lib/scheduler.ts`, y cancelar es
  `cancelScheduledEvent`. Ninguno encola: registran el efecto en el outbox, que se vacia tras el
  commit. No hay forma de alcanzar la cola desde dentro de una transaccion.
- El efecto de dominio de un evento vencido se escribe en `modules/<modulo>/jobs.ts`, cuyo
  andamiaje ya existe con la firma definitiva y ya esta conectado por `src/handlers.ts`. El evento
  llega ya reclamado con una actualizacion condicional, asi que el manejador no debe volver a
  comprobar el estado.
- La liquidacion forzosa de la seccion 6.6 del plan se registra con `registerSettleSweepHook` de
  `lib/jobs.ts`, sin reabrir `lib/advancePlayer.ts`. Es de W5-C.
- El modelo de lectura del jugador y del reloj esta en `lib/playerView.ts`
  (`buildPlayerDto`, `toClockDto`, `toLedgerEntryDto`, `buildPlayerCounters`). Los siete modulos que
  emiten `PLAYER_UPSERTED` lo comparten; ver el apartado 4.1.
- El anillo de reproduccion y el registro de eventos estan en `lib/events.ts` (`readRing`, `readLog`,
  `appendEvents`). `GET /api/events` y `GET /api/state/snapshot` de W6-B los componen.
- Un modulo no puede importar el cliente generado de Prisma: la zona de ESLint lo impide. Las dos
  traducciones que hacen falta estan en `lib/tx.ts`, `isUniqueViolation` e `isMissingRecord`.

## 2. Decisiones de W3-A que condicionan a las fases siguientes

### 2.1 Los ficheros de `plugins/` son funciones, no plugins de Fastify

`backend/package.json` esta congelado y no declara `fastify-plugin`. Sin el, un plugin registrado con
`app.register` obtiene su propio contexto de encapsulacion y sus decoradores no son visibles para las
rutas, que es una clase de error dificil de diagnosticar. Todos los ficheros de `plugins/` son por
tanto funciones que reciben la instancia raiz y la decoran directamente; los plugins externos
(`@fastify/helmet`, `cors`, `cookie`, `rate-limit`, `swagger`, `swagger-ui`, `websocket`) si se
registran con `app.register`, porque vienen envueltos.

### 2.2 El JWT esta escrito a mano, HS256, sin dependencia

`backend/package.json` no declara ninguna libreria de JWT: ni `@fastify/jwt`, ni `jsonwebtoken`, ni
`jose`. Pedir una habria bloqueado la fase en un fichero congelado. El alcance de `lib/jwt.ts` es
deliberadamente minimo: un solo algoritmo fijado en el codigo, comparacion de firma en tiempo
constante antes de leer el payload, `exp` obligatorio, y ningun `alg` del encabezado usado para
elegir implementacion. Trece pruebas cubren cada forma de rechazo, incluida la de `alg: none`.

Si W7 prefiere una libreria, el cambio es de una linea en `plugins/auth.ts` y el borrado de
`lib/jwt.ts`; el resto del backend no conoce la diferencia. No es una peticion: la implementacion
actual es completa y probada.

### 2.3 El area `system` no es un modulo

`/health`, `/metrics` y las cuatro rutas `POST /api/dev/*` viven en `plugins/systemRoutes.ts`.
Ninguna es dominio: las dos primeras son propiedades del proceso y las cuatro de desarrollo manejan
directamente las piezas de `lib` (el reloj, el aplicador de efectos, el ledger y el barrido). Un
duodecimo directorio en `src/modules/` habria metido infraestructura en la capa que las zonas de
ESLint reservan al dominio, y `docs/ownership.md` enumera once modulos a proposito. `GET /docs` lo
registra `@fastify/swagger-ui`.

### 2.4 El avance del jugador se engancha a los caminos de lectura, no a los secuenciados

La guarda `advancesPlayer` de `plugins/routes.ts` se anade cuando la ruta exige sesion, avanza al
jugador y **no** es `sequenced`. Una ruta secuenciada muta, y por tanto corre dentro de
`withPlayerAdvanced`, que avanza al jugador en la misma transaccion que sus propias escrituras;
avanzar otra vez en un `preHandler` abriria una segunda transaccion, tomaria el bloqueo del jugador
dos veces y no cambiaria nada.

Consecuencia para W4, W5 y W6: **toda ruta `sequenced` tiene que usar `withPlayerAdvanced`**. Es
tambien lo unico que devuelve el `seq` que su respuesta debe llevar, de modo que no usarlo se nota de
inmediato.

`POST /api/auth/login` es la unica ruta con `advancesPlayer: true` y `requiresAuth: false`, y avanza
al jugador en su propio manejador despues de comprobar las credenciales: no hay sesion que avanzar
antes.

### 2.5 El limite de peticiones exime el `upgrade` del WebSocket

El apreton de manos del WebSocket esta en la lista de exentos de `@fastify/rate-limit`, y se
estrangula donde se puede: el ticket que lo autoriza sale de `POST /api/auth/ws-ticket`, que si esta
limitada, es de un solo uso y vive treinta segundos. Contar tambien el `upgrade` limitaria las
reconexiones durante una caida, que es justo cuando un cliente reconecta mas.

Ademas, el generador de clave del limitador tolera la ausencia de socket: `request.ip` resuelve la
direccion a traves de las cabeceras de reenvio y necesita el socket subyacente, que un `upgrade`
inyectado por las pruebas no tiene, y el limitador calcula la clave antes de consultar la lista de
exentos.

### 2.6 Un solo socket por jugador

Una segunda conexion del mismo jugador desplaza a la primera, que se cierra con el codigo 4410
(`SUPERSEDED`). Dos sockets serian ambos correctos, pero el cliente aplicaria cada sobre dos veces en
dos pestanas y la contabilidad del latido tendria que pasar a ser por socket sin que la interfaz lo
pida.

### 2.7 Las suscripciones a chunks se registran y no filtran

`subscribeChunks` y `unsubscribeChunks` se aceptan y se guardan por conexion, y `WsHub.subscribedChunks`
las expone para el renderizador de W4-D. Lo que no se hace es filtrar los sobres `CHUNK_PATCHED` por
esa suscripcion: descartar un sobre de dominio abre un hueco de secuencia y el cliente entra en
resincronizacion, que cuesta mas que el sobre que se ahorraria.

### 2.8 La guarda de tormenta usa la regla de secuencia en lugar de pelearse con ella

Cuando un vaciado del outbox produce mas de diez sobres para un jugador, solo se publica el ultimo,
que es el que lleva la secuencia mas alta. Descartar sobres del canal en vivo es seguro por diseno:
la fila de `game_events` esta escrita, el cliente ve un hueco y reproduce con una sola peticion en
lugar de recibir cientos de sobres. Es lo que hace que un barrido de reconciliacion tras una caida no
inunde a nadie.

### 2.9 El ancla del reloj no se cachea

Se lee la fila de `World` una vez por peticion o por trabajo, y se propaga como contexto. Un ancla
cacheada da un instante de juego erroneo tras un re-anclaje, y «erroneo» aqui significa o un evento
que dispara antes de tiempo o un reloj que parece rebobinar. La lectura es un `SELECT` por clave
primaria. Lo que si se cachea es el identificador del mundo, que es inmutable para una semilla.

### 2.10 El arnes de integracion crea su propio mundo

`src/__tests__/harness.ts` no usa contenedores ni crea esquemas: crea una fila de `World` con una
semilla negativa aleatoria, su propio prefijo de claves de Redis y su propio prefijo de BullMQ, y en
el desmontaje borra exactamente lo que creo. Asi dos agentes pueden ejecutar sus suites a la vez
sobre la misma pila, que es lo que pide la seccion 10 del plan, y ninguno toca los datos de
desarrollo. El reloj real se inyecta y lo mueve la prueba, de modo que una ventana de seis horas de
juego son seis horas exactas.

Consecuencia util para W7: el trabajo `integration` de la integracion continua no necesita
`make seed`, porque la suite no depende del mundo sembrado. Si necesita `make migrate`, que ya
ejecuta.

## 3. Material para las entradas de ADR 0015-0020

Redactado para que el agente de cierre de la fase lo incorpore. El reparto es el que fija el apartado
3.3 de `docs/ownership.md`.

### 0015 Autenticacion JWT con refresh rotativo y ticket para WebSocket

Decision: token de acceso HS256 de quince minutos en el cuerpo de la respuesta, que el cliente
guarda solo en memoria; refresh opaco de 256 bits en cookie `httpOnly` con rotacion en cada uso y
deteccion de reutilizacion; ticket de un solo uso de treinta segundos en Redis para el WebSocket.

Motivos: el token de acceso es sin estado a proposito, porque verificarlo cuesta un HMAC y ninguna
consulta, que es lo que permite que lo lleve cada peticion; el refresh tiene fila a proposito, porque
rotacion y revocacion son exactamente lo que un token autocontenido no puede hacer. La cadena
`replacedByTokenId` hace detectable el robo: un token ya revocado que tiene sucesor se ha usado dos
veces, y eso revoca toda la familia activa del jugador. El ticket existe porque un navegador no puede
fijar cabeceras en el apreton de manos y un token en la cadena de consulta acaba en los registros de
todos los proxies del camino.

Consecuencia registrada: el JWT esta implementado a mano con `node:crypto` porque
`backend/package.json` esta congelado y no declara ninguna libreria de JWT (apartado 2.2).

### 0016 Outbox en PostgreSQL con Redis como despertador, y horizonte de agendado

Decision: `ScheduledEvent` es la lista autoritativa; Redis solo tiene despertadores para lo que vence
dentro de una ventana real configurable de 24 horas. La fila se inserta dentro de la transaccion de
dominio y el despertador se crea despues del commit. `sim.reconcile` encola en orden todo lo vencido
al arrancar y cada minuto.

Motivo estructural, que es lo que conviene registrar: el orden correcto no se sostiene con disciplina
seis flujos de trabajo mas, asi que se impone con la forma. El cuerpo de una transaccion recibe un
`Outbox` que solo registra intencion, y `withTransaction` lo vacia cuando el commit ha vuelto; el
codigo que sabe alcanzar la cola no se le pasa. Encolar dentro de la transaccion produce un trabajo
que corre contra una fila no comprometida, y publicar dentro de ella convierte al cliente en autoridad
durante unos milisegundos.

Detalle que costo una prueba: la deduplicacion es `INSERT ... ON CONFLICT DO NOTHING` sobre el indice
unico parcial, y no una insercion con la violacion capturada despues. En PostgreSQL un statement que
falla aborta la transaccion entera, de modo que capturar la violacion deja una transaccion en la que
ya no se puede leer nada. El predicado del indice hay que repetirlo completo en el destino del
conflicto (`status = 'PENDING' AND "dedupeKey" IS NOT NULL`), o PostgreSQL responde 42P10.

### 0017 Punto unico de avance del jugador y orden canonico de bloqueos

Decision: todo efecto de simulacion se aplica en `advancePlayer`, que bloquea la fila del jugador,
procesa los eventos vencidos en orden liquidando devengos antes de cada uno, liquida hasta el
instante final y aplica la politica de deuda. Tres llamantes y ningun cuarto: el manejador de la cola,
el envoltorio `withPlayerAdvanced` de todo endpoint mutante y el login. Orden de bloqueos: mundo,
jugador, dominio por identificador ascendente.

Motivos: liquidar antes de cada evento cobra cada intervalo a las tasas que estuvieron en vigor
durante el, porque un evento vencido cambia las tasas (una tarea que termina deja de devengar coste de
operacion). La consecuencia que da forma al sistema es que si el worker esta caido, la primera
peticion del jugador repara su mundo: BullMQ es requisito de puntualidad, no de correccion.

### 0018 Restricciones duras por contador con CHECK y por actualizacion condicional

Decision, en la parte que implementa esta fase: el cobro es una actualizacion condicional cuyo
recuento de filas es la decision, no una lectura seguida de una escritura; el avance de
`lastAccrualGameMs` es monotono y condicional; y la puerta de transicion de cada evento es un
`UPDATE ... WHERE status='PENDING'` cuyo recuento decide si el manejador corre.

Motivo: bajo READ COMMITTED dos transacciones concurrentes leen el mismo saldo, y solo la
actualizacion condicional las obliga a escribir la misma fila y reevaluar la condicion contra el valor
ya comprometido. Las tres defensas de la seccion 6.3 del plan son independientes: la marca monotona,
la clave de idempotencia unica y la puerta de transicion. La prueba de integracion las ejercita por
separado.

### 0019 Sincronizacion del cliente por secuencia con reproduccion e instantanea

Decision: la secuencia se asigna en `lib/events.ts`, incrementando la fila del jugador dentro de la
transaccion de dominio y bajo su bloqueo, lo que la hace sin huecos: un cambio comprometido tiene
siempre su sobre y un cambio revertido no lo tiene nunca. Dos capas de almacenamiento con papeles
distintos: `game_events` en PostgreSQL, autoritativa y de solo insercion, y una lista acotada en Redis
como camino rapido de la misma reproduccion, escrita despues del commit.

Consecuencia que conviene registrar: como descartar un sobre del canal en vivo es seguro, la guarda de
tormenta puede colapsar un lote grande en su ultimo sobre y dejar que el cliente reproduzca una vez
(apartado 2.8). `HELLO` lleva la secuencia actual y la mas antigua que el anillo conserva, de modo que
reconexion y hueco comparten camino.

### 0020 Arte generado por codigo y paleta unica compartida con CSS

No corresponde a este agente: es de W3-D. Se deja constancia de que W3-A no aporta material.

## 4. Discrepancias detectadas

### 4.1 El brief pide un modulo `player` y una ruta que el contrato no declara

El brief de este agente asigna `backend/src/modules/player/**` y `GET /api/player/state`. Esa ruta no
existe: `shared/api/routes.ts` no declara area `player`, `docs/ownership.md` enumera once modulos y
ninguno es `player`, y `eslint.config.js` declara las once zonas sin esa. Las dos rutas que devuelven
ese modelo de lectura son `GET /api/auth/me`, del area `auth`, y `GET /api/state/snapshot`, del area
`state`, que pertenece al modulo `session` de W6-B.

Resolucion: el modelo de lectura vive en `lib/playerView.ts` y no en un modulo. No es una preferencia:
lo necesitan `auth` (W3-A), `session` (W6-B) y los cinco modulos que emiten `PLAYER_UPSERTED` al mover
dinero (`land`, `farms`, `machinery`, `economy` y las rutas de desarrollo), y la regla 4 de la seccion
11 del plan prohibe que dos modulos hermanos se importen. Un modelo de lectura compartido por siete
modulos de cuatro flujos de trabajo solo puede estar en `lib`; ponerlo en un modulo obligaria a
duplicarlo o a violar la regla. No se ha creado `modules/player/`, que habria quedado como un
directorio sin ruta que registrar y sin consumidor posible.

### 4.2 `ApiTransportCode` no tiene un codigo para «la primera peticion sigue en vuelo»

La guarda de idempotencia distingue tres casos, y el contrato solo nombra dos. Misma clave y mismo
cuerpo con la primera peticion ya terminada es reproduccion de la respuesta almacenada; misma clave y
cuerpo distinto es `IDEMPOTENCY_KEY_REUSED`; misma clave y mismo cuerpo con la primera peticion
todavia en vuelo no tiene codigo propio.

Resolucion adoptada: se responde `SERVICE_UNAVAILABLE` (503), que es lo que el caso significa
operativamente («todavia no, reintenta») y lo unico que no miente: `IDEMPOTENCY_KEY_REUSED` diria que
el cliente se equivoco, y reproducir una respuesta que aun no existe es imposible. Si se considera que
merece codigo propio, seria una adicion a `ApiTransportCode` y una fila en su tabla de estados HTTP,
en un fichero congelado.

### 4.3 Una respuesta 501 borra el registro de idempotencia

La regla implementada es: una respuesta de 500 o mas no se almacena y su registro se borra, para que un
fallo transitorio siga siendo reintentable. Un 501 de un andamiaje entra en esa regla, de modo que hoy
una ruta que mueve dinero y todavia no esta implementada no reproduce nada. Es deliberado y esta
probado (`src/__tests__/idempotency.int.test.ts`): cuando el modulo aterrice, el reintento no debe
encontrarse un 501 almacenado. Los agentes de W4 y W5 no tienen que hacer nada; se documenta porque la
regla es visible en las pruebas.

### 4.4 Cinco tipos de evento agendado quedan con un manejador de andamiaje

`src/handlers.ts` conecta los seis `ScheduledEventKind`. Cinco apuntan a
`modules/<modulo>/jobs.ts`, cuyo cuerpo es un andamiaje que no aplica efecto alguno y lo hace constar
en el registro y en la metrica `farm_world_scheduled_events_unhandled_total`. La alternativa,
que el andamiaje fallara, convertiria cada vencimiento en un reintento indefinido de BullMQ, porque el
evento ya quedo marcado como procesado por el punto de avance. Esa metrica debe quedar plana en cero
cuando W6 cierre; mientras no lo este, nombra el modulo que falta.

### 4.5 `.github/workflows/ci.yml` mantiene `CORS_ORIGIN: http://localhost:3001`

Ya anotado por `NOTES-w2-5-parcheo` 2.3. Se confirma que sigue desfasado (el puerto es 3100) y que no
afecta a las pruebas de integracion, que no usan navegador. Sin cambio por W3-A.

### 4.6 La opcion `disableRequestLogging` esta obsoleta en Fastify 5.11

`app.ts` no la usa: Fastify 5.11.3 avisa de que se elimina en la mayor 6 y hay que usar
`logController`. Se deja constancia porque el andamiaje de W1 en `server.ts` la llevaba y ya no.

## 5. Verificacion ejecutada

| Orden | Resultado |
|---|---|
| `make sync-types` | 53 ficheros a cada copia |
| `cd backend && npx tsc --noEmit` | Sin salida |
| `cd backend && npx vitest run` | 3 ficheros, 37 pruebas en verde |
| `cd backend && npx vitest run --config vitest.int.config.ts` | 8 ficheros, 87 pruebas en verde |
| `npx eslint backend/src` | Sin hallazgos, incluidas las reglas de zona |
| `npx prettier --check "backend/src/**/*.ts"` | Conforme |
| `npx tsx src/server.ts` mas `curl /health`, `/metrics`, `/docs` | 55 rutas registradas, 7 manejadores de trabajo, `status: ok` con las tres dependencias arriba, formato de exposicion de Prometheus, viewer de OpenAPI con 48 operaciones |
| `npx tsx src/worker.ts` mas `curl :9464/health` y `:9464/metrics` | Consume la cola con los siete nombres, barrido al arrancar, 94 series propias, 404 en cualquier otra ruta |

No ejecutado, conforme al brief: `git`, `npm install`, `prisma generate`, `prisma migrate`,
`docker compose up/down` ni compilaciones de produccion.

Estado en que queda la base de datos de desarrollo: como la dejo la ventana de parcheo. Un mundo
(semilla 20260811, tasa 12/1, epoch 0), el jugador `dev@farm-world.local` y cero eventos pendientes.
Los mundos de las pruebas de integracion los borra el desmontaje del arnes, y el jugador que se creo a
mano para la comprobacion con `curl` se borro al terminar.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 1.2 `METRICS_PORT` no figura en `.env.example`

Aplicado por W7-A (integracion). `.env.example` declara `METRICS_PORT=9464` con el motivo por el que
existe, y la variable se movio de `CONTAINER_ENV_VARS` a `SERVICE_ENV_VARS` en `plugins/config.ts`, que es
donde corresponde a una variable que el proceso lee. La prueba `plugins/__tests__/config.test.ts` afirma
ahora la direccion del movimiento en lugar de la asimetria.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `.env.example`
Propietario del cambio: W7-A

`docker-compose.yml` inyecta `METRICS_PORT=9464` al servicio `worker` y
`infra/prometheus/prometheus.yml` raspa `worker:9464/metrics`, pero la plantilla no declara la
variable. La prueba `src/plugins/__tests__/config.test.ts` comprueba precisamente esa asimetria y
deja constancia de ella: `CONTAINER_ENV_VARS` enumera las tres variables que inyectan los ficheros
de Compose y que la plantilla no lleva (`NODE_ENV`, `HOST`, `METRICS_PORT`).

Mitigacion adoptada: `plugins/config.ts` la declara con valor por omision 9464, que es el mismo que
inyecta Compose, de modo que el worker abre su escuchador en el puerto correcto sin la variable.
Documentarla en la plantilla es claridad, no correccion; si se anade, hay que anadirla tambien a
`CONTAINER_ENV_VARS` o moverla a `SERVICE_ENV_VARS`, o la prueba falla, que es el comportamiento
buscado.

### 1.1 Politica de reinicio del servicio `worker`

Aplicado por W7-A (integracion): `restart: unless-stopped`.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `docker-compose.yml`, servicio `worker`
Propietario del cambio: W7-A

`restart: "no"` existia porque el punto de entrada de W1 registraba una linea y terminaba
(`NOTES-W1` nota 4, reiterada en `NOTES-w2-5-parcheo` 2.5). Ya no es el caso: `backend/src/worker.ts`
es un consumidor de larga vida de la cola de dominio, con barrido de reconciliacion al arrancar y
cada minuto, y con apagado ordenado ante SIGTERM. La linea debe volver a `unless-stopped`, y lleva su
comentario en el propio fichero de Compose.

Mitigacion adoptada mientras tanto: ninguna necesaria. El proceso funciona; lo unico que falta es que
Compose lo reinicie si muere.
