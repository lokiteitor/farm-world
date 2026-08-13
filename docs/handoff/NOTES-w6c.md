# NOTES-w6c

Agente de silvicultura de W6. Ambito escrito: `backend/src/modules/forestry/**` y
`backend/src/__tests__/forestry/**`. Ningun otro fichero del repositorio se ha tocado.

Implementa §128 a §141 y el desmonte de §10: la parcela forestal como entidad separada del campo, la
generacion procedural del bosque salvaje, la tala por lote, la replantacion, el desmonte a terreno
agricola y el manejador real de `FOREST_NOTIFY_MILESTONE`.

## 1. Verificado con salida real

Ejecutado desde la raiz, con PostgreSQL en 55432 y Redis en 56379.

| Orden | Codigo | Resultado |
|---|---|---|
| `make sync-types` | 0 | 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `npx tsc --noEmit` en `backend/` | 0 | Sin salida |
| `make typecheck` | 0 | `shared`, `backend` y `vue-tsc` del cliente en verde |
| `make lint` | 0 | `eslint` sin hallazgos, incluidas las zonas; Prettier: "All matched files use Prettier code style!" |
| `make test-unit` | 0 | `shared`: 23 ficheros, 418 pruebas. Cliente: 51 ficheros, 514 pruebas |
| `make test-int` | 0 | 32 ficheros y 254 pruebas, todas en verde |
| `npx vitest run --config vitest.config.ts` en `backend/` | 0 | 6 ficheros y 82 pruebas (eran 5 y 67 al cierre de W5; las 15 nuevas son `__tests__/forestry/generator.test.ts`) |

Pruebas de este ambito: 15 unitarias en `backend/src/__tests__/forestry/generator.test.ts` y 13 de
integracion en `backend/src/__tests__/forestry/forestry.int.test.ts`, que cubren una a una las nueve
que el brief exige.

### 1.1 Llamada HTTP real contra el servidor de desarrollo

Servidor levantado con `PORT=3211 METRICS_PORT=3212 DEV_ENDPOINTS=true npx tsx src/server.ts` contra el
mundo de desarrollo (semilla 20260811, ritmo 12/1), y apagado al terminar. Los seis jugadores de
verificacion (`w6c-...@verify.invalid`) se borraron de la base de desarrollo con sus celdas, arboles,
tareas y edificios, de modo que esta verificacion no engorda la lista del apartado 2.8 de
`NOTES-w5-cierre.md`.

Salida real de la ultima pasada, que recorre el bucle completo:

```
1.  jugador 019ff859-03d2-75d7-acef-febf5ae9f6af registrado
2.  mundo 019ff2d6-fcde-7010-85fa-803b113e77cd semilla 20260811 chunk 32 reloj
    {"gameMs":"4564891212","anchorGameMs":"3456000000","rateNum":12,"rateDen":1,"scheduleEpoch":0}
3.  fondos concedidos por la ruta de desarrollo
4.  granja 019ff859-0454-7159-953c-c77a0871f82a con garaje, vivienda y almacen de madera
5.  compradas 12 celdas de bosque por 840.0000
6.  parcela 019ff859-062e-7746-a0c6-35be285d535b: 12 arboles generados, 19100 dm3 talables
    valorados en 859.5000
    histograma de fases {"SAPLING":1,"YOUNG":1,"MATURE":9,"OLD_GROWTH":1}
7.  operario 019ff859-0668-77b2-94a3-766e1f0ab567 (habilidad 6183 pb) y maquinaria comprada
8.  tala con tractor: 400 POWERED_MACHINE_REQUIRED
9.  tala 019ff859-0721-727e-9b4b-2644a0c3f6f1: 12 arboles, 18.537971944444443 h de juego,
    velocidad 647 milesimas de arbol/h, reserva 19100 dm3
10. avance forzado: 2 eventos procesados
11. almacen: 19100 dm3 de 500000, valor de mercado 859.5000
12. vendidos 19100 dm3 por 859.5000; saldo 391672.1320
13. parcela tras la tala: 0 en pie, 12 celdas vacias, histograma {"SAPLING":0,"YOUNG":0,
    "MATURE":0,"OLD_GROWTH":0}
    un arbol talado: estado FELLED, felledAtGameMs 4631637115, volumen derivado 2500 dm3
15. replantacion 019ff859-07b5-7008-9de0-a20e9e45b499: 6 celdas, 1.2633972222222223 h de juego
16. plantones: 6 en pie, histograma {"SAPLING":6,"YOUNG":0,"MATURE":0,"OLD_GROWTH":0};
    uno de ellos edad 0.0000 h, fase SAPLING, generado false
17. desmonte 019ff859-07ed-734b-8895-01d8c04a99d7: 6 celdas, 3.662332777777778 h de juego
18. terreno tras el desmonte: GRASS
19. campo 019ff859-0821-736c-bcc0-21076d6f5f88 creado sobre 6 celdas, estado VIRGIN
20. tras 481 h de juego: 3 eventos procesados
```

