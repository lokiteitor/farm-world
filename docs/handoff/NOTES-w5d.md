# NOTES-w5d

Agente de entidades del lienzo, fase W5. Ambito escrito: `frontend/app/game/entities/**` y este
fichero. Ningun fichero fuera de esos dos se ha modificado.

Este fichero recoge lo que otros agentes deben aplicar y que W5-D no podia aplicar, el contrato que
la capa publica para las fases siguientes, las decisiones que el agente de cierre debe redactar como
ADR, y las discrepancias detectadas.

---

## 1. Que implementa este ambito

Seccion 9.5 del plan, en su parte de entidades, y la mitad visual de las secciones 68, 92, 96, 105 y
108 del GDD.

- Vistas de edificio, maquina, trabajador y arbol sobre las texturas que ya genera `game/textures`,
  agrupadas y recicladas por chunk, con ordenacion por profundidad estable.
- Los arboles se dibujan uno a uno solo por encima de zoom 0,6; por debajo los representan la capa de
  uso y la miniatura de chunk, que es lo que ya dice «aqui hay un arbol en pie» a cuatro pixeles por
  celda.
- Movimiento cosmetico de maquinaria y trabajadores, derivado por completo en el cliente: de la tarea
  se sintetiza un recorrido en serpentina determinista sobre las celdas del objetivo, sembrado por el
  identificador de la tarea, y la posicion es funcion del progreso temporal calculado con el reloj de
  juego que se le inyecta. La orientacion sale de la tangente del recorrido.
- Maquinaria ociosa aparcada dentro de la huella de su garaje y trabajadores ociosos junto a su
  vivienda con distintivo.
- Barras de progreso de tarea sobre la maquina que trabaja, delegadas en `OverlayScene.addProgress`
  de W4-D, y un rotulo por vivienda con el numero de trabajadores ociosos, delegado en `addLabel`.

El motor de tareas es de W6 y todavia no existe. La capa trabaja contra la forma que declara el
contrato (`shared/api/schemas/tasks.ts`, `machinery.ts`, `workers.ts`, `farms.ts` y `forestry.ts`) a
traves de un puerto, y se ejercito contra un origen sin red.

---

## 2. Verificacion, salida real

Ejecutado desde la raiz del repositorio, con PostgreSQL en 55432 y Redis en 56379.

| Orden | Salida |
|---|---|
| `make sync-types` | 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `make typecheck` | exit 0. `tsc` en shared y backend sin salida; `npx vue-tsc --build --force` del cliente en verde, 18 s |
| `make lint` | exit 0. `npx eslint .` sin hallazgos; Prettier: «All matched files use Prettier code style!» |
| `make test-unit` | exit 0. shared: 23 ficheros y 418 pruebas. Cliente: 51 ficheros y 514 pruebas, de las cuales 94 son nuevas de este ambito |
| `npx vitest run app/game/entities` | 6 ficheros y 94 pruebas en verde |
| `make test-int` | exit 1, con una prueba en rojo que no es de este ambito. Apartado 6.1 |
| `npx nuxt dev --port 3111` | Arranca sin errores; el registro solo lleva el aviso del servidor simulado. Apagado al terminar |

`npx vue-tsc --noEmit` sigue terminando con codigo 0 sin comprobar nada, por lo que `NOTES-w3d` 5
explica. La orden que comprueba es `npx vue-tsc --build --force`, y es la que se reporta. Se confirmo
ademas que los diez modulos de este ambito entran en el programa de tipos, leyendo
`frontend/.nuxt/tsconfig.app.tsbuildinfo`.

Sobre el servidor de desarrollo: al empezar la verificacion habia ya uno de otro agente de la fase
escuchando en 3111, y se reutilizo en lugar de levantar un segundo, porque dos servidores de Nuxt
comparten `frontend/.nuxt/` y el segundo corrompe el trabajo del primero. Cuando aquel termino, este
ambito levanto el suyo en el mismo puerto y lo apago al acabar. No queda ningun proceso de desarrollo
ni ningun navegador abierto.

