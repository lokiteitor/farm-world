# NOTES-w7b — Prueba de humo del bucle completo

Ventana W7-B. Propiedad: `scripts/smoke/**` y el objetivo `smoke` del `Makefile`.

## 1. Qué se entrega

`make smoke` recorre el bucle completo del juego por HTTP contra la pila real. No hay servidor
simulado en ninguna parte del recorrido: hay un proceso Fastify escuchando en un socket, el
PostgreSQL y el Redis del proyecto, y un consumidor de BullMQ real.

| Fichero | Contenido |
|---|---|
| `scripts/smoke/smoke.ts` | El escenario: dieciséis pasos, 182 comprobaciones satisfechas |
| `scripts/smoke/env.ts` | Puertos, multiplicador del reloj y entorno de los dos procesos hijo |
| `scripts/smoke/stack.ts` | Arranque y parada ordenada del servidor y del worker |
| `scripts/smoke/http.ts` | Cliente HTTP derivado de `API_ROUTES`, con validación de la respuesta |
| `scripts/smoke/ws.ts` | WebSocket con la regla de sincronización del cliente real |
| `scripts/smoke/site.ts` | Localización de superficies con el generador determinista compartido |
| `scripts/smoke/report.ts` | Pasos, aserciones y tabla de variaciones de saldo |
| `scripts/smoke/tsconfig.json` | Proyecto de comprobación de tipos, con la severidad del repositorio |

Tres propiedades que el escenario mantiene por construcción:

1. **Ninguna aserción contra un literal.** Cada cifra se compara contra las reglas puras de
   `shared/rules` o contra los catálogos de `shared/config`: `landPurchasePrice`,
   `realBuildingCost`, `estimateTaskDuration`, `conditionAfterWork`, `skillAfterTask`,
   `projectWeedLevel`, `finalYieldLiters`, `fertilityAfterHarvest`, `projectCropPhase`,
   `batchWoodVolume`, `cropSaleRevenue`, `woodSaleRevenue`. Un cambio de balance en el catálogo
   arrastra al escenario; un cambio de balance que el juego aplique mal lo pone en rojo.
2. **El propio guión queda comprobado por el compilador.** `make smoke` ejecuta
   `npx tsc -p scripts/smoke/tsconfig.json` antes del recorrido. El cuerpo de cada petición está
   tipado como `RouteBody<K>` y la respuesta se valida con el esquema Zod que la ruta declara, de
   modo que cada llamada es además una prueba de contrato.
3. **El tiempo se resuelve con el multiplicador.** El mundo corre a 360 000 ms de juego por ms
   real, una hora de juego cada diez milisegundos. Ninguna espera del camino feliz se salta con
   una ruta de desarrollo: cada finalización llega como trabajo retrasado de BullMQ y se observa
   como fotograma `TASK_UPSERTED` o `FIELD_UPSERTED` en el WebSocket.

## 2. Cómo se ejecuta

```
make smoke
```

El objetivo levanta de Compose solo `postgres` y `redis`, aplica las migraciones, comprueba los
tipos del guión y lo ejecuta. Los procesos de backend y worker los arranca y los apaga el propio
guión, en el primer puerto libre a partir de 3220, y el multiplicador del mundo se restituye al
valor de `.env` con `POST /api/dev/retime` en el bloque `finally`, antes de devolver la pila.

Variables opcionales: `SMOKE_BACKEND_PORT`, `SMOKE_WORKER_METRICS_PORT` y `SMOKE_LOG_LEVEL`
(por defecto `warn`; la salida de ambos procesos se imprime solo cuando algo falla).

## 3. Cobertura por paso

