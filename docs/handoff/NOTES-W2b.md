# NOTES-W2b

Agente de reglas puras y mundo. Fase W2. Ambito escrito: `shared/rules/` y `shared/world/`, con sus
directorios `__tests__` anidados.

Este fichero recoge lo que otros agentes deben aplicar y que W2b no podia hacer por estar fuera de su
ambito, las decisiones de diseno que condicionan a las fases siguientes, las discrepancias detectadas
entre el plan, el GDD y el codigo ya existente, y los numeros reales que arroja la prueba dorada de
balance.

## 1. Pendiente para otros agentes

Ninguna de las cinco notas de este apartado sigue abierta. Se conservan con su numeracion original
en el apartado «Resuelto» del final del fichero, porque otros documentos las citan por numero.

## 2. Decisiones que condicionan a las fases siguientes

### 2.1 El devengo se acumula como integral exacta y se redondea una sola vez por categoria

`accrueContinuousCostsExact` devuelve las cuatro integrales en unidades de «unidad escalada de dinero
por milisegundo de juego», como `bigint`. `accrueContinuousCosts` divide por los milisegundos de una hora
de juego una unica vez por categoria y devuelve importes.

Consecuencia que el backend debe respetar: la aditividad exacta que exige la seccion 8 del plan
(`accrue(a,c) = accrue(a,b) + accrue(b,c)`) solo se cumple literalmente sobre la integral. En forma de
dinero, dos ventanas contiguas pueden diferir del total en una unidad de la cuarta decimal por categoria,
es decir una centesima de centimo, porque hay un redondeo por division. Las dos propiedades estan
demostradas por separado en `shared/rules/__tests__/properties.test.ts`. Para cadenas largas de ventanas
existe `addAccrualIntegrals`, que permite sumar integrales y convertir al final.

`AccrualBreakdown.total` es la suma de las cuatro categorias ya redondeadas, no el redondeo de la suma
exacta. Es deliberado: el ledger escribe un asiento por categoria y `balanceAfter` tiene que cuadrar con
la suma de los asientos que escribio.

### 2.2 El interes de descubierto se calcula sobre el saldo de apertura de la ventana

`AccrualSources.openingBalance` es el saldo liquidado al inicio de la ventana, y solo su parte negativa
se cobra. No se integra contra el saldo en movimiento: con la tasa cero por defecto la distincion es
nula, y el barrido periodico de la seccion 6.6 del plan mantiene las ventanas cortas. Si alguna fase
posterior activa una tasa no nula, este es el punto donde la simplificacion se vuelve visible.

### 2.3 Los atributos perezosos truncan, y el sesgo esta acotado y documentado

`projectWeedLevel` y `projectFallowFertility` integran la tasa en `bigint` y truncan hacia cero, de modo
que una liquidacion nunca concede mas de lo que el tiempo transcurrido devenga y el resultado no depende
de la plataforma. El coste es un sesgo de hasta un punto base por liquidacion. Como ambos atributos se
liquidan solo en los cambios de estado, y un ciclo de trigo pasa por nueve como maximo, el sesgo
acumulado queda por debajo del 0,1 % del nivel. El backend no debe liquidar estos atributos con mas
frecuencia que los cambios de estado: liquidar cada 30 segundos de juego con tasa de 60 pb/h truncaria
a cero cada vez y detendria el crecimiento.

### 2.4 Origen de jugador: retícula de bloques reservados

`assignSpawn(seed, playerIndex)` es determinista en la semilla y el indice del jugador, sin leer ninguna
otra fila, lo que permite asignar el origen dentro de la transaccion de registro.