### 2.1 Prueba en el navegador

Entorno: Chrome 151 sin cabeza, ventana 1440x900, servidor de desarrollo `npx nuxt dev --port 3111`,
ruta `/perf?mock=1&mockSession=1`. La capa se adjunta a la escena viva desde el protocolo de
depuracion importando `app/game/entities/index.ts` del servidor de Vite, exactamente como W4-G
ejercito la herramienta de seleccion, de modo que no se escribio en `pages/`, que no es de este
ambito. Los guiones quedan en el directorio de trabajo temporal de la sesion.

Comprobado con captura (`entities.png` del mismo directorio), a zoom 1,4 con 186 sprites:

| Comprobacion | Resultado |
|---|---|
| Edificios | Garaje, vivienda y silo dibujados sobre su huella exacta, con origen en la celda noroeste |
| Maquinaria ociosa | Cuatro maquinas aparcadas dentro del garaje, en plazas distintas y mirando al sur |
| Trabajadores ociosos | Cuatro figuras al sur de la vivienda, cada una con su distintivo y su tinte propio |
| Rotulo | Uno solo por vivienda: «4 ociosos» |
| Tarea en curso | Tractor y sembradora sobre el campo, la sembradora a remolque y en la misma orientacion, y el trabajador al costado con la herramienta alzada |
| Arboles | 168 arboles con solape correcto de copas, ordenados de norte a sur |
| Profundidad | Ninguna entidad tapa a la que tiene delante; la maquinaria aparcada se ve sobre el tejado del garaje |

---

## 3. Efecto en el banco de medida con 200 maquinas y 2.000 arboles

Caso de carga: 42 edificios (34 garajes y 8 viviendas), 200 maquinas, 32 trabajadores, 2.000 arboles
en un bloque de 45 por 45 celdas y 6 tareas en curso con dos maquinas cada una. Camara a zoom 1 sobre
el bloque, ventana de muestreo de 4 s.

Advertencia sobre el entorno, sin la cual las cifras de fotogramas no dicen nada. En esta maquina el
unico navegador que entrega fotogramas de forma fiable es Chrome sin cabeza, y ahi Phaser cae al
renderizador de lienzo (`renderType` 1, `CanvasRenderer`, comprobado en la propia pagina), es decir
rasterizacion por CPU. Con la ventana visible el gestor de ventanas de esta maquina no entrega
`requestAnimationFrame` en absoluto, de modo que no se pudieron obtener cifras de GPU. Es la misma
clase de limitacion que `NOTES-w4d.md` apartado 4 documenta para Chrome sin cabeza, agravada: alli
el renderizador era WebGL sobre SwiftShader y aqui es el lienzo. Las cifras de coste de CPU, de
recuento de sprites y de reciclado son validas; las de fotogramas y de draw calls no describen el
diseno sino el rasterizador.

### 3.1 Coste de la capa, mismo entorno y misma camara

| Medida | Sin la capa | Con 200 maquinas y 2.000 arboles |
|---|---|---|
| Sprites de entidad | 0 | 2.302 |
| Grupos de chunk vivos | — | 10 |
| Almacenes por clave de textura | — | 15 |
| Arboles dibujados uno a uno | — | 2.000 |
| Coste de la pasada estructural | — | **2,7 ms** (3,7 ms de maximo) |
| Coste medio por fotograma de la capa | — | **1,48 ms** (9,7 ms de maximo, que es la pasada estructural) |
| Fotogramas por segundo del lienzo | 36,2 | 21,9 |

La pasada estructural corre diez veces por segundo y decide que entidades existen; la pasada de
fotograma mueve solo lo que una tarea esta moviendo, que son seis maquinas y seis trabajadores, y
mide 0,1 ms. Los 2,7 ms de la estructural son el numero que importa, y son el resultado de una
optimizacion que la medicion obligo a hacer: la primera version reasignaba textura, origen, posicion,
rotacion, escala, profundidad y tinte a los 2.302 sprites en cada pasada y medía **10 ms**; comparar
contra el estado vivo y escribir solo lo que cambia lo baja a 2,7 ms, porque 2.000 de los 2.302 son
arboles y un arbol no se mueve, no gira y no cambia de textura entre dos pasadas.

