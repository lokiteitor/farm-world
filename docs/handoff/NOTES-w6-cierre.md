# NOTES-w6-cierre

Agente de cierre documental de W6, la fase que implemento el motor de tareas, la sesion con instantanea
y resumen de regreso, la silvicultura completa, la costura del cliente de esas tres materias y el tercer
y ultimo grupo de paneles.

Ambito escrito: `docs/adr.md` (entradas 0049 a 0055), `docs/erratas-gdd-stack.md`, `docs/ownership.md`,
`README.md` de la raiz y este fichero. No se ha tocado codigo. `docs/balance/` se ha regenerado al
ejecutar `make balance`, que es una ruta generada y no una escritura.

Las cinco notas de los agentes de la fase siguen vigentes y no se repiten aqui salvo cuando la
verificacion de cierre las confirmo o las corrigio con una salida concreta.

## 1. Verificado en el cierre

Salidas reales, ejecutadas desde la raiz del repositorio, con PostgreSQL en 55432 y Redis en 56379.

| Orden | Codigo | Resultado |
|---|---|---|
| `make sync-types` | 0 | 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `make typecheck` | 0 | `tsc` en `shared` y en `backend` sin salida; `vue-tsc --build --force` del cliente en verde |
| `make lint` | 0 | `npx eslint .` sin hallazgos, incluidas las reglas de zona; Prettier responde "All matched files use Prettier code style!" |
| `make test-unit` | 0 | `shared`: 23 ficheros y 418 pruebas. Cliente: 60 ficheros y 646 pruebas. Todas en verde |
| `make test-int` | 0 | 32 ficheros y 254 pruebas, todas en verde |
| `make balance` | 0 | Informe y `kpis.json` regenerados. Ratio 0,0963, equilibrio inexistente |

Es el primer cierre de fase en el que las seis puertas devuelven 0 a la vez. `make test-int` arrastraba
una prueba en rojo desde W5 y la cerro la ventana de integracion previa a esta fase.

Comprobaciones adicionales de este cierre:

- Suite unitaria del backend, que ninguna puerta ejecuta:
  `npx vitest run --config vitest.config.ts` en `backend/` devuelve 6 ficheros y 82 pruebas, todas en
  verde. Eran 5 y 67 al cierre de W5; las 15 nuevas son `__tests__/forestry/generator.test.ts`.
- Rutas que siguen respondiendo 501: **ninguna**. `npx vitest run --config vitest.int.config.ts
  src/__tests__/app.int.test.ts --reporter=verbose` devuelve ocho pruebas y ninguna de ellas es un caso
  "responde 501 con NOT_IMPLEMENTED", porque esos casos se derivan de `stubRouteKeys()` (ADR-0038) y esa
  lista esta vacia. Ningun modulo llama ya a `defineStubRoute`, comprobado con `grep` sobre
  `backend/src/modules/`.
- Paneles que siguen siendo andamiaje: **ninguno**. `grep -rl UiPendingPanel
  frontend/app/components/panels/` no devuelve ningun fichero. Son veintitres paneles en veintitres
  directorios, mas `registry.ts`, `shared/` y `__tests__/`.
- `/metrics` con el servidor arrancado. Servidor levantado en el puerto 3011 con `npx tsx src/server.ts`
  y apagado al terminar (`health=000`, sin proceso). Salida literal tras procesar doce eventos vencidos:

```
# HELP farm_world_scheduled_events_due_total Eventos agendados vencidos y aplicados.
# TYPE farm_world_scheduled_events_due_total counter
farm_world_scheduled_events_due_total{kind="PLAYER_SETTLE_SWEEP",service="server"} 4
farm_world_scheduled_events_due_total{kind="TASK_COMPLETE",service="server"} 2
farm_world_scheduled_events_due_total{kind="FOREST_NOTIFY_MILESTONE",service="server"} 6

# HELP farm_world_scheduled_events_unhandled_total Eventos vencidos cuyo tipo no tiene manejador registrado.
# TYPE farm_world_scheduled_events_unhandled_total counter
```

`farm_world_scheduled_events_unhandled_total` queda declarada y sin ninguna serie, que es la forma en que
`prom-client` expresa un contador etiquetado que nunca se incremento: plana en cero y no cero declarado.
La comprobacion es significativa y no vacia porque el contador de vencidos si tiene series, y entre ellas
las de los dos tipos que esta fase entrego. Para provocarlas se llamo a `POST /api/dev/reconcile`, que
encolo 21 eventos de 27 pendientes, y despues a `POST /api/dev/advance-player` sobre cinco de los
jugadores de verificacion abandonados que el apartado 2.8 de `NOTES-w5-cierre.md` ya recogia.

