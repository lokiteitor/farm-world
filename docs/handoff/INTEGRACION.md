# Inventario de integracion (W7-A)

Estado: redactado antes de aplicar ningun cambio, para que la ventana de integracion sea auditable.

Este documento recoge el apartado «Pendiente» de los 34 ficheros de `docs/handoff/`, mas las peticiones
dirigidas a W7-A que aparecen fuera de ese apartado (apartados «Discrepancias detectadas» y «Ordenes que
no se han ejecutado»), y las clasifica en tres categorias:

- (a) Se aplica en esta ventana.
- (b) Ya no aplica: el codigo cambio despues de escribirse la nota y el punto esta cerrado.
- (c) Queda fuera del alcance de las fases 0 a 8, o corresponde a otro agente de W7.

La comprobacion de la categoria (b) no es documental: cada punto se verifico contra el arbol real antes
de clasificarlo, y la columna «Comprobacion» dice como.

---

## 1. Estado de partida, medido

Ejecutado antes de tocar nada, el 13 de agosto de 2026:

```text
make check-sync   -> backend/src/shared is in sync; frontend/app/shared is in sync
make typecheck    -> shared, backend y frontend sin errores
make lint         -> eslint 0 hallazgos; prettier "All matched files use Prettier code style!"
make test-unit    -> shared 418/418 en 23 ficheros; frontend 646/646 en 60 ficheros
cd backend && npx vitest run -> 82/82 en 6 ficheros (fuera de toda puerta)
make test-int     -> 254/254 en 32 ficheros
```

Es decir: el arbol esta en verde y la deuda pendiente no es un rojo, sino superficie no cubierta,
ficheros congelados sin actualizar y costuras entre modulos que ninguna fase pudo cerrar.

---

## 2. Categoria (a): se aplica en esta ventana

### 2.1 Ficheros congelados de infraestructura

| N. | Punto | Fichero | Origen |
|---|---|---|---|
| a1 | `make test-unit` no ejecuta la suite unitaria del backend, hoy 82 pruebas en 6 ficheros | `Makefile` | `NOTES-w4c` 1.2, `NOTES-w4-cierre` 5, `NOTES-w4-cierre-2` 4, `NOTES-w5b` 4.6, `NOTES-w5-cierre` 2.8, `NOTES-w6-cierre` 3.1.5, errata 66 |
| a2 | `make verify` no encadena los pasos del criterio de aceptacion de la seccion 12 del plan | `Makefile` | Plan seccion 12 |
| a3 | El servicio `worker` sigue con `restart: "no"`, politica escrita para el andamiaje de W1 | `docker-compose.yml` | `NOTES-W1` 4, `NOTES-w2-5-parcheo` 2.5, `NOTES-w3a` 1.1, `NOTES-w3-cierre` 4, `NOTES-w4-cierre` 9 |
| a4 | `METRICS_PORT` no figura en la plantilla de entorno | `.env.example` y `backend/src/plugins/__tests__/config.test.ts` | `NOTES-w3a` 1.2, `NOTES-w3-cierre` 5, `NOTES-w4-cierre` 9 |
| a5 | El puerto del servidor de desarrollo esta fijado en 3001, ocupado en esta maquina | `frontend/nuxt.config.ts` | `NOTES-w3d` 1, `NOTES-w3-cierre` 6, `NOTES-w4d` 1.4, `NOTES-w5w` 4.4, `NOTES-w6w` 4.5, errata 10 |
| a6 | `CORS_ORIGIN` de la integracion continua declara el puerto 3001 | `.github/workflows/ci.yml` | `NOTES-w2-5-parcheo` 2.3, `NOTES-w3-cierre` 6 |

### 2.2 Costuras del backend que ninguna fase pudo cerrar