### 3.2 Umbral de zoom de los arboles

| Zoom | Sprites | Arboles dibujados | Arboles cedidos a la capa de uso | En almacen | Coste de la pasada |
|---|---|---|---|---|---|
| 0,25 | 302 | 0 | 2.000 | 1.024 | 1,0 ms |
| 0,35 | 302 | 0 | 2.000 | 1.024 | 1,8 ms |
| 0,50 | 302 | 0 | 2.000 | 1.024 | 0,8 ms |
| 0,70 | 2.302 | 2.000 | 0 | 0 | 3,0 ms |
| 1,00 | 2.302 | 2.000 | 0 | 0 | 2,7 ms |
| 1,40 | 2.302 | 2.000 | 0 | 0 | 2,5 ms |
| 2,00 | 2.302 | 2.000 | 0 | 0 | 2,6 ms |

El umbral esta en 0,6 y no coincide con ningun paso de zoom, de modo que cruzarlo es siempre un
cambio real de paso y nunca el resultado de una comparacion de coma flotante, que es el criterio que
`game/world/config.ts` fija para `NEAR_LOD_MIN_ZOOM`.

### 3.3 Reciclado

Al bajar de 0,7 a 0,5 los 2.000 arboles se liberan: el almacen retiene **1.024** y destruye **976**.
La aritmetica cuadra exactamente con el techo declarado: el caso de carga usa cuatro claves de
textura de arbol y `MAX_POOLED_SPRITES_PER_KEY` es 256, de modo que 4 x 256 = 1.024 se retienen y el
resto se destruye en lugar de acumularse. Al volver a 0,7 se reutilizan los 1.024 y se construyen los
976 que faltan.

Barrido de 40 pasos de camara de 40 celdas y vuelta al origen, con la capa adjunta:

| Medida | Antes | Despues |
|---|---|---|
| Sprites vivos | 2.302 | 2.302 |
| Grupos de chunk | 10 | 10 |
| Sprites construidos | 3.278 | 4.254 |
| Sprites destruidos | 976 | 1.952 |
| Sprites rechazados por grupo lleno | 0 | 0 |

Ni un solo grupo llego a su techo de `CELLS_PER_CHUNK` sprites, que es lo que la prueba unitaria
exige y lo que el dominio garantiza por construccion: un arbol por celda (GDD seccion 130).

### 3.4 Banco de `/perf`, antes y despues de adjuntar la capa

Las dos ejecuciones dan «fuera del presupuesto» y las dos lo dan por el mismo motivo y solo por el:
la tasa de fotogramas del renderizador de lienzo. Todo lo demas queda dentro, y con margen:

| Medida | Presupuesto | Sin la capa | Con la capa |
|---|---|---|---|
| Carga de un chunk, detalle cerca | 4 ms de media | 0,07 ms | 0,05 ms |
| Carga de un chunk, detalle lejos | 4 ms de media | 0,06 ms sobre 14.622 chunks | 0,04 ms sobre 14.588 |
| Tick de streaming, detalle lejos | 33 ms | 8,01 ms de media | 6,66 ms |
| Parcheo de 250 celdas | 2 ms | 1,16 ms | 0,13 ms |
| Conmutacion de nivel de detalle | no reconstruir nada | 12 mitades sobre 32 chunks recargados | 12 sobre 32 |
| Texturas tras 10.016 chunks | estable | 117 antes y 117 despues | 117 y 117 |

La capa de entidades no altera ninguna de esas medidas, que es lo esperable: no toca el streaming, no
crea texturas nuevas y no participa en el parcheo.

### 3.5 Draw calls