El indice del jugador se proyecta sobre una espiral cuadrada de puntos de retícula separados
`2 x SPAWN_MIN_DISTANCE_CHUNKS` chunks, y la busqueda se confina a un bloque de
`SPAWN_MIN_DISTANCE_CHUNKS` chunks de lado anclado en ese punto. La separacion minima entre dos origenes
es por tanto `2d - (d-1) = d+1` chunks, superior a la exigida, y la garantia es estructural: dos
registros concurrentes no pueden colisionar porque no comparten estado. Si el bloque reservado no
contiene ningun chunk utilizable, la busqueda se amplia en anillos hasta el tope de
`SPAWN_SEARCH_MAX_CHUNKS` y lo declara con `withinReservedBlock: false`; sobre 200 semillas y sobre los
50 primeros indices de jugador no se ha dado el caso, y la busqueda resuelve en menos de ocho chunks
inspeccionados de media.

El campo `meetsMinimum` puede ser falso en el caso degenerado. La funcion es total y devuelve siempre
una celda de origen: un fallo durante el registro es peor que un origen mediocre.

### 2.5 Coordenada maxima de celda

`shared/rules/geometry.ts` acota la magnitud de una coordenada de celda en 2^25, es decir 335.000 km con
la celda de 10 m, para poder indexar una celda con un unico entero seguro (`cellKey`). Es holgado frente
a donde el asignador de origen coloca a un jugador, pero es un limite real: si alguna fase posterior
necesita coordenadas mayores habra que cambiar la clave a dos niveles o a cadena.

### 2.6 La contigüidad comparte tope con el cliente

`isContiguous` rechaza una seleccion que supera `MAX_SELECTION_CELLS` sin recorrerla, y
`boundedBreadthFirst` acota el recorrido. Es la misma cifra que el cliente aplica al arrastrar, de modo
que una peticion malformada no puede pasear por una region ilimitada de un mundo virtualmente infinito.

### 2.7 Forma de la respuesta de validacion de una seleccion

`validateSelection` devuelve `{ ok, cellCount, validCellCount, issues, price }`, con un `SelectionIssue`
por codigo, su recuento de celdas y la primera celda afectada en el orden en que llego la seleccion.
Primero van las reglas de seleccion completa (vacia, demasiado grande, no contigua, no adyacente) y
despues las de celda en el orden en que se encontraron. El cuerpo de error de `shared/api/` puede
reutilizar esta forma tal cual: es lo que permite a la interfaz mostrar una lista corta y accionable y
mover la camara al primer conflicto en lugar de enumerar dos mil errores identicos.

## 3. Discrepancias detectadas

### 3.1 El ejemplo de §110 es inconsistente consigo mismo y con la tabla de §91

§110 escribe `taskDuration = 300 / (4.2 x 0.95 x 0.85) ~ 84h` para una maquina al 95 % de condicion.
Dos problemas independientes:

- Usa 0,95 directamente como `conditionFactor`, mientras que la tabla de §91 asigna 0,75 al 50 % y 1,0
  al 100 %, de modo que el 95 % interpola a 0,975. La tabla es la autoritativa y la regla la sigue, con
  lo que la duracion real es 86,19 h.
- Su propia expresion evaluada da 88,46 h, no las 84 h que enuncia.

Ambos valores quedan afirmados en la prueba dorada. Procede recogerlo en `docs/erratas-gdd-stack.md`.

### 3.2 §118 supone un mantenimiento que su propio catalogo no respalda, y omite el coste de operacion

§118 supone «~70 $/h combinado» de mantenimiento. El catalogo de §89 solo asigna mantenimiento al tractor
(12) y a la cosechadora (25), porque los implementos no declaran ninguno, de modo que la tasa real es
37 $/h. Sobre el ciclo de 325,34 h eso da 12.037,64 frente a los 22.750 publicados.

En sentido contrario, §118 no cuenta el coste de operacion, que §94, §107 y §114 declaran explicitamente
aditivo al de posesion. Sobre el mismo ciclo son 8.771,01. Los dos errores se compensan en buena parte:
el coste de posesion real por ciclo es 25.688,78 frente a los 27.625 publicados, un 7 % menos.

### 3.3 La tasa de malezas de §82 saturaria el nivel en el ciclo de §118