| N. | Punto | Fichero | Origen |
|---|---|---|---|
| a7 | El proceso `worker` no registra el enganche de la liquidacion forzosa: un barrido que corre solo en la cola liquida devengos y no liquida activos | `backend/src/handlers.ts` | `NOTES-w5c` 2.1, `NOTES-w5-cierre` 2.2, `NOTES-w6w` 4.1, `NOTES-w6-cierre` 3.1.1, errata 38 |
| a8 | El proceso `worker` no instala la contribucion forestal a `TASK_COMPLETE`: una finalizacion forestal procesada solo por la cola cae en el manejador generico | `backend/src/handlers.ts` | `NOTES-w6c` 2.1, `NOTES-w6-cierre` 3.1.1, errata 57 |
| a9 | El paso `CANCEL_TASKS` de la liquidacion forzosa esta declarado sin estrategia, aunque `cancelTasksForLiquidation` existe y esta probada | `backend/src/modules/economy/liquidation.ts` | `NOTES-w5c` 2.4, `NOTES-w6a` 2.1, `NOTES-w6-cierre` 3.1.2 |
| a10 | La cancelacion de una tala no devuelve a `STANDING` los arboles marcados: `modules/tasks` no puede importar a su hermano de fase `modules/forestry` | `backend/src/modules/tasks/service.ts`, `backend/src/modules/forestry/tasks.ts` | `NOTES-w6c` 2.2, `NOTES-w6-cierre` 3.1.3, errata 58 |
| a11 | `hasStandingTree` filtra por `status = 'STANDING'`, de modo que un arbol marcado por una tala en curso viaja al cliente como celda vacia | `backend/src/modules/world/cellRepo.ts`, `backend/src/modules/world/service.ts` | `NOTES-w6c` 2.3, errata 59 |
| a12 | `/health` registra `FST_ERR_REP_ALREADY_SENT` en cada peticion: una linea de nivel `warn` por sonda | `backend/src/plugins/systemRoutes.ts` | `NOTES-w6b` 4.4 |

Sobre a9 y a10, que son la unica decision de arquitectura de esta lista. Las dos costuras cruzan la
regla 4 de la seccion 11 del plan en sentidos opuestos: `economy` (fase W5) necesita a `tasks` (fase W6),
que es una fase posterior, y `tasks` necesita a `forestry`, que es su hermano de fase. `NOTES-w6c` 2.2
ofrece dos salidas y pide que W7-A elija: relajar la zona de ESLint, o declarar un registro de
estrategias en `lib/` con la misma forma que `registerSettleSweepHook`.

Se adopta la segunda, por tres motivos. Relajar la zona convertiria en legitima una dependencia entre
hermanos de fase, que es exactamente lo que la regla existe para impedir, y lo haria de forma permanente
para todo el modulo y no para la llamada concreta. El registro, en cambio, deja la direccion de la
dependencia hacia `lib/`, que es el sentido que ya siguen `SCHEDULED_EVENT_HANDLERS` y
`registerSettleSweepHook`. Y ademas resuelve el mismo problema que a7 y a8: el punto de relleno pasa a ser
`registerDomainHandlers`, que los dos procesos invocan, de modo que la costura no depende de que se haya
construido la aplicacion Fastify.

### 2.3 Ampliaciones del contrato, todas aditivas

| N. | Punto | Fichero | Origen |
|---|---|---|---|
| a13 | `ledgerQuerySchema` no admite el filtro por tipo de asiento ni por intervalo, que `queryLedger` y `sumLedger` implementan y prueban | `shared/api/schemas/economy.ts`, `backend/src/modules/economy/routes.ts` | `NOTES-w5c` 2.3, `NOTES-w5-cierre` 2.3, `NOTES-w6w` 4.2, errata 37 |
| a14 | `POST /api/tasks` y `POST /api/tasks/:taskId/cancel` emiten `FARM_UPSERTED` y no lo declaran | `shared/api/routes.ts` | `NOTES-w6a` 2.2, errata 56 |
| a15 | `welcomeBackLiquidationSchema` no transporta `detail`, de modo que el resumen dice «Maquina \<identificador\>» y no «Cosechadora» | `shared/api/schemas/state.ts`, `backend/src/modules/session/welcomeBack.ts` | `NOTES-w6t` 1.1, errata 60 |