No hay cifra fiable de este entorno, por lo que el apartado 3 explica. La unica lectura sobre WebGL
que se obtuvo en esta maquina, en una sesion con ventana visible cuya entrega de fotogramas estaba
limitada a unos 9 por segundo, fue **1 draw call sin la capa y 2 con los 2.302 sprites**, contra un
presupuesto de 130 a zoom 1. Es coherente con el diseno —los sprites de entidad comparten unas pocas
texturas generadas y el lote multitextura de Phaser los agrupa— pero se publica como observacion y no
como medida, y conviene rehacerla en una maquina con GPU accesible. Apartado 5.4.

---

## 4. Contrato que este ambito publica

No es material pendiente: es lo que W6 y W7 tienen que leer en lugar de deducirlo.

| Pieza | Ruta | Uso |
|---|---|---|
| Arranque | `game/entities/index.ts` | `createEntityLayer({ world, overlay, source })` sobre las escenas que devuelve `createWorldScenes` de W4-D |
| Puerto de datos | `game/entities/port.ts` | `EntitySource`. La capa no importa ningun almacen: la zona de ESLint lo prohibe y el puerto es la costura |
| Enlace con los almacenes | `game/entities/source.ts` | `createStoreEntitySource({ buildings, machines, workers, tasks, trees, fieldCells, forestPlotCells?, nowGameMs, revision })`. Declara la forma de cada fila de forma estructural, sin importarla |
| Origen sin red | `game/entities/source.ts` | `createStaticEntitySource`, con `setNowGameMs` y `replace`, para pruebas y para el banco |
| Recorrido cosmetico | `game/entities/serpentine.ts` | `pathSeed`, `serpentinePath`, `pathCursor`, `poseAt`, `travelledCells`, `taskProgressRatio`. Puras |
| Decision de dibujo | `game/entities/plan.ts` | `planEntities`, `taskPoses`, `taskPath`, `createTaskPathCache`. Puras |
| Profundidad | `game/entities/depth.ts` | `depthKeyOf`, `orderByDepth` |
| Colocacion en reposo | `game/entities/idle.ts` | `parkingGrid`, `parkedMachineSpot`, `restingWorkerSpot`, `ordinalOf` |
| Reciclado | `game/entities/pool.ts` | `SpritePool`, `ChunkEntityGroup`, `groupKeyOf`. Genericos y sin motor |
| Consulta por celda | `EntityLayer.entityAt(cellX, cellY)` | Devuelve `{ kind, id }` o null |
| Contadores | `EntityLayer.stats()` | Sprites, grupos, almacenes, arboles dibujados y cedidos, sprites rechazados, construidos, destruidos, ordenaciones y milisegundos de la ultima pasada |
| Constantes | `game/entities/config.ts` | Umbral de zoom de los arboles, techos, profundidad, desplazamientos y aparcamiento |

Como se enlaza desde fuera del lienzo, que es donde viven los almacenes:

```ts
const entities = createEntityLayer({
  world: scenes.world,
  overlay: scenes.overlay,
  source: createStoreEntitySource({
    buildings: () => buildings.all,
    machines: () => machines.all,
    workers: () => workers.all,
    tasks: () => tasks.active,
    trees: () => Object.values(forestry.treesByPlotId).flatMap((byId) => Object.values(byId)),
    fieldCells: (fieldId) => fields.cellsOf(fieldId),
    nowGameMs: () => clock.displayGameMs,
    revision: () => sync.lastAppliedSeq,
  }),
});
```

`sync.lastAppliedSeq` es la revision correcta y no cuesta nada: la incrementa toda trama aplicada y
toda respuesta de ruta mutante, que es la definicion de «el dominio se ha movido».

Convenciones que conviene no reinventar:

- La capa solo lee. Todo lo que entra viene por `EntitySource`; nada sale de ella salvo por consulta
  explicita. Ningun almacen se escribe desde `app/game`.
- Toda decision esta en `plan.ts` y es pura. Lo que queda en `EntityLayer.ts` es asignacion de
  memoria, que es la parte de la que una prueba unitaria no puede decir nada util.