Con 0,6 %/h y 246,07 horas de juego en estados de crecimiento de maleza (70,03 arando sobre campo
virgen, 78 creciendo y 98,04 con el campo listo sin cosechar), el nivel llega al 147,6 % y satura en
100 %. La penalizacion es por tanto la maxima de §78, el 50 %, y no el 8 % que §119 supone. Rendimiento
real 11.250 L e ingreso 2.475, frente a los 20.700 L y 4.554 publicados. Con el nivel del 20 % que §119
asume, la formula reproduce 20.700 L y 4.554 exactamente, lo que confirma que la discrepancia esta en la
tasa y no en la formula de rendimiento.

Hallazgo cuantificado que conviene llevar al informe de balance: cultivar no evita la saturacion en un
campo de 250 celdas. `CULTIVATE` pone las malezas a cero, pero las 78 h de crecimiento mas las 98,04 h
de cosecha suman 176,04 h, por encima de las 166,67 h que la tasa necesita para saturar. El tamano de
campo es la palanca real: por debajo de unas 130 celdas, contando tambien el arado, el nivel se queda
por debajo del 100 % (un campo de 120 celdas termina en 95,20 %).

### 3.4 La compra escalonada de §120 no alcanza el punto de equilibrio

§120 recomienda combinar la palanca A (menor coste de posesion mediante compra escalonada) con la C
(ciclo mas corto). Modelada la palanca A, comprando cada maquina al empezar la fase que la necesita, el
coste de posesion por ciclo baja de 25.688,78 a 20.006,22 y el ratio ingreso/coste solo pasa de 0,096 a
0,124. El deficit es de un orden de magnitud, no de margen, de modo que la palanca A por si sola no
basta y el informe de balance debe decirlo con estos numeros.

### 3.5 El volumen de la primera tala de §138 sale exacto excluyendo plantones

`NATURAL_FOREST_AVERAGE_VOLUME_DM3` de `shared/config` promedia los cuatro estados y da 1.534 dm3 por
celda, es decir 383,5 m3 en 250 celdas. Pero §131 no admite talar un planton ni le asigna valor
comercial, de modo que el volumen de una tala solo cuenta los tres estados talables:
`expectedNaturalForestVolumeDm3` da 1.530 dm3 por celda, 382,5 m3 en 250 celdas, frente a los 382 m3 que
§138 estima. La cifra del catalogo sigue siendo correcta como volumen medio del arbolado; la de la regla
es la correcta como produccion de una tala. Conviene que el informe de balance use la segunda.

Ingreso de la primera tala: 382,5 x 45 = 17.212,50 frente a los ~17.190 de §138. El setup forestal
minimo reproduce 132.500 exactamente.

### 3.6 El salario de §117 y §118 no procede de la regla de §102

El escenario de la prueba dorada usa los 15 $/h que enuncian §117 y §118, para poder reproducir su
aritmetica. La regla procedural de §102, ajustada en `shared/config/workers.ts`, da 22,75 $/h para el
70 % de habilidad que implican las duraciones de §118 y 18,25 $/h para el «~60 %» que §117 menciona para
el mismo trabajador. Las tres cifras no pueden sostenerse a la vez. El catalogo conserva la regla
procedural y las otras dos quedan como no reproducibles, conforme a la seccion 2.2 del plan.

Ademas, §118 multiplica por 325 h redondeadas y da 4.875; con las 325,34 h que salen de las formulas el
salario devengado es 4.880,13.

### 3.7 `realBuildingCost` distingue precio de planificacion y precio transaccional

Aplicar §116 literalmente cobra el suelo dos veces al jugador que ya posee la parcela, que es
exactamente el caso que describe §117. La funcion devuelve las dos cifras: `total`, que es lo que se
cobra y solo incluye el suelo cuando `landAlreadyOwned` es falso, y `plannedCostWithLand`, que es la
formula literal de §116 y es lo que muestra el panel de planificacion. El endpoint de construccion debe
cobrar `total` y nunca `plannedCostWithLand`.