Cuatro lecturas de esa salida. La velocidad efectiva, 647 milesimas de arbol por hora, es
`0,8 x conditionFactor(100 %) x skillFactor(6183 pb)` de §135 evaluada por la regla compartida y no un
literal. El volumen se recalcula en el instante de la finalizacion y no se lee de la reserva: en esta
pasada coincidieron, y en la pasada anterior la reserva fue de 14 500 dm3 y lo depositado, 15 900,
porque un arbol joven cruzo a maduro durante las dieciseis horas que duro la tala. El planton
replantado tiene edad 0,0000 h y fase `SAPLING` derivada, con `naturallyGenerated` en falso (§137). Y
el desmonte deja el terreno en `GRASS` y el servidor acepta un campo sobre el, que es la unica prueba
util de que la celda quedo apta (§10).

El histograma del paso 20 sigue en `SAPLING` a proposito: `POST /api/dev/advance-player` fuerza el
procesado de los eventos vencidos hasta un instante dado, y no mueve el reloj del mundo, de modo que
la fase que el DTO deriva es la del reloj real. El hito se proceso —lo dice el contador de vencidos— y
la fase no habia llegado todavia, que es exactamente lo que "la fase es derivada y el trabajo solo
notifica" significa.

### 1.2 `/metrics` sin series de eventos sin manejador

```
# HELP farm_world_scheduled_events_due_total Eventos agendados vencidos y aplicados.
# TYPE farm_world_scheduled_events_due_total counter
farm_world_scheduled_events_due_total{kind="PLAYER_SETTLE_SWEEP",service="server"} 2
farm_world_scheduled_events_due_total{kind="TASK_COMPLETE",service="server"} 3
farm_world_scheduled_events_due_total{kind="WORKER_POOL_REFRESH",service="server"} 1
farm_world_scheduled_events_due_total{kind="FOREST_NOTIFY_MILESTONE",service="server"} 1
# HELP farm_world_scheduled_events_unhandled_total Eventos vencidos cuyo tipo no tiene manejador registrado.
# TYPE farm_world_scheduled_events_unhandled_total counter

# HELP farm_world_ws_connections Conexiones WebSocket activas.
```

`farm_world_scheduled_events_unhandled_total` queda declarado y sin ninguna serie, que es plano en cero.
`FOREST_NOTIFY_MILESTONE` aparece en el contador de vencidos con un manejador real, y las tres
finalizaciones de tarea de la pasada —tala, replantacion y desmonte— se aplicaron sin dejar hueco. La
suite de integracion lo exige ademas en cada avance: `advanceAndSettle` asegura
`unhandledEvents === 0`.

## 2. Pendiente fuera de este ambito

### 2.4 Falta una geometria por tarea para acotar un desmonte parcial

Categoria: contrato
Ficheros afectados: `backend/prisma/schema.prisma`, modelo `Task`
Propietario del cambio: W2-D (cerrado), a aplicar cuando el esquema vuelva a abrirse

`tasks` no tiene ninguna columna donde guardar un conjunto de celdas, y `POST /api/land/clear` recibe
uno. La finalizacion, que corre horas de juego despues, tiene que reconstruir el area a partir de algo
almacenado, y lo unico almacenado es la parcela.

Lo que este modulo hace en consecuencia esta descrito en el apartado 3.3: un desmonte convierte la
parte talada completa de su parcela, y una seleccion que no la cubra entera se rechaza en la asignacion
con `VALIDATION_FAILED` y los dos recuentos en los detalles. Es una restriccion real y es la unica
alternativa honesta a inventar un almacenamiento: guardar las celdas en `Task.jobId`, que es texto sin
indice, o en `ScheduledEvent.dedupeKey`, que si lo tiene y reventaria con dos mil celdas, seria abuso
de una columna con otro significado.