- La profundidad de la capa se deriva de `DEPTH` de `game/world/config.ts` y no se escribe como 25.
  Dentro de la capa, la profundidad de un sprite es su `y` de mundo mas un dieciseisavo de pixel por
  rango de tipo.

---

## 5. Pendiente

### 5.2 El puente no declara evento para el marcado de una entidad

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/composables/useGameBridge.ts`, `frontend/app/game/world/WorldScene.ts`
Propietario del cambio: W3-C y W4-D (cerrados), a aplicar por W7-A

`CanvasPick` declara los tipos de sujeto `MACHINE` y `WORKER`, y hoy nadie los emite: `WorldScene`
resuelve el sujeto desde la capa de modificaciones del chunk, que solo conoce campo, edificio y
parcela forestal. La capa de entidades publica `entityAt(cellX, cellY)` y no emite nada, porque un
segundo emisor de `canvas:pick` lo dispararia dos veces.

La costura son tres lineas en `WorldScene.emitPick`, consultando la capa antes de caer en el parche
de la celda, y exige que la escena conozca la capa. La via limpia es que `createEntityLayer` devuelva
la consulta y que quien monta las dos se la pase a la escena; eso es un cambio en `WorldScene`, que
es de W4-D. No se ha tocado nada.

Mitigacion adoptada: `entityAt` esta publicada y probada; el panel que la necesite puede llamarla
directamente sobre la celda que `canvas:pick` ya trae.

### 5.3 El rotulo del trabajador ocioso es de este ambito y la lista de la plantilla no

Categoria: coordinacion, sin cambio de fichero
Propietario: W5-F (panel de trabajadores) y W6-D (resumen de regreso)

El lienzo dice «4 ociosos» sobre una vivienda; el detalle de quien y desde cuando es del panel de
personal y del resumen de regreso de GDD seccion 68. Se ha evitado deliberadamente duplicar ahi
ninguna cifra economica: la capa de entidades no muestra salarios ni condicion.

### 5.4 La medida de draw calls no es reproducible en esta maquina

Categoria: verificacion pendiente
Propietario: W7-A o quien disponga de una maquina con GPU accesible

Apartados 3 y 3.5. Chrome sin cabeza cae al renderizador de lienzo de Phaser y Chrome con ventana no
recibe `requestAnimationFrame` en este escritorio. La comprobacion que falta es una ejecucion del
banco de `/perf` con la capa adjunta sobre WebGL real, para confirmar que los 2.302 sprites siguen
costando uno o dos draw calls.

Riesgo concreto que esa medida debe vigilar, y que conviene registrar antes de que aparezca como una
sorpresa: el lote multitextura de Phaser agrupa hasta el numero de unidades de textura de la GPU,
tipicamente dieciseis. El catalogo de arte da 5 edificios, 8 maquinas, 2 poses de trabajador, 16
arboles y 3 particulas, es decir 34 claves distintas, y a las que hay que sumar los dos atlas de
tesela. Una escena con muchas especies de entidad a la vez puede por tanto forzar vaciados de lote
adicionales. Si eso llega a medirse como un problema, la solucion es un unico atlas generado de
entidades en `game/textures`, que es de W3-D; no se ha hecho aqui porque seria escribir en un
directorio ajeno y porque sin la medida seria una optimizacion a ciegas.

### 5.5 La geometria de una parcela forestal no viaja en el contrato

Categoria: hueco del contrato, sin cambio de fichero
Propietario: W6-C (silvicultura)

`ForestPlotDto` lleva `cellCount` y no las celdas. Para dibujar el recorrido de una tala, el enlace
de `source.ts` cae en las celdas de los arboles en pie de la parcela, que es sobre lo que una tala
trabaja de verdad (GDD seccion 132), y admite un `forestPlotCells` opcional que lo sustituye. Si W6-C
publica la geometria de la parcela, basta con pasarla y el respaldo deja de correr; no hace falta
tocar este ambito.

---

## 6. Discrepancias detectadas

### 6.1 `make test-int` queda en rojo por una prueba de raiz del backend

Categoria: prueba de otro ambito
Ficheros afectados: `backend/src/__tests__/idempotency.int.test.ts`, linea 154
Propietario: W3-A (cerrado), a aplicar por W7-A

Salida real:

```
FAIL  src/__tests__/idempotency.int.test.ts > la cabecera Idempotency-Key >
      no almacena la respuesta de un fallo del servidor, de modo que el reintento sigue abierto
