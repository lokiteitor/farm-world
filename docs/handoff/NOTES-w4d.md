# NOTES-w4d

Agente de renderizado del mundo, fase W4. Ambito escrito: `frontend/app/game/world/`,
`frontend/app/game/overlay/` y `frontend/app/pages/perf.vue`. No se ha escrito en ningun otro
directorio del repositorio.

---

## 1. Pendiente

### 1.2 Dos rutas con propiedad distinta de la que declara la tabla

Categoria: cambio en fichero de otro propietario
Ficheros afectados: `docs/ownership.md`, apartado 3.6
Propietario del cambio: el agente de cierre de W4

El apartado 3.6 atribuye `frontend/app/game/overlay/` a W5-D y `frontend/app/pages/perf.vue` a W3-C.
El brief de este agente asigna ambas a W4-D de forma explicita, y asi se han escrito. La escena de
superposicion existe porque el contador de depuracion de F3 y el anclaje invariante al zoom son
requisitos de esta fase, no de la siguiente; W5-D la extiende anadiendo rotulos con `addLabel` y
`addProgress` y no necesita reescribir nada de lo que hay.

Mitigacion adoptada: ninguna necesaria. Ningun fichero de otro agente se ha tocado y la superficie que
W5-D consume esta documentada en el apartado 3.

### 1.3 El presupuesto de un tick al nivel de detalle lejano queda al borde

Categoria: rendimiento medido, trabajo pendiente opcional
Ficheros afectados: `frontend/app/game/world/chunkView.ts`
Propietario del cambio: W4-D o quien retome el renderizado

Un tick de streaming al nivel lejano mide 31,05 ms de media y 35,10 de maximo (apartado 4). El coste
esta casi entero en una sola operacion: crear la textura de lienzo de la miniatura de un chunk y
subirla a la GPU, que en esta maquina son unos 1,9 ms por chunk. Con doce chunks por tick el
presupuesto se cumple, pero el margen es pequeno y el numero no baja optimizando el codigo que lo
rodea, porque no es codigo: es una creacion de textura por chunk.

La via que resolveria el punto, si algun dia estorba, es un atlas rodante de miniaturas: una unica
textura de 512 por 512 en la que el chunk `(cx, cy)` ocupa el bloque `(cx mod 16, cy mod 16)`. Con
ella una region visible se dibuja con cuatro cuadrilateros en lugar de ciento doce, la subida a la GPU
se agrupa una vez por fotograma en lugar de una por chunk, y el coste por chunk pasa a ser una
escritura de 4 KB en un lienzo. El coste de la opcion es que la miniatura de un chunk fuera de la
ventana de 16 por 16 deja de existir, lo que hay que contrastar con lo que el minimapa de W4-E
necesite.

Mitigacion adoptada: el numero de chunks que construyen su mitad por tick es una constante propia,
`MAX_LEVEL_UPGRADES_PER_TICK`, fijada en 12 y separada del techo de 32 cargas por tick que fija la
seccion 9.5 del plan. Bajarla es el ajuste inmediato si el tick se pasa de presupuesto en otra
maquina.

### 1.5 El contador de la ruta de medicion se apoya en un global de la pagina

Categoria: verificacion
Ficheros afectados: `frontend/app/pages/perf.vue`
Propietario: W4-D

`perf.vue` publica el informe en `window.__fwPerf` y las escenas en `window.__fwWorld`. Es lo que
permite ejecutar el banco sin un humano delante y mover la camara desde una comprobacion automatica,
y es la unica via que no anade una dependencia a un `package.json` congelado. Son dos globales en una
ruta de desarrollo y nada del cliente los lee. Si W7 decide que la ruta no debe existir en produccion,
lo que hay que retirar es la ruta entera, no los globales.

---

## 2. Discrepancias detectadas

### 2.1 La tesela de propiedad dibuja borde en sus cuatro lados

`game/textures/usage-atlas.ts` pinta `OWNED` como un tinte translucido mas un borde de un pixel en
los cuatro lados de la celda, con alfa 170. A escala, una parcela de varios miles de celdas en
propiedad se lee como una reticula amarilla densa que compite con la rejilla y con el contorno de
propiedad, que dibuja la misma frontera otra vez y mucho mas fina. Se puede comprobar en las capturas
de la verificacion a zoom 1 y a zoom 2.

