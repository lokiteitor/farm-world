# NOTES-w5-cierre

Agente de cierre documental de W5, la fase que implemento maquinaria, trabajadores, economia, la
calculadora de balance, las entidades del lienzo, la costura de la pagina de juego y el segundo grupo de
paneles.

Ambito escrito: `docs/adr.md` (entradas 0039 a 0048), `docs/erratas-gdd-stack.md`, `docs/ownership.md`,
`README.md` de la raiz y este fichero. No se ha tocado codigo. `docs/balance/` se ha regenerado al
ejecutar `make balance`, que es una ruta generada y no una escritura.

Este fichero recoge lo que la verificacion de cierre detecto y que cae fuera del ambito documental, con su
categoria, su fichero y su propietario. Las seis notas de los agentes de la fase siguen vigentes y no se
repiten aqui salvo cuando la verificacion las confirmo con una salida concreta.

## 1. Verificado en el cierre

Salidas reales, ejecutadas desde la raiz del repositorio, con PostgreSQL en 55432 y Redis en 56379.

| Orden | Codigo | Resultado |
|---|---|---|
| `make sync-types` | 0 | 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `make typecheck` | 0 | `tsc` en `shared` y en `backend` sin salida; `vue-tsc --build --force` del cliente en verde |
| `make lint` | 0 | `npx eslint .` sin hallazgos, incluidas las reglas de zona; Prettier responde "All matched files use Prettier code style!" |
| `make test-unit` | 0 | `shared`: 23 ficheros y 418 pruebas. Cliente: 51 ficheros y 514 pruebas. Todas en verde |
| `make test-int` | 2 | 25 ficheros y 213 pruebas: 212 en verde y 1 en rojo, `idempotency.int.test.ts` (apartado 2.1). `make` devuelve 2; el proceso de Vitest, 1 |
| `make balance` | 0 | Informe y `kpis.json` regenerados. Ratio 0,0963, equilibrio inexistente |

Dos comprobaciones adicionales de este cierre:

- Determinismo del informe de balance, que es lo que ADR-0044 exige: se copiaron los dos ficheros
  generados, se volvio a ejecutar `make balance` y `diff` no encontro ninguna diferencia en ninguno de los
  dos. El informe sigue midiendo 17.367 bytes.
- Suite unitaria del backend, que ninguna puerta ejecuta: `npx vitest run --config vitest.config.ts` en
  `backend/` devuelve 5 ficheros y 67 pruebas, todas en verde. Eran 4 ficheros y 54 pruebas al cierre de
  W4; las 13 nuevas son `__tests__/workers/pool.test.ts`.

Lo que las notas de los agentes reportaban en rojo y ya no lo esta:

- `make lint` estaba en rojo por seis ficheros del modulo `economy` sin formatear, que W5-A y W5-B
  observaron mientras W5-C todavia escribia. Al cierre de la fase devuelve 0.
- `make test-unit` estaba en rojo por `frontend/app/components/panels/__tests__/registry.test.ts`. La
  ventana de integracion previa a la fase aplico el parche de `NOTES-w4e.md` 1.1 y la suite pasa. Queda
  abierto el problema de su tiempo de espera (apartado 2.5).

No ejecutado, conforme al brief: `git`, `npm install`, `prisma generate`, `prisma migrate`,
`docker compose` y construcciones de produccion. No se levanto ningun servidor de desarrollo en este
cierre. `make typecheck`, `make lint`, `make test-unit` y `make test-int` ejecutan `sync-types` como
prerrequisito, de modo que las dos copias de `shared/` quedaron actualizadas; ambas estan en `.gitignore`
y no son ficheros de otro agente.

La comprobacion de propiedad se hizo con `find` y con las marcas de tiempo del sistema de ficheros, no con
`git`, que la regla 5 prohibe: 502 ficheros, todos atribuidos en el apartado 3 de `docs/ownership.md`.
Ningun fichero de esta fase tuvo dos escritores; el razonamiento completo, con los cinco candidatos
posibles, esta en el apartado 4.7 de ese documento.