La comprobacion de propiedad se hizo con `find` y con las marcas de tiempo del sistema de ficheros, no con
`git`, que la regla 5 prohibe: 548 ficheros, todos atribuidos en el apartado 3 de `docs/ownership.md`.
Ningun fichero de esta fase tuvo dos escritores; el razonamiento completo, con los cuatro candidatos
posibles, esta en el apartado 4.8 de ese documento.

No ejecutado, conforme al brief: `git`, `npm install`, `prisma generate`, `prisma migrate`,
`docker compose` y construcciones de produccion. No se levanto Nuxt en este cierre.

## 2. Lo que las notas de la fase daban por abierto y ya no lo esta

### 2.1 El rojo de `make test-int`

`NOTES-w5-cierre.md` 2.1 y la fila 36 del apartado 5 de las erratas quedan cerradas. La ventana de
integracion previa a esta fase reescribio `backend/src/__tests__/idempotency.int.test.ts`, y no con el
parche que `NOTES-w5a.md` 2.1 proponia —enviar un `farmId` invalido para provocar un 500 via P2023— sino
de otra forma que conviene registrar porque generaliza la leccion de ADR-0038: la prueba ejercita
`completeIdempotency` directamente, con un registro de idempotencia creado a mano y una respuesta 503. La
invariante que defiende, que un 5xx no se almacena, es del guardian y no de ninguna ruta, y probarla
contra una ruta la ataba a que esa ruta siguiera sin implementar.

### 2.2 El tiempo de espera del registro de paneles

`NOTES-w6t.md` 1.4 y la fila 42 de las erratas lo dan por abierto y no lo esta. La ventana de integracion
intermedia de W6 —marca de tiempo 17:55 del 12 de agosto, entre los agentes de backend y el de paneles—
aplico `MOUNT_ALL_TIMEOUT_MS = 30_000` a las dos pruebas que montan los veintitres paneles, con el motivo
escrito en la cabecera del fichero. La informacion de la nota esta desactualizada, no equivocada: ese
agente no volvio a leer un fichero que no era suyo.

### 2.3 La capa de entidades y los contadores de plaza

Filas 43 y 47 del apartado 5 de las erratas, cerradas por el agente de costura y registradas en ADR-0054.
Las dos tenian el mismo tipo de defecto —una premisa razonable sobre el orden de llegada que resulta ser
falsa en ejecucion real— y las dos solo eran visibles en el navegador.

## 3. Pendiente fuera del ambito documental

Estado tras la ventana de integracion W7-A: todo lo que este apartado enumera esta aplicado o tiene su
motivo escrito para no aplicarse. El detalle punto por punto esta en el apartado 5 de este mismo
fichero, y el inventario completo en `docs/handoff/INTEGRACION.md`. El apartado se conserva como estaba
porque otros documentos lo citan por numero.

Todo lo que sigue esta detallado, con su fichero y su parche, en el apartado 5 de
`docs/erratas-gdd-stack.md`, filas 54 a 67, y en las cinco notas de la fase. Aqui va solo lo que un
agente de W7 necesita saber antes de abrir nada.

### 3.1 Lo que hay que aplicar sobre ficheros congelados, por orden de riesgo

1. `backend/src/handlers.ts` y `backend/src/worker.ts`: dos enganches sin registrar en el proceso de la
   cola, la liquidacion forzosa (`NOTES-w5c.md` 2.1) y la contribucion forestal a `TASK_COMPLETE`
   (`NOTES-w6c.md` 2.1). Ninguno pierde correccion; los dos pierden puntualidad.
2. `backend/src/modules/economy/liquidation.ts`: nombrar `cancelTasksForLiquidation` en el `STEP_PLAN` y
   anadir `'TASK'` a la union local `LiquidatedAsset['assetKind']` (`NOTES-w6a.md` 2.1). Es el unico de
   los tres pasos sin estrategia que ya tiene su implementacion escrita y probada.