No se ha cambiado nada: el atlas es de W3-D y esta congelado en cuanto a criterio artistico. La
observacion es para el panel de leyenda de W4-E, que tendra que explicar tres marcas distintas para el
mismo hecho, y para W7 si decide simplificar: lo barato es que la tesela `OWNED` deje el borde y
conserve solo el tinte, porque el contorno de propiedad ya marca el limite de la parcela y lo hace
sobre el conjunto y no sobre cada celda.

### 2.2 `RenderStats` del puente no cubre lo que el contador de depuracion muestra

`composables/useGameBridge.ts` declara `RenderStats` con cinco campos (`fps`, `drawCalls`, `quads`,
`loadedChunks`, `levelOfDetail`). El contador de F3 que pide el brief necesita ademas el zoom, los
chunks visibles y las peticiones en vuelo.

Resuelto sin tocar el contrato: la escena publica `WorldStats`, mas rico, como metodo propio
(`WorldScene.stats()`), y por el puente sigue viajando exactamente `RenderStats`. El zoom ya viaja en
`camera:changed`. No hace falta ningun cambio en `app/composables/`, que es de W3-C.

### 2.3 `canvas:drag` no lo emite nadie todavia

La escena emite `canvas:hover` y `canvas:pick`, que son los dos que necesita el inspector de celda de
W4-E, y deja `canvas:drag` sin emisor. Es deliberado: el arrastre pertenece a la herramienta de
seleccion de W5-E, que es quien sabe cuando un arrastre es una seleccion y cuando es un desplazamiento
de camara. La costura ya esta puesta: la camara deja de panear con el boton primario cuando llega un
`selection:mode` con proposito no nulo, y vuelve a hacerlo cuando llega uno nulo.

### 2.4 La rueda del raton y el arbitraje de entrada

`useShellUi` deshabilita la entrada del mundo cuando hay un modal abierto y lo publica por
`input:enabled`. La camara lo respeta para arrastre, teclado y rueda. Lo que no puede respetar es el
foco del teclado cuando el jugador esta escribiendo en un campo de texto de un panel: el evento
`keydown` de Phaser se registra sobre el documento. No se ha visto ningun caso en esta fase porque no
hay paneles con formulario montados sobre el lienzo, pero W4-E y W5-F deben saber que si un panel
lateral con campo de texto queda abierto sin modal, las teclas WASD moveran la camara mientras se
escribe. La solucion natural es que `useShellUi` emita `input:enabled` en falso tambien cuando el foco
esta en un campo de texto; es un cambio en `app/composables/`, de W3-C.

---

## 3. Contrato que esta fase publica para W4-E, W5-D y W5-E

No es material pendiente: es lo que los agentes siguientes tienen que leer en lugar de deducirlo.

| Pieza | Ruta | Uso |
|---|---|---|
| Arranque | `game/world/index.ts` | `createWorldScenes({ source, bridge, debug, home })` devuelve `{ scenes, world, overlay, stats }`. Las escenas se pasan a `createGame({ worldScenes })` de W3-D |
| Puerto de datos | `game/world/source.ts` | `WorldSource`. La escena no importa ningun almacen: la zona de ESLint lo prohibe y el puerto es la costura |
| Enlace con el almacen | `game/world/source.ts` | `createStoreWorldSource({ store, viewerPlayerId, requestChunks, fieldState, pendingCells })`. Declara la forma del almacen de forma estructural, sin importarlo |
| Fuente sin red | `game/world/source.ts` | `createStaticWorldSource` y `benchPatchesOf`, para pruebas y para el banco de medida |
| Camara | `game/world/camera.ts` | `WorldCamera`: `goto`, `goHome`, `setHome`, `zoomStep`, `cellAt`, `viewRect`, `setPanWithPrimary`, `setInputEnabled`. Se obtiene con `world.worldCameraHandle` |
| Aritmetica de camara | `game/world/zoom.ts` | `worldPointOfScreen`, `screenPointOfWorld`, `cellOfScreen`, `anchoredScroll`, `visibleCellRect`, `scrollCenteredOnCell`, `snapZoom`, `stepZoom`, `levelOfDetail`. Puras |
| Rectangulos y streaming | `game/world/viewport.ts` | `chunkRectOfCells`, `expandChunkRect`, `chunkRectContains`, `planStreaming`. Puras |
| Contornos | `game/world/outlines.ts` | `collectOutlineGroups(chunks, chunkSize, viewerPlayerId)` sobre `borderSegments` de `shared/rules/geometry.ts`. La herramienta de seleccion de W5-E debe usar la misma funcion compartida y no escribir un segundo recorrido de bordes |
| Miniatura | `game/world/thumbnail.ts` | `chunkThumbnailPixels(chunk, chunkSize, contexto)`. Es la que alimenta el minimapa de W4-E: `ChunkView.thumbnail32` devuelve los mismos bytes ya calculados para el chunk cargado |
| Teselas | `game/world/tiles.ts` | `terrainTileIndices`, `usageTileIndices`, `chunkTileData`, `toRows`, `NO_USAGE_TILE` |
| Rotulos anclados | `game/overlay/index.ts` | `OverlayScene.addLabel(anchor, texto)` y `addProgress(anchor, razon)`, ambos con `move`, `setVisible` y `remove`. El anclaje es `{ cellX, cellY, offsetX?, offsetY? }` y el desplazamiento va en pixeles de pantalla, de modo que no escala con el zoom |
| Contador de depuracion | `game/overlay/debugLines.ts` | `debugLines(stats)` e `isOverBudget(stats)`. F3 lo conmuta; `WorldScene.debugVisible` es el interruptor |
| Banco de medida | `game/world/bench.ts` | `runWorldBench({ world, game, onProgress })` y `formatBenchReport`. Es lo que ejecuta `/perf` |
| Constantes | `game/world/config.ts` | Umbral de nivel de detalle, pasos de zoom, anillos, techos por tick, capacidad de cache, profundidades y presupuesto |

