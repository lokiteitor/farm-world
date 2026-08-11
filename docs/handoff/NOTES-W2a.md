# NOTES-W2a

Agente de vocabulario. Fase W2. Ambito escrito: `shared/domain/`, `shared/config/` y
`shared/index.ts`.

Este fichero recoge lo que otros agentes deben hacer y que W2a no podia hacer, las decisiones que
condicionan al resto por estar en el vocabulario compartido, y las discrepancias detectadas entre el
plan, el GDD y el codigo ya existente.

## 1. Pendiente para otros agentes

Ninguna de las cinco notas de este apartado sigue abierta. Se conservan con su numeracion original
en el apartado «Resuelto» del final del fichero, porque otros documentos y varios comentarios de codigo
las citan por numero.

## 2. Decisiones que condicionan a las fases siguientes

### 2.1 El tipo `Money` vive en `money.ts`, no en `units.ts`

El brief situaba el tipo marcado `Money` en `units.ts`. Es imposible sin duplicar el nombre en el
barril: el modulo de aritmetica se llama tambien `Money`, y un tipo y un valor homonimos solo pueden
coexistir si se exportan desde el mismo modulo. `shared/domain/money.ts` exporta ambos y es el unico
sitio que construye un valor `Money`, lo que garantiza la forma canonica de cuatro decimales y
convierte la igualdad de importes en igualdad de cadenas. `units.ts` documenta la razon en cabecera.

### 2.2 Constructores estrictos y su coste

`gameMs`, `realMs` y `bp` lanzan `RangeError` fuera de rango, y `bp` exige entero. Los caminos que
convierten un valor calculado deben usar `clampBp`, que redondea y acota, no `bp`. Los intervalos
transcurridos son `bigint` a secas, no `GameMs`: un instante no puede ser negativo y un delta si.

### 2.3 Unidades enteras para todo lo fungible

El trigo se cuenta en litros y la madera en decimetros cubicos, ambos enteros. Los volumenes de §131
son multiplos de 0,05 m3 y sumar decenas de miles en coma flotante haria que el resultado de una suma
perezosa dependiera de su orden, lo que contradice el requisito de reproducibilidad de la seccion 5.2
del plan. `STORAGE_RESOURCE_UNITS` en `shared/config/buildings.ts` publica, por recurso, la unidad
almacenada, la unidad de presentacion y el divisor. La interfaz divide; el servidor no.

### 2.4 Velocidad de trabajo: regla de resolucion

`OPERATION_REQUIREMENTS` no repite la velocidad de cada operacion. La regla, que debe implementar
`shared/rules/duration`, es: si la operacion declara `workSpeedOverrideUnitsPerGameHour`, esa; si no,
la del implemento requerido cuando lo tiene; si no, la de la maquina propulsada. Con el catalogo
literal de §89 esto da 4,2 celdas/h para arar, 5,5 para cultivar, 4,8 para sembrar (implemento) y 3,0
para cosechar (la propia cosechadora, porque el remolque no tiene velocidad). La prueba de coherencia
comprueba que las siete operaciones resuelven una velocidad positiva.

### 2.5 Las curvas se acotan, no se extrapolan

Los nodos de `shared/config/curves.ts` llevan la entrada en porcentaje 0..100 porque asi las publica
el GDD; el llamante convierte con `bpToPercent`. Por debajo del primer nodo y por encima del ultimo,
`interpolateCurve` debe acotar. Importa en fertilidad: §77 no da nodo por debajo del 10 % y
extrapolar hacia cero inventaria un numero de balance.

### 2.6 Convenio de signo del ledger

Importe firmado, negativo para salida de caja del jugador. `ACCRUAL_LEDGER_TYPES` enumera los cuatro
devengos continuos, que son los unicos cuyo importe es una integral sobre un intervalo y por tanto
los unicos cuya clave de idempotencia incluye el intervalo. `NON_MONETARY_LEDGER_TYPES` enumera los
asientos de importe cero que existen solo para explicar una perdida fisica en el resumen de regreso;
hoy solo `HARVEST_WASTE`.

## 3. Discrepancias detectadas

### 3.1 Seccion 5.2 del plan frente a seccion 5.4

