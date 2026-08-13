# NOTES-w4c

Agente de campos. Fase W4. Ambito escrito: `backend/src/modules/fields/**` y
`backend/src/__tests__/fields/**`. Ningun fichero fuera de esos dos directorios se ha
modificado.

Este fichero recoge lo que otros agentes deben aplicar y que W4-C no podia aplicar, las
decisiones que condicionan a las fases siguientes y las discrepancias detectadas entre el
brief, el plan, el contrato y el esquema.

## 1. Pendiente para otros agentes

### 1.3 Material para las entradas de ADR de la fase

Categoria: cambio en fichero de otro propietario
Ficheros afectados: `docs/adr.md`
Propietario del cambio: W4-A, que segun el apartado 3.3 de `docs/ownership.md` escribe las
entradas 0023 a 0026 de esta fase

El apartado 2 de este fichero lleva el material, redactado para que se incorpore con
`scripts/adr-append.mjs`. La entrada que le corresponde por tema es la de geometria de campos
y contiguidad por recorrido en anchura; los apartados 2.2 a 2.6 son consecuencias de esa misma
decision y no piden entrada propia.

## 2. Decisiones de W4-C que condicionan a las fases siguientes

### 2.1 La regla de resolucion de la fusion (GDD 22)

La seccion 22 del GDD exige validar "contiguidad, compatibilidad, propiedad y estado agricola"
y anade que la fusion "no deberia destruir progreso agricola sin razon explicita", sin decir
que hacer cuando las partes difieren. La regla implementada, y su justificacion, es esta:

1. Dos campos en fases distintas del ciclo no se fusionan: la peticion se rechaza con
   `FIELD_MERGE_INCOMPATIBLE`. Es la unica lectura de la frase del GDD que no destruye nada.
   Fusionar un campo `GROWING` con uno `VIRGIN` obligaria a conceder al virgen un cultivo que
   nunca se sembro, lo que crea rendimiento de la nada, o a descartar el que crecia, que es la
   destruccion que la seccion prohibe. El rechazo deja siempre un remedio obvio al jugador:
   cosechar o trabajar la otra mitad primero.
2. El estado que se compara es el proyectado y no el almacenado. Cada campo se materializa
   antes de la comparacion, en la misma transaccion, de modo que un campo cuyo trabajo de
   crecimiento no ha corrido se compara por lo que realmente es.
3. Compatible significa el mismo estado del ciclo, el mismo cultivo, la misma condicion del
   suelo y la misma granja de servicio. La condicion del suelo forma parte del estado agricola
   que la seccion 22 manda validar, y la granja decide a que silo va la cosecha (seccion 31 del
   GDD, resuelta por la seccion 2.2 del plan); ninguna de las dos se puede elegir al azar.
4. Los atributos paralelos del resultado son la media de las partes ponderada por numero de
   celdas, truncada. Fertilidad, malezas y fertilizacion son magnitudes intensivas sobre una
   superficie, de modo que ponderar por superficie es la unica combinacion bajo la cual
   fusionar y cosechar produce lo que habria producido cosechar las partes por separado, salvo
   el truncamiento de un punto base.
5. La linea de tiempo de crecimiento del resultado es la mas tardia de las partes. No es una
   preferencia: es la unica eleccion bajo la cual la fase proyectada del campo fusionado sigue
   siendo la fase comun de las partes. Tomar la mas temprana, o la media, podria situar el
   resultado mas alla de una frontera que ninguna parte habia cruzado, que es progreso
   concedido gratis.
6. Sobrevive el primer campo de la peticion y los demas quedan con borrado logico. Crear una
   tercera identidad, que es como la seccion 22 lo dibuja, dejaria huerfana toda referencia que
   ya apunta a las partes: la referencia polimorfica del ledger (ADR-0009), el historico de
   tareas y la columna de reserva llevan identificadores de campo. La respuesta del contrato,
   `{ field, removedFieldIds }`, admite las dos formas, y la que conserva el rastro es esta.

Consecuencia registrada: el campo absorbido conserva su `cellCount`. `fields_geometry_check`
de la migracion inicial exige recuento positivo, y ademas una fila con borrado logico registra
lo que la entidad fue; la geometria que posee de verdad es cero celdas, y eso ya lo dice
`world_cells`, cuyas filas apuntan al superviviente.