3. La costura de la cancelacion forestal, que exige elegir entre una linea en `eslint.config.js` y un
   registro de estrategias en `lib/` (`NOTES-w6c.md` 2.2). Es la unica decision de arquitectura que W7
   tiene que tomar de esta lista, y por eso conviene tomarla pronto.
4. Cuatro ampliaciones de `shared/`, todas aditivas y ninguna con ruptura: los filtros de
   `ledgerQuerySchema`, `FARM_UPSERTED` en el `emits` de seis rutas, `detail` en
   `welcomeBackLiquidationSchema` y las celdas vacias de la parcela o el arbolado en la instantanea.
5. Una linea en el `Makefile` para que `make test-unit` recorra el backend, hoy 82 pruebas fuera de toda
   puerta.
6. `frontend/nuxt.config.ts`, `.env.example` y `docker-compose.yml`: el puerto de desarrollo, `METRICS_PORT`
   y `restart` del servicio `worker`. Es la quinta tanda de verificacion que necesita `--port 3111`.

### 3.2 Lo que no es un fichero congelado y sigue abierto

- `frontend/app/mock/handlers.ts` linea 530: `welcomeBackPending` literal, que impide ejercitar el
  resumen de regreso contra el servidor simulado.
- `frontend/app/components/panels/cell-inspector/worldAccess.ts`: el sujeto de un modo de seleccion no
  sale del panel, de modo que el arrastre de una tala se pinta con el veredicto de un desmonte.
- `frontend/app/game/entities/EntityLayer.ts`: rama diferida del constructor, hoy inalcanzable.
- `backend/src/modules/world/cellRepo.ts` y `service.ts`: `hasStandingTree` no cuenta el arbol marcado.
- El inspector de edificio sigue mostrando el identificador del enumerado, y `starting-guide` sigue sin
  entrada propia en su pestana.
- La base de datos de desarrollo acumula mundos y jugadores de verificacion de W3, W5 y W6. Este cierre
  anadio ademas escrituras sobre cinco de esos jugadores al forzar su avance para la comprobacion de
  `/metrics`; ninguno pertenece a una suite viva. `backend/src/__tests__/session/fixtures.ts` documenta
  el orden de borrado que las restricciones `onDelete: Restrict` imponen y puede copiarse tal cual.

## 4. Consecuencias para W7

- Los tramos de ADR quedan asi: W6 escribio 0049-0055 y a W7-D le corresponde 0056, la estrategia de
  pruebas y la prueba de humo. Es el unico tema del reparto original del plan que sigue sin escribir; el
  de balance esta escrito como ADR-0044 y lo que queda es cerrar el informe, no volver a decidir.
- Las entradas que un agente de W7 debe leer antes de tocar nada son la 0052 (el motor de tareas y la
  idempotencia de cerrar una tarea), la 0053 (los tres caminos de recuperacion y el intervalo del
  resumen), la 0049 y la 0050 (silvicultura), y la 0054 (las dos premisas de orden que resultaron
  falsas), porque las cinco describen invariantes que una integracion puede romper sin que ninguna
  puerta lo note.
- La revision adversarial contra el GDD tiene ahora material nuevo que revisar y una lista donde
  buscarlo: las resoluciones 53 a 58 del apartado 2 de las erratas son las decisiones de esta fase sobre
  huecos del GDD, y ninguna la ha revisado nadie salvo quien la tomo.
- El bucle completo nunca se ha recorrido de una pieza. Cada modulo se verifico por HTTP por separado y
  el cliente se recorrio en el navegador contra el servidor simulado. `make smoke` es lo que cierra esa
  distancia, y es tambien lo unico que impide que `make verify` quede en verde.
- Dos cifras que conviene tener presentes al medir: la instantanea de un jugador con veinte campos de
  doscientas cincuenta celdas mide 174,3 KiB contra un techo declarado de 512 KiB, y la extrapolacion al
  peor caso admisible es de unos 1,4 MiB. Y el rendimiento del ciclo sigue siendo el que el informe de
  balance publica: ratio 0,0963 contra el 1,3 a 1,8 que recomienda §125, sin punto de equilibrio. Es una
  desviacion documentada y no un defecto, por decision de la planificacion (ADR-0011, ADR-0014, ADR-0044).

## 5. Resuelto

Lo que el apartado 3 dejaba abierto, con lo que la ventana de integracion W7-A aplico. El inventario
completo, con la clasificacion de cada punto y el motivo de cada decision, esta en
`docs/handoff/INTEGRACION.md`.