La seccion 5.2 dice que se eliminan «los dos punteros cruzados que el GDD propone en §98 y §101» y
que «el estado se deriva». La seccion 5.4 exige, para descartar la doble reserva de trabajador o
maquina, una «actualizacion condicional sobre estado ocioso y tarea nula», que necesita las dos
columnas en la fila.

Resolucion adoptada, documentada en `entities.ts`: los punteros eliminados son los que enlazan
trabajador y maquina entre si (`Machine.assignedWorkerId` y `Worker.assignedMachineId`), que son dos
fuentes de verdad del mismo hecho. `status` y `currentTaskId` se conservan en ambas entidades como
columna de reserva, que es lo que la seccion 5.4 necesita y lo que hace que la garantia sea de la
base de datos y no del codigo.

### 3.2 §137 exige maquinaria forestal para replantar, sin velocidad

`REPLANT` requiere maquinaria forestal segun §137, pero la unica velocidad publicada para
`HARVESTER_FORESTRY` es 0,8 arboles/hora (§134). Reutilizarla haria que plantar un planton fuera
cuatro veces mas lento que talar un arbol adulto. Se anade
`workSpeedOverrideUnitsPerGameHour: 6.0` celdas/h, marcado como inventado y justificado en el propio
catalogo.

### 3.3 §10 exige coste de maquinaria para el desmonte, sin definirlo

`CLEAR_LAND` no figura en la tabla de §90. Se resuelve con tractor y arado, velocidad 2,0 celdas/h
(inventada, la mitad del arado) y sin tasa monetaria adicional: el coste economico que pide §10 es el
coste de operacion de la tarea. Inventar una tarifa por celda seria inventar un numero de balance sin
respaldo.

### 3.4 §134 no da costes de posesion al autocargador

`FORWARDER` no declara `maintenanceCost` ni `operatingCost` en §134. Se implementa literalmente a
cero, igual que con los implementos de §89. Consecuencia para el informe de balance: el setup
forestal de §138 tiene coste de posesion menor del que sugiere su precio de adquisicion.

### 3.5 Huella de `WOOD_STORAGE` no publicada

§136 da precio y capacidad, no huella. Se fija en 6 x 8 = 48 celdas, la del garaje, marcada como
inventada. Afecta al coste real de §116 y por tanto al total de §138, que no incluye suelo para el
almacen.

### 3.6 Tamano del pool de contratacion

§102 no da el tamano del pool; su ejemplo enumera tres candidatos. Se fija `POOL_SIZE = 3` por
literalidad. Con refresco cada 48 horas de juego, contratar dos candidatos deja uno disponible, lo
que es una escasez coherente con §64 pero conviene revisar en playtesting.

### 3.7 Correlacion salario-habilidad de §102

Los tres ejemplos de §102 no son colineales. El ajuste por minimos cuadrados da
`salario = 0,45 x habilidad - 8,75`, con residuo maximo de 1,15 $/h en el ejemplo intermedio, dentro
de la banda de ruido del 12 % que se declara. Los 30 $/h de §36 y los 15 $/h de §117 quedan como no
reproducibles, conforme a la seccion 2.2 del plan.

### 3.8 El ejemplo de §84 no reproduce las fases fijadas por el plan

§84 narra «6 h despues: GERMINATING» y «96 h despues: GROWING → READY_TO_HARVEST». Con
`SEEDED 6 / GERMINATING 12 / GROWING 78` la primera transicion coincide y la segunda ocurre a las 18
h, con `READY_TO_HARVEST` a las 96 h. Es la interpretacion que preserva las dos cifras publicadas
(96 h totales de §82 y 325 h de ciclo de §118); el texto de §84 se lee como una simplificacion
narrativa.

## 4. Decisiones para ADR

Reparto previsto por la seccion 11 del plan, con lo que W2a aporta a cada entrada:

- 0008 Dinero en decimal exacto: implementacion propia sobre `bigint` escalado por 10 000, sin
  dependencias; redondeo mitad hacia el infinito en valor absoluto en la cuarta decimal; forma
  canonica de cuatro decimales como unica representacion; `toDisplay` de dos decimales solo para la
  interfaz. Anadir la variante `mulGameMs`, exacta, como camino preferente del devengo, frente a
  `mulHours`, con precision de 10^-6 horas.