### 3.8 Matiz a la propiedad de aditividad que enuncia la seccion 8 del plan

La seccion 8 del plan pide demostrar `settle(a,c) = settle(a,b) + settle(b,c)`. Con dinero decimal
redondeado esa igualdad no es alcanzable en general, porque cada llamada redondea una division. El
apartado 2.1 explica como se resuelve: la igualdad se demuestra exacta sobre la integral en `bigint`, y
sobre el importe se demuestra una cota de una unidad de la cuarta decimal por categoria. No es una
relajacion de la propiedad, sino su enunciado correcto; conviene que el ADR 0024 lo recoja asi.

### 3.9 `SPAWN_SEARCH_MAX_CHUNKS` cambia de significado

`NOTES-W2a.md` describe la constante como «chunks que el asignador inspecciona antes de rendirse». Con la
retícula de bloques reservados del apartado 2.4, el tope solo actua en el caso degenerado en que el
bloque de 64 chunks del jugador no contiene ninguno utilizable, situacion que no se ha dado en la
medicion. El valor de 4.096 queda como red de seguridad y no como presupuesto habitual de busqueda: el
coste normal es de dos a tres chunks.

### 3.10 Cero negativo en el modulo euclideo

`floorMod(-32, 32)` devolvia `-0` con el operador nativo, valor que se comporta como cero en aritmetica
pero no bajo `Object.is`. La funcion lo normaliza. Es un detalle de implementacion, pero conviene
saberlo si alguna fase posterior escribe su propio calculo de indice de celda en lugar de usar
`cellIndex`.

## 4. Numeros reales de la prueba dorada de balance

Escenario `MINIMUM_SETUP_SCENARIO`: 250 celdas de campo, 80 de huella de granja, pradera, garaje mas
silo mas vivienda, tractor, arado, sembradora, cosechadora y remolque, un trabajador a 15 $/h,
habilidad del operario 70 %, condicion de la maquinaria 100 %, fertilidad 100 %, todo comprado el dia
uno.

| Concepto | GDD | Calculado | Estado |
|---|---:|---:|---|
| Tierra, 330 celdas x 120 (§117) | 39.600 | 39.600 | Reproduce |
| Edificios (§117) | 23.000 | 23.000 | Reproduce |
| Maquinaria (§117) | 83.500 | 83.500 | Reproduce |
| Total de arranque (§117) | 146.100 | 146.100 | Reproduce |
| Colchon sobre 160.000 (§117) | 13.900 | 13.900 | Reproduce |
| Arado, 250 celdas (§118) | ~70 h | 70,0280 h | Reproduce |
| Siembra (§118) | ~61 h | 61,2745 h | Reproduce |
| Crecimiento (§82, §118) | 96 h | 96 h | Reproduce |
| Cosecha (§118) | ~98 h | 98,0392 h | Reproduce |
| Ciclo completo (§118) | ~325 h | 325,3417 h | Reproduce |
| Mantenimiento combinado por hora (§118) | ~70 | 37 | Desviacion |
| Mantenimiento del ciclo (§118) | 22.750 | 12.037,6442 | Desviacion |
| Salarios del ciclo (§118) | 4.875 | 4.880,1260 | Desviacion menor |
| Operacion del ciclo (§107, §114) | No contabilizado | 8.771,0084 | Omision del GDD |
| Coste de posesion del ciclo (§118) | 27.625 | 25.688,7786 | Desviacion |
| Malezas al cosechar (§119) | 20 % | 100 % | Desviacion |
| Rendimiento (§119) | 20.700 L | 11.250 L | Desviacion |
| Rendimiento con malezas al 20 % (§119) | 20.700 L | 20.700 L | Reproduce |
| Ingreso (§119) | 4.554 | 2.475 | Desviacion |
| Ingreso con malezas al 20 % (§119) | 4.554 | 4.554 | Reproduce |
| Ratio ingreso/coste (§125, objetivo 1,3 a 1,8) | — | 0,0963 | No cumple |
| Ciclos hasta el equilibrio (§121) | — | No existe | Confirma §119 |
| Setup forestal minimo (§138) | 132.500 | 132.500 | Reproduce |
| Volumen de la primera tala (§138) | ~382 m3 | 382,5 m3 | Reproduce |
| Ingreso de la primera tala (§138) | ~17.190 | 17.212,50 | Reproduce |