### 3.1.1 Los dos enganches sin registrar en el proceso de la cola

Aplicado. `registerEconomySweepHooks` y `registerForestryScheduledHandlers` se invocan desde
`registerModuleExtensions` de `backend/src/handlers.ts`, que es el punto que `server.ts` y `worker.ts`
ejecutan por igual. La liquidacion forzosa y la contribucion forestal a `TASK_COMPLETE` dejan de depender
de haber construido la aplicacion Fastify.

### 3.1.2 `CANCEL_TASKS` en el `STEP_PLAN` de la liquidacion

Aplicado, sin que `modules/economy` nombre a `modules/tasks`: la estrategia llega por
`taskCancellerForLiquidation` de `backend/src/lib/moduleSeams.ts`. `LiquidatedAsset['assetKind']` admite
`'TASK'` y el paso lleva un predicado `available`, de modo que sin estrategia registrada se reporta como
no ejecutado en lugar de no hacer nada en silencio.

### 3.1.3 La costura de la cancelacion forestal

Aplicado con la segunda de las dos opciones que `NOTES-w6c.md` 2.2 ofrecia: un registro de estrategias en
`lib/`, no una linea en `eslint.config.js`. El motivo es que la dependencia es entre hermanos de la misma
fase, que es justo lo que la regla 4 existe para impedir, y relajarla la habria legitimado para todo el
modulo y de forma permanente. `releaseForestryTask` se estrecho a lo unico que `cancelTask` no hace ya
—devolver a `STANDING` los arboles marcados y emitir sus tramas—, porque repetir el resto habria liberado
la reserva de madera dos veces. La prueba «la cancelacion de una tala (GDD 106 y 132)» lo ejercita por
HTTP.

### 3.1.4 Las ampliaciones de `shared/`

Aplicadas tres de las cuatro: los filtros de `ledgerQuerySchema`, ya alcanzables por HTTP y traducidos en
`modules/economy/routes.ts`; `FARM_UPSERTED` en el `emits` de las dos rutas de tarea que lo emiten, mas
`TREES_UPSERTED` en la de cancelacion; y `detail` en `welcomeBackLiquidationSchema`, con el lector del
backend y el panel que lo consume. Las cuatro rutas de maquinaria y personal no declaran `FARM_UPSERTED`
porque no lo emiten: declarar un evento que no se emite seria peor que no declararlo, y la ocupacion se
resuelve en el cliente contando sobre `Machine.garageId` y `Worker.homeId` (ADR-0048).

La cuarta, las celdas vacias de la parcela o el arbolado en la instantanea, queda deliberadamente sin
aplicar: `GET /api/forest-plots/:forestPlotId` si transporta los arboles y el panel los pide, mientras que
anadir las coordenadas al DTO inflaria cada trama `FOREST_PLOT_UPSERTED` hasta dos mil pares. La
comprobacion de coherencia de ADR-0055 cubre el hueco.

### 3.1.5 `make test-unit` y el backend

Aplicado, y con ello `make verify` encadena los pasos del criterio de aceptacion de la seccion 12 del
plan: `check-sync`, `typecheck`, `lint`, `test-unit`, `migrate`, `test-int`, `compose-config` y `balance`.
`smoke` sale de la cadena porque `scripts/smoke/smoke.ts` no existe.

### 3.1.6 Los tres ficheros de configuracion

Aplicados: `restart: unless-stopped` en el servicio `worker`, `METRICS_PORT` declarado en `.env.example` y
movido a `SERVICE_ENV_VARS`, y `frontend/nuxt.config.ts` leyendo `FRONTEND_DEV_PORT`. Con ellos, la
verificacion en el navegador deja de necesitar `--port`.

### 3.2 Lo que no era un fichero congelado

Aplicado: el literal `welcomeBackPending` del servidor simulado se deriva de la marca del ultimo resumen;
`startSelectionMode` publica el sujeto del modo; `hasStandingTree` cuenta el arbol marcado en las dos
consultas; el inspector de edificio muestra las etiquetas en castellano; y la base de datos de desarrollo
queda limpia. Sin aplicar y con motivo escrito en `INTEGRACION.md`: la rama muerta de `EntityLayer`, que
la pagina ya no puede alcanzar y queda documentada; la entrada propia de `starting-guide` en su pestana,
que exige un submenu de pestana y no es deuda sino diseno de navegacion.