Convenciones que conviene no reinventar:

- La escena solo lee. Todo lo que entra viene por `WorldSource` o por el puente; todo lo que sale va
  por el puente. Ningun almacen se escribe desde `app/game`.
- La profundidad de un objeto nuevo se declara en `DEPTH` de `config.ts` y no como literal en el punto
  de uso. Los cinco valores actuales dejan hueco de diez en diez a proposito: las entidades de W5-D
  van entre `USAGE` (20) y `GRID` (30), y la seleccion de W5-E por encima de `OUTLINES` (40).
- La camara mantiene su propio desplazamiento en doble precision y lo escribe en la camara de Phaser
  cada fotograma. Quien necesite mover la camara usa `goto` o el evento `camera:goto`, nunca
  `scene.cameras.main.setScroll`, que Phaser redondea y devolveria un valor distinto del que la
  camara cree tener.

---

## 4. Verificacion, salida real

Entorno: Chrome 1920x1080 sobre Intel Iris Xe (Mesa, `ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics
(TGL GT2), OpenGL ES 3.2)`), servidor de desarrollo `npx nuxt dev --port 3111`, ruta
`/perf?mock=1&mockSession=1&bench=1` con el servidor simulado activo y el generador local como origen
de datos.

| Orden | Salida |
|---|---|
| `make sync-types` | 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `make typecheck` | exit 0. `tsc` en shared y backend sin salida; `vue-tsc --build --force` del cliente en verde |
| `make lint` | exit 0. `npx eslint .` sin hallazgos; Prettier: «All matched files use Prettier code style!» |
| `make test-unit` | exit 0. shared: 23 ficheros y 418 pruebas. Cliente: 17 ficheros y 169 pruebas, de las cuales 76 son nuevas de esta fase |
| `npx vitest run app/game` | 10 ficheros y 122 pruebas en verde |
| `npx nuxt dev --port 3111` | Arranca sin errores; el registro solo lleva el aviso del servidor simulado |

`npx vue-tsc --noEmit` sigue terminando con codigo 0 y sin comprobar nada, por lo que `NOTES-w3d` 5
explica: `frontend/tsconfig.json` es un fichero de solucion con `"files": []`. La orden que comprueba
es `npx vue-tsc --build --force`, y es la que se reporta arriba.

### 4.1 Banco de medida, cifras reales

Ejecutado sobre la escena real con el generador local. El origen no lleva red a proposito: un
presupuesto medido a traves de una peticion HTTP mide la peticion. La capa de modificaciones del banco
no es decorativa: tres cuartas partes de cada chunk estan en propiedad y hay un campo en crecimiento
dentro, de modo que la capa de uso y la extraccion de contornos trabajan de verdad.