### 2.4 Cliente

| N. | Punto | Fichero | Origen |
|---|---|---|---|
| a16 | El inspector de edificio muestra el identificador del enumerado en lugar de la etiqueta en castellano, que existe desde W5 | `frontend/app/components/panels/building-inspector/BuildingInspectorPanel.vue` | `NOTES-w4f` 2.4, `NOTES-w5f` 3.1, `NOTES-w5-cierre` 2.8 |
| a17 | `startSelectionMode` no publica el sujeto del modo, de modo que el arrastre de una tala se pinta con el veredicto de un desmonte | `frontend/app/components/panels/cell-inspector/worldAccess.ts` | `NOTES-w6w` 4.3, `NOTES-w6-cierre` 3.2, errata 65 |
| a18 | El servidor simulado ignora `expectedTotal` en la compra y en la reparacion de maquinaria | `frontend/app/mock/handlers.ts` | `NOTES-w5f` 3.6, errata 45 |
| a19 | El servidor simulado devuelve `welcomeBackPending: false` como literal, de modo que el resumen de regreso es el unico panel que no se puede ejercitar contra el | `frontend/app/mock/handlers.ts` | `NOTES-w6w` 4.4, `NOTES-w6-cierre` 3.2, errata 63 |

### 2.5 Documentacion y entorno

| N. | Punto | Fichero | Origen |
|---|---|---|---|
| a20 | El apartado 6 del `README.md` de la raiz declara el estado al cierre de W2 | `README.md` | `NOTES-w2-cierre` 1 |
| a21 | Las notas aplicadas hay que moverlas al apartado «Resuelto» de su fichero de origen | `docs/handoff/NOTES-*.md` | `docs/handoff/README.md` 1 |
| a22 | La base de datos de desarrollo acumula mundos y jugadores de verificacion de W3, W4, W5 y W6 | ninguno | `NOTES-w4a` 1.4, `NOTES-w5b` 4.7, `NOTES-w5-cierre` 2.8, `NOTES-w6b` 4.5, `NOTES-w6a` 2.4, errata 51 |

---

## 3. Categoria (b): ya no aplica

Cada fila se comprobo contra el arbol real. Ninguna se cierra por lectura de otro documento.