AssertionError: expected 404 to be 501
```

La prueba usa `POST /api/machines` como ejemplo de ruta de andamiaje y espera un 501. W5-A ha
implementado esa ruta en esta misma fase, de modo que ahora responde 404 con una granja inexistente.
Es exactamente el defecto que ADR-0038 resolvio para la lista de rutas implementadas, aplicado a otra
prueba: una prueba que codifica como literal un hecho que la fase siguiente cambia. La correccion
natural es elegir la ruta de andamiaje desde `stubRouteKeys()` en lugar de nombrarla. El resto de la
suite esta en verde: 24 ficheros y 212 pruebas.

Este ambito no ha tocado ningun fichero del backend.

### 6.2 La maquinaria aparcada quedaba oculta bajo el tejado de su garaje

Detectado en la primera captura de la verificacion y corregido dentro de este ambito. La regla
general de profundidad es «lo que esta mas al sur se dibuja encima», y con ella una maquina aparcada
en la mitad norte de un garaje de ocho celdas queda detras del propio edificio, que es opaco. Un
garaje cuyo interior no se ve no dice nada sobre la capacidad que existe para limitar (GDD seccion
96), de modo que una maquina aparcada se ordena por el borde sur del edificio que la contiene y no
por su propia posicion. Queda como caso de prueba.

### 6.3 Un rotulo por trabajador ocioso es ilegible

Detectado en la misma captura y corregido dentro de este ambito. Cuatro trabajadores de una vivienda
estan a una celda unos de otros, y cuatro nombres a una celda se solapan en una mancha ilegible a
cualquier zoom al que se dibujen rotulos. La lectura que GDD seccion 68 pide es un recuento, no una
nomina, de modo que la capa emite un rotulo por vivienda: el nombre cuando hay uno solo y «N ociosos»
cuando hay varios.

### 6.4 La orientacion de las texturas no esta documentada en ningun sitio verificable

`game/textures/shapes.ts` declara en su cabecera que toda maquina y el trabajador se dibujan mirando
al este y centrados en su lienzo, y que un arbol tiene el tronco abajo al centro. No hay prueba que
lo compruebe, y la capa de entidades depende por completo de ello: si una textura futura se dibujase
mirando al sur, la maquinaria giraria noventa grados de mas y nada fallaria en rojo. No se ha
cambiado nada, porque `game/textures` es de W3-D. La observacion es para W7 si decide anadir una
prueba de orientacion sobre el catalogo de sprites.

---

## 7. Material para el ADR

Lo redacta el agente de cierre de la fase, en el tramo 0039-0041 que el apartado 3.3 de
`docs/ownership.md` reserva a W5. Las decisiones de este ambito caen todas bajo el tema que el plan
titula «Movimiento de maquinaria cosmetico y derivado en el cliente», que el reparto original situaba
en W6 y que este ambito ya ha implementado.

### 7.1 Para «Movimiento cosmetico y derivado en el cliente»

1. El servidor no dice nunca donde esta un tractor, y el cliente lo responde. GDD seccion 92 lo
   autoriza de forma explicita: la tarea se ata al campo completo y el movimiento visual de la
   maquina entre chunks es cosmetico y sin efecto en la simulacion. Tres propiedades se siguen de
   derivarlo en lugar de transmitirlo, y las tres son la razon por la que el plan lo pide asi: no
   consume trafico, sobrevive a una recarga y es identico en dos pestanas. Un paseo aleatorio en el
   cliente no tendria ninguna de las tres.
2. La forma del recorrido es una serpentina, que es como se trabaja un campo de verdad, y el
   identificador de la tarea elige cual de las ocho orientaciones se usa. Ocho y no una, porque dos
   campos trabajados a la vez en paralelo se leerian como una sola maquina reflejada; ocho y no
   infinitas, porque cada una de las ocho es un recorrido que un agricultor conduciria.
3. El recorrido es funcion del conjunto de celdas y no del orden en que llegan. Las celdas de un
   campo llegan como una pagina de una respuesta de API, y dos clientes que las recibieron en otro
   orden tienen que dibujar el mismo recorrido. Se garantiza ordenando explicitamente y no dejandolo
   a la iteracion de un mapa, y se comprueba con una prueba que baraja la entrada.
4. La posicion se parametriza por indice de celda y no por longitud de arco. Las dos difieren solo en
   el giro del final de banda, donde un paso diagonal es mas largo que uno recto, y pagar una tabla
   de longitudes acumuladas por tarea para eliminar una variacion de velocidad apenas visible en la
   cabecera seria la eleccion equivocada: una maquina real tambien afloja ahi.
5. La cancelacion detiene el recorrido donde se detuvo. `endedGameMs` acota el progreso, porque una
   tarea cancelada no es una tarea completada (GDD seccion 106): no se reembolsa nada y el desgaste
   se prorratea, de modo que la maquina no puede seguir avanzando hacia un final previsto que ya no
   va a ocurrir.
6. El reloj es un parametro y nunca `Date.now`. El tiempo de juego es una extrapolacion desde un
   ancla con multiplicador racional, y un renderizador que leyera el reloj de pared se separaria de
   toda cuenta atras de la interfaz al minuto de cambiar el multiplicador.

### 7.2 Para «Entidades del lienzo», si el cierre decide darle entrada propia

1. Dos niveles de detalle tambien para las entidades, y por el mismo motivo que para el terreno. Por
   debajo de zoom 0,6 los arboles no se dibujan uno a uno: la capa de uso y la miniatura de chunk ya
   dicen que una celda lleva un arbol en pie, que es todo lo que una celda de cuatro pixeles puede
   decir. Medido: 2.000 sprites a zoom 0,7 y ninguno a zoom 0,5, con el mismo dato de origen.
2. Toda decision es pura y esta separada del motor. `planEntities` toma el modelo de lectura, el
   rectangulo visible, el zoom y el reloj y devuelve una lista de colocaciones; `EntityLayer` la
   aplica. Lo que se gana no es elegancia: es que «que se ve», «donde aparca una maquina», «que se
   dibuja delante de que» y «donde esta una maquina en este instante» son aserciones de una prueba
   unitaria y no capturas de pantalla.
3. Dos frecuencias y una sola verdad. La pasada estructural corre diez veces por segundo y decide que
   entidades existen; la pasada de fotograma mueve solo lo que una tarea esta moviendo. Las dos
   derivan la pose de la misma funcion, de modo que no pueden discrepar. Medido: 2,7 ms la
   estructural con 2.302 sprites, 0,1 ms la de fotograma.
4. Se escribe solo lo que cambia. La primera version reasignaba las siete propiedades de los 2.302
   sprites en cada pasada estructural y medía 10 ms; comparar contra el estado vivo lo baja a 2,7 ms,
   porque 2.000 de ellos son arboles y un arbol no se mueve. La comparacion no es una optimizacion
   anadida despues: es la razon por la que la capa mantiene un indice de lo que ya esta en pantalla.
5. El reciclado tiene dos techos porque hay dos modos de fallo distintos. El del grupo acota lo que
   un chunk puede costar, y es el invariante «un arbol por celda» de GDD seccion 130 hecho exigible.
   El del almacen acota lo que una sesion larga puede costar, y sin el, recorrer un bosque dejaria
   caliente en memoria cada sprite jamas creado, con lo que el reciclado se habria convertido en una
   fuga con mejor nombre.
6. La profundidad es una clave y no un comparador. La `y` de mundo mas un dieciseisavo de pixel por
   rango de tipo ordena totalmente, y la ordenacion estable garantiza que dos iguales conserven su
   orden de llegada, que es exactamente el caso de una hilera de arboles. Con una ordenacion
   inestable esa hilera parpadea entre dos fotogramas.
7. Una maquina aparcada se ordena por el borde sur del edificio que la contiene. Es la unica
   excepcion a la regla general, y existe porque la regla general la esconderia bajo un tejado
   opaco.

---

## 8. Ficheros creados

```text
frontend/app/game/entities/config.ts        constantes, umbral de zoom de los arboles y techos
frontend/app/game/entities/port.ts          el puerto de lectura y su origen vacio
frontend/app/game/entities/serpentine.ts    recorrido determinista, cursor, pose y progreso de tarea
frontend/app/game/entities/idle.ts          aparcamiento en garaje y descanso junto a la vivienda
frontend/app/game/entities/depth.ts         clave de profundidad y ordenacion estable
frontend/app/game/entities/pool.ts          almacen de sprites y grupo por chunk, sin motor
frontend/app/game/entities/plan.ts          la decision completa de un tick, pura
frontend/app/game/entities/source.ts        enlace con los almacenes y origen sin red
frontend/app/game/entities/EntityLayer.ts   la capa sobre la escena del mundo
frontend/app/game/entities/index.ts         superficie publica
frontend/app/game/entities/__tests__/       fixtures y seis suites: serpentine, depth, pool, idle,
                                            plan, source. 94 pruebas