| Paso | Contenido | Estado |
|---|---|---|
| 1 | Registro, saldo de §117 y su asiento en el ledger | Verde |
| 2 | Mundo alrededor del origen; terreno local contra `POST /api/world/chunks` | Verde |
| 3 | Presupuesto y compra de 330 celdas al precio de §115, con eco por WebSocket | Verde |
| 4 | Granja, garaje y silo, cada cargo el de §116 | Verde |
| 5 | Tractor, arado, sembradora y remolque; quinta máquina rechazada con 409 (§96); segundo garaje y cosechadora | Verde |
| 6 | Contratación sin vivienda rechazada con 409 (§108); vivienda y contratación | Verde |
| 7 | Campo de 250 celdas que abarca dos chunks (§18) | Verde |
| 8 | Arado: estado del campo, trabajador y máquinas ociosos, habilidad y condición | Verde |
| 9 | Siembra y observación de `GERMINATING`, `GROWING` y `READY_TO_HARVEST` a las 6, 18 y 96 h | Verde |
| 10 | Cosecha: rendimiento de §83, fertilidad de §77, campo de vuelta a `VIRGIN` | Verde |
| 11 | Venta del trigo al precio de §123 | Verde |
| 12 | Resumen de regreso no vacío y cuadrado | Verde |
| 13 | Ledger: 180 asientos, secuencia contigua, suma cuadrada con el saldo | Verde |
| 14 | Silvicultura: compra, parcela poblada, tala, almacén, venta y replantación | Verde |
| 15 | WebSocket: una conexión, secuencia 1..167 sin huecos | Verde |
| 16 | Desmonte de bosque talado a terreno agrícola (§10) | **Rojo** |

El paso 16 está deliberadamente después del 15 y no dentro del 14: es el punto 8 del criterio de
aceptación de la sección 12 del plan y es la única parte del bucle que no funciona, de modo que un
defecto en él ni tapa ni queda tapado por el resto del recorrido.

## 4. Hallazgos

### 4.1 Defecto: el desmonte de todas las celdas de una parcela nunca termina

Reproducible en las dos ejecuciones consecutivas. Propietario del arreglo: el módulo `forestry`
del backend.

- Camino: crear una parcela forestal, talarla entera y desmontar sus celdas con
  `POST /api/land/clear`. `requireEmptyClearing` exige que la petición nombre exactamente todas
  las celdas vacías de la parcela, de modo que un desmonte de una parcela ya talada es siempre un
  desmonte total.
- Observado: la tarea se crea con normalidad y el manejador de `TASK_COMPLETE` aborta.
  `completeClearLand` (`backend/src/modules/forestry/tasks.ts`) llama a `refreshPlotCellCount`
  (`backend/src/modules/forestry/service.ts:525`), que recalcula `cellCount = 0` y escribe la
  fila; PostgreSQL rechaza la escritura con `23514 forest_plots_geometry_check`, que exige
  `cellCount > 0` (`prisma/migrations/20260811205212_init/migration.sql:1244`).
- Consecuencia: el trabajo agota los cinco reintentos de BullMQ y la tarea queda `IN_PROGRESS`
  para siempre, con el trabajador, el tractor, el arado y la parcela reservados. El jugador pierde
  la máquina y el operario sin ninguna señal.
- Arreglo natural, no aplicado aquí por la regla de propiedad exclusiva: una parcela cuyo suelo
  ha pasado íntegro a cultivable ya no es una parcela, de modo que el desmonte total debería
  darla de baja lógicamente (`disposedGameMs`, estado `FOREST_PLOT_REMOVED`) en lugar de escribir
  `cellCount = 0`. La restricción `cellCount > 0` es correcta y no debería relajarse.

### 4.2 El resumen de regreso pierde las transiciones automáticas tras la cosecha

`fieldTransitionsIn` deriva el bloque de la línea de crecimiento del campo, y la cosecha borra
`seededAtGameMs`, de modo que un recorrido que cosecha ve el bloque vacío. Está documentado en la
cabecera de `backend/src/modules/session/welcomeBack.ts` y por tanto no es un defecto, pero sí
significa que ese bloque no tiene cobertura en un recorrido completo: el escenario lo declara con
una nota y afirma en su lugar que las tres tareas cerradas aparecen y que la cosecha declara lo
que produjo. Si se quiere que el bloque sobreviva a la cosecha, la vía es derivarlo de las filas
de `GameEvent` del intervalo y no de la línea de crecimiento. Corresponde al propietario de
`session`.

### 4.3 El bucle completo no es financiable con el capital de §117

Cifras del recorrido, con el catálogo sin ajustar: 330 celdas de suelo agrícola (39 600), 96
celdas para la fase forestal (9 120), cinco edificios (43 000) y siete máquinas (186 500) suman
unos 278 000, contra los 160 000 de §117, que dimensiona el capital inicial para el montaje
agrícola mínimo y nada más. El escenario inyecta capital de trabajo con `POST /api/dev/grant` en
dos asientos `COMPENSATION` declarados como filas propias de la tabla de variaciones, nunca
plegados dentro de otro paso.