El cambio que lo resolveria es una tabla `TaskCell (taskId, cellX, cellY)` con clave primaria
compuesta, o una columna `Task.areaCells Json?`. Con cualquiera de las dos, `assignClearLandTask`
guarda el area y `completeClearLand` la lee, y la restriccion desaparece sin tocar el contrato de API.

### 2.5 El desmonte de bosque que nunca fue parcela no esta cubierto

Categoria: hueco funcional derivado de 2.4
Ficheros afectados: `backend/src/modules/forestry/tasks.ts`, `requireClearingPlot`
Propietario: este mismo ambito, condicionado a 2.4

`clearLandBodySchema` declara `forestPlotId` opcional, "cuando las celdas pertenecen a una". Como el
area de un desmonte se reconstruye desde la parcela, este modulo exige que todas las celdas pertenezcan
a una misma parcela viva del jugador y rechaza el resto con `VALIDATION_FAILED` sobre `forestPlotId`.

En la practica no cierra el ciclo del juego: toda celda desmontable es una celda que una tala vacio, y
un arbol solo existe dentro de una parcela, de modo que el camino normal —comprar bosque, crear la
parcela, talar, desmontar— funciona entero. Lo que queda fuera es el atajo de desmontar bosque comprado
sobre el que nunca se creo una parcela, que ademas seria la unica via de sacrificar el arbolado sin
cobrarlo. Con la columna de 2.4 aplicada, la restriccion se levanta borrando `requireClearingPlot`.

### 2.6 La geometria de la parcela para la instantanea

Categoria: informacion para otro agente de la misma fase, sin cambio de fichero
Destinatario: W6-B (sesion e instantanea) y W6-D (paneles)

`snapshotReplySchema` declara `forestPlotCells`, y este modulo publica lo que hace falta para
rellenarlo: `plotCells(db, forestPlotId)` de `modules/forestry/index.ts` devuelve las celdas en orden
row major. El apartado 3.4 explica por que la geometria viaja por el marco y por la instantanea y no
dentro de `ForestPlotDto`.

## 3. Decisiones de este ambito, para `docs/adr.md`

Se anotan aqui porque el reparto de W6 asigna la escritura de los ADR al agente de cierre. Tres
entradas, en el tramo 0049 en adelante.

### 3.1 El arbol no almacena nada y la parcela lo agrega en cada lectura

`Tree` guarda especie, celda, `plantedAtGameMs`, estado y `felledAtGameMs`, y nada mas. La fase, la
edad y el volumen son evaluaciones de `shared/rules/forestry.ts`, que corre igual en el servidor y en el
cliente. El agregado de una parcela —recuento en pie, volumen talable, histograma de fases— se recalcula
sobre los arboles vivos en cada lectura y no se almacena en ninguna columna, y el motivo no es la
elegancia: el numero que habria que mantener cambia sin que nadie escriba nada, porque un arbol que
cruza las 480 horas mueve una unidad del histograma y anade 1 400 dm3 al volumen talable sin que ocurra
ninguna transaccion. Un contador seria un dato que envejece solo.

La consecuencia medible es que ninguna de las siete rutas del ciclo forestal escribe una fase, y que
la prueba "la fase de un arbol avanza con el reloj" es una lectura antes y otra despues sin ninguna
escritura entre medias.

### 3.2 El hito de crecimiento se agenda por parcela y por ventana, no por arbol

§130 admite un arbol por celda y una parcela admite hasta dos mil celdas, de modo que un evento por
arbol serian decenas de miles de filas para un hecho del que nada depende: §131 es explicito en que no
se pierde nada por no talar a tiempo. `FOREST_NOTIFY_MILESTONE` es por tanto de la parcela.