## 2. Pendiente fuera del ambito documental

### 2.6 El reductor no recibe los contadores de plaza

Categoria: cambio en fichero congelado del cliente y adicion de trama en el servidor
Ficheros afectados: `frontend/app/stores/sync.ts`, y las cuatro rutas de maquinaria y personal
Propietario: W3-C, W5-A y W5-B (cerrados), a aplicar por W7-A

El reductor no aplica `garageSlotsUsed` ni `homeSlotsUsed`, y ninguna de las cuatro rutas emite
`FARM_UPSERTED`; contratar y despedir tampoco emiten `PLAYER_UPSERTED`, con lo que el consumo por hora de
la barra superior se queda atras. Mitigado en los paneles contando la ocupacion sobre la entidad que lleva
su ubicacion (ADR-0048), que es lo que hace que el garaje no siga lleno tras vender aunque no haya socket
vivo. `NOTES-w5f.md` 3.4 y 3.5.

### 2.7 El informe de balance cita la cifra de tala que la errata 40 descarta

Categoria: constante en una herramienta generadora
Ficheros afectados: `tools/balance/deviations.ts`
Propietario: W5-C (cerrado), a aplicar por W7-D al cerrar el informe

El informe cita 383,5 m3 y 17.257,50 $ como volumen e ingreso de la primera tala, que corresponden a
`NATURAL_FOREST_AVERAGE_VOLUME_DM3`, el volumen medio del arbolado incluidos los plantones. La resolucion
40 del apartado 2 de las erratas fija que la cifra que la regla usa, y la que el informe debe citar, es la
produccion de una tala: 382,5 m3 y 17.212,50 $. Las dos caen dentro del 1 % de las ~382 m3 que §138
publica, de modo que la clasificacion del informe como reproducible no cambia; la cifra si. Fila 41 del
apartado 5 de las erratas.

### 2.8 Puntos de fases anteriores que siguen abiertos sin cambio

Estado tras W7-A: los siete estan cerrados. `make test-unit` recorre el backend; `nuxt.config.ts` y la
integracion continua declaran el puerto publicado; el servicio `worker` vuelve a `unless-stopped` y
`.env.example` declara `METRICS_PORT`; el inspector de edificio usa las tablas de etiquetas; y la base de
datos de desarrollo queda con un solo mundo y el jugador de la semilla. `starting-guide` sigue sin
entrada propia en su pestana y el contador de depuracion sigue bajo el panel de leyenda, los dos por
decision registrada en el apartado 4 de `docs/handoff/INTEGRACION.md`.

Todos con propietario W7-A y detalle en las notas que se citan:

- `make test-unit` no ejecuta la suite unitaria del backend, hoy 67 pruebas en 5 ficheros. Una linea en el
  `Makefile`, congelado desde W1. `NOTES-w4c.md` 1.2 y fila 21 del apartado 5 de las erratas.
- `frontend/nuxt.config.ts` fija el puerto de desarrollo en 3001 y `.github/workflows/ci.yml` declara
  `CORS_ORIGIN` con ese puerto, cuando el publicado es 3100. Cuarta tanda de verificacion que necesita
  `--port 3111`. Fila 10 del apartado 5 de las erratas.
- El servicio `worker` de `docker-compose.yml` sigue con `restart: "no"` y `.env.example` no declara
  `METRICS_PORT`. `NOTES-w4-cierre.md` apartado 9.
- El inspector de edificio sigue mostrando el identificador del enumerado, aunque las tablas de etiquetas
  de `MachineType`, `MachineStatus` y `WorkerStatus` ya existen desde W5 en los dos modulos de
  presentacion. Dos lineas en un fichero de W4-F. `NOTES-w5f.md` 3.1.
- `starting-guide` no es alcanzable desde su pestana, porque `help.defaultPanel` es `legend`. Mitigado con
  un boton en la cabecera del panel de maquinaria. `NOTES-w5f.md` 3.3.