Con compra escalonada, coste de posesion 20.006,22, mantenimiento 6.355,08, ratio 0,1237 y tampoco
existe punto de equilibrio.

Ninguna constante se ha ajustado para producir estas cifras, conforme a la seccion 1 del plan. Las
desviaciones se afirman en la prueba con su valor real, no con el del GDD, y cada una lleva el comentario
que explica de donde sale.

## 5. Decisiones para ADR

Aportacion de W2b a las entradas previstas por la seccion 11 del plan:

- 0007 Tiempo de juego en enteros y ancla con multiplicador racional: `gameMsAt` con `floorDiv` da
  monotonia; `realMsFor` con `ceilDiv` da ausencia de disparo temprano, con la propiedad
  `gameMsAt(realMsFor(g)) >= g` demostrada sobre el espacio de anclas. `reanchor` devuelve el ancla nueva
  y el tramo congelado bajo el multiplicador anterior, e incrementa `scheduleEpoch`. Un ancla con
  numerador negativo o denominador no positivo se rechaza con excepcion, porque es dato corrupto y no un
  caso limite del dominio; `rateNum = 0` es mundo pausado y `realMsFor` devuelve nulo.
- 0008 Dinero en decimal exacto: extension con el criterio del apartado 2.1, la integral exacta en
  unidades de dinero escalado por milisegundo y un unico redondeo por categoria.
- 0011 Catalogos de balance como constantes: las reglas reciben el catalogo como parametro con el
  catalogo real por defecto, de modo que las pruebas fijan valores sin duplicar formulas.
- 0014 Huecos numericos del GDD: se anaden los inventados por W2b, todos justificados en el propio
  codigo. Ninguno es un numero de balance: son parametros de forma del generador y de la busqueda de
  origen.
- 0024 Devengo por integral de solapes: el enunciado correcto de la aditividad, segun el apartado 3.8.
- 0027 Reglas de validacion compartidas entre cliente y servidor: la forma de respuesta del apartado 2.7,
  con motivos agregados por codigo, recuento y primera celda.
- 0030 Arbol sin estado almacenado: fase y volumen derivados de la edad, con fronteras en 240, 480 y
  720 horas de juego, y el volumen de una tala contando solo los estados talables.
- Entrada nueva sugerida: asignador determinista de origen de jugador por retícula de bloques
  reservados (apartado 2.4). Es una decision con consecuencias observables para el jugador, la separacion
  entre explotaciones, y su garantia es estructural en lugar de probabilistica, lo que justifica un ADR
  propio en lugar de una linea en 0014.

---

## Resuelto

Las cinco notas del apartado 1 estan aplicadas. Los apartados 2, 3, 4 y 5 no son notas pendientes: son
decisiones, discrepancias, los numeros de la prueba dorada y las aportaciones al ADR, y siguen vigentes
tal cual.