| Punto pendiente en las notas | Comprobacion sobre el arbol | Origen de la nota |
|---|---|---|
| `app.int.test.ts` afirma 501 con una lista literal de rutas implementadas | El fichero deriva hoy los andamiajes de `stubRouteKeys()` del propio registro (ADR-0038). `make test-int` 254/254 | `NOTES-w3-cierre` 1, `NOTES-w4a` 1.1, `NOTES-w4b` 3.1, `NOTES-w4c` 1.1, `NOTES-w4-cierre` 1 |
| `idempotency.int.test.ts` usa `POST /api/machines` como ruta que responde 501 | Reescrita: ejercita `completeIdempotency` con un registro creado a mano y una respuesta 503, sin depender de ninguna ruta | `NOTES-w5a` 2.1, `NOTES-w5c` 2.2, `NOTES-w5-cierre` 2.1, erratas 36 y 52 |
| `registry.test.ts` exige «No implementado» de los veintitres paneles | La prueba distingue hoy los andamiajes por la presencia de `UiPendingPanel` | `NOTES-w4e` 1.1, `NOTES-w4f` 2.1, `NOTES-w4-cierre-2` 1 |
| `registry.test.ts` agota el tiempo de espera por omision | `MOUNT_ALL_TIMEOUT_MS = 30_000` en las dos pruebas que montan los veintitres | `NOTES-w5f` 3.2, `NOTES-w5-cierre` 2.5, `NOTES-w6t` 1.4, erratas 42 y 53 |
| `building-placement` declarado modal quita la entrada al lienzo | La entrada del registro declara `surface: PanelSurface.SIDE` con su motivo | `NOTES-w4f` 2.2, `NOTES-w4-cierre-2` 6 |
| El arbitraje de entrada no deshabilita el lienzo con el foco en un campo de texto | `useShellUi` calcula `worldInputEnabled = modals.length === 0 && !textEntryFocused`, con `focusin`/`focusout` sobre el documento | `NOTES-w4d` 2.4, `NOTES-w4g` 1.7, `NOTES-w4-cierre` 7 |
| Escape tiene dos duenos | `setCanvasEscabeClaim` antepone el lienzo en la escalera de Escape | `NOTES-w4g` 1.6, `NOTES-w4-cierre` 7 |
| `pages/game.vue` no monta el lienzo ni crea la herramienta de seleccion | La pagina llama a `createGame`, cose la herramienta y adjunta la capa de entidades (ADR-0046, ADR-0054) | `NOTES-w4d` 1.1, `NOTES-w4g` 1.5, `NOTES-w4-cierre` 4, `NOTES-w4-cierre-2` 2, `NOTES-w5d` 5.1, `NOTES-w5-cierre` 2.4, errata 47 |
| El panel lateral arranca vacio con la pestana Mundo activa | `pages/game.vue` selecciona la pestana al montar | `NOTES-w4e` 1.3, `NOTES-w4-cierre-2` 2 |
| El puente no declara evento de preferencias de renderizado | `GameBridgeEvents` declara `settings:changed` con `RenderPreferences`, y `WorldScene` lo consume, incluida la lectura retenida al crearse | `NOTES-w4e` 1.2, `NOTES-w4-cierre-2` 3 |
| `SelectionMode` del puente no puede llevar el sujeto | Declara `mode`, `fieldId`, `forestPlotId` y `buildingType` | `NOTES-w4g` 1.2, `NOTES-w5w` 4.6 |
| Las zonas de ESLint impiden que los modulos de W4 consuman `modules/world/service.ts` | `BACKEND_MODULE_PHASES` agrupa por fase y cada zona admite las fases anteriores. Resuelto en la ventana previa a W4 | `NOTES-w3-cierre` 2, errata 1 |
| El servidor simulado valora dos veces una celda repetida | `distinctCells` deduplica por `cellKey` en el presupuesto y en la compra | `NOTES-w4a` 1.3, `NOTES-w4-cierre` 6 |
| El servidor simulado renombra la unica granja en lugar de crear una segunda | `POST /api/farms` crea una granja nueva y la registra en `foundedFarms` | `NOTES-w4f` 4.1, `NOTES-w4-cierre-2` 5, errata 28 |
| El servidor simulado no rechaza retirar un almacen con existencias | El manejador aplica la segunda negativa del servidor real, en su orden y con su codigo | `NOTES-w4f` 4.2, `NOTES-w4-cierre-2` 5, errata 29 |
| Cinco (luego cuatro) tipos de evento agendado con manejador de andamiaje | Los seis tipos de `ScheduledEventKind` apuntan a un manejador real en `src/handlers.ts` | `NOTES-w3-cierre` 8, `NOTES-w4-cierre` 8 |
| El worker no expone `/metrics` | `backend/src/worker.ts` abre un escuchador con `/metrics` y `/health` | `NOTES-W1` 3 |
| El backend debe honrar `expectedTotal` | Comprobado en `modules/land/service.ts`, `modules/farms/index.ts` y `modules/machinery/service.ts` | `NOTES-W2c` 1.3 |
| La guarda de idempotencia debe derivarse de la bandera del mapa de rutas | `plugins/routes.ts` la deriva de `route.requiresIdempotencyKey` | `NOTES-W2c` 1.4 |
| El terreno de un chunk podria tener que viajar en la respuesta | El cliente lo reproduce con el generador compartido y el presupuesto se cumple. No hace falta el campo | `NOTES-W2c` 1.5 |
| `settings` no es alcanzable desde ninguna pestana | La leyenda lleva un boton «Ajustes» | `NOTES-w4e` 1.4, errata 24 |
| La salida del generador de Prisma deberia emitir bajo `src/` | Emite en `backend/src/generated/prisma` | `NOTES-W1` 2, `NOTES-w2-5-parcheo` 2.4 (la mitad de la optimizacion que queda es categoria c) |
| `EntityLayer` con rama diferida inalcanzable | La pagina construye la capa con la escena viva (ADR-0054), y la rama quedo documentada como muerta | `NOTES-w6-cierre` 3.2, errata 64 |