- El contador de depuracion se dibuja bajo el panel de leyenda y en `/game` es invisible salvo plegando la
  leyenda. `NOTES-w5w.md` 4.3.
- Quedan jugadores de verificacion en la base de datos de desarrollo (`w3a-...`, `w5b-...`).
  `world_cells.ownerPlayerId` es `onDelete: Restrict`, de modo que borrarlos exige liberar antes sus
  celdas. No afecta a las pruebas, que usan bases efimeras. `NOTES-w5b.md` 4.7.

## 3. Consecuencias para W6

- Los tramos de numeracion de ADR se han desplazado otra vez, y por el mismo motivo: W5 escribio diez
  entradas donde el reparto le reservaba tres. W6 escribe 0049-0051 y W7-D, 0052. De los cuatro temas que
  el plan reservaba a W6, dos ya estan escritos: ADR-0041, la reparacion como evento agendado, y ADR-0045,
  el movimiento cosmetico derivado en el cliente. El apartado 3.3 de `docs/ownership.md` lo recoge.
- El lote de W6-D sigue siendo de cinco paneles: `task-assign`, `task-list`, `forestry`, `forest-plot` y
  `welcome-back`. `notices` lo escribio W4-E.
- W6-A recibe de esta fase una superficie ya ejercitada y no una especificacion: `requireAssignableMachines`
  y `applyMachineWear` de `modules/machinery`, y `requireIdleWorker`, `requireWorkerOfFarm`,
  `reserveWorkerForTask`, `releaseWorkerFromTask`, `applyTaskCompletion` y `accruedWages` de
  `modules/workers`. El contrato de cada una esta en ADR-0040 y el detalle en `NOTES-w5a.md` 3.4 y
  `NOTES-w5b.md` 5. La regla de zona sigue prohibiendo importar hermanos de la misma fase, y `machinery`,
  `workers` y `economy` ya son fase anterior para W6.
- Tres pasos de la liquidacion forzosa estan declarados y sin estrategia porque su semantica pertenece a
  otros modulos: `CANCEL_TASKS` a `modules/tasks` (W6-A), `BUILDINGS` a `modules/farms` y `UNUSED_LAND` a
  `modules/world`. El motor recorre el orden completo y registra en `meta` los pasos que ejecuto y los que
  no, de modo que anadir una estrategia no cambia el motor. `NOTES-w5c.md` 2.4.
- Quedan dos tipos de evento agendado con manejador de andamiaje, `TASK_COMPLETE` y
  `FOREST_NOTIFY_MILESTONE`, que es lo que `farm_world_scheduled_events_unhandled_total` cuenta. Los dos
  son de W6.
- La geometria de una parcela forestal no viaja en el contrato, de modo que la capa de entidades coloca
  los arboles desde `TREES_UPSERTED`. W6-C decide si la parcela publica su geometria. `NOTES-w5d.md` 5.5.
- Las entradas de ADR de esta fase que un agente de W6 debe leer antes de escribir son la 0039 (deuda y
  liquidacion), la 0040 (la tarea como unico vinculo), la 0045 (movimiento cosmetico), la 0046 (la capa de
  entidades) y la 0048 (el orden de evaluacion como motivo de bloqueo).
- Si W6 necesita mas piezas comunes entre paneles, lo que procede es crear
  `frontend/app/components/panels/shared/` con fila propia y un unico agente responsable, como ADR-0037
  dejo previsto. W5 no lo necesito: sus cinco piezas viven en el directorio del panel de su materia.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 2.5 `registry.test.ts` agota el tiempo de espera por omision