| Nota | Quien la aplico | Como |
|---|---|---|
| 1.1 Reexportaciones de `shared/index.ts` | Ventana de parcheo W2.5 | Las cuatro lineas descomentadas, incluidas `./rules/index.js` y `./world/index.js`. Sin colision de nombres, comprobado con `tsc` |
| 1.2 Falta un codigo de validacion para el terreno forestal | Ventana de parcheo W2.5 | `TERRAIN_NOT_FORESTABLE` anadido a `ValidationCode` y a `VALIDATION_MESSAGES` («El terreno seleccionado no admite silvicultura.»), con estado HTTP 409 en `API_ERROR_HTTP_STATUS`. Las dos devoluciones de `canBeForestPlotCell` y `canClearCell` sustituidas y su prueba actualizada |
| 1.3 Suelo de montana de la banda de distribucion | Ventana de parcheo W2.5 | `TERRAIN_DISTRIBUTION_TARGET_BP.MOUNTAIN.minBp` de 200 a 100 puntos base, con la medicion citada en el propio `world.ts`. `TERRAIN_NOISE`, `TERRAIN_THRESHOLDS_BP` y `GENERATOR_VERSION` sin tocar |
| 1.4 La codificacion de un chunk generado es contrato de transporte | W2-C | Resuelto por la via mas fuerte: el terreno no viaja en la respuesta de `POST /api/world/chunks`, que lleva solo la capa de modificaciones y la version, de modo que no existe una segunda tabla de codigos. Queda la condicion abierta de `NOTES-W2c` 1.5 si el cliente no pudiera generar el terreno con el presupuesto de rendimiento |
| 1.5 Sincronizacion de copias | Ventana de parcheo W2.5 | `make sync-types` ejecutado; `make check-sync` devuelve 0 |

### 1.1 Reexportaciones de `shared/index.ts`

Categoria: cambio en fichero de otro propietario
Ficheros afectados: `shared/index.ts`
Propietario del cambio: W3 al sincronizar, o W7-A

`shared/index.ts` declara las cuatro reexportaciones pendientes como comentarios, y su cabecera indica
que cada agente descomente la suya. W2b no lo ha hecho: el brief de este agente delimita el ambito de
escritura a `shared/rules/` y `shared/world/`, y editar un fichero compartido en paralelo con el agente
de `shared/api/` y `shared/ws/` admite la perdida de uno de los dos cambios. El agente de contrato
tampoco lo ha hecho, de modo que las cuatro lineas siguen comentadas.

Cambio a aplicar, sin reordenar el fichero: descomentar las lineas 16 y 19, que quedan asi.

```ts
export * from './rules/index.js';
export * from './world/index.js';
```

Conviene aplicarlo antes de W3: el backend y el frontend importan la copia sincronizada de `shared` por
el barril, y sin estas dos lineas tendrian que importar rutas profundas, que es precisamente lo que el
barril evita. Se ha comprobado que las reexportaciones de `rules/` y `world/` no colisionan por nombre
con `domain/` ni con `config/`.

### 1.2 Falta un codigo de validacion para el terreno forestal

Categoria: hueco en el contrato
Ficheros afectados: `shared/domain/enums.ts`
Propietario del cambio: W7-A

`ValidationCode` dispone de `TERRAIN_NOT_ARABLE`, `TERRAIN_NOT_BUILDABLE` y `TERRAIN_NOT_PURCHASABLE`,
pero no de un codigo para «el terreno no admite silvicultura». Lo necesitan dos reglas de
`shared/rules/selection.ts`: `canBeForestPlotCell`, cuando el jugador intenta crear una parcela forestal
sobre pradera, y `canClearCell`, cuando intenta desmontar una celda que no es bosque. Ambas devuelven
hoy `TERRAIN_NOT_ARABLE`, cuyo mensaje («El terreno seleccionado no admite agricultura») es enganoso en
ese contexto.

Cambio propuesto: anadir `TERRAIN_NOT_FORESTABLE` al conjunto y su mensaje a `VALIDATION_MESSAGES`
(«El terreno seleccionado no admite silvicultura.»), y sustituir las dos devoluciones en
`selection.ts`. El punto exacto queda marcado con un comentario en la funcion.

### 1.3 Banda de distribucion de terreno: el suelo de montana queda muy justo

Categoria: cambio en fichero congelado por propiedad
Ficheros afectados: `shared/config/world.ts`
Propietario del cambio: W7-A, a peticion de W2b