Un evento por parcela no basta por si solo: doscientos cincuenta arboles con edades repartidas maduran
en doscientos cincuenta instantes distintos, y eso serian doscientos cincuenta avisos consecutivos. El
instante de vencimiento se cuantiza por tanto a ventanas de veinticuatro horas de juego, que es el dia
del contador propio del jugador de §61. Cada frontera cae en exactamente una ventana, de modo que la
notificacion sigue siendo exacta, un arbol se reporta una vez y solo una, y no hace falta almacenar que
arboles ya se avisaron: el calendario apunta siempre a la ventana mas temprana que aun no ha vencido.

De ahi se deriva una regla que parece menor y no lo es: una fila pendiente se conserva y no se
recalcula. `syncPhaseSchedule` de `modules/fields` cancela y reagenda; aqui hacerlo perderia avisos, y
no en un caso raro sino en el corriente, porque una tala que termina entre el instante en que un arbol
madura y el vencimiento de su ventana es lo normal. Conservarla es seguro en la otra direccion: la
ventana pendiente solo puede ser anterior a la que produzca cualquier arbol posterior, porque un
planton replantado madura cuatrocientas ochenta horas despues de ahora y todo arbol ya presente se
planto no mas tarde que ahora. Una fila obsoleta es, como mucho, una ventana que no reporta nada, y el
manejador responde reagendando.

### 3.3 El lote de una tala se recuerda marcando sus arboles, y un desmonte es una operacion sobre la parcela

§132 define la tala en dos pasos, `MARK_FOR_HARVEST(treeId)` y despues `FELL(treeId)`, y el MVP
simplifica la interaccion a un area conservando el modelo de datos por arbol. Eso es exactamente lo que
hace falta: la asignacion marca los arboles del area seleccionada y la finalizacion tala los marcados.
La alternativa seria una geometria en la fila de la tarea, y `tasks` no tiene columna para una.

La marca es interna: toda lectura de este modulo trata un arbol marcado como vivo, y el marco que la
asignacion emite lleva la parcela y no los arboles, de modo que el agregado no cambia y el cliente no
ve nada raro. Lo que compra es lo unico que el esquema congelado no puede expresar de otra forma: que
arboles selecciono el jugador.

Un desmonte no dispone de esa marca, porque una celda desmontable es por definicion una celda sin
arbol. Su area se reconstruye desde la parcela como "las celdas que no llevan arbol vivo", que es
justamente el suelo que una tala vacio y justamente lo que §137 ofrece convertir. La peticion tiene por
tanto que nombrar ese conjunto entero, y una seleccion que sea un subconjunto estricto se rechaza en la
asignacion en lugar de sorprender al jugador con otro subconjunto del mismo tamano trescientas horas de
juego despues. Las dos mitades de esta decision —la restriccion y el motivo— estan en el apartado 2.4.

### 3.4 La parcela publica su geometria por el marco y por la instantanea, nunca dentro de su DTO

`ForestPlotDto` lleva `cellCount` y no las celdas, y no puede llevarlas: `shared/` esta congelado. El
contrato si ofrece dos canales para la geometria, y los dos se usan: `FOREST_PLOT_UPSERTED` declara
`cells` anulable, con la misma regla que `FIELD_UPSERTED` —las celdas cuando cambian y null cuando no—,
y `snapshotReplySchema` declara `forestPlotCells`.

Este modulo emite la geometria en la creacion, que es cuando la parcela nace, y en la finalizacion de
un desmonte, que es la unica operacion que la reduce. Entre esos dos momentos no cambia, de modo que
ningun marco intermedio la repite. El respaldo que `NOTES-w5d.md` 5.5 describe —colocar los arboles
desde `TREES_UPSERTED`— sigue siendo el camino correcto para los arboles, que es lo que la capa de
entidades dibuja; lo que la geometria de la parcela alimenta es el contorno, que es otra capa.

## 4. Discrepancias detectadas

### 4.1 `CLEAR_LAND` con `targetForestPlotId`, frente al comentario del esquema

`schema.prisma` comenta sobre `Task` que "`CLEAR_LAND` no tiene ninguno [de los dos objetivos], porque
apunta a un conjunto de celdas", y la restriccion `tasks_target_check` solo prohibe tener los dos a la
vez. Este modulo escribe `targetForestPlotId` en una tarea de desmonte, que la restriccion admite y el
comentario no anticipaba, porque es lo unico que permite reconstruir el area (apartado 2.4). No es una
contradiccion con el esquema, sino con su comentario.

### 4.2 `MACHINE_WRONG_FARM` no tenia ningun productor