A esto se añade un efecto del propio multiplicador, que conviene dejar escrito porque no es obvio:
a una hora de juego cada diez milisegundos, el reloj de pared de la prueba es un gasto. Doscientas
idas y vueltas HTTP y las esperas entre ellas valen miles de horas de juego de salarios y
mantenimiento (§107). Con la aportación dimensionada al ras, el saldo se volvía negativo antes de
la venta y la liquidación forzosa de la sección 6.6 del plan vendía el grano antes que el propio
recorrido, que entonces afirmaba sobre la liquidación y no sobre el mercado. La aportación es por
eso holgada y no ajustada.

### 4.4 La saturación de malezas queda comprobada como hecho ejecutable

El campo de 250 celdas rinde 11 250 L sobre una base de 22 500 L: las malezas llegan a 10 000
puntos básicos y la penalización de §78 es del 50 %. Es exactamente el hallazgo principal del
informe de balance, ahora medido sobre el juego en marcha y no solo calculado.

### 4.5 El WebSocket exige latido y el guardián de avalancha actúa

Un cliente que no envía `ping` es cerrado con 4408 a los veinte segundos, de modo que el recorrido
completo no cabe en una conexión sin latido; el guión lo envía a la mitad del período que anuncia
`HELLO`. Y el colapso de lotes de `backend/src/lib/pubsub.ts` es real: en las ejecuciones se
observan cuatro huecos y seis fotogramas recuperados por `GET /api/events?since`. Por eso el paso
15 afirma la propiedad fuerte —la secuencia aplicada es estrictamente creciente y sin huecos,
llegase cada fotograma por el canal en vivo o por reproducción— y no la propiedad ingenua de que
nada se pierde en vivo, que el diseño no promete.

### 4.6 Puertos y ejecución concurrente

Los puertos 3210, 3211 y 3212 estaban ocupados durante esta ventana por otros procesos de la
máquina, uno de ellos un backend de este mismo repositorio arrancado por otra ventana del
workflow. El guión busca por eso el primer puerto libre a partir de 3220 en lugar de fijarlo. Un
detalle que conviene conocer: varias ventanas que compartan la base de desarrollo comparten
también la fila del mundo, y el multiplicador es una columna de esa fila.

## 5. Pendiente y peticiones a otros propietarios

1. **`backend/src/modules/forestry`**: el defecto del apartado 4.1.
2. **`docs/ownership.md`** (W7-D): la fila `scripts/smoke/smoke.ts` atribuye el fichero a W7-A;
   lo ha escrito W7-B, y el directorio contiene ahora siete ficheros más el `tsconfig.json`. La
   fila debería decir `scripts/smoke/**` y W7-B.
3. **`Makefile`, objetivo `verify`** (propietario del fichero congelado): ahora que el guión
   existe, encadenar `smoke` en `verify` es posible. No se ha hecho desde esta ventana por dos
   motivos: `verify` no es propiedad de W7-B, y hoy dejaría la puerta única en rojo por el defecto
   del apartado 4.1. La decisión corresponde a quien cierre la fase, y lo natural es encadenarlo
   en cuanto ese defecto esté resuelto.
4. **Base de desarrollo**: cada ejecución registra una cuenta propia, `smoke-<id>@farm-world.local`,
   y no se ha ejecutado `make reset` en ninguna. `prisma migrate reset` es una acción destructiva
   que el propio Prisma rechaza sin consentimiento explícito del usuario, de modo que la base
   conserva las cuentas de las ejecuciones de esta ventana y las tareas `CLEAR_LAND` que el
   apartado 4.1 deja atascadas. Limpiarla es una decisión del usuario, no del agente.
5. **`docs/adr.md`** (W7-D): la decisión 0056 prevista, «estrategia de pruebas y prueba de humo
   con multiplicador de tiempo», puede escribirse ya. Lo que esta ventana aporta a esa decisión es
   el apartado 4.3: el multiplicador no es gratis, porque convierte la latencia de la propia
   prueba en gasto del jugador, y una prueba de humo acelerada necesita capital de trabajo
   declarado por ese motivo y no solo por el precio del catálogo.