```

---

## 9. Ordenes que no se han ejecutado

Ninguna que mute el repositorio fuera del ambito asignado: sin `git`, sin `npm install`, sin
`docker compose`, sin `prisma generate` ni `prisma migrate`, sin compilaciones de produccion. Se
ejecutaron `make sync-types`, `make typecheck`, `make lint`, `make test-unit`, `make test-int`,
`npx vue-tsc --build --force`, `npx vitest run`, `npx nuxt dev --port 3111` y, sobre
`frontend/app/game/entities` unicamente, `npx eslint --fix` y `npx prettier --write`.

## 10. Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 5.1 La pagina de juego monta el lienzo y no crea la capa de entidades

Resuelto por W6-W: la pagina construye la capa con la escena viva (ADR-0054).

El texto original de la nota:

Categoria: cambio en fichero de otro agente
Ficheros afectados: `frontend/app/pages/game.vue`
Propietario del cambio: W5-W, el agente de costura de esta misma fase; si ya ha cerrado, W7-A

El agente de costura reescribio `pages/game.vue` durante esta fase y resolvio lo que
`NOTES-w4d.md` 1.1, `NOTES-w4g.md` 1.5 y `NOTES-w4-cierre-2.md` 2 declaraban pendiente: la pagina ya
llama a `createGame` y ya cose la herramienta de seleccion. Lo que falta es la capa de entidades, que
son unas pocas lineas dentro de `mountCanvas`, junto al `attachSelectionTool` que ya esta ahi:

```ts
entities = createEntityLayer({
  world: scenes.world,
  overlay: scenes.overlay,
  source: createStoreEntitySource({ /* apartado 4 de este fichero */ }),
});
```

y `entities?.destroy()` en `onBeforeUnmount`.

Un detalle que ahorra trabajo a quien lo aplique: la capa **no** necesita la espera con plazo que la
herramienta de seleccion necesita. `createSelectionTool` registra objetos sobre la escena en el acto
y por eso `game.vue` sondea hasta que `world.isReady`; `createEntityLayer` comprueba `isReady` en su
constructor y, si la escena no ha corrido `create`, se suscribe a `Phaser.Scenes.Events.CREATE` y se
adjunta sola. Se puede construir en la misma sentencia que `createGame`.

Mitigacion adoptada: el enlace completo esta escrito y ejercitado en el navegador contra la escena
viva, de modo que quien lo aplique copia y no inventa.
