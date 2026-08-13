# NOTES-w3-cierre

Agente de cierre documental. Fase W3. Ambito escrito: `docs/adr.md`, `docs/erratas-gdd-stack.md`,
`docs/ownership.md`, `README.md` de la raiz y este fichero.

Este fichero recoge lo que la verificacion de cierre detecto y que cae fuera del ambito documental, con
su categoria, su fichero, su motivo y su propietario. Las notas de los agentes de la fase estan en
`NOTES-w3a.md`, `NOTES-w3c.md` y `NOTES-w3d.md` y siguen vigentes; no se repiten aqui salvo cuando la
verificacion las confirmo con una salida concreta.

El flujo de trabajo W3 se interrumpio antes de ejecutar este cierre, por una parada solicitada por el
usuario. Los cuatro agentes de implementacion habian terminado; el unico efecto de la parada sobre el
arbol es que el agente del modulo de mundo, W3-B, no llego a escribir su fichero de traspaso.

## Pendiente

### 3. W3-B no dejo fichero de traspaso

Categoria: traspaso ausente
Ficheros afectados: `docs/handoff/NOTES-w3b.md`, que no existe
Propietario: sin propietario; el agente termino antes de la parada de la fase
Motivo: el codigo del modulo de mundo cita `docs/handoff/NOTES-w3b.md` en cinco puntos
(`generator.ts` dos veces, `cellRepo.ts`, `service.ts` y `spawn.ts`) para remitir a decisiones y
desviaciones que ese fichero deberia recoger.

Mitigacion adoptada: las decisiones del modulo estan documentadas en ADR-0021, redactado leyendo el
codigo, y sus dos pendientes reales son los apartados 2 de este fichero y 4.4 de `docs/ownership.md`. No
se ha creado un `NOTES-w3b.md` en nombre de otro agente: seria un fichero de traspaso escrito por quien
no hizo el trabajo. Las cinco citas del codigo quedan como referencias colgantes; corregirlas seria
tocar codigo, y lo mas barato es que W7-A las redirija a ADR-0021 si algun dia abre esos ficheros.

### 7. El contrato no tiene trama de acuse para el latido

Categoria: cambio en fichero congelado
Ficheros afectados: `shared/ws/envelope.ts` o, sin tocarlo, `backend/src/plugins/ws.ts`
Propietario del cambio: W7-A
Motivo: el cliente declara el mensaje `ping` y la union de tramas del servidor no tiene ninguna etiqueta
de acuse. El cliente lo resolvio midiendo trafico entrante de cualquier tipo, y el servidor simulado
responde a un `ping` con una trama `CLOCK`. El backend real todavia no responde nada. Confirmado de
`NOTES-w3c` 3.1.

Mitigacion adoptada: el latido del cliente no depende de la respuesta, de modo que la conexion no se
corta hoy por esto. Lo barato es que el backend responda `CLOCK`, que ya esta en la union y no consume
numero de secuencia; anadir una etiqueta `PONG` seria un cambio en `shared/ws/`.

### 9. Documentacion de otros ambitos que quedo desfasada

Categoria: cambio en fichero de otro propietario
Propietario del cambio: W7-A

| Fichero | Que dice | Que es cierto |
|---|---|---|
| `shared/api/README.md`, apartado 8 | Que los fixtures de partida del servidor simulado estan en `shared/api/__tests__/fixtures.ts` | El script de sincronizacion excluye `__tests__/` a cualquier profundidad, de modo que no llegan al cliente. `frontend/app/mock/world.ts` construye los suyos desde los catalogos (`NOTES-w3c` 3.4) |
| `docs/handoff/README.md`, apartado 4 | Enumera el estado de las notas hasta W2.5 | Faltan las cuatro de W3. El fichero esta congelado desde W1 y este agente no lo ha tocado |

### 10. Consecuencia de la numeracion de ADR para W4

Categoria: coordinacion entre fases
Ficheros afectados: `docs/adr.md`, `docs/ownership.md` apartado 3.3
Propietario: W4-A

La fase W3 escribio ocho entradas y no las seis que preveia la seccion 11 del plan: las seis del reparto
(0015 a 0020) mas ADR-0021, sobre el modulo de mundo, y ADR-0022, sobre el servidor simulado del cliente
como transporte del contrato. Los tramos restantes se desplazan dos numeros y el apartado 3.3 de
`docs/ownership.md` ya recoge la numeracion real: W4-A escribe 0023-0026, W5-A 0027-0030, W6-A 0031-0034
y W7-D 0035-0036. Los temas del plan no cambian; cambia el numero de cada tema. `scripts/adr-append.mjs`
rechaza cualquier numero que no sea el siguiente de la serie, de modo que el error se detecta al
intentarlo.

