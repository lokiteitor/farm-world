# Modelo de datos y garantías de la base de datos

Estado: vigente desde el cierre del flujo de trabajo W2. `schema.prisma`, `prisma.config.ts` y
`seed.ts` quedan congelados a partir de esa fase; las migraciones posteriores se añaden como
ficheros nuevos en `migrations/`.

Este documento describe qué hay en la base de datos, qué invariantes garantiza por sí misma y por
qué cada restricción está donde está. La referencia normativa es la sección 5 del plan de
implementación; los números de balance provienen del GDD, citado por sección en el propio esquema.

---

## 1. Alcance

PostgreSQL es la única fuente de verdad. Redis no es autoritativo para dinero ni para capacidad:
cachear un saldo y validar contra él es la vía más rápida para crear dinero de la nada. Redis
cachea chunks, transporta la cola, publica eventos hacia los WebSocket y guarda el anillo de
reproducción y los tickets.

El esquema cubre el alcance completo de las fases 0 a 8 del roadmap (§71), no solo la fase en curso.
Se escribe una vez y se congela porque lo leen todos los agentes posteriores, y porque una columna
añadida a PostgreSQL es instantánea mientras que migrar un enum de Prisma no lo es.

Veinte modelos: `World`, `WorldTimeSegment`, `Player`, `RefreshToken`, `Chunk`, `WorldCell`, `Farm`,
`Building`, `Field`, `Machine`, `Worker`, `WorkerCandidate`, `Task`, `TaskMachine`, `ForestPlot`,
`Tree`, `LedgerEntry`, `ScheduledEvent`, `GameEvent`, `RequestIdempotency`.

---

## 2. Contrato real de Prisma 7.9.1

El plan fija Prisma 7.9.1 y ordena adaptarse al andamiaje oficial en lugar de escribir la
configuración de memoria. El contrato encontrado difiere del de Prisma 6 en cinco puntos que
condicionan al resto del backend.

| Punto                    | Prisma 6                                            | Prisma 7.9.1                                                                                                                           |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Configuración            | Bloque `datasource` con `url = env("DATABASE_URL")` | `prisma.config.ts` en la raíz del proyecto npm, con `defineConfig` importado de `prisma/config`. El esquema declara solo el `provider` |
| Carga de `.env`          | Automática                                          | No existe. La hace el fichero de configuración                                                                                         |
| Generador                | `prisma-client-js`, salida en `node_modules`        | `prisma-client` con `output` obligatorio. Emite TypeScript, no JavaScript compilado. `prisma-client-js` ya no existe                   |
| Construcción del cliente | `new PrismaClient()`                                | Exige un adaptador de driver: `new PrismaClient({ adapter })`. No existen `datasourceUrl` ni `datasources`                             |
| Semilla                  | Clave `prisma.seed` en `package.json`               | Clave `migrations.seed` en `prisma.config.ts`                                                                                          |

Consecuencias adoptadas:

1. `prisma.config.ts` carga el `.env` de la raíz del repositorio con `process.loadEnvFile`, que es
   parte de Node 22 y, como `--env-file`, no sobrescribe una variable ya presente. Se descarta
   `dotenv`, que el andamiaje oficial sugiere, porque no está declarado en `backend/package.json`,
   que está congelado, y porque solo reproduciría lo que el propio runtime ya ofrece. La ruta se
   resuelve desde la ubicación del fichero, no desde el directorio de trabajo, porque los comandos
   se invocan como `cd backend && npx prisma ...`.
2. La salida del generador es `backend/src/generated/prisma`. No es una preferencia: los ficheros
   emitidos son TypeScript y tienen que compilarlos el propio proyecto, y `tsconfig.build.json`
   declara `rootDir: "src"`, de modo que cualquier fuente generada fuera de ese directorio falla la
   compilación con TS6059. Es el mismo arreglo que `backend/src/shared`: generado, no editable a
   mano, no versionado. Está excluido en `.gitignore` y en `.prettierignore` desde la ventana de
   parcheo de W2.5.