---

## 4. Categoria (c): fuera del alcance de las fases 0 a 8, o de otro agente

| Punto | Motivo por el que no se aplica aqui |
|---|---|
| `scripts/smoke/smoke.ts` y `make smoke` | El fichero no existe y `make smoke` lo declara con su propietario. El criterio que esta ventana tiene que dejar en verde es el de la seccion 12 sin el paso 4: `sync-types`, `typecheck`, `lint`, `test-unit`, `migrate`, `test-int` y `balance`. Se retira `smoke` de la cadena de `verify` y se mantiene como objetivo propio, para que la puerta no dependa de un fichero que nadie escribio |
| Adelgazamiento de la etapa `runtime` de `backend/Dockerfile` | Tamano de imagen, no correccion. La etapa actual es correcta (`NOTES-w2-5-parcheo` 2.4) |
| Atlas rodante de miniaturas de chunk | Optimizacion de renderizado con margen medido suficiente (`NOTES-w4d` 1.3) |
| Medida de draw calls sobre WebGL real | Exige una maquina con GPU accesible; Chrome sin cabeza cae al renderizador de lienzo (`NOTES-w5d` 5.4) |
| Tabla `TaskCell` o columna `Task.areaCells` para acotar un desmonte parcial | Cambio de esquema con migracion, y el ciclo del juego se cierra sin el: toda celda desmontable procede de una tala y por tanto de una parcela (`NOTES-w6c` 2.4 y 2.5, errata 58 del apartado 2) |
| Poblar `Task.jobId` | La fila del outbox es la autoritativa y una segunda copia quedaria obsoleta en el primer re-anclaje (`NOTES-w6a` 2.3) |
| `PLAYER_UPSERTED` en contratar y despedir | Hay dos salidas y la del cliente ya existe: `player.localHoldingRate` se recalcula con la regla compartida. Cambiar los `emits` sin necesidad amplia el trafico de dos rutas frecuentes (`NOTES-w5f` 3.5, errata 44) |
| `garageSlotsUsed` y `homeSlotsUsed` en el reductor | Mitigado por construccion: la ocupacion se cuenta sobre `Machine.garageId` y `Worker.homeId`, que si viajan en la respuesta (ADR-0048, `NOTES-w5f` 3.4, errata 43) |
| Trama de acuse del latido en `shared/ws/` | El latido del cliente no depende de la respuesta y el servidor ya emite `CLOCK` periodico. Anadir `PONG` es un cambio del contrato sin consumidor (`NOTES-w3-cierre` 7) |
| `selection:confirmed` en el puente | El puerto `SelectionPort.onConfirm` lo cubre y lleva ademas la instantanea completa, que el evento no podria llevar sin arrastrar tipos de dominio al puente (`NOTES-w4g` 1.1) |
| Propositos `FIELD_SPLIT` y `FELL_AREA` en `shared/rules/selection.ts` | Las dos reglas se componen en el cliente con las primitivas compartidas y reflejan sentencia a sentencia lo que el servidor hace (ADR-0030, `NOTES-w4g` 1.3, errata 45 del apartado 2) |
| Evento de marcado de entidad (`MACHINE`, `WORKER` en `CanvasPick`) | Exige que `WorldScene` conozca la capa de entidades. `entityAt` esta publicada y probada, y el panel que la necesite puede llamarla sobre la celda que `canvas:pick` ya trae (`NOTES-w5d` 5.2, `NOTES-w6w` 4.5) |
| Contador de depuracion bajo el panel de leyenda | Cosmetico y de una ruta de desarrollo (`NOTES-w5w` 4.3, errata 49) |
| `starting-guide` sin entrada propia en su pestana | El registro solo abre el panel por omision de una pestana; darle entrada exige un submenu de pestana, que es diseno de navegacion y no deuda. Mitigado con el boton de la cabecera del panel de maquinaria (`NOTES-w5f` 3.3, errata 46) |
| Celdas vacias de la parcela o arbolado en la instantanea | `GET /api/forest-plots/:forestPlotId` si transporta los arboles y el panel los pide; anadir las coordenadas al DTO inflaria cada trama `FOREST_PLOT_UPSERTED` hasta 2.000 pares. La comprobacion de coherencia de ADR-0055 cubre el hueco (`NOTES-w6t` 1.2, errata 61) |
| `UiButton.reason` y `exactOptionalPropertyTypes` | Los paneles ya calculan siempre una cadena. Cambiar la firma tocaria veintitres consumidores por estetica (`NOTES-w4-cierre-2` 7) |
| `docs/adr.md`, `docs/ownership.md` y `docs/erratas-gdd-stack.md` | Propiedad de W7-D segun el apartado 3.3 de `docs/ownership.md`. Esta ventana no los escribe: lo que aplica queda registrado aqui y en el apartado «Resuelto» de cada fichero de origen |
| Informe de balance: cifra de la primera tala (383,5 frente a 382,5 m3) | `tools/balance/` y `docs/balance/` los cierra W7-D (errata 41, `NOTES-w5-cierre` 2.7) |
| `shared/api/README.md` apartado 8 y `docs/handoff/README.md` apartado 4 desfasados | Documentacion de otros ambitos, sin efecto sobre el codigo (`NOTES-w3-cierre` 9) |
| Cinco citas colgantes a `NOTES-w3b.md`, que nunca se escribio | Comentarios de codigo del modulo de mundo. Redirigirlos exige tocar cuatro ficheros por una referencia (`NOTES-w3-cierre` 3) |