| Medida | Presupuesto | Medido |
|---|---|---|
| Zoom 1, 52 chunks cargados (10 visibles), detalle cerca | 55 fps, 130 draw calls | **59,1 fps** de motor (59,6 de sondeo), **2 draw calls** de maximo y de media, 17.920 cuadrilateros |
| Zoom 0,25, 214 chunks cargados (112 visibles), detalle lejos | 55 fps, 220 draw calls | **60,1 fps**, **8 draw calls** de maximo y de media, 112 cuadrilateros |
| Carga de un chunk, detalle cerca | 4 ms | **0,14 ms** de media, 0,30 de maximo sobre 28 chunks |
| Carga de un chunk, detalle lejos | 4 ms | **0,06 ms** de media, 0,20 de maximo sobre 236 chunks |
| Tick de streaming, detalle cerca | 33 ms | **3,47 ms** de media, 7,80 de maximo sobre 7 ticks |
| Tick de streaming, detalle lejos | 33 ms | **31,05 ms** de media, 35,10 de maximo sobre 13 ticks (apartado 1.3) |
| Parcheo de 250 celdas | 2 ms | **0,49 ms** de media, 0,70 de maximo sobre 8 chunks |
| Memoria tras recorrer 10.016 chunks | estable | texturas **162 antes y 142 despues**; monticulo 136,7 MB a 197,3 MB |
| Conmutacion de nivel de detalle | no reconstruir nada | 256 chunks cargados, 108 construyeron su otra mitad la primera vez; al repetir el cruce se construyeron 36 mitades sobre 64 chunks recargados, es decir ninguna mitad dos veces |

Recorrido manual de la camara, con las mismas herramientas y capturas guardadas:

| Zoom | Detalle | Chunks | Draw calls | Cuadrilateros | fps | Contornos |
|---|---|---|---|---|---|---|
| 2,00 | cerca | 32 cargados, 6 visibles | 2 | 10.752 | 59,6 | 888 segmentos (4,0 ms) |
| 1,00 | cerca | 24 cargados, 8 visibles | 2 | 14.336 | 59,9 | 1.152 segmentos (5,6 ms) |
| 0,50 | cerca | 74 cargados, 32 visibles | 7 | 57.344 | 59,5 | 4.416 segmentos (12,6 ms) |
| 0,25 | lejos | 165 cargados, 112 visibles | 8 | 112 | 57,9 | 0, el nivel lejano no dibuja contornos |

Tres lecturas de esas cifras que conviene registrar:

1. El presupuesto de draw calls no esta ajustado, esta holgado por un factor de quince. El motivo es
   que el nivel cercano dibuja dos capas de tilemap por chunk sobre dos unicas texturas, y el lote
   multitextura de Phaser las agrupa: ocho chunks visibles son dos llamadas de dibujo, no dieciseis.
   El nivel lejano dibuja una miniatura por chunk, cada una con su textura, y ahi si aparece una
   llamada cada catorce chunks aproximadamente.
2. El recuento de cuadrilateros que publica el contador es una cota superior: cuenta todas las teselas
   de los chunks visibles, y Phaser descarta por celda las que caen fuera del encuadre. Los 17.920 de
   zoom 1 son diez chunks completos, no lo que llego al lote.
3. La media de fotogramas se mide contando los pasos del motor y no los fotogramas que ve el propio
   banco. Las dos cifras se publican juntas porque discrepar es la firma de un navegador que ha dejado
   de entregar fotogramas a una ventana que considera oculta, y una ejecucion en la que discrepan no
   dice nada del renderizador. Con la ventana fuera de pantalla, Chrome lo hace: hubo que forzar
   `Page.setWebLifecycleState('active')` por el protocolo de depuracion para obtener medidas estables.

Nota sobre el entorno de medida, por si alguien repite el ejercicio. En Chrome sin cabeza el
renderizador es SwiftShader, es decir rasterizacion por software: los draw calls, los tiempos de carga,
el parcheo y la memoria salen iguales, pero la tasa de fotogramas cae a 10-25 en el caso cercano. No
es un limite del diseno: un borrado de pantalla completa alcanza 59 fps en ese mismo entorno, de modo
que lo que se agota es el relleno de pixeles de la CPU. Las cifras de esta nota son las de la GPU real.

---

## 5. Material para el ADR

Lo redacta el agente designado de la fase, W4-A, en los numeros 0023 a 0026 (`docs/ownership.md`,
apartado 3.3). Decisiones de este ambito que conviene que recojan.

### 5.1 Para «Dos niveles de detalle en el renderizado, tilemap por chunk y miniatura»

1. Los dos niveles se alimentan de la misma estructura de datos y de las mismas funciones puras. Los
   pixeles de la miniatura y los indices de tesela se calculan al cargar el chunk, desde el mismo
   `WorldChunkView`, de modo que el minimapa y el lienzo no pueden discrepar: no hay un segundo camino
   de datos, hay un segundo consumidor del primero.