3. Las cuatro opciones restantes del generador se fijan explícitamente (`runtime = "nodejs"`,
   `moduleFormat = "esm"`, `generatedFileExtension = "ts"`, `importFileExtension = "js"`) en lugar de
   dejar que se deduzcan del `tsconfig`, para que los especificadores emitidos no cambien si más
   adelante se cambia una opción del compilador.
4. El adaptador obligatorio es `@prisma/adapter-pg@7.9.1`, que arrastra `pg` como dependencia propia.
   No está declarado en `backend/package.json`. Es la única dependencia que bloquea la ejecución del
   backend y del `seed`; figura como punto 1 de `docs/handoff/NOTES-w2d.md`.

Forma de importar el cliente desde `backend/src`:

```ts
import { PrismaClient } from '../generated/prisma/client.js'; // desde src/plugins
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
```

Los tipos de modelo y los enums generados se importan del mismo fichero (`client.js` reexporta
`./enums.js` y `./models.js`). No se importan desde `@prisma/client`, que en Prisma 7 solo aporta el
runtime.

Prisma 7 no genera `DEFAULT` en la base de datos para `@default(uuid(7))`: el identificador lo
produce el cliente. Cualquier inserción en SQL crudo, incluidas las de las pruebas de integración,
debe aportar el identificador, por ejemplo con `gen_random_uuid()`.

---

## 3. Convenciones del esquema

1. Tiempo. Todo instante con significado de simulación o económico es `BigInt` de milisegundos de
   juego, con sufijo `GameMs`. Los instantes reales llevan sufijo `RealMs`, existen solo para trazas
   y agendado, y de ellos nunca se deriva tiempo de juego. No hay ninguna columna `timestamptz` en el
   esquema, deliberadamente: invitaría a esa derivación.
2. Dinero. `Decimal(20,4)`. La liquidación de costes continuos es muy frecuente por diseño y
   redondear a céntimos en cada una acumula un sesgo sistemático a favor del jugador. El único
   constructor en el lado de la aplicación es el módulo `Money` de `shared/domain`, que serializa
   como cadena decimal canónica de cuatro decimales.
3. Porcentajes. Enteros en puntos base, 0 a 10000, con rango comprobado por `CHECK`. La acumulación
   perezosa debe ser determinista y reproducible en las pruebas.
4. Cantidades fungibles. Enteras en su unidad de almacenamiento: trigo en litros, madera en
   decímetros cúbicos. Los volúmenes de §131 son múltiplos de 0,05 m³ y sumar decenas de miles en
   coma flotante haría que el resultado dependiera del orden de la suma.
5. Catálogos fuera de la base de datos. Precios por hora, velocidades de trabajo, tasas de desgaste,
   huellas, volúmenes por fase y precios de venta viven en `shared/config/`. Se almacena lo que el
   catálogo no puede saber: el precio realmente pagado, la copia de la capacidad que necesita un
   `CHECK` y el estado de la fila.
6. Borrado lógico. Todo lo que participa en un coste conserva su intervalo de vigencia y nunca se
   borra físicamente, porque un asiento inmutable debe seguir apuntando a algo.
7. Nombres. Tablas en snake_case y plural mediante `@@map`; columnas en camelCase, que el SQL crudo
   entrecomilla. La asimetría es deliberada: la migración inicial contiene SQL escrito a mano y los
   nombres de tabla sin comillas lo hacen legible.

---

## 4. Modelos

### 4.1 Mundo y reloj