---

## 5. Resultado

### 5.1 Lo aplicado, contra la lista del apartado 2

Los veintidos puntos de la categoria (a) estan aplicados. Tres detalles se resolvieron de forma distinta
a la que la nota de origen proponia, y conviene registrar por que:

- a9 y a10, las dos costuras entre modulos. Se adopto el registro de estrategias en `lib/` y no la
  relajacion de la zona de ESLint. El fichero nuevo es `backend/src/lib/moduleSeams.ts`, con dos
  registros: el cancelador de tareas que el paso `CANCEL_TASKS` de la liquidacion consume, y las
  estrategias de liberacion que `cancelTask` invoca. `backend/src/handlers.ts` es el unico fichero que
  nombra los dos extremos, que es exactamente lo que ya hacia con los manejadores de evento agendado.
- a10. `releaseForestryTask` se estrecho al hacerlo. La version anterior retiraba tambien el trabajo
  agendado, liberaba las maquinas y liberaba la reserva de almacen, y las tres cosas las hace ya
  `cancelTask` para toda operacion que declare almacen en la tabla de GDD §90, lo que incluye `FELL`.
  Haberla llamado tal cual habria descontado la reserva de madera dos veces. La prueba nueva de
  `forestry.int.test.ts` afirma que `reservedWoodDm3` queda en cero, precisamente por eso.
- a14. `FARM_UPSERTED` se anadio al `emits` de las dos rutas de tarea que lo emiten, y no a las cuatro de
  maquinaria y personal, que no lo emiten. Declarar un evento que no se produce es peor que no
  declararlo; la ocupacion de garaje y vivienda se resuelve en el cliente contando sobre
  `Machine.garageId` y `Worker.homeId` (ADR-0048).

Se aprovecho ademas la apertura de `.github/workflows/ci.yml` para anadir `make generate` al trabajo
`static`: `backend/src/generated/prisma` esta en `.gitignore` y tanto `make typecheck` como la suite
unitaria del backend, que `make test-unit` ejecuta desde esta ventana, lo necesitan.