2. Lo que se difiere no es el dato sino el objeto del motor. El tilemap se crea la primera vez que el
   chunk se dibuja de cerca y la textura de la miniatura la primera vez que se dibuja de lejos; una vez
   creados, ninguno se destruye mientras el chunk viva, de modo que cruzar el umbral conmuta
   visibilidad y no reconstruye nada, que es la propiedad que el plan protege. Las dos mitades del
   diferimiento se decidieron midiendo: un tilemap son 2.048 objetos de tesela, y el caso lejano del
   brief tiene 200 chunks, lo que serian 409.600 objetos para algo que a cuatro pixeles por chunk nadie
   ve; y una textura de lienzo cuesta unos 1,9 ms, casi todo creacion y subida a la GPU, lo que pagado
   por 32 chunks en un tick fue un tiron visible de 60 ms.
3. La construccion esta acotada por tick y solo para chunks visibles. Construir la mitad que falta para
   todos los chunks vivos en el fotograma del cruce detuvo el bucle del motor en la maquina de esta
   fase, con 200 texturas en un solo fotograma. Doce por tick mantiene el tick dentro de presupuesto y
   cuesta dos tics mas, es decir una quinta parte de segundo, en terminar un cruce.
4. La tesela vacia de la capa de uso es el indice -1 y no la tesela transparente del atlas. El
   descarte de Phaser omite una tesela con indice -1 y batea una transparente: sobre un chunk sin
   modificar es la diferencia entre 1.024 cuadrilateros y ninguno, y la mayor parte de un mundo
   virtualmente infinito no esta modificada.
5. Los contornos se extraen a nivel de escena y no por chunk, agrupados por sujeto. Por chunk serian
   ademas de mas lentos, incorrectos: un campo que cruza la frontera de dos chunks mostraria una
   costura donde sus mitades se encuentran. Y agrupar dos campos adyacentes en un mismo conjunto
   borraria la frontera entre ellos, porque el contorno de un conjunto es el conjunto de aristas cuyo
   vecino esta fuera. La extraccion es `borderSegments` de `shared/rules/geometry.ts`, la misma que usa
   el servidor.
6. El presupuesto es medido y publicado, no aspiracional, y el banco publica ademas el zoom que midio
   y los fotogramas que dio el motor. Sin esos dos datos un informe puede parecer plausible mientras
   mide otra cosa: durante esta fase hubo ejecuciones que declaraban zoom 1 y estaban midiendo el nivel
   lejano, y ejecuciones cuya tasa de fotogramas era la del temporizador de respaldo del propio banco.

### 5.2 Para «Cache de chunks con la version en la clave, sin invalidacion», parte de cliente

1. La cache decodificada del cliente y las vistas de la escena tienen un unico ciclo de vida. Cuando el
   streamer descarta un chunk llama a `evictChunk` del origen: un chunk retenido por uno y olvidado por
   el otro es una fuga que ademas se ve, porque la version que el renderizador cree tener deja de ser
   la que el reductor actualiza.
2. La histeresis es el diseno y no un ajuste. Anillo de prefetch de uno y umbral de descarga de tres:
   un chunk entre los dos anillos ni se carga ni se descarta, que es lo que impide que una camara
   apoyada en una frontera de chunk cargue y descarte el mismo chunk en tics alternos.
3. Un chunk que la camara necesita nunca se desaloja, aunque la cache este por encima de su capacidad.
   La capacidad cede, no la imagen: el desalojo por antiguedad salta lo protegido y toma el siguiente
   candidato, y si todo lo excedente esta protegido no desaloja nada.

---

## 6. Ficheros creados