`World` guarda la semilla, la versión del generador, el tamaño de chunk y el ancla del reloj con
multiplicador racional (`anchorGameMs`, `anchorRealMs`, `rateNum`, `rateDen`, `scheduleEpoch`). La
versión del generador y el tamaño de chunk se persisten para que el arranque pueda abortar cuando las
constantes de `shared/config` ya no coincidan con aquello con lo que se generaron las coordenadas
guardadas: sin ellas, ajustar el ruido puede convertir en agua una celda que ya forma parte de un
campo. `seed` es único, de modo que el `seed.ts` puede hacer `upsert` sobre él y ser idempotente.

`WorldTimeSegment` es un registro de solo inserción de los intervalos vividos bajo un mismo
multiplicador. Los cálculos económicos se hacen en tiempo de juego y no lo necesitan; lo necesita
cualquier auditoría que tenga que traducir un intervalo de juego a tiempo real.

`Chunk` lleva un contador `version`. Permite responder `unchanged` a un cliente al día y, sobre todo,
permite cachear en Redis el solape de modificaciones con la versión dentro de la clave: al modificar
una celda cambia la clave, así que no hay que invalidar nada y desaparece la clase entera de errores
de invalidación.

`WorldCell` contiene solo celdas modificadas. Alcanza el mundo a través del chunk y no con una
segunda clave ajena, porque la fila del chunk tiene que existir de todos modos para que su versión se
incremente. `generatedTerrain` es el testigo de lo que produjo el generador cuando se escribió la
fila; `terrainOverride` es el bosque desmontado de §10; `naturalTreeConsumed` impide el
aprovechamiento de borrar y recrear una parcela forestal para que reaparezcan los árboles generados.

No se usa extensión geoespacial. Toda la geometría está alineada a rejilla y la clave de chunk es el
índice espacial natural; las consultas rectangulares derivan los chunks cubiertos en lugar de recorrer
rangos sobre `cellX`/`cellY`, que un índice btree solo aprovecharía en su primera columna.

### 4.2 Jugador

`Player` es la fila por la que pasa todo camino de escritura, que es precisamente la serialización
buscada: `advancePlayer` la bloquea, la secuencia del ledger se incrementa bajo ese bloqueo y
`balanceAfter` se almacena para que el ledger sea auto-auditable. Lleva cuatro marcas temporales
distintas (`startedAtGameMs`, `lastAccrualGameMs`, `lastLoginGameMs`, `lastSummaryGameMs`) porque
cumplen funciones distintas: la de resumen es distinta de la de login para que un refresco de página
no borre el resumen de regreso.

`balance` no tiene `CHECK` de signo. El devengo offline de costes de posesión lleva legítimamente el
saldo a negativo, que es el estado esperado del primer ciclo según §118 y §119.

`RefreshToken` guarda solo el hash y encadena las rotaciones con `replacedByTokenId`: un token
reutilizado cuyo sucesor existe es la firma de una cookie robada.

### 4.3 Granja e infraestructura

`Farm` guarda las existencias agregadas de grano y madera, su capacidad y la cantidad reservada. La
asimetría con `Building` es deliberada: máquinas y trabajadores se cuentan por edificio porque tienen
identidad y ubicación individual (§98, §101), mientras que grano y madera se agregan por granja porque
son fungibles, y agregarlos evita inventar una micro-decisión que el GDD nunca pide.

`Building` guarda la huella como rectángulo, más una copia de la capacidad del catálogo y los
contadores `machineCount` y `workerCount`. La copia es redundante a propósito: las restricciones duras
de §96 y §108 son un `CHECK` contra un contador de la misma fila, y un `CHECK` no puede leer una
constante que vive en la aplicación.

### 4.4 Campos

La geometría de un campo no es un array de celdas: la celda lleva la clave ajena, y `cellCount` es el
área denormalizada que necesitan las fórmulas de duración y rendimiento. El estado del ciclo vive solo
en el campo y nunca en la celda: duplicarlo por celda multiplicaría por entre 250 y 2.000 el coste de
cada transición.

Cada atributo perezoso lleva su propia marca temporal, no una compartida por la fila, para que
liquidar uno no descarte el tiempo transcurrido del otro.