Dos cambios de prueba acompanan al codigo, y ninguno relaja una afirmacion:

- `liquidation.int.test.ts` esperaba `CANCEL_TASKS` entre los pasos no ejecutados; ahora lo espera entre
  los ejecutados, y los pasos sin estrategia bajan de tres a dos.
- `forestry.int.test.ts` gana el caso «la cancelacion de una tala (GDD 106 y 132)», que ejercita por HTTP
  el camino completo: asignar la tala, comprobar que el lote queda marcado, cancelar, y comprobar que los
  cuatro arboles vuelven a `STANDING`, que la reserva de madera queda en cero, que el puntero de la
  parcela queda nulo y que no sobrevive ningun evento agendado. Es el camino que `NOTES-w6c.md` 2.2
  declaraba sin ninguna prueba de integracion.

### 5.2 Verificacion, con la salida real

`make verify`, de extremo a extremo, con la cadena completa del criterio de aceptacion:

```text
check-sync      backend/src/shared is in sync; frontend/app/shared is in sync
typecheck       shared, backend y frontend sin errores
lint            eslint 0 hallazgos; "All matched files use Prettier code style!"
test-unit       shared   Test Files 23 passed (23)  Tests 418 passed (418)
                backend  Test Files  6 passed (6)   Tests  82 passed (82)
                frontend Test Files 60 passed (60)  Tests 646 passed (646)
migrate         2 migrations found; No pending migrations to apply
test-int        Test Files 32 passed (32)  Tests 255 passed (255)
compose-config  Los tres ficheros de Compose son validos
balance         Informe de balance generado en docs/balance/
--> verify completo
```

Comprobacion contra los procesos arrancados, que es lo unico que las suites no pueden ver:

```text
servidor en el puerto 3210, LOG_LEVEL=warn
  tres GET /health consecutivos -> 200 200 200, y el registro queda vacio
  GET /metrics -> 200, 124 series farm_world_*
worker con METRICS_PORT=9465
  GET /health del escuchador de metricas -> 200
  el barrido de reconciliacion arranca y procesa la cola
```

Los dos procesos quedaron apagados y los puertos 3210, 3211 y 9465 libres.

Base de datos de desarrollo, antes y despues:

```text
antes    9 mundos (8 de semilla negativa, restos de suites cuyo teardown no corrio), 19 jugadores,
         19 eventos agendados pendientes que el worker reportaba como de jugadores inexistentes
despues  1 mundo (semilla 20260811, 137 celdas), 1 jugador (dev@farm-world.local),
         0 eventos pendientes, 0 eventos huerfanos
```

### 5.3 Lo que queda abierto al cerrar la ventana

1. `scripts/smoke/smoke.ts` no existe, de modo que el paso 4 del criterio de aceptacion —el bucle
   completo por HTTP contra la pila real, con sus aserciones negativas— sigue sin ejecutarse nunca.
   `make smoke` esta escrito y declara el fichero que falta, y por eso no forma parte de la cadena de
   `make verify`: una puerta unica que dependiera de un fichero inexistente no seria una puerta.
2. `BUILDINGS` y `UNUSED_LAND` de la liquidacion forzosa siguen sin estrategia, y el asiento agregado los
   reporta como no ejecutados. Demoler un edificio exige liberar las celdas de su huella y recalcular la
   capacidad de almacenamiento; devolver la propiedad de una celda exige el simetrico de `claimCells`.
   Ninguno de los dos modulos lo expone, y una demolicion a medias seria peor que no liquidar.
3. `docs/adr.md`, `docs/ownership.md` y `docs/erratas-gdd-stack.md` no recogen todavia lo aplicado en esta
   ventana. Corresponde a W7-D segun el apartado 3.3 de `docs/ownership.md`, junto con el cierre del
   informe de balance y la correccion de la cifra de la primera tala que la errata 41 registra.
4. Todo lo clasificado como categoria (c) en el apartado 4, cada punto con su motivo.