Conforme al apartado 1.3 de `NOTES-W2a.md`, W2b no edita `shared/config/world.ts`. La distribucion real
del generador, medida sobre 20 semillas y 200 chunks separados por semilla, es decir 4.096.000 celdas,
es la siguiente.

| Terreno | Medido | Banda de `TERRAIN_DISTRIBUTION_TARGET_BP` | Margen |
|---|---:|---|---|
| Pradera | 5.908 pb | 4.000 a 7.500 | Amplio |
| Bosque | 2.837 pb | 1.200 a 3.500 | Amplio |
| Montana | 257 pb | 200 a 1.500 | 28 % sobre el suelo |
| Agua | 997 pb | 400 a 2.200 | Amplio |

Las cuatro cifras caen dentro de la banda y coinciden con el reparto que la propia cabecera de
`world.ts` declara como objetivo (59 % pradera, 25 % bosque, 4 % montana, 12 % agua): la desviacion
mayor es montana, 2,57 % frente al 4 % previsto.

Cambio recomendado, no imprescindible: bajar `TERRAIN_DISTRIBUTION_TARGET_BP.MOUNTAIN.minBp` de 200 a
100 puntos base. Motivo: 257 pb es el ajuste mas estrecho de los cuatro, y la variacion por region es
grande. Midiendo una sola semilla sobre una ventana de 30 por 30 chunks, la cuota de montana oscila
entre 88 y 308 puntos base, de modo que la banda solo es una afirmacion valida sobre el agregado del
generador, nunca sobre una region concreta. Con el suelo en 100 pb la banda sigue detectando el fallo
que importa, que es un mundo sin barreras naturales, sin volverse fragil.

Se ha verificado que no hace falta tocar `TERRAIN_NOISE` ni `TERRAIN_THRESHOLDS_BP`: los umbrales
suponen un campo acampanado centrado en 5.000 pb con dispersion de unos 1.500 pb, y el generador
produce media 0,52 y desviacion 0,119 en elevacion y 0,133 en humedad, que es lo que hace salir el
reparto anterior. `GENERATOR_VERSION` permanece en 1.

### 1.4 La codificacion de un chunk generado es contrato de transporte

Categoria: contrato
Propietario del cambio: agente de `shared/api/`

`shared/world/terrain.ts` publica `TERRAIN_CODE`, `TERRAIN_BY_CODE` y `terrainFromCode`, y
`generateChunkTerrain` devuelve un `Uint8Array` de 1.024 bytes en orden por filas. Esa codificacion
(0 pradera, 1 bosque, 2 montana, 3 agua) es la que debe reutilizar el esquema de respuesta de
`POST /api/world/chunks` y la que cachea Redis con la version del chunk en la clave. No conviene definir
una segunda tabla en `shared/api/`: cambiar un valor invalida todos los chunks cacheados y obliga a
incrementar `GENERATOR_VERSION`.

### 1.5 Sincronizacion de copias

Categoria: orden que hay que ejecutar
Propietario del cambio: W3 y W7

`shared/rules/` y `shared/world/` son directorios nuevos. W2b no ejecuta `make sync-types` porque escribe
fuera de su ambito. Los patrones de exclusion del script cubren `__tests__/` a cualquier profundidad, de
modo que `shared/rules/__tests__/` y `shared/world/__tests__/` no se copian, que es lo que exige la
seccion 4 del plan.

### 1.6 El modulo `codes` de la seccion 8 del plan no existe como fichero

Categoria: discrepancia documental
Propietario del cambio: redactor de `docs/adr.md`

La seccion 8 del plan enumera `codes` entre los modulos de `shared/rules/`. El agente de vocabulario lo
situo en `shared/domain/enums.ts`, junto con `VALIDATION_MESSAGES`, que es donde corresponde: es
vocabulario cerrado y no una regla. W2b lo consume desde alli y no crea un `shared/rules/codes.ts`
vacio. La tabla de propiedad de `docs/ownership.md` conviene que refleje la ubicacion real.