- 0011 Catalogos de balance como constantes: ademas de lo previsto, la tabla de compatibilidad de §90
  y la maquina de estados de §76 se implementan como dato y no como codigo, y una prueba cruza ambas.
- 0013 Porcentajes en puntos base: constructor estricto `bp` y acotado `clampBp`. Extension no
  prevista: las cantidades fungibles tambien son enteras, y la madera pasa a decimetros cubicos por
  el mismo motivo de reproducibilidad.
- 0014 Huecos numericos del GDD y valores inventados. Lista completa de lo inventado en esta fase, con
  su justificacion en el propio codigo: tasas de desgaste (15, 25 y 30 puntos base por hora), coste de
  reparacion por punto (0,30 % del precio), duracion de reparacion por punto (0,25 horas de juego),
  regeneracion de fertilidad en barbecho (5 puntos base por hora), factor de reventa (60 %), umbral de
  liquidacion (30 % del valor liquidable), huella del almacen de madera (6 x 8), velocidad de
  replantacion (6,0 celdas/h) y de desmonte (2,0 celdas/h), parametros y umbrales del ruido de
  terreno, separacion minima entre origenes de jugador (8 chunks), ruido salarial (12 %) y suelo
  salarial (6,00 por hora de juego), tamano del pool (3) y mezcla de fases del bosque generado.
- Entrada nueva sugerida, si el redactor de ADR lo considera: la mezcla de fases del bosque generado
  (800 / 2000 / 5000 / 2200 puntos base para planton, joven, maduro y viejo) no es una invencion
  libre: es la distribucion que hace salir la estimacion de §138, 250 celdas con un arbol cada una y
  volumen medio 1,534 m3, es decir 383,5 m3 frente a los 382 m3 del GDD. La prueba de coherencia lo
  comprueba con tolerancia del 2 %.

---

## Resuelto

Las cinco notas del apartado 1 estan aplicadas. Los apartados 2, 3 y 4 no son notas pendientes: son
decisiones, discrepancias y aportaciones al ADR, y siguen vigentes tal cual.

| Nota | Quien la aplico | Como |
|---|---|---|
| 1.1 Reexportaciones de `shared/index.ts` | Ventana de parcheo W2.5 | Las cuatro lineas descomentadas en su sitio, sin reordenar el fichero. Comprobado que no hay colision de nombres ni ciclo: `npx tsc --noEmit` y las 418 pruebas de `shared/` en verde |
| 1.2 La union de eventos se construye sobre `GameEventType` | W2-C | Cumplido literalmente, con `HELLO` como unica etiqueta de transporte anadida y una prueba de exhaustividad en las dos direcciones |
| 1.3 Ajuste de los umbrales de terreno | Ventana de parcheo W2.5 | Solo el suelo de montana de `TERRAIN_DISTRIBUTION_TARGET_BP`, de 200 a 100 puntos base, con la medicion de `NOTES-W2b` 1.3. `TERRAIN_NOISE`, `TERRAIN_THRESHOLDS_BP` y `GENERATOR_VERSION` sin tocar |
| 1.4 Esquema de Prisma | W2-D | Los cuatro puntos respetados. Las siete divergencias que quedaron entre `entities.ts` y el esquema las alineo la ventana de parcheo de W2.5 siguiendo el esquema |
| 1.5 Sincronizacion de copias | Ventana de parcheo W2.5 | `make sync-types` ejecutado; `make check-sync` devuelve 0 |

### 1.1 Reexportaciones de `shared/index.ts`

Categoria: contrato
Ficheros afectados: `shared/index.ts`
Propietario del cambio: agentes de `shared/rules/`, `shared/api/`, `shared/ws/` y `shared/world/`

El barril declara las cuatro reexportaciones pendientes como comentarios en lineas marcadas, en el
orden previsto. Cada agente descomenta la suya y no reordena el fichero. `SHARED_CONTRACT_VERSION`
se conserva con el valor `0.1.0` que fijo W1.