El codigo existe en `shared/domain/enums.ts` desde W2 y ninguna ruta lo emitia. Este modulo lo emite al
comprobar que la maquinaria de una tarea pertenece a la misma granja que el trabajador, que es la mitad
legible del disparador `task_machines_farm_guard`. Sin ella el rechazo llegaria como un error de base
de datos.

### 4.3 La cifra de §138 se reproduce, la de la primera tala depende de la mezcla

La generacion cumple lo que `NATURAL_FOREST` promete: sobre mil celdas la mezcla de fases cae dentro de
cinco puntos porcentuales de la distribucion declarada y el volumen talable dibujado queda dentro del
10 % de la forma cerrada de `expectedNaturalForestVolumeDm3`, que es lo que el informe de balance cita.
Sobre doce celdas, que es lo que la verificacion HTTP compro, la dispersion es la que cabe esperar de
una muestra pequena: cuatro pasadas dieron 19 800, 14 500, 18 800 y 19 100 dm3 talables. La resolucion 40 del
apartado 2 de las erratas, que el apartado 2.7 de `NOTES-w5-cierre.md` deja pendiente para W7-D, no se
ve afectada: sigue siendo la produccion de una tala, 382,5 m3, y no el volumen medio del arbolado.

### 4.4 Las suites unitarias del backend siguen fuera de `make test-unit`

Las quince pruebas de `__tests__/forestry/generator.test.ts` no las ejecuta ninguna puerta. Es el punto
que el apartado 2.8 de `NOTES-w5-cierre.md` ya recoge con propietario W7-A y una linea en el
`Makefile`; esta fase lo agrava en quince pruebas mas.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 2.3 `hasStandingTree` del solape de chunk no cuenta el arbol marcado

Aplicado por W7-A (integracion), con el cambio exacto que la nota describe: `t."status" <> 'FELLED'` en
la consulta de solape de chunk y `status: { in: ['STANDING', 'MARKED_FOR_HARVEST'] }` en
`standingTreeCells`.

El texto original de la nota:

Categoria: cambio en fichero congelado de una fase anterior
Ficheros afectados: `backend/src/modules/world/cellRepo.ts` (linea 504) y
`backend/src/modules/world/service.ts` (`standingTreeCells`)
Propietario del cambio: W3-B (cerrado), a aplicar por W7-A

Las dos consultas filtran por `status = 'STANDING'`. Un arbol marcado por una tala en curso
(`MARKED_FOR_HARVEST`, §132) sigue ocupando su celda y esas dos consultas dicen que no. La consecuencia
visible es que, mientras dura una tala, las celdas del lote viajan al cliente con
`hasStandingTree: false`, de modo que la capa de uso las dibuja como vacias y la regla compartida
`canClearCell` las aceptaria.

El cambio es una palabra en cada sitio: `t."status" <> 'FELLED'` en lugar de `t."status" = 'STANDING'`,
y `status: { in: ['STANDING', 'MARKED_FOR_HARVEST'] }` en el segundo.

Mitigacion adoptada mientras tanto: este modulo no confia en esas dos consultas para nada que decida.
`requireCellsWithoutTree` de `tasks.ts` repite la comprobacion sobre todo arbol vivo antes de aceptar
una replantacion o un desmonte, y el `UPDATE` de `applyClearing` excluye la celda con arbol vivo dentro
del propio statement, de modo que el camino que podria convertir suelo bajo un arbol en tala esta
cerrado en el servidor. Lo que queda es cosmetico y de una fase anterior.

### 2.2 La cancelacion de una tarea forestal necesita la funcion de este modulo

Aplicado por W7-A (integracion), con la segunda de las dos opciones: un registro de estrategias en
`backend/src/lib/moduleSeams.ts`, que `src/handlers.ts` rellena y `cancelTask` consume. Se descarto
relajar la zona de ESLint porque la dependencia es entre hermanos de la misma fase, que es exactamente lo
que la regla existe para impedir, y relajarla la habria legitimado para todo el modulo y de forma
permanente.