### 2.2 La ampliacion se restringe a los estados en los que aun no hay cosecha

La seccion 20 del GDD pide "tierra adyacente, propiedad del jugador, terreno compatible y
ausencia de infraestructura" y no dice nada del estado del campo. Anadir celdas sin sembrar a
un campo ya `SEEDED` aumentaria `cellCount`, que multiplica directamente el rendimiento de la
seccion 83, de modo que el jugador cosecharia una superficie que nunca sembro. La ampliacion se
admite por tanto desde `VIRGIN`, `PLOWED`, `CULTIVATED` y `HARVESTED`, y se rechaza con
`FIELD_STATE_NOT_ALLOWED` desde las tres fases cronometradas y desde `READY_TO_HARVEST`.

La division no lleva esa restriccion y se admite en cualquier estado: las dos mitades heredan
la linea de tiempo y los atributos sin cambio, la suma de celdas se conserva y por tanto el
rendimiento total tambien.

### 2.3 El intervalo de un atributo perezoso se corta por las fronteras de fase

Es la pieza del modulo que mas facil habria sido escribir mal sin que se notara. Las malezas
crecen solo en `GROWING`, `READY_TO_HARVEST` y `VIRGIN` (seccion 78). Un campo sembrado y
dejado en paz cien horas tiene `weedLevelUpdatedAtGameMs` en el instante de la siembra y estado
almacenado `SEEDED`, porque ningun trabajo ha corrido todavia. Proyectar todo el intervalo con
el estado almacenado no haria crecer ninguna maleza; proyectarlo con el estado actual las haria
crecer tambien durante las seis horas de `SEEDED` y las doce de `GERMINATING`, donde la seccion
78 dice que no crecen. Las dos lecturas se equivocan en decenas de puntos porcentuales del
rendimiento de la seccion 83 y ninguna se detecta sin hacer la cuenta a mano.

`phaseSegments` corta el intervalo por las fronteras que la linea de tiempo implica y acumula
cada tramo con el estado que estuvo en vigor durante el, llamando en cada tramo a
`projectWeedLevel` de `shared/rules/yield.ts`, de modo que la tasa, la lista de estados y la
saturacion siguen teniendo una unica implementacion. El coste es el truncamiento por tramo, a lo
sumo cuatro puntos base por liquidacion, que es la cota de ADR-0013 multiplicada por el numero de
fases de un ciclo.

### 2.4 Una frontera por evento agendado, y la proyeccion como autoridad

El manejador de `FIELD_ADVANCE_PHASE` materializa la frontera vencida en el instante en que se
cruzo, no en el instante en que el trabajo la noto, y agenda la siguiente al salir. Un jugador
que vuelve tras doscientas horas cruza por tanto las tres fronteras en tres pasadas de la cola,
cada una dejando el historico almacenado donde lo habria dejado una ejecucion puntual. Ponerse al
dia con todas las fronteras dentro de un solo manejador aplicaria efectos mas alla del instante
hasta el que se liquidaron los devengos, que es el error que el orden de `advancePlayer` existe
para evitar.

El camino de escritura no depende de eso: `applyFieldOperation` llama primero a
`materializeProjectedPhase`, de modo que una cosecha asignada a un campo cuyo trabajo no ha
corrido se acepta y la transicion se materializa en la misma transaccion. La prueba de
integracion compara las dos filas resultantes con igualdad literal y comprueba que aplicar
cualquiera de los dos caminos dos veces no cambia nada ni escribe otro sobre.

### 2.5 Lo que W6-A encuentra ya hecho

`modules/tasks` es de una fase posterior y por tanto puede importar `modules/fields` (la zona de
ESLint lo permite desde el cierre de W3). El motor de tareas no debe reimplementar nada del ciclo:

- `applyFieldOperation(tx, outbox, reading, field, { operation, cropId })` aplica el efecto de
  dominio de una operacion completada. Materializa la fase proyectada, valida contra
  `OPERATION_REQUIREMENTS` de la seccion 90 del GDD, aplica la transicion con sus efectos
  laterales (condicion del suelo de la seccion 81, reseteo de malezas de la seccion 78, drenaje
  de fertilidad de la seccion 77), encadena `HARVESTED -> VIRGIN` y deja el agendado
  sincronizado. Devuelve `harvestedLiters` cuando la operacion es `HARVEST`, calculado con
  `finalYieldLiters` de las reglas compartidas y con los atributos liquidados justo antes de la
  transicion; depositarlos en el silo no es regla de este modulo (secciones 83 y 97).