```text
frontend/app/game/world/config.ts          constantes, umbral de nivel de detalle y presupuesto
frontend/app/game/world/source.ts          el puerto de datos y sus dos implementaciones
frontend/app/game/world/viewport.ts        rectangulo visible y diferencia de conjuntos con histeresis
frontend/app/game/world/zoom.ts            aritmetica de camara y anclaje del zoom
frontend/app/game/world/lru.ts             indice de recencia de la cache de chunks
frontend/app/game/world/tiles.ts           decodificacion de un chunk en indices de tesela y tintes
frontend/app/game/world/thumbnail.ts       miniatura de 32 por 32, un pixel por celda
frontend/app/game/world/outlines.ts        extraccion y agrupacion de contornos
frontend/app/game/world/chunkView.ts       un chunk en pantalla, en los dos niveles de detalle
frontend/app/game/world/streamer.ts        carga, descarga, desalojo, refetch y repintado
frontend/app/game/world/camera.ts          arrastre, teclado y zoom discreto anclado al cursor
frontend/app/game/world/drawCalls.ts       sonda de llamadas de dibujo sobre el contexto WebGL
frontend/app/game/world/WorldScene.ts      la escena del mundo
frontend/app/game/world/bench.ts           el banco de medida
frontend/app/game/world/index.ts           superficie publica
frontend/app/game/world/__tests__/         fixtures y seis suites: viewport, zoom, lru, tiles,
                                           thumbnail, outlines, streamer
frontend/app/game/overlay/anchors.ts       proyeccion de un ancla sobre la camara sin desplazamiento
frontend/app/game/overlay/debugLines.ts    las siete lineas del contador de F3
frontend/app/game/overlay/OverlayScene.ts  rotulos, barras de progreso y contador
frontend/app/game/overlay/index.ts         superficie publica
frontend/app/game/overlay/__tests__/       una suite: anclaje y contador
frontend/app/pages/perf.vue                reescrito: monta el lienzo y ejecuta el banco
```

---

## 7. Ordenes que no se han ejecutado

Ninguna que mute el repositorio fuera del ambito asignado: sin `git`, sin `npm install`, sin
`docker compose`, sin `prisma`, sin compilaciones de produccion. Se ejecutaron `make sync-types`,
`make typecheck`, `make lint`, `make test-unit`, `npx vue-tsc --build --force`, `npx vitest run`,
`npx nuxt dev --port 3111` y, sobre `frontend/app/game` y `frontend/app/pages/perf.vue` unicamente,
`npx eslint --fix` y `npx prettier --write`.

## 8. Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 1.4 El puerto del servidor de desarrollo, otra vez

Aplicado por W7-A (integracion).

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/nuxt.config.ts`
Propietario del cambio: W7-A

Ya recogido en `NOTES-w3d` 1 y en `NOTES-w3-cierre` 6. Se repite aqui solo porque la verificacion de
esta fase volvio a necesitar `--port 3111`. Ningun fichero de este ambito codifica un puerto.

### 1.1 La pagina de juego no monta el lienzo

Resuelto por el agente de costura de W5-W, que reescribio `pages/game.vue`: la pagina llama a
`createGame`, cose la herramienta de seleccion y, desde W6, adjunta la capa de entidades (ADR-0046,
ADR-0054).

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/pages/game.vue`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

Al cierre de W3 nadie llamaba a `createGame`: `WorldViewport.client.vue` expone el elemento anfitrion
y `game.vue` lo monta, pero ningun punto del cliente crea la instancia de Phaser. Este ambito ha
resuelto el montaje en `pages/perf.vue`, que es suyo, y no puede tocar `game.vue`.

El cambio son doce lineas y esta ya escrito y verificado en `pages/perf.vue`. Aplicado a `game.vue`:

```ts
const viewport = ref<InstanceType<typeof WorldViewport> | null>(null);
let handle: GameHandle | null = null;
let disconnect: (() => void) | null = null;

onMounted(() => {
  const host = viewport.value?.host ?? null;
  if (host === null) return;
  const source = createStoreWorldSource({
    store: world,
    viewerPlayerId: () => player.id,
    requestChunks: async (requests) =>
      (await apiCall('POST /api/world/chunks', { body: { chunks: requests.map((r) => ({ ...r })) } }))
        .chunks,
    fieldState: (fieldId) => {
      const field = fields.get(fieldId);
      return field === undefined
        ? undefined
        : { cropCycleState: field.cropCycleState, growthProgressBp: bp(field.projection.growthProgressBp) };
    },
    pendingCells: () => pending.pendingCellKeys,
  });
  const scenes = createWorldScenes({ source, bridge: gameBridge(), home: world.spawnCell ?? undefined });
  handle = createGame({ host, worldScenes: scenes.scenes });
  disconnect = connectShellBridge(handle, gameBridge());
});

onBeforeUnmount(() => {
  disconnect?.();
  handle?.destroy();
});
```

Mitigacion adoptada: `pages/perf.vue` monta la escena completa y admite `?source=store`, de modo que
el camino real (almacen mas cliente REST) esta ejercitado y comprobado antes de que W7-A lo copie.
Mientras no se aplique, `/game` sigue mostrando el marcador de posicion de W3-C y `/perf` es la unica
ruta con lienzo.