## Verificado en el cierre

Salidas reales, ejecutadas desde la raiz del repositorio, con `postgres` y `redis` levantados por Compose
en los puertos 55432 y 56379:

| Orden | Resultado |
|---|---|
| `make sync-types` | exit 0. 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `make typecheck` | exit 0. `tsc` en `shared` y en `backend` sin salida; `vue-tsc --build --force` del cliente en verde tras generar los tipos de Nuxt |
| `make lint` | exit 0. `npx eslint .` sin hallazgos, incluidas las reglas de zona; `npx prettier --check .` responde "All matched files use Prettier code style!" |
| `make test-unit` | exit 0. `shared`: 23 ficheros y 418 pruebas en 3,56 s. Cliente: 9 ficheros y 93 pruebas en 3,77 s |
| `make test-int` | exit 2. 11 ficheros y 121 pruebas: 120 en verde y 1 en rojo, la del apartado 1 de este fichero |

No ejecutado, conforme al brief: `git` salvo `git ls-files`, `npm install`, `prisma generate`,
`prisma migrate`, `docker compose` y construcciones de imagenes. `make typecheck`, `make lint`,
`make test-unit` y `make test-int` ejecutan `sync-types` como prerrequisito, de modo que las dos copias de
`shared/` quedaron actualizadas; ambas estan en `.gitignore` y no son ficheros de otro agente.

La comprobacion de propiedad se hizo con `git ls-files`: 329 rutas versionadas en el momento de la
comprobacion, todas atribuidas en el apartado 3 de `docs/ownership.md`. Este fichero de traspaso es la
330.

## Resuelto

(nada todavia: ninguna nota de este fichero se ha aplicado)

### 8. Cinco tipos de evento agendado siguen con manejador de andamiaje

Resuelto por W4, W5 y W6, cada uno el manejador de su modulo. Los seis tipos de `ScheduledEventKind`
apuntan a un manejador real en `src/handlers.ts`, y la suite de silvicultura afirma que
`farm_world_scheduled_events_unhandled_total` no tiene ninguna serie.

El texto original de la nota:

Categoria: trabajo pendiente de fases posteriores
Ficheros afectados: `backend/src/modules/{fields,machinery,workers,tasks,forestry}/jobs.ts`
Propietario del cambio: los agentes de W4, W5 y W6, cada uno el de su modulo
Motivo: `src/handlers.ts` conecta los seis tipos y cinco apuntan a un andamiaje que no aplica efecto
alguno y lo hace constar en el registro y en la metrica
`farm_world_scheduled_events_unhandled_total`. Esa metrica debe quedar plana en cero cuando W6 cierre.

Mitigacion adoptada: el andamiaje no falla a proposito. Fallar convertiria cada vencimiento en un
reintento indefinido de BullMQ, porque el punto de avance ya marco el evento como procesado.

### 6. Puertos del cliente en dos ficheros congelados