- `requireField`, `findLiveField`, `fieldCells`, `requireIdleField` y `buildFieldDto` son el
  modelo de lectura, y `fieldUpsertedFrame` construye el sobre.
- `requireOperationAllowed` y `requireTransition` son la puerta de la maquina de estados, y
  lanzan el `ApiError` con la lista de estados admisibles en los detalles.
- La reserva del campo se hace escribiendo `Field.currentTaskId`, que tiene indice unico y es la
  red de la restriccion dura correspondiente; `requireIdleField` es la comprobacion previa.

### 2.6 El rendimiento esperado se publica en cualquier estado

`FieldProjection.expectedYieldLiters` aplica la formula de la seccion 83 sea cual sea el estado
del campo, que es la lectura literal del contrato y es lo que hace util la cifra: sobre un campo
sin sembrar es la estimacion de planificacion que la interfaz necesita para comparar dos parcelas,
y el estado viaja al lado para que un panel que no deba mostrarla lo sepa. Un campo sin cultivo
asignado se costea con `FALLOW_RATE_CROP`, que hoy es el trigo, por el mismo motivo por el que la
tasa de malezas de un campo virgen sale del catalogo del trigo: la seccion 78 hace del crecimiento
de malezas una propiedad de la tierra y la seccion 82 publica la tasa dentro del cultivo, y con un
solo cultivo en el MVP las dos lecturas coinciden.

## 3. Discrepancias detectadas

### 3.1 La seccion 84 del GDD no es reproducible con el catalogo de la seccion 82

Ya prevista por la seccion 2.2 del plan y confirmada aqui con numeros. El ejemplo narrativo dice
que el nivel de malezas subio al 34 % y que la penalizacion fue de "alrededor del 14 %". Con la
tasa que la seccion 82 publica, 0,6 %/h, y con las 78 horas de `GROWING` que la reparticion de
fases del plan fija, el nivel es del 46,8 % y la curva de la seccion 78 da el 18,72 %. No se
ajusta ningun valor: se implementa el catalogo literal y la desviacion queda afirmada en las dos
suites, en `projection.test.ts` y en `fields.int.test.ts`.

Lo que si reproduce el ejemplo, y las pruebas lo comprueban, es el resto del recorrido: `VIRGIN`
con fertilidad 100 %, `GERMINATING` a las 6 horas, `READY_TO_HARVEST` a las 96, y fertilidad al
85 % despues de cosechar.

### 3.2 `readyAtGameMs` fuera de la parte cronometrada

El contrato dice que es nulo "fuera de la parte cronometrada del ciclo". Se ha implementado
literalmente: la cifra viaja mientras la fase proyectada es `SEEDED`, `GERMINATING` o `GROWING`, y
es nula desde `READY_TO_HARVEST` en adelante. La lectura alternativa, publicarla tambien en
`READY_TO_HARVEST` como "el instante en que llego", habria sido igual de defendible; se elige la
literal porque en ese estado no queda ninguna cuenta atras que mostrar.

### 3.3 El campo absorbido por una fusion no puede quedar con `cellCount` cero

`fields_geometry_check` de `20260811205212_init` exige `"cellCount" > 0`, de modo que un campo con
borrado logico conserva el recuento que tenia. No se pide cambiar la restriccion: la
interpretacion elegida (apartado 2.1) es coherente con ella.

### 3.4 La sesion caduca al mover el reloj inyectado del arnes

No es un defecto y se anota porque costo diagnosticarlo y lo va a volver a costar. El verificador
de tokens lee `services.clock.nowRealMs()`, que en la suite de integracion es el reloj inyectado,
y el multiplicador del mundo de pruebas es uno a uno. Avanzar noventa y seis horas de juego caduca
por tanto un token emitido quince minutos antes en su propio marco. Una prueba que avance el reloj
y siga usando HTTP tiene que renovar la sesion; `fields.int.test.ts` lo hace con un ayudante
`login(label)`.

### 3.5 El barrido periodico de liquidacion cuenta como evento procesado