### 4.5 Maquinaria, trabajadores y tareas

No existen los punteros cruzados de §98 y §101 (`assignedWorkerId`, `assignedMachineId`): el vínculo
autoritativo entre trabajador y máquina es la tarea, y dos fuentes de verdad del mismo hecho se
desincronizan. Sí existen `status` y `currentTaskId` en máquina y trabajador, que son la columna de
reserva sobre la que opera la actualización condicional que descarta la doble reserva.

`Machine.farmId` es obligatorio (pertenencia) y `garageId` opcional (ubicación física, asignada por el
servidor), lo que resuelve la ambigüedad de `location` en §98 y permite validar la capacidad por
edificio.

`Task` distingue `scheduledEndGameMs` de `endedGameMs` porque cancelar no es completar: no se
reembolsa, el desgaste se aplica prorrateado y la integral de coste de operación debe detenerse en el
final real. Guarda además `jobId` para poder retirar el trabajo agendado al cancelar, y
`unitsAtStart` y `effectiveWorkSpeedMilli` como auditoría, porque §89 advierte que la unidad de
`workSpeed` se recalculará y así los históricos siguen siendo reinterpretables.

`TaskMachine` registra el papel de cada máquina (propulsada o implemento), de modo que una duración
histórica siga explicándose después de retocar el catálogo.

### 4.6 Silvicultura

`Tree` almacena `plantedAtGameMs` y nada más sobre su crecimiento: edad, fase y volumen son derivados
de la edad, la especie y el reloj. Decenas de miles de árboles hacen inviable un trabajo por árbol, y
§131 confirma que nada se dispara al madurar. Un árbol generado ya crecido es simplemente un árbol con
una fecha de plantación en el pasado, lo que obliga a que el reloj del mundo no empiece en cero
(apartado 7).

La celda se direcciona por coordenadas absolutas y no con clave ajena a `world_cells`: un árbol vive
sobre una celda de bosque generada que puede no tener fila todavía, y forzarla persistiría celdas que
nadie modificó.

### 4.7 Ledger, eventos e idempotencia

`LedgerEntry` es asiento único con importe firmado: negativo es salida de caja. El mercado, el pool
laboral y el vendedor de tierras son «el mundo», así que no hay contrapartida que modelar. La
referencia al origen es polimórfica y sin clave ajena, porque un registro contable inmutable no debe
apuntar con clave ajena a entidades que se despiden, se venden o se fusionan; se compensa con borrado
lógico en las entidades referenciadas. `idempotencyKey` es único por jugador: la cola entrega al menos
una vez, y un reintento de «cobra los salarios de este intervalo» sin clave duplica el cargo.

`ScheduledEvent` es la lista autoritativa de lo que debe ocurrir; Redis solo contiene despertadores
para el subconjunto que vence dentro del horizonte. `GameEvent` respalda el anillo de
resincronización con una secuencia monótona por jugador. `RequestIdempotency` guarda la respuesta de
una petición que llevó cabecera `Idempotency-Key`, y es la única tabla mutable por diseño.

---

## 5. Invariantes que garantiza la base de datos

La idea que unifica el apartado: cuando dos transacciones concurrentes deben verse, hay que forzarlas
a escribir la misma fila. Bajo `READ COMMITTED`, que `infra/postgres/init.sql` fija como valor por
defecto de la base de datos, PostgreSQL serializa a los escritores de una fila y reevalúa su `CHECK`
sobre el valor ya comprometido, lo que convierte «sumar hijos y comparar» en una garantía de la base
de datos sin cerrojos explícitos.

Todo lo de este apartado vive en la ampliación manual de la migración inicial, a partir de la línea
marcada como tal, porque el lenguaje de esquema de Prisma no lo expresa.

### 5.1 Capacidad por contador

