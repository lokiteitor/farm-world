# NOTES-w3d

Agente de nucleo de renderizado, fase W3. Ambito escrito: `frontend/app/game/index.ts`,
`frontend/app/game/boot/`, `frontend/app/game/textures/`, `frontend/app/pages/texture-lab.vue` y el
bloque generado de `frontend/app/assets/tokens.css` delimitado por los marcadores `fw-palette:start`
y `fw-palette:end`.

## Pendiente

### 1. El puerto del servidor de desarrollo esta ocupado en esta maquina

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/nuxt.config.ts`
Propietario del cambio: W1 (cerrado), a aplicar por W7-A

`devServer.port` vale 3001, que es el puerto que la ventana de parcheo W2.5 dejo de usar: `.env.example`
publica el cliente en `FRONTEND_DEV_PORT=3100` y el `Makefile` anuncia 3100 en sus objetivos
informativos. En esta maquina 3001 esta ocupado por otro proyecto, de modo que `npx nuxt dev` sin
argumentos arranca en un puerto arbitrario o falla. Conviene leer el valor del entorno, por ejemplo
`port: Number(process.env.FRONTEND_DEV_PORT ?? 3100)`, que es lo que hace que el `Makefile`, el fichero
de entorno y el cliente digan lo mismo.

Mitigacion adoptada: la verificacion de esta fase se ejecuto con `npx nuxt dev --port 3100`. Ningun
fichero de este ambito codifica un puerto.

### 2. Dos rutas sin fila en la tabla de propiedad

Categoria: cambio en fichero de otro propietario
Ficheros afectados: `docs/ownership.md`, apartado 3.6
Propietario del cambio: W2-E o W7-D

El apartado 3.6 no atribuye `frontend/app/game/index.ts` ni `frontend/app/pages/texture-lab.vue`,
que el brief de esta fase asigna a W3-D. Ademas su fila de pruebas del cliente dice
`frontend/app/__tests__/`, y las de esta fase viven en `frontend/app/game/textures/__tests__/`, que es
el patron de un directorio de pruebas por subdirectorio que ya sigue `shared/` y que evita que dos
agentes de la misma fase compartan directorio de pruebas. `frontend/vitest.config.ts` incluye
`app/**/__tests__/**/*.test.ts`, de modo que el patron no exige ningun cambio de configuracion.

Mitigacion adoptada: ninguna necesaria. Las tres rutas estan dentro del ambito que el brief asigna y
ninguna colisiona con otro agente.

### 3. El bloque de paleta de `tokens.css` puede perderse en una reescritura concurrente

Categoria: coordinacion dentro de la fase
Ficheros afectados: `frontend/app/assets/tokens.css`
Propietario del cambio: W3-C escribe el bloque de interfaz, W3-D el bloque de paleta

`tokens.css` lo escribio W3-C durante esta misma fase declarando dos mitades y reservando la primera a
este agente: «W3-D regenerates the block between the two markers and touches nothing else in this
file». Se ha regenerado exactamente eso, sustituyendo el contenido entre los marcadores por la salida
de `paletteCssBlock()` y conservando byte a byte la cabecera y el bloque de interfaz. Como los dos
agentes trabajan a la vez, una reescritura posterior del fichero completo por W3-C descartaria el
bloque generado.

Mitigacion adoptada: dos medidas, y la primera no depende del fichero.

1. `applyPaletteCssVariables` escribe las variables sobre el elemento raiz al arrancar el juego, de
   modo que lo que leen los paneles en ejecucion es lo mismo con lo que se dibujaron las texturas,
   diga lo que diga la hoja de estilos. Es el primer paso de la fabrica de texturas.
2. `frontend/app/game/textures/__tests__/tokens-css.test.ts` compara el bloque del fichero con la
   salida del generador. Si el bloque se pierde o se edita a mano, falla `make test-unit` con el
   fichero y la linea, y regenerarlo es copiar `paletteCssBlock()` entre los dos marcadores.

Nombres adoptados sin cambios, que son los que declaro W3-C y los que leen los paneles: los cuatro de
terreno, los cinco de uso del suelo, los ocho del ciclo de cultivo (con `--fw-crop-ready` para
`READY_TO_HARVEST`, que es el unico cuyo nombre no es su forma kebab), los cuatro de fase de arbol, los
cinco de entidad, los cuatro de seleccion, los cuatro de contorno y `--fw-grid-line`, que es el unico
con alfa.

Los valores si difieren de los que el fichero traia, porque el propio fichero declara
`game/textures/palette.ts` como fuente de verdad y las texturas se dibujan con esos numeros. Cada
familia necesita en el lienzo mas de un tono (base, sombra, luz y acento) y el token publica el
representativo. Quince variables mas, que son adiciones y no renombrados, con su motivo en el
comentario de `paletteCssVariables`: `--fw-use-owned-foreign`, los ocho `--fw-machine-*`, los cinco
`--fw-building-*` y `--fw-canvas-void`.

### 4. Dos puentes en la misma fase, y la costura entre ellos

Categoria: coordinacion dentro de la fase
Ficheros afectados: `frontend/app/game/index.ts`, `frontend/app/composables/useGameBridge.ts`
Propietario del cambio: la llamada la escribe quien posea el componente del visor, W3-C

W3-C escribio `app/composables/useGameBridge.ts` con su propio puente tipado, que declara los tres
eventos de arranque que este ambito produce: `scene:preload` con `{ ratio, label }`, `scene:ready` con
`{ width, height }` y `scene:error` con `{ message }`. Este ambito escribio `game/boot/bridge.ts`, que
es el puente del lienzo y no depende de Vue.

No se han fundido en uno, por dos razones. La regla 4 de la seccion 11 del plan prohibe importaciones
entre modulos hermanos de la misma fase, y el puente del lienzo tiene que poder gobernarse sin la capa
de Vue, que es exactamente lo que hace la ruta de inspeccion de esta fase. Ademas los dos llevan cargas
distintas: el del lienzo publica el informe completo de texturas, que es lo que necesitan la ruta de
inspeccion y la de medicion de W4; el de la interfaz publica la razon y la etiqueta, que es todo lo que
un indicador de carga muestra.

Mitigacion adoptada: `connectShellBridge(handle, shell)` en `game/index.ts` republica los tres eventos.
Declara la forma del puente de la interfaz de manera estructural, `ShellBridgeLike`, sin importar el
modulo, de modo que un renombrado de evento rompe la compilacion en el punto de llamada, que es donde
corresponde. La compatibilidad con el puente real se comprobo por comprobacion de tipos contra
`gameBridge()` tal como esta al cierre de esta fase. Lo que queda por escribir es una linea en el
componente del visor:

```ts
const handle = createGame({ host: element });
const stop = connectShellBridge(handle, gameBridge());
```

### 5. `npx vue-tsc --noEmit` no comprueba nada en este proyecto

Categoria: verificacion
Ficheros afectados: ninguno
Propietario del cambio: quien redacte briefs de fases posteriores

`frontend/tsconfig.json` es un fichero de solucion con `"files": []` y referencias a los cuatro
proyectos que genera Nuxt, de modo que `npx vue-tsc --noEmit` termina con codigo 0 y sin salida porque
no tiene entradas que comprobar. La orden equivalente real es `npx vue-tsc --build --force`, que es lo
que ejecutan `npm run typecheck` y `make typecheck`. Se comprobo empiricamente introduciendo un error
de tipos en `app/pages/texture-lab.vue`: `--noEmit` no lo detecta y `--build --force` lo senala con
fichero, linea y codigo.

Mitigacion adoptada: esta fase reporta las dos ordenes, la que el brief pedia y la que comprueba.

## Contrato que esta fase publica para W4 y W5

No es material pendiente, es lo que los agentes siguientes tienen que leer en lugar de deducirlo.

| Pieza | Ruta | Uso |
|---|---|---|
| Claves de textura | `game/textures/keys.ts` | `TEXTURE_KEYS`, `buildingTextureKey`, `machineTextureKey`, `treeTextureKey`, `cursorTextureKey`, `particleTextureKey`. Ninguna clave se escribe como literal en el punto de uso |
| Indice del atlas de terreno | `game/textures/terrain-atlas.ts` | `terrainTileIndex(terreno, variante)` y su inverso. Vale `TERRAIN_CODE[terreno] * 4 + variante`, con el orden de filas del byte de transporte de `shared/world/terrain.ts` |
| Indice del atlas de uso | `game/textures/usage-atlas.ts` | `usageTileIndex`, `usageTileIndexForCropState`, `usageTileFromIndex`. La tesela 0 es transparente y las de relleno son magenta |
| Geometria de los dos atlas | `game/textures/pixels.ts` | `TERRAIN_ATLAS_GEOMETRY` y `USAGE_ATLAS_GEOMETRY`. Registrar el tileset con `addTilesetImage(nombre, clave, 16, 16, 1, 2)`: margen 1 y espaciado 2 son obligatorios, la extrusion depende de ellos |
| Variante de tesela por celda | `game/textures/prng.ts` | `variantForCell(semillaDelMundo, cellX, cellY, 4)`. Misma semilla y misma version de generador que el terreno, de modo que el mosaico es estable entre sesiones |
| Tinte de crecimiento | `game/textures/palette.ts` | `growthTint(progresoEnPuntosBase)`. El progreso viaja como tinte y nunca como mas teselas |
| Tinte de trabajador | `game/textures/palette.ts` | `workerTint(workerId)`, determinista sobre el identificador |
| Rejilla | `game/textures/grid.ts` | Una tesela de una celda para un unico `TileSprite` a nivel de escena |
| Arranque | `game/index.ts` | `createGame({ host, bridge?, worldScenes?, startSceneKey? })` y `destroyGame`. W4 y W5 registran sus escenas por `worldScenes`; no hay que tocar `boot/` |
| Puente | `game/boot/bridge.ts` | `createGameBridge()`, `GamePhase`, y `createEmitter<T>()` para que las capas de W5 declaren su propio mapa de eventos en lugar de inventar otro emisor |
| Costura con la interfaz | `game/index.ts` | `connectShellBridge(handle, gameBridge())` republica `scene:preload`, `scene:ready` y `scene:error` en el puente de W3-C |
| Claves de escena | `game/boot/scenes.ts` | `SCENE_KEYS.WORLD` y `SCENE_KEYS.OVERLAY` ya existen; `PreloadScene` arranca la primera si esta registrada y se detiene si no |

Convenciones de anclaje y orientacion, documentadas en la cabecera de `game/textures/shapes.ts`
porque no se pueden leer en una textura: maquinaria y trabajador mirando al este y centrados, origen
(0,5, 0,5); edificio del tamano exacto de su huella, origen (0, 0) sobre la celda noroeste; arbol con
el tronco en el centro inferior, origen (0,5, 1).

## Material para ADR-0020, «Arte generado por codigo y paleta unica compartida con CSS»

Lo redacta el agente designado de la fase, W3-A. Decisiones de este ambito que conviene que la entrada
recoja:

1. La paleta vive en un unico modulo de TypeScript y llega al CSS por dos caminos, no por uno: el
   bloque generado de `tokens.css`, que es lo que se revisa como diferencia y lo que colorea la
   interfaz antes de que arranque el lienzo, y la escritura de las variables sobre el elemento raiz al
   arrancar, que es lo que hace imposible la divergencia en ejecucion. Un tercer mecanismo, una prueba
   que compara fichero y generador, convierte una edicion a mano en un fallo de la suite.
2. Separacion entre funcion pura y adaptador de Phaser. Todo lo que decide pixeles y todo lo que decide
   indices son funciones puras sobre `Uint8ClampedArray`, sin importar Phaser; el motor solo aparece en
   `factory.ts`, en las dos escenas de arranque y en `index.ts`. La consecuencia buscada es que la
   aritmetica de indices, la extrusion y el determinismo se afirman byte a byte en Vitest sin lienzo ni
   contexto WebGL, y lo que queda sin cubrir por pruebas son llamadas de subida cuyo fallo es visible
   en la ruta de inspeccion.
3. Extrusion obligatoria en los dos atlas: tesela de 16 px dentro de celda de 18 px con replicacion de
   borde, registrada con margen 1 y espaciado 2, que es la formula que Phaser aplica
   (`margen + columna x (tesela + espaciado)`). Sin ella el zoom fraccionario sangra la tesela vecina
   en la junta. Se comprueba dos veces: sobre el bufer en Vitest y sobre los pixeles de la textura ya
   subida en la ruta de inspeccion, que es la unica forma de cubrir el paso de subida.
4. La legibilidad de los ocho estados del ciclo de cultivo se apoya en el patron y no en el color
   (surcos anchos, surcos finos, puntos, puntos verdes, trazos verticales, espigas, rastrojo), de modo
   que la lectura rapida que exige la seccion 60 del GDD no depende de distinguir dos tonos de marron.
   El progreso de crecimiento viaja como tinte, lo que mantiene una tesela por estado.
5. El presupuesto de generacion es medido y publicado, no aspiracional: la ruta de inspeccion muestra el
   trabajo de cada paso y el total frente al limite de 250 ms. Se distinguen dos tiempos, el trabajo de
   los pasos y el reloj de pared, porque la fabrica cede un fotograma entre pasos para que la barra de
   progreso se presente de verdad; confundirlos volveria el presupuesto inservible. Medido en esta
   fase: 14,4 ms de trabajo y 161 ms de reloj para 40 texturas.
6. Ningun `Math.random` en el arte. La variante de tesela de una celda sale del mismo hash entero, la
   misma semilla y la misma version de generador que el terreno, reutilizando `hashGrid` de
   `shared/world/terrain.ts` en lugar de reimplementarlo; el ruido interior de una textura sale de una
   semilla constante, porque las texturas se generan antes de conocer el mundo.
7. Un paso de generacion que falla se registra y se salta en lugar de abortar el arranque: una textura
   ausente produce un marcador magenta en un sprite, mientras que una excepcion que escapa de la escena
   de precarga deja al jugador ante un lienzo en blanco sin explicacion. El informe lleva los fallos y
   la ruta de inspeccion los muestra.

## Resuelto

(nada todavia: ninguna nota de este fichero se ha aplicado)