`advancePlayerNow` devuelve `processedEvents` de todos los tipos, y un jugador recien registrado
tiene ya su `PLAYER_SETTLE_SWEEP` agendado. Una prueba que quiera contar transiciones de fase debe
afirmar sobre el estado del campo, o filtrar por tipo, y no sobre el recuento total. Se anota para
W5 y W6, que van a escribir pruebas del mismo estilo.

## 4. Verificacion ejecutada

| Orden | Resultado |
|---|---|
| `make sync-types` | exit 0. 53 ficheros a cada copia |
| `make typecheck` | exit 0. `shared`, `backend` y `frontend` sin salida |
| `make lint` | exit 0. `npx eslint .` sin hallazgos, incluidas las reglas de zona; Prettier conforme |
| `make test-unit` | exit 0. `shared` 23 ficheros y 418 pruebas; cliente 9 ficheros y 93 pruebas |
| `cd backend && npx vitest run` | 4 ficheros y 54 pruebas en verde, incluidas las 17 de `__tests__/fields/projection.test.ts` |
| `cd backend && npx vitest run --config vitest.int.config.ts` | 16 ficheros y 182 pruebas: 178 en verde y 4 en rojo, las cuatro del apartado 1.1, dos de ellas de `farms` |
| `cd backend && npx vitest run --config vitest.int.config.ts src/__tests__/fields/fields.int.test.ts` | 19 pruebas en verde, ejecutado tres veces seguidas para descartar dependencia de la semilla aleatoria del arnes |
| `npx tsx src/server.ts` mas `curl` | Registro, compra de tierra por `land`, creacion de campo, listado, detalle, division, fusion, fusion repetida y ampliacion sin adyacencia |

Comprobacion por HTTP real, con el servidor en el puerto 3211 y PostgreSQL y Redis en 55432 y
56379. Salidas abreviadas:

```text
POST /api/fields (celdas sin comprar)  -> 409 CELL_NOT_OWNED, details.cells [{628,-437}]
POST /api/land/purchase (6 celdas)     -> 200, totalPaid 720.0000
POST /api/fields                       -> 200, cellCount 6, cropCycleState VIRGIN,
                                          projection.availableOperations ["PLOW"],
                                          projection.expectedYieldLiters 540
GET  /api/fields                       -> 200, un campo
GET  /api/fields/:id                   -> 200, cellCount 6, cells 6
POST /api/fields/:id/split (3 celdas)  -> 200, original 3, created 3, moved 3
POST /api/fields/merge                 -> 200, cellCount 6, removedFieldIds [created]
POST /api/fields/merge (repetido)      -> 404 (el absorbido ya no existe)
POST /api/fields/:id/extend (lejano)   -> 400 SELECTION_NOT_ADJACENT
```

No ejecutado, conforme al brief: `git`, `npm install`, `prisma generate`, `prisma migrate`,
`docker compose` y construcciones de produccion.

Estado en que queda la base de datos de desarrollo: como estaba. El jugador que la comprobacion
con `curl` creo, sus seis celdas y sus campos se borraron al terminar; los mundos de las pruebas
de integracion los borra el desmontaje del arnes.

## 5. Ficheros creados

| Ruta | Contenido |
|---|---|
| `backend/src/modules/fields/projection.ts` | Proyeccion pura: corte del intervalo por fronteras de fase, liquidacion de malezas, fertilidad y fertilizacion, fase y progreso, operaciones disponibles y rendimiento esperado |
| `backend/src/modules/fields/stateMachine.ts` | Interrogacion de las dos tablas de `shared/config`: transiciones de la seccion 76 y requisitos de operacion de la seccion 90 |
| `backend/src/modules/fields/service.ts` | API interna: lecturas, modelo de lectura, escritura de una transicion, materializacion de la fase, agendado, operacion del jugador y las cuatro operaciones de geometria |
| `backend/src/modules/fields/routes.ts` | Las seis rutas del area |
| `backend/src/modules/fields/jobs.ts` | Manejador de `FIELD_ADVANCE_PHASE`, que sustituye el andamiaje de W3-A |
| `backend/src/modules/fields/index.ts` | Barril del modulo, con `registerFieldsRoutes` en el mismo punto que el andamiaje |
| `backend/src/__tests__/fields/projection.test.ts` | 17 pruebas unitarias sin base de datos |
| `backend/src/__tests__/fields/fields.int.test.ts` | 19 pruebas de integracion contra PostgreSQL y Redis reales |

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 1.2 `make test-unit` no ejecuta la suite unitaria del backend