| Restricción                              | Mecanismo                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Capacidad de garaje (§96)                | `buildings_capacity_check` sobre `machineCount`, mantenido por el disparador `machines_garage_occupancy`              |
| Capacidad de vivienda (§108)             | El mismo `CHECK` sobre `workerCount`, mantenido por `workers_home_occupancy`                                          |
| Capacidad de almacenamiento de la granja | `buildings_farm_storage_capacity` recalcula `capacityWheatLiters` y `capacityWoodDm3` a partir de los edificios vivos |
| Existencias frente a capacidad (§83)     | `farms_stock_check`: existencias más reservado no superan la capacidad                                                |

Solo cuenta lo vivo: una máquina con `disposedGameMs` libera su plaza, y un trabajador con
`terminatedGameMs` libera la suya, que es lo que §109 describe como «Home slot liberado». Cuando un
traslado toca dos filas, los dos `UPDATE` se emiten en orden ascendente de identificador, que es el
orden canónico de bloqueos del plan, lo que elimina el interbloqueo entre dos transacciones que
intercambien máquinas entre los mismos dos garajes.

`farms_stock_check` es una red de seguridad, no la defensa principal. La defensa principal son tres
capas: reserva de capacidad al asignar la tarea, para que el desbordamiento sea un rechazo accionable;
un único statement acotado al completar, que calcula lo aceptado y desperdicia el resto; y esta
restricción. La capa intermedia es crítica, porque una restricción violada dentro de un trabajo de la
cola produce reintentos indefinidos, así que la aplicación nunca debe delegar en ella un caso de
negocio previsible.

### 5.2 Exclusividad de uso de la celda

`world_cells_use_exclusivity_check` es un `CHECK` intra-fila que exige que el puntero de uso concuerde
exactamente con `landUse`, y que solo haya uno. Cierra con `ELSE false`, no con `ELSE true`: un valor
añadido al enum más adelante debe fallar de forma visible en lugar de pasar porque un `CASE` sin rama
devuelve `NULL`, que un `CHECK` acepta.

La exclusividad entre pretendientes de la misma celda, que es un problema distinto, se resuelve en la
aplicación con actualización condicional y recuento de filas afectadas, más la unicidad de
`(worldId, chunkX, chunkY, idx)` para la doble compra.

### 5.3 Reloj

`worlds_retime_guard` rechaza cualquier cambio de `rateNum` o `rateDen` que no re-ancle el reloj y no
incremente `scheduleEpoch`, y rechaza siempre que `anchorGameMs` disminuya. Sin él, un solo `UPDATE`
del multiplicador movería en silencio todos los instantes futuros del mundo, y los trabajos ya
encolados dispararían antes de tiempo.

El disparador exige que `anchorRealMs` avance estrictamente, lo que además rechaza dos re-anclajes
dentro del mismo milisegundo. La alternativa, aceptar un ancla sin cambios, aceptaría una
actualización que no re-ancló en absoluto.

### 5.4 Trabajador, granja y despido

`task_machines_farm_guard` rechaza una máquina cuya granja no sea la del trabajador de la tarea
(§108), y rechaza también una máquina de otro jugador. La regla no vive solo en la aplicación porque
la tarea es el único vínculo autoritativo entre trabajador y máquina: si puede escribirse mal, puede
escribirse mal la imputación de costes de una granja entera.

`machines_farm_move_guard` impide que una máquina cambie de granja mientras está reservada por una
tarea, que es la otra forma de llegar al mismo estado inválido.

`workers_termination_guard` rechaza despedir a un trabajador con una tarea en curso (§109). Existe
además del `CHECK` sobre `currentTaskId` porque ese `CHECK` solo sirve mientras la aplicación mantenga
la columna de reserva al día, y el despido es precisamente el camino tentado de limpiarla primero. El
disparador lee las tareas, así que no depende de que otra columna esté bien.

### 5.5 Registros de solo inserción