Aplicado antes de W7.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/components/panels/__tests__/registry.test.ts`
Propietario: W3-C (cerrado), a aplicar por W7-A

Resuelto el defecto de la lista literal, queda otro: montar los veintitres paneles con importacion
diferida tarda 10,9 s en frio y 5,2 s con cache caliente, por encima de los 5 s por omision de Vitest. En
este cierre la suite paso, y dos agentes de la fase la vieron fallar y volver a pasar sin tocar nada. El
cambio es `testTimeout: 30_000`.

### 2.4 La costura de la pagina no adjunta la capa de entidades

Resuelto por W6-W.

El texto original de la nota:

Categoria: costura entre dos ambitos de la misma fase
Ficheros afectados: `frontend/app/pages/game.vue`
Propietario: W5-W y W5-D (cerrados), a aplicar por W6 o W7-A

Las dos mitades se escribieron en paralelo y ninguna podia esperar a la otra: la pagina crea el lienzo y
no crea `EntityLayer`, de modo que maquinaria, trabajadores y arboles se ven en `/perf` y no en `/game`.
La costura exacta esta en `NOTES-w5d.md` apartado 5.1.

### 2.3 La consulta del ledger no admite sus filtros por HTTP

Aplicado por W7-A (integracion).

El texto original de la nota:

Categoria: cambio en fichero congelado del contrato
Ficheros afectados: `shared/api/schemas/economy.ts`, `ledgerQuerySchema`
Propietario: W2-C (cerrado), a aplicar por W7-A

`queryLedger` y `sumLedger` implementan y prueban el filtro por tipo de asiento y por intervalo, que es lo
que el resumen de regreso de §124 necesitara, y son inalcanzables por HTTP porque el esquema es un objeto
estricto. Ampliacion exacta en `NOTES-w5c.md` apartado 2.3.

### 2.2 El proceso `worker` no aplica la liquidacion forzosa

Aplicado por W7-A (integracion) desde `registerDomainHandlers`.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `backend/src/handlers.ts`, `backend/src/worker.ts`
Propietario: W3-A (cerrado), a aplicar por W7-A

`registerSettleSweepHook` se invoca al construir la aplicacion Fastify y `src/worker.ts` no la construye,
de modo que hoy solo el servidor aplica la liquidacion de ADR-0039. Consecuencia real: un jugador cuyo
barrido corre exclusivamente en el proceso de la cola acumula deuda sin liquidar hasta su siguiente
peticion. Parche de dos lineas en `NOTES-w5c.md` apartado 2.1.

### 2.1 `make test-int` queda con una prueba en rojo

Resuelto por la ventana de integracion intermedia de W6.

El texto original de la nota:

Categoria: prueba de otro agente que una fase posterior invalida
Ficheros afectados: `backend/src/__tests__/idempotency.int.test.ts`, linea 154
Propietario: W3-A (cerrado), a aplicar por W7-A

Salida real:

```
FAIL  src/__tests__/idempotency.int.test.ts > la cabecera Idempotency-Key >
      no almacena la respuesta de un fallo del servidor, de modo que el reintento sigue abierto
AssertionError: expected 404 to be 501
 Test Files  1 failed | 24 passed (25)
      Tests  1 failed | 212 passed (213)
```

La prueba necesita una ruta que exija clave de idempotencia y devuelva un 5xx, y usaba `POST /api/machines`
por ser andamiaje. W5-A implemento el modulo y la ruta responde 404 al cuerpo que la prueba envia.

Es el mismo defecto de referencia escrita a mano que ADR-0038 resolvio para la lista de rutas
implementadas, con un agravante que conviene no pasar por alto: tras W5 no queda ninguna ruta con
`requiresIdempotencyKey` sin implementar, de modo que derivar el ejemplo de `stubRouteKeys()` —que es lo
que ADR-0038 hizo— ya no sirve y no volvera a servir. El parche verificado, con salida real de 500 y cero
registros de idempotencia, esta en `NOTES-w5a.md` apartado 2.1: enviar `farmId: 'no-es-un-uuid'` y esperar
500, que provoca un 5xx autentico via P2023.

Los tres agentes de backend se abstuvieron de tocarlo, que es el comportamiento correcto bajo la regla 1 y
el mismo que W4 tuvo con `app.int.test.ts`.