Aplicado por W7-A (integracion). El objetivo `test-unit` del `Makefile` recorre `shared`, `backend` y
`frontend`. Son 82 pruebas en 6 ficheros que ninguna puerta ejecutaba.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `Makefile`, objetivo `test-unit`
Propietario del cambio: W7-A

`test-unit` ejecuta `shared` y `frontend` y nada mas, de modo que las pruebas unitarias del
backend, que hoy son cuatro ficheros y 54 casos y no necesitan ni PostgreSQL ni Redis, no
entran en ninguna puerta. Entre ellas estan las diecisiete de
`backend/src/__tests__/fields/projection.test.ts`, que son las que afirman la formula
analitica de la seccion 78 del GDD y el recorrido de la maquina de estados de la seccion 76.

No es una regresion de esta fase: la asimetria existe desde W1 y afecta igual a
`lib/__tests__/primitives.test.ts`, `lib/__tests__/jwt.test.ts` y
`plugins/__tests__/config.test.ts`. Se anota porque a partir de ahora hay contenido de dominio
detras.

Cambio a aplicar, una linea: anadir `@cd backend && npm run --silent test` al objetivo
`test-unit`, entre `shared` y `frontend`.

Mitigacion adoptada: la suite se ejecuta con `cd backend && npx vitest run`, y su salida real
esta en el apartado 4.

### 1.1 `app.int.test.ts` da por no implementadas dos rutas del area `fields`

Resuelto por ADR-0038: la lista se deriva de `stubRouteKeys()`.

El texto original de la nota:

Categoria: cambio en fichero de otro propietario
Ficheros afectados: `backend/src/__tests__/app.int.test.ts`, constante `IMPLEMENTED` y la
afirmacion `expect(stubs.length).toBe(40)`
Propietario del cambio: W3-A (cerrado); lo aplica el agente de cierre de W4 o W7-A

La constante `IMPLEMENTED` enumera a mano las quince rutas que estaban implementadas al
cierre de W3. Las cuatro rutas mutantes del area `fields` siguen pasando la prueba, porque
con cuerpo vacio entran por la rama de 400 que la propia prueba admite; las dos de lectura
no, porque ya responden de verdad.

Salida real, `cd backend && npx vitest run --config vitest.int.config.ts`:

```text
× GET /api/farms responde 501 con NOT_IMPLEMENTED 13ms
× DELETE /api/buildings/:buildingId responde 501 con NOT_IMPLEMENTED 11ms
× GET /api/fields responde 501 con NOT_IMPLEMENTED 8ms
× GET /api/fields/:fieldId responde 501 con NOT_IMPLEMENTED 7ms
Test Files  1 failed | 15 passed (16)
Tests  4 failed | 178 passed (182)
```

Dos de los cuatro fallos son de `farms` y no de este modulo, lo que confirma que el fichero
es un punto de encuentro de tres agentes de la misma fase. Por eso no se ha tocado: editarlo
desde aqui habria sobrescrito el trabajo de W4-B, que es exactamente lo que la regla 1 de la
seccion 11 del plan existe para evitar, y es el mismo caso que el apartado 1 de
`NOTES-w3-cierre.md` dejo pendiente para las dos rutas del area `world`.

Cambio a aplicar, una vez, cuando los tres modulos de W4 hayan aterrizado: anadir a
`IMPLEMENTED` las rutas realmente servidas por `land`, `farms` y `fields`, y bajar
`expect(stubs.length)` al numero que quede. Con los tres modulos completos, las seis del area
`fields` son:

```text
'GET /api/fields', 'GET /api/fields/:fieldId', 'POST /api/fields',
'POST /api/fields/:fieldId/extend', 'POST /api/fields/:fieldId/split',
'POST /api/fields/merge'
```

Mitigacion adoptada mientras tanto: ninguna posible desde este ambito. El fallo es explicito
y no oculta ningun defecto del servicio: los otros quince ficheros de la suite de integracion
estan en verde, incluidos los diecinueve casos de `src/__tests__/fields/fields.int.test.ts`.