Tres registros se escriben una vez y no se reescriben: el ledger, cuya inmutabilidad es lo que lo hace
auditable; el log de eventos por jugador, cuya secuencia el cliente usa para detectar huecos; y el
registro de tramos de tiempo del mundo, que es el pasado congelado del reloj. Un disparador rechaza
`UPDATE` en los tres.

Se rechaza solo `UPDATE`, no `DELETE`. Reescribir un registro escrito es corromper el histórico y no
tiene ningún llamante legítimo; eliminar filas sí lo tiene: borrar un jugador propaga en cascada,
`prisma migrate reset` destruye el esquema y los fixtures de integración se desmontan solos. Una
corrección es siempre un asiento nuevo, nunca una edición.

### 5.6 Rango y coherencia de valores

Además de los anteriores, la migración añade `CHECK` de rango de puntos base (fertilidad, malezas,
fertilización, condición, habilidad), de no negatividad (existencias, contadores, precios, salarios),
de orden de los intervalos de vigencia (`disposed >= acquired`, `terminated >= hired`,
`felled >= planted`, `scheduledEnd >= start`) y de coherencia de estado:

- Un campo en fase sembrada tiene cultivo e instante de siembra (`fields_growth_timeline_check`).
- Una tarea terminada tiene final real y una en curso no (`tasks_end_state_check`), lo que permite que
  la integral de coste de operación lea `coalesce(endedGameMs, scheduledEndGameMs)` sin casos
  especiales.
- Un árbol con estado `FELLED` tiene instante de tala, y viceversa (`trees_life_check`).
- Un evento pendiente no tiene instante de proceso y uno procesado sí
  (`scheduled_events_check`).
- `CLOCK` no puede persistirse en `game_events` (`game_events_check`), porque es de solo transporte y
  no consume número de secuencia.

### 5.7 Unicidad parcial e índices parciales

Cinco objetos que Prisma no puede declarar:

| Objeto                                                                                                                                       | Motivo                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trees_standing_cell_key`                                                                                                                    | Un árbol por celda (§130), solo entre los árboles en pie: la misma celda vuelve a llevar árbol tras talar y replantar, y la fila talada no desaparece. Una unicidad total haría imposible replantar |
| `scheduled_events_pending_dedupe_key`                                                                                                        | Agendar dos veces el mismo hecho es inocuo mientras está pendiente y legítimo una vez procesado: el refresco del pool de §102 reprograma la misma clave en cada ciclo                               |
| `scheduled_events_pending_due_idx`                                                                                                           | El barrido lee lo pendiente y ya vencido, en orden. Parcial porque la tabla estará dominada por filas procesadas, que nunca se vuelven a leer                                                       |
| `scheduled_events_pending_unqueued_idx`                                                                                                      | Lo pendiente que todavía no tiene despertador en Redis, que es lo que recorre el horizonte de agendado al avanzar                                                                                   |
| `machines_idle_by_type_idx`, `workers_idle_idx`, `worker_candidates_available_idx`, `tasks_in_progress_due_idx`, `refresh_tokens_active_idx` | Consultas del camino caliente que solo miran filas activas                                                                                                                                          |

---

## 6. Índices de las consultas críticas

Declarados en el esquema, porque son índices totales y así `prisma migrate diff` los conoce:

| Consulta                                                           | Índice                                                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Lote de chunks de un área                                          | `world_cells (worldId, chunkX, chunkY)` y único `(worldId, chunkX, chunkY, idx)` |
| Celdas de un jugador, de un campo, de una parcela o de un edificio | `world_cells` por `ownerPlayerId`, `fieldId`, `forestPlotId`, `buildingId`       |
| Histórico económico de un jugador                                  | `ledger_entries (playerId, atGameMs)`                                            |
| Resumen de regreso agregado por tipo de asiento                    | `ledger_entries (playerId, type, atGameMs)`                                      |
| Orden total del ledger y detección de duplicados                   | únicos `(playerId, seq)` y `(playerId, idempotencyKey)`                          |
| Maquinaria de un jugador por tipo                                  | `machines (playerId, type)`, más el índice parcial de ociosas                    |
| Trabajadores de un jugador por estado                              | `workers (playerId, status)`                                                     |
| Árboles de una parcela por estado                                  | `trees (forestPlotId, status)`                                                   |
| Barrido de eventos                                                 | `scheduled_events (status, dueGameMs)` y `(playerId, status)`                    |
| Huecos de secuencia del cliente                                    | único `game_events (playerId, seq)`                                              |

---

## 7. Ancla inicial del reloj

El reloj de un mundo nuevo no se ancla en `gameMs = 0`, sino en 960 horas de juego, que es
`PINE.stageStartGameHours.OLD_GROWTH` más `NATURAL_FOREST.oldGrowthAgeSpanGameHours`.

El motivo es la silvicultura: un bosque llega ya poblado al comprarse (§130, §141), de modo que un
árbol generado lleva una fecha de plantación en el pasado, y el más viejo que el generador puede
extraer tiene esa edad. Con el mundo anclado en cero, ese árbol necesitaría un instante de plantación
negativo, que el dominio prohíbe porque un instante de juego nunca precede a la época del mundo.

El valor se deriva del catálogo forestal y no se inventa, de forma que retocar la especie lo mueve con
ella. Desde la ventana de parcheo de W2.5 vive en `shared/config/time.ts` como
`INITIAL_ANCHOR_GAME_MS` y `seed.ts` lo importa, porque lo necesitan también el generador de bosque y
las pruebas de propiedad del reloj.

---

## 8. Migraciones

### 8.1 Procedimiento para ampliar una migración a mano

```
cd backend
npx prisma migrate dev --name <nombre> --create-only   # genera el SQL sin aplicarlo
# editar migrations/<marca>_<nombre>/migration.sql y añadir el SQL manual al final
npx prisma migrate dev                                  # lo aplica y registra su checksum
```

Editar una migración ya aplicada cambia su checksum y Prisma lo detecta como historial modificado. Si
ocurre durante el desarrollo, la salida es recrear el esquema y volver a aplicar
(`npx prisma migrate reset --force`, que ejecuta también la semilla).

### 8.2 Comprobación de idempotencia

Los objetos escritos a mano son invisibles para Prisma: no son representables en el lenguaje de
esquema, así que `prisma migrate diff` no los reporta ni los elimina. Eso es lo que hace que el
historial sea idempotente respecto al modelo de datos y, a la vez, lo que convierte a la migración en
el único lugar donde están declarados.

```
# La base de datos aplicada coincide con el modelo de datos
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code