Comprobado que el barril completo carga en tiempo de ejecucion sin ciclos: la prueba de andamiaje de
`shared/__tests__/scaffolding.test.ts` importa `../index.js`, lo que arrastra `domain/` y `config/`
enteros.

### 1.2 La union discriminada de eventos se construye sobre `GameEventType`

Categoria: contrato
Propietario del cambio: agente de `shared/ws/`

`shared/domain/enums.ts` define `GameEventType` como conjunto cerrado de etiquetas, con la convencion
`UPSERTED` y `REMOVED` por entidad. La union discriminada de `shared/ws/` debe usar exactamente esas
etiquetas como discriminante, sin anadir ninguna: la tabla `GameEvent` persiste el mismo valor y el
reductor del cliente conmuta sobre el. `CLOCK` es la unica etiqueta de solo transporte y no consume
numero de secuencia.

No se ha modelado el contenido de `NOTICE` (aviso de desbordamiento de silo, liquidacion forzosa,
hito forestal). Corresponde a `shared/ws/`.

### 1.3 Ajuste de los umbrales de terreno

Categoria: cambio en fichero congelado por propiedad
Ficheros afectados: `shared/config/world.ts`
Propietario del cambio: W7-A, a peticion del agente de `shared/world/`

`TERRAIN_NOISE` y `TERRAIN_THRESHOLDS_BP` son valores inventados, calculados suponiendo una
distribucion acampanada del ruido de octavas sumadas. `TERRAIN_DISTRIBUTION_TARGET_BP` fija la banda
admisible que debe comprobar la prueba de distribucion del generador. Si con el generador real la
distribucion cae fuera de la banda, el agente de `shared/world/` no debe editar `world.ts`: anota el
valor concreto que necesita en su propio fichero de `handoff` y W7 lo aplica. `GENERATOR_VERSION`
permanece en 1 mientras no exista ningun mundo persistido; cualquier cambio posterior a esas
constantes obliga a incrementarlo.

### 1.4 Esquema de Prisma

Categoria: contrato
Propietario del cambio: agente de `backend/prisma/`

Las interfaces de `shared/domain/entities.ts` son el reflejo previsto del esquema. Cuatro puntos que
no se deducen de la lectura rapida:

- El dinero es `numeric(20,4)` y viaja como cadena decimal canonica de cuatro decimales. El unico
  constructor es el modulo `Money`.
- Los porcentajes de dominio son enteros en puntos base (0..10000), no coma flotante.
- La madera se almacena en decimetros cubicos enteros, no en metros cubicos con decimales. Los campos
  son `Farm.storedWoodDm3` y `Farm.reservedWoodDm3`, y la capacidad de `WOOD_STORAGE` del catalogo ya
  esta expresada en esa unidad (500 m3 = 500 000 dm3). Motivo en el apartado 2.3.
- `Machine.status`, `Machine.currentTaskId`, `Worker.status` y `Worker.currentTaskId` si existen como
  columnas: son la columna de reserva sobre la que opera la actualizacion condicional de la seccion
  5.4 del plan. Lo que se elimina de §98 y §101 son los punteros cruzados
  `Machine.assignedWorkerId` y `Worker.assignedMachineId`. Detalle en el apartado 3.1.

No se ha modelado `RequestIdempotency`: es infraestructura del backend (respuesta persistida por
clave de idempotencia) y no vocabulario de dominio. Figura en la lista de modelos de la seccion 5 del
plan y debe crearla el agente del esquema.

### 1.5 Sincronizacion de copias

Categoria: orden que hay que ejecutar
Propietario del cambio: W3 y W7

`shared/domain/` y `shared/config/` son directorios nuevos. `backend/src/shared` y
`frontend/app/shared` contienen todavia la copia de W1 con un unico fichero, de modo que
`make check-sync` falla hasta que se ejecute `make sync-types`. W2a no ejecuta la sincronizacion
porque escribe fuera de su ambito.

Verificado que las exclusiones del script cubren los directorios de prueba anidados: los patrones
`__tests__/` y `*.test.ts` de `rsync` casan a cualquier profundidad, asi que
`shared/domain/__tests__/` y `shared/config/__tests__/` no se copian.