`releaseForestryTask` se estrecho al hacerlo, y el motivo importa: `cancelTask` ya retira el trabajo
agendado, libera las maquinas, el trabajador y el puntero de la parcela, y libera la reserva de almacen
de toda operacion que declare una en la tabla de GDD 90, que incluye `FELL`. Repetir cualquiera de esas
cosas habria liberado la reserva de madera dos veces. Lo que solo este modulo sabe, y lo unico que la
estrategia hace, es devolver a `STANDING` los arboles `MARKED_FOR_HARVEST` y emitir las tramas de la
parcela y de su arbolado. La prueba `la cancelacion de una tala (GDD 106 y 132)` de
`forestry.int.test.ts` la ejercita de extremo a extremo por HTTP, y afirma tambien que
`reservedWoodDm3` queda en cero, que es el doble descuento que la costura podia introducir.

El texto original de la nota:

Categoria: costura entre dos ambitos de la misma fase
Ficheros afectados: `backend/src/modules/tasks/` (W6-A)
Propietario del cambio: W6-A, o W7-A si W6-A ya cerro

`POST /api/tasks/:taskId/cancel` es de `modules/tasks` y la regla 4 del plan prohibe que ese modulo
importe este. Una cancelacion de una tala tiene que deshacer tres cosas que solo este modulo conoce:
las marcas `MARKED_FOR_HARVEST` de los arboles del lote, la reserva de madera del almacen de destino y
el puntero `ForestPlot.currentTaskId`. Este modulo publica exactamente eso:

```ts
// backend/src/modules/forestry/index.ts
export async function releaseForestryTask(tx: Tx, outbox: Outbox, task: TaskRecord): Promise<void>
```

Hay dos formas de aplicarlo y las dos tocan un fichero congelado, asi que la eleccion es de W7-A:

1. Anadir `'./forestry'` al `except` de la zona de `tasks` en `eslint.config.js`, lo que convierte la
   dependencia en legitima y permite la llamada directa. Es una linea y no altera ninguna otra zona.
2. O declarar un registro de estrategias de cancelacion en `backend/src/lib/`, con la misma forma que
   `registerSettleSweepHook` de `lib/jobs.ts`, que este modulo rellenaria desde
   `registerForestryRoutes`.

Mitigacion adoptada mientras tanto: `requireIdlePlot` de este modulo deriva la ocupacion de la parcela
de la tabla de tareas y no del puntero (ADR-0040), de modo que una cancelacion que dejara
`currentTaskId` colgado no bloquea la parcela. Lo que si queda mal sin la costura es la madera
reservada, que seguiria ocupando capacidad hasta que otra tala la libere, y los arboles marcados, que
seguirian contando como vivos y no volverian a `STANDING`. Ninguna prueba de integracion ejerce hoy la
cancelacion de una tarea forestal, precisamente porque la ruta no es de este ambito.

### 2.1 El proceso `worker` no instala la contribucion forestal a `TASK_COMPLETE`

Aplicado por W7-A (integracion): `registerForestryScheduledHandlers` se invoca desde
`registerModuleExtensions` de `src/handlers.ts`, que los dos procesos ejecutan.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `backend/src/worker.ts`
Propietario del cambio: W3-A (cerrado), a aplicar por W7-A

`registerForestryScheduledHandlers()` se invoca desde `registerForestryRoutes`, que es el punto de
registro que este modulo posee, exactamente como `registerEconomyRoutes` invoca
`registerEconomySweepHooks` para la liquidacion forzosa de ADR-0039. `src/worker.ts` llama a
`registerDomainHandlers` y no construye la aplicacion Fastify, de modo que en el proceso de la cola la
composicion no queda instalada y una finalizacion forestal procesada solo por la cola cae en el
manejador de `modules/tasks`.

Es el mismo defecto que el apartado 2.2 de `NOTES-w5-cierre.md` recoge para
`registerSettleSweepHook`, y el parche es de dos lineas:

```ts
// backend/src/worker.ts, junto a registerDomainHandlers(services)
import { registerForestryScheduledHandlers } from './modules/forestry/index.js';
registerForestryScheduledHandlers();
```

Mitigacion adoptada mientras tanto: ninguna correccion se pierde. La primera peticion del jugador pasa
por `withPlayerAdvanced`, que corre en el proceso servidor, donde la composicion si esta instalada, y
aplica la finalizacion pendiente. Lo que se pierde es puntualidad, que es exactamente lo que la
seccion 6.3 del plan declara opcional.