# Reproducir el historial en una base de datos sombra produce el modelo de datos
SHADOW_DATABASE_URL=... \
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
```

Ambas deben decir «No difference detected» y devolver 0. La segunda exige
`datasource.shadowDatabaseUrl`, que `prisma.config.ts` toma de `SHADOW_DATABASE_URL` cuando está
definida.

En Prisma 7 los nombres de estos parámetros han cambiado: no existen `--to-schema-datamodel` ni
`--shadow-database-url` como opción de línea de órdenes, y `migrate reset` ya no admite
`--skip-seed`.

---

## 9. Semilla

`seed.ts` escribe dos cosas y ninguna más:

1. La fila del mundo, con la semilla de `WORLD_SEED`, la versión de generador y el tamaño de chunk de
   `shared/config`, y el ancla del apartado 7. Si el mundo ya existe, no lo toca, y aborta si la
   versión de generador o el tamaño de chunk persistidos no coinciden con las constantes: repararlos
   significaría reescribir el terreno bajo tierra que ya tiene propietario.
2. Tras la bandera `SEED_DEV_PLAYER=true` y con `NODE_ENV` distinto de `production`, un jugador de
   prueba con el capital inicial de §117, sin tierra, sin granja y sin maquinaria. Son dos guardas y
   no una: una cuenta con 160.000 de capital y contraseña conocida es una credencial, y no debe poder
   crearse en producción activando una variable.

El capital inicial se escribe también como asiento del ledger, no solo como saldo, porque el ledger es
auditable precisamente porque la suma de sus asientos es igual al saldo, y la prueba de humo lo
comprueba. El tipo empleado es `STARTING_CAPITAL`, añadido al enumerado y al tipo de PostgreSQL por la
ventana de parcheo de W2.5 mediante la migración `20260811215755_ledger_type_starting_capital`. El
registro de un jugador nuevo debe usar el mismo tipo y la misma clave de idempotencia,
`starting-capital:<playerId>`.

La semilla es idempotente: ejecutarla dos veces deja la base de datos igual que ejecutarla una vez, y
nunca sobrescribe lo que ya existe. Importa porque llegan a ella dos caminos, `make seed` y
`prisma migrate reset`, este último a través de `migrations.seed` de `prisma.config.ts`.

Variables que lee:

| Variable                         | Obligatoria | Valor por defecto                                     |
| -------------------------------- | ----------- | ----------------------------------------------------- |
| `DATABASE_URL`                   | Sí          | —                                                     |
| `WORLD_SEED`                     | Sí          | —                                                     |
| `GAME_RATE_NUM`, `GAME_RATE_DEN` | No          | `DEFAULT_GAME_RATE` de `shared/config/time.ts` (24/1) |
| `SEED_DEV_PLAYER`                | No          | ausente, es decir sin jugador de prueba               |
| `SEED_DEV_PLAYER_EMAIL`          | No          | `dev@farm-world.local`                                |
| `SEED_DEV_PLAYER_PASSWORD`       | No          | `farm-world-dev`                                      |

`seed.ts` importa las constantes de la copia sincronizada `backend/src/shared`, que es lo que exige la
regla de zonas de ESLint. Requiere por tanto que `make sync-types` se haya ejecutado; desde la ventana
de parcheo de W2.5 los objetivos `seed` y `reset` lo declaran como prerrequisito, igual que
`typecheck`, `lint`, `test-unit`, `test-int`, `up` y `build`.

La misma ventana añadió la carga explícita del `.env` de la raíz al comienzo de `seed.ts`. Sin ella
`make seed` fallaba con «The environment variable DATABASE_URL is required»: llegan dos caminos al
script y solo uno traía el entorno cargado. `prisma migrate reset` pasa por `prisma.config.ts`, que
carga el fichero y lo hereda el proceso hijo, mientras que `npm run seed` ejecuta `tsx prisma/seed.ts`
directamente y no lo cargaba nadie. El mecanismo es el mismo que en `prisma.config.ts`,
`process.loadEnvFile`, que no sobrescribe una variable ya presente y por tanto es inocuo en integración
continua y dentro de los contenedores.

---

## 10. Dependencias resueltas por la ventana de parcheo de W2.5

Las tres que bloqueaban la ejecución, recogidas en su día en `docs/handoff/NOTES-w2d.md`, están
aplicadas y verificadas:

1. `@prisma/adapter-pg@7.9.1` declarado en `backend/package.json` e instalado. `seed.ts` construye el
   cliente con `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` mediante un `import`
   normal, sin la indirección que mantenía la comprobación de tipos en verde mientras faltaba.
2. `backend/src/generated/` excluido en `.gitignore` y en `.prettierignore`. `make lint` pasa.
3. El montaje del volumen de PostgreSQL es `/var/lib/postgresql` en los tres ficheros de Compose donde
   aparece. La imagen `postgres:18-alpine` arranca y queda sana.

Queda una migración por fase, conforme al apartado 8: cada flujo de trabajo posterior añade las suyas
como ficheros nuevos en `migrations/` y nunca edita las dos existentes.