Aplicado por W7-A (integracion). `frontend/nuxt.config.ts` declara
`port: Number(process.env.FRONTEND_DEV_PORT ?? 3100)` y la integracion continua declara `CORS_ORIGIN` con
el puerto publicado.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/nuxt.config.ts`, `.github/workflows/ci.yml`
Propietario del cambio: W7-A
Motivo: `devServer.port` vale 3001 y `CORS_ORIGIN` de la integracion continua tambien, cuando el puerto
publicado del cliente es `FRONTEND_DEV_PORT`, 3100, desde la ventana de parcheo W2.5. En esta maquina
3001 esta ocupado por otro proyecto. Confirmado de `NOTES-w3d` 1, `NOTES-w3c` 3.7 y
`NOTES-w2-5-parcheo` 2.3.

Mitigacion adoptada: `--port` de la linea de ordenes prevalece sobre la configuracion, y ningun fichero
del cliente codifica un puerto. La forma natural de alinearlo es
`port: Number(process.env.FRONTEND_DEV_PORT ?? 3100)`.

### 5. `METRICS_PORT` no figura en `.env.example`

Aplicado por W7-A (integracion).

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `.env.example`
Propietario del cambio: W7-A
Motivo: `docker-compose.yml` inyecta `METRICS_PORT=9464` al worker y `infra/prometheus/prometheus.yml`
raspa `worker:9464/metrics`, pero la plantilla no declara la variable. Confirmado de `NOTES-w3a` 1.2.

Mitigacion adoptada: `plugins/config.ts` la declara con el mismo valor por omision. Si se anade a la
plantilla, hay que anadirla tambien a `CONTAINER_ENV_VARS` de `plugins/__tests__/config.test.ts` o
moverla a `SERVICE_ENV_VARS`, o la prueba falla, que es el comportamiento buscado.

### 4. Politica de reinicio del servicio `worker`

Aplicado por W7-A (integracion).

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `docker-compose.yml`, servicio `worker`
Propietario del cambio: W7-A
Motivo: sigue en `restart: "no"`, politica que existia mientras el punto de entrada de W1 registraba una
linea y terminaba. `backend/src/worker.ts` es ya un consumidor de larga vida con barrido de
reconciliacion al arrancar y cada minuto y con apagado ordenado ante SIGTERM. Confirmado de
`NOTES-w3a` 1.1 y `NOTES-w2-5-parcheo` 2.5.

Mitigacion adoptada: ninguna necesaria. El proceso funciona; lo unico que falta es que Compose lo
reinicie si muere.

### 2. Las zonas de ESLint impiden que los modulos de W4 consuman el modulo de mundo

Resuelto en la ventana de parcheo previa a W4, con la primera de las dos opciones ampliada:
`eslint.config.js` agrupa los modulos por la fase que los escribe (`BACKEND_MODULE_PHASES`) y cada zona
admite el propio modulo y los de fases estrictamente anteriores. La prohibicion queda entre hermanos de la
misma fase, que es la letra de la regla 4 del plan.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `eslint.config.js`, apartado `siblingModuleZones`
Propietario del cambio: W7-A, antes de que W4 empiece
Motivo: la regla 4 de la seccion 11 del plan prohibe importaciones entre modulos hermanos "de la misma
fase" y la zona implementada las prohibe entre cualesquiera modulos hermanos del backend. El brief de
W3-B pide explicitamente que `modules/land`, `modules/farms`, `modules/fields` y `modules/forestry`
consuman `modules/world/service.ts`, que es la API interna de la rejilla, y tal como esta la regla no lo
permite. El propio fichero lo declara como desviacion conocida en su cabecera.

Resolucion posible, y hay que elegir una: un `except: ['./world']` en la zona, que es el cambio minimo, o
mover `modules/world/service.ts` a `lib/`, que es lo que W3-A tuvo que hacer con `lib/playerView.ts` por
la misma razon. La primera conserva la cohesion del modulo; la segunda es coherente con el precedente ya
sentado.

Mitigacion adoptada mientras tanto: ninguna necesaria dentro de W3, porque ningun modulo de esta fase lo
consume. Consecuencia visible: `modules/auth/service.ts` invoca directamente el asignador puro
`assignSpawn` en lugar de `assignAndPersistSpawn`, con el mismo indice y por tanto con el mismo origen;
lo unico que pierde es la comprobacion contra los origenes ya persistidos. Es un bloqueo real para W4-A y
hay que resolverlo antes, no despues.

### 1. `make test-int` termina con una prueba en rojo

Resuelto antes de W7, en la ventana de parcheo previa a W4 y despues por ADR-0038: `app.int.test.ts`
deriva los andamiajes de `stubRouteKeys()` del propio registro en lugar de enumerarlos. Sin rutas de
andamiaje, la suite no genera ningun caso de 501.

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Ficheros afectados: `backend/src/__tests__/app.int.test.ts`
Propietario del cambio: W3-A (cerrado), a aplicar por W7-A
Motivo: la constante `IMPLEMENTED` del fichero enumera las trece rutas que W3-A implemento y no incluye
las dos del area `world`, que W3-B implemento en la misma fase. La prueba generada para
`GET /api/world/info` afirma 501 y recibe 200. `POST /api/world/chunks` no falla solo porque el cuerpo
vacio de la prueba no satisface el esquema y entra por la rama de 400, que la propia prueba admite.

Salida real:

```text
FAIL  src/__tests__/app.int.test.ts > las rutas todavia no implementadas >
      GET /api/world/info responde 501 con NOT_IMPLEMENTED
AssertionError: expected 200 to be 501
Test Files  1 failed | 10 passed (11)
Tests  1 failed | 120 passed (121)
```

Cambio a aplicar, dos lineas y su comentario: anadir `'GET /api/world/info'` y
`'POST /api/world/chunks'` a `IMPLEMENTED`, y cambiar la afirmacion `expect(stubs.length).toBe(42)` a
40, junto con el comentario que dice "cuarenta y dos de las cincuenta y cinco".

Mitigacion adoptada mientras tanto: ninguna posible desde el ambito documental. El fallo es visible y
explicito y no oculta ningun defecto del servicio: las 120 pruebas restantes, incluidas las tres suites
del modulo de mundo, estan en verde.
