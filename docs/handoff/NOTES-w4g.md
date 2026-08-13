# NOTES-w4g

Agente de la herramienta de seleccion, fase W4. Ambito escrito: `frontend/app/game/selection/**` y este
fichero. Ningun fichero fuera de esos dos se ha modificado.

Este fichero recoge lo que otros agentes deben aplicar y que W4-G no podia aplicar, el contrato que la
herramienta publica para los paneles y para la integracion, las decisiones que condicionan a las fases
siguientes y las discrepancias detectadas entre el brief, el plan, el contrato y el codigo ya escrito.

---

## 1. Pendiente para otros agentes

### 1.1 El puente no declara ningun evento de confirmacion de seleccion

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/composables/useGameBridge.ts`, interfaz `GameBridgeEvents`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

El apartado 9.5 del plan y el brief de este agente exigen que confirmar publique "por el puente el evento
que abre el panel correspondiente". El puente declara quince eventos y ninguno significa eso: de Phaser
hacia Vue solo existen `scene:ready`, `scene:preload`, `scene:error`, `canvas:pick`, `canvas:hover`,
`canvas:drag`, `camera:changed` y `render:stats`. `canvas:drag` con fase `END` significa "el arrastre
termino", que ocurre en cada rectangulo compuesto y no solo al confirmar, de modo que reutilizarlo haria
que componer una forma con tres rectangulos abriese el panel tres veces.

Cambio a aplicar, cuatro lineas dentro de `GameBridgeEvents`:

```ts
/** The player confirmed the selection. Opens the panel that owns the request. */
'selection:confirmed': {
  readonly purpose: SelectionPurpose;
  readonly cellCount: number;
  readonly valid: boolean;
};
```

Mitigacion adoptada: la confirmacion viaja por el puerto `SelectionPort.onConfirm`, que es el mismo patron
estructural que `WorldSource` de W4-D y que el binding fuera del lienzo enlaza con el anfitrion de paneles.
El puerto lleva ademas la instantanea completa (celdas, veredicto, precio, primer conflicto), que el evento
propuesto no puede llevar sin arrastrar tipos del dominio al puente. Cuando el evento exista, emitirlo desde
`SelectionTool.confirm` es una linea y el puerto sigue siendo necesario para la carga util.

### 1.3 `shared/rules/selection.ts` no tiene proposito para la division ni para la tala por area

Categoria: cambio en fichero congelado
Ficheros afectados: `shared/rules/selection.ts`, `SelectionPurpose` y `SELECTION_PURPOSE_RULES`
Propietario del cambio: W2-B (cerrado), a aplicar por W7-A si se decide

`SelectionPurpose` tiene seis valores: `PURCHASE`, `FIELD`, `FIELD_EXTEND`, `BUILDING`, `FOREST_PLOT` y
`CLEAR_LAND`. El apartado 9.5 del plan pide ocho modos y dos de ellos no encajan en ninguno:

- Division de campo (GDD 21). No puede reutilizar `canBeFieldCell`: toda celda de una division ya tiene
  `landUse = FIELD` y esa regla la rechaza con `CELL_IN_USE`.
- Tala por area (GDD 135). No puede reutilizar `canClearCell`, que exige que la celda **no** tenga arbol en
  pie, que es exactamente lo contrario de lo que la tala selecciona. `CLEAR_LAND` es el desmonte de GDD 10,
  operacion distinta y con ruta propia (`POST /api/land/clear` frente a
  `POST /api/forest-plots/:id/fell`).

Mitigacion adoptada, y es la que se recomienda mantener: las dos reglas se componen en
`game/selection/rules.ts` a partir de las mismas primitivas compartidas (`isContiguous`, `cellKey`,
`ValidationCode`, `VALIDATION_MESSAGES`) y reflejan lo que el servidor ya hace. La de division reproduce
`splitField` de `backend/src/modules/fields/service.ts` sentencia a sentencia: pertenencia al campo, las dos
mitades no vacias y las dos contiguas, todo informado como `FIELD_SPLIT_INCOMPLETE`. La de tala usa
`TARGET_KIND_MISMATCH` para una celda que no es de la parcela y `NO_FELLABLE_TREES` cuando la seleccion no
contiene ningun arbol en pie. Ningun mensaje se escribe a mano.

Consecuencia que W6-C debe conocer: cuando el modulo de silvicultura implemente la tala, su validacion tiene
que producir esos mismos dos codigos para esos mismos dos casos, o el cliente y el servidor discreparan en
el unico punto donde este ambito no ha podido apoyarse en una funcion compartida.

### 1.4 Un noveno modo que el brief no enumera: el desmonte

Categoria: adicion de ambito, sin cambio en fichero ajeno
Propietario: W4-G

El brief enumera ocho modos y la herramienta tiene nueve. El anadido es `CLEAR_LAND`, el desmonte de GDD 10.
No es preferencia: `SelectionPurpose.CLEAR_LAND` existe en las reglas compartidas y `POST /api/land/clear`
existe en el contrato, de modo que sin un modo propio quedaria un proposito compartido inalcanzable desde el
lienzo, y la tala tendria que resaltar como validas celdas con arbol en pie para una operacion que las
rechaza. La prueba `modes.test.ts` afirma que cada proposito compartido es alcanzable desde exactamente un
modo, que es lo que convierte esto en dato comprobable y no en un parrafo.

### 1.8 Propiedad del directorio

Categoria: cambio en fichero de otro propietario
Ficheros afectados: `docs/ownership.md`, apartado 3.6
Propietario del cambio: el agente de cierre de W4

El apartado 3.6 atribuye `frontend/app/game/selection/` a W5-E, fase W5. El brief de este agente lo asigna a
W4-G de forma explicita y asi se ha escrito. Es el mismo caso que el apartado 1.2 de `NOTES-w4d.md` recoge
para `game/overlay/` y `pages/perf.vue`. Ningun fichero de otro agente se ha tocado.

---

## 2. Discrepancias detectadas

### 2.1 El almacen de seleccion y la herramienta tienen la misma algebra escrita dos veces

`frontend/app/stores/selection.ts` (W3-C, congelado) implementa `addRect`, `removeRect`, `toggleCell` y
`replaceCells` con el tope compartido, y `game/selection/set.ts` implementa las mismas cuatro operaciones. No
es un descuido de este ambito: la regla de zona de `eslint.config.js` prohibe que `app/game` importe
`app/stores`, y la herramienta necesita el conjunto dentro del bucle de arrastre, donde una escritura reactiva
por cruce de frontera pagaria el coste de Pinia sesenta veces por segundo.

Las dos implementaciones no pueden divergir en lo que importa, porque las dos toman el tope de
`MAX_SELECTION_CELLS` y las dos derivan el veredicto de `validateSelection`. Difieren en dos detalles que
conviene conocer: la de la herramienta devuelve ademas si la operacion llego al tope (`capped`), que es lo
que el aviso junto al cursor necesita y el almacen no expone; y la del almacen resuelve las celdas contra la
cache de chunks a traves de `world.selectionCellAt`, mientras que la herramienta las resuelve contra el mismo
`WorldSource` que dibuja la escena.

La forma de eliminar la duplicacion, el dia que estorbe, es mover el algebra a `shared/rules/selection.ts`,
que ya es el sitio donde vive el tope. Es un cambio en fichero congelado y no bloquea nada hoy.

### 2.2 La tesela de propiedad compite con el relleno de la seleccion

Confirmado en las capturas del apartado 4.3, y ya anotado como 2.1 de `NOTES-w4d.md` por otro motivo: la
tesela `OWNED` dibuja borde en sus cuatro lados con alfa 170, de modo que sobre tierra ya en propiedad el
relleno verde de la seleccion se lee sobre una reticula amarilla densa. Sobre terreno sin comprar, que es el
caso de la compra de tierra, se lee sin problema. Afecta a la leyenda de W4-E y no se ha cambiado nada.

### 2.3 `WorldScene` emite `canvas:pick` tambien con un modo activo

Un clic en modo de seleccion produce a la vez el gesto de la herramienta y un `canvas:pick` de la escena, que
es lo que alimenta al inspector de celda. No es un fallo: el inspector es informacion y no accion, y quien
escuche `canvas:pick` puede ignorarlo cuando el modo no es inspeccion. Se anota porque W4-E lo va a ver.

### 2.4 El veredicto es provisional mientras haya chunks sin cargar

`unresolvedCount` mayor que cero significa que la seleccion contiene celdas cuyo chunk no ha llegado. La
herramienta las pinta en gris, no las cuenta como invalidas y **rechaza la confirmacion** mientras existan,
que es la lectura conservadora de la seccion 7 del plan: el cliente es una cache y no puede afirmar nada sobre
una celda que no tiene. El caso es alcanzable de verdad, con un arrastre rapido hacia el borde de la region
cargada, y la resolucion llega sola: `SelectionTool` compara `source.revision()` una vez por fotograma y
revalida cuando el chunk aterriza.

---

## 3. Contrato que este ambito publica

No es material pendiente: es lo que los agentes siguientes tienen que leer en lugar de deducirlo.

| Pieza | Ruta | Uso |
|---|---|---|
| Arranque | `game/selection/index.ts` | `createSelectionTool({ world, overlay, bridge, port, config })`. `world` y `overlay` son las escenas que devuelve `createWorldScenes` de W4-D |
| Puerto | `game/selection/port.ts` | `SelectionPort` con `onChanged`, `onConfirm` y `onCancel`, y `SelectionSnapshot` con celdas, veredicto, invalidas, sin resolver, tope y primer conflicto |
| Modos | `game/selection/modes.ts` | `SelectionToolMode` con nueve valores, `SELECTION_TOOL_MODES` con su regla y sus secciones del GDD, y el mapeo con `SelectionPurpose` del puente |
| Intencion | `game/selection/port.ts` | `SelectionToolIntent`: modo, `fieldId`, `forestPlotId`, `buildingType` y `targetCells` |
| Validez | `game/selection/rules.ts` | `validateToolSelection` devuelve `SelectionValidation` de `shared/rules`, con la misma forma que devuelve el servidor. `cellRuleOf` da el veredicto por celda, que es lo que el relleno necesita |
| Algebra | `game/selection/set.ts` | `unionRect`, `subtractRect`, `toggleCell`, `replaceCells`, todas con el tope compartido y con `capped` |
| Estrangulador | `game/selection/boundary.ts` | `createBoundaryThrottle`. Una llamada por celda entrada y ninguna por pixel |
| Huella | `game/selection/ghost.ts` | `footprintOf(type)` y `footprintCells(anchor, size)`, centrada en el cursor |
| Plan de dibujo | `game/selection/draw.ts` | `selectionDrawPlan` con los tres grupos de tramos horizontales y el contorno, extraido con `borderSegments` de `shared/rules/geometry.ts` |
| Lectura en vivo | `game/selection/readout.ts` | `readoutText(model)`, la linea junto al cursor |

Metodos de la herramienta que un panel usa: `setIntent`, `setCells`, `clear`, `cancel`, `confirm`,
`jumpToFirstConflict`, `snapshot`, `drawPlan` y `destroy`.

Convenciones que conviene no reinventar:

- La herramienta no escribe ningun almacen y no muta nada. Confirmar publica una instantanea; quien la recibe
  abre el panel y es el panel quien pide al servidor.
- El modo lo fija siempre alguien de fuera. La escena no cambia de modo por su cuenta en ningun camino.
- El conjunto solo se recalcula al cruzar una frontera de celda. Quien anada un gesto nuevo tiene que pasar
  por `boundary.accept` o el coste deja de ser proporcional a lo seleccionado.
- La profundidad de la seleccion es `DEPTH.OUTLINES + 10` y se declara en `config.ts`, siguiendo la
  convencion de `NOTES-w4d.md`, apartado 3.
- Los gestos: arrastre sustituye, mayusculas une, alt resta, control conmuta una celda, en colocacion la
  huella sigue al cursor y el clic confirma, Enter confirma y Escape cancela.

---

## 4. Verificacion, salida real

### 4.1 Ordenes

| Orden | Salida |
|---|---|
| `make sync-types` | 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `npx vue-tsc --build --force` (en `frontend/`) | Sin salida, **exit 0** |
| `make typecheck` | **exit 0**. `tsc` en shared y backend sin salida; `vue-tsc --build --force` del cliente en verde |
| `make lint` | **exit 0**. `npx eslint .` sin hallazgos; Prettier: «All matched files use Prettier code style!» |
| `npx vitest run app/game/selection` (en `frontend/`) | **9 ficheros, 83 pruebas en verde**, 3,00 s |
| `make test-unit` | **exit 0**. shared: 23 ficheros y 418 pruebas. Cliente: 26 ficheros y **252** pruebas (169 previas mas las 83 de esta fase) |

`npx vue-tsc --noEmit` sigue terminando con codigo 0 sin comprobar nada, por lo que explica el apartado 5 de
`NOTES-w3d.md`: `frontend/tsconfig.json` es un fichero de solucion con `"files": []`. La orden que comprueba
de verdad es `npx vue-tsc --build --force`, y es la que se reporta arriba.

### 4.2 Prueba manual en el navegador

Entorno: Chrome 151 sin cabeza con SwiftShader, ventana 1440x900, servidor de desarrollo
`npx nuxt dev --port 3111` (3001 y 3100 estan ocupados en esta maquina), ruta
`/perf?mock=1&mockSession=1&source=store`, es decir el camino real de datos: almacen de mundo mas cliente REST
contra el servidor simulado.

Como se ejercito la herramienta sin tocar ficheros ajenos: `pages/perf.vue` publica las escenas en
`window.__fwWorld`, de modo que desde el protocolo de depuracion se importa
`app/game/selection/index.ts` del servidor de Vite, se crea la herramienta sobre la escena viva con el puente
de la propia escena, y se dirigen raton y teclado con `Input.dispatchMouseEvent`. Es la unica via que no exige
escribir en `pages/`, que no es de este ambito. Los guiones quedan en el directorio de trabajo temporal.

Detalle que conviene registrar porque costo una vuelta: la herramienta hay que crearla con el puente **de la
escena** y no con un `gameBridge()` importado en caliente. El servidor de desarrollo sirve los modulos de la
aplicacion bajo `/_nuxt/@fs/<ruta absoluta>`, y una importacion dinamica con otro especificador devuelve otra
instancia del modulo, es decir otro emisor. Con un puente distinto, `selection:mode` no llega a la camara,
`setPanWithPrimary(false)` no se dispara, la camara panea bajo el arrastre y la celda bajo el cursor no cambia
nunca: la seleccion se queda en una sola celda. Es exactamente el sintoma que produciria en produccion olvidar
pasar el puente, y quedo comprobado por accidente.

Resultados, con las cifras que devolvio la propia herramienta:

| Comprobacion | Gesto | Resultado |
|---|---|---|
| Rectangulo exacto | Arrastre diagonal de 160 x 96 px a zoom 1 | Esquinas `(62,89)` y `(72,95)` segun la camara; seleccion de **77 celdas** con caja `[62,89]-[72,95]`, es decir 11 x 7 |
| Estrangulador de frontera | Arrastre horizontal de 320 px, **321 eventos de raton** | **21 celdas** y **22 notificaciones** al puerto: 21 cruces mas la del final del arrastre. Una por celda y ninguna por pixel |
| Estrangulador, diagonal | 161 eventos de raton sobre 11 x 7 celdas | 18 notificaciones: 17 cruces mas el final |
| Union con mayusculas | Arrastre con `shift` sobre otra zona | 21 celdas pasan a **45** |
| Resta con alt | Arrastre con `alt` sobre parte de la anterior | 45 celdas pasan a **39** |
| Conmutacion con control | Clic con `ctrl`, y otra vez en la misma celda | 39 a **40** y de vuelta a **39** |
| Tope compartido | Arrastre de 400 x 400 px a zoom 0,25, rectangulo de 101 x 20 celdas | **2.000 celdas**, `capped: true`, sin `SELECTION_TOO_LARGE`: el cliente detiene el crecimiento y el aviso lo da la lectura junto al cursor |
| Fantasma de edificio | Modo `BUILDING` con `SILO` | **16 celdas** (4 x 4 del catalogo), caja `[80,100]-[83,103]`; al mover el cursor 16 px, caja `[81,100]-[84,103]`, es decir exactamente una celda |
| Validez con motivo | `FIELD_CREATE` sobre tierra ajena y bosque | 357 celdas, **357 invalidas**, motivos agregados `CELL_NOT_OWNED:309` y `TERRAIN_NOT_ARABLE:48` |
| Salto al primer conflicto | `jumpToFirstConflict()` con 154 celdas no poseidas | Devuelve `(62,89)` y la camara pasa de centro `(100,100)` a **`(62,89)`** |
| Confirmar no muta | `confirm()` sobre 9 celdas validas | Aceptado, el puerto recibe `{ mode: 'PURCHASE', cells: 9 }`, y `source.revision()` **no cambia** |
| Confirmar con veredicto rojo | `confirm()` con celdas invalidas | Rechazado, el puerto no recibe nada |
| Cancelar | Tecla Escape | Modo de vuelta a `INSPECT`, 0 celdas, `onCancel` invocado |
| Capas | Lista de objetos de la escena del mundo | `TileSprite` a profundidad 30, `Graphics` de contornos a 40, `Graphics` de seleccion a **50**: un unico `Graphics` por encima de los contornos |
| Lectura en vivo | Etiqueta de la escena de superposicion | «494 celdas · 34580.00 $» y «357 celdas · 357 no validas», visibles y ancladas junto al cursor |

Coste del dibujo, medido con `drawPlan()`: una seleccion de 494 celdas produce **19 rectangulos** de relleno y
90 segmentos de contorno; una de 2.000 celdas, 20 rectangulos y 242 segmentos. La fusion de tramos
horizontales es lo que mantiene el numero de ordenes de dibujo proporcional a las filas de la forma y no a sus
celdas.

Nota sobre la tasa de fotogramas: 14-16 fps en este entorno, que es lo que `NOTES-w4d.md` ya documenta para
Chrome sin cabeza con SwiftShader, donde el renderizador es rasterizacion por software. Los draw calls (1) y
los cuadrilateros (8.953) coinciden con los de esa nota y no dependen del rasterizador. La herramienta anade
**un** objeto a la escena y ningun draw call medible.

### 4.3 Capturas

Guardadas en el directorio de trabajo temporal de la sesion: `selection.png` (seleccion valida de 494 celdas
con su contorno, su relleno y la lectura junto al cursor) y `selection-invalid.png` (357 celdas invalidas en
rojo sobre bosque y tierra ajena).

---

## 5. Material para el ADR

Lo redacta el agente designado de la fase, que segun el apartado 3.3 de `docs/ownership.md` escribe las
entradas 0023 a 0026. Por tema, esto pertenece a la entrada de reglas de validacion compartidas entre cliente
y servidor, que el reparto de la seccion 11 del plan situa en W5. Decisiones de este ambito que conviene que
recoja:

1. La herramienta no implementa ninguna regla que las reglas compartidas ya expresen. Siete de los nueve modos
   son una llamada a `validateSelection` o a `validateBuildingFootprint` y nada mas, y el tope de 2.000 celdas
   es la misma constante en los dos lados. Las dos excepciones estan documentadas y compuestas con las mismas
   primitivas, no reinventadas.
2. El veredicto por celda y el agregado salen de la misma funcion. `cellRuleOf` devuelve la entrada de
   `SELECTION_PURPOSE_RULES` que el agregado ejecuta por dentro, de modo que las celdas pintadas de verde y
   las contadas como validas no pueden diferir. Es el mismo motivo por el que el contorno de la seleccion usa
   `borderSegments` y no un segundo recorrido de bordes.
3. El tope se aplica mientras se recorre el rectangulo y no despues. Un arrastre de cinco mil por cinco mil
   celdas son veinticinco millones de claves, y construir el conjunto para recortarlo luego es la version que
   congela la pestana. Es la misma decision que `boundedBreadthFirst` de `shared/rules/geometry.ts` tomo con
   su propia cota.
4. La actualizacion al cruzar una frontera de celda no es una optimizacion sino el diseno. A dieciseis pixeles
   por celda un arrastre produce dieciseis veces mas eventos que celdas, y cada uno reconstruiria el conjunto,
   lo revalidaria y redibujaria el `Graphics`. Medido en el navegador: 321 eventos de raton, 22
   recalculos.
5. Una celda cuyo chunk no ha llegado no es invalida, es desconocida. Se pinta en un tercer color, no cuenta
   como invalida y bloquea la confirmacion. Pintarla en rojo seria una afirmacion que el cliente no esta en
   condiciones de hacer, y pintarla en verde seria peor.
6. Confirmar no muta nada y ademas se niega cuando el veredicto no es verde: un viaje de ida y vuelta gastado
   en aprender lo que el cliente ya sabia no es defensa en profundidad, es latencia.
7. La herramienta lee el mundo por el mismo puerto que la escena (`WorldSource`) y publica por un puerto
   propio. Ninguna de las dos direcciones pasa por un almacen, que es lo que la regla de zona de ESLint
   garantiza y lo que hace que las nueve suites de prueba corran sin Phaser y sin Pinia.

---

## 6. Ficheros creados

```text
frontend/app/game/selection/config.ts          profundidad, colores, alfas y desplazamiento de la lectura
frontend/app/game/selection/modes.ts           los nueve modos, su regla y el mapeo con el puente
frontend/app/game/selection/port.ts            intencion, instantanea y puerto hacia fuera del lienzo
frontend/app/game/selection/cells.ts           resolucion de una celda contra la cache de chunks
frontend/app/game/selection/set.ts             union, resta, conmutacion y el tope compartido
frontend/app/game/selection/boundary.ts        el estrangulador de frontera de celda
frontend/app/game/selection/ghost.ts           la huella del catalogo centrada en el cursor
frontend/app/game/selection/rules.ts           validez, delegada a shared/rules salvo dos composiciones
frontend/app/game/selection/draw.ts            el plan de dibujo: tramos horizontales y contorno
frontend/app/game/selection/readout.ts         la linea junto al cursor
frontend/app/game/selection/SelectionTool.ts   la maquina de estados y su enlace con las escenas
frontend/app/game/selection/index.ts           superficie publica
frontend/app/game/selection/__tests__/         fixtures y ocho suites: set, boundary, contiguity, rules,
                                               ghost, draw, modes, readout, cells
docs/handoff/NOTES-w4g.md                      este fichero
```

---

## 7. Ordenes que no se han ejecutado

Ninguna que mute el repositorio fuera del ambito asignado: sin `git`, sin `npm install`, sin `docker compose`,
sin `prisma`, sin construcciones de produccion. Se ejecutaron `make sync-types`, `make typecheck`, `make lint`,
`make test-unit`, `npx vue-tsc --build --force`, `npx vitest run` y, sobre `frontend/app/game/selection`
unicamente, `npx eslint --fix` y `npx prettier --write`. El servidor de desarrollo de Nuxt en el puerto 3111 ya
estaba levantado por la fase anterior y no se reinicio.

## 8. Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 1.2 `SelectionMode` del puente no distingue dos de los nueve modos

Aplicado antes de W7 y completado por W7-A. `SelectionMode` del puente declara `mode`, `fieldId`,
`forestPlotId` y `buildingType`, y `pages/game.vue` los aplica sobre la herramienta. Lo que faltaba era
que el emisor los rellenara, que es lo que esta ventana hizo en `startSelectionMode`.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/composables/useGameBridge.ts`, interfaz `SelectionMode`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

`SelectionMode` lleva `purpose: SelectionPurpose | null` y dos dimensiones de huella. Con eso se expresan
siete modos: la division de campo comparte el proposito `FIELD` con la creacion, y la tala por area no tiene
proposito en las reglas compartidas (apartado 1.3). Ademas el puente no puede llevar el campo, la parcela ni
las celdas del sujeto sobre el que actua la seleccion, que la ampliacion (GDD 20) y la division (GDD 21)
necesitan.

Cambio a aplicar, si se prefiere que el puente baste: anadir a `SelectionMode` un discriminante propio
(`mode?: string`) o los identificadores (`fieldId?`, `forestPlotId?`, `buildingType?`). No es urgente.

Mitigacion adoptada: `SelectionTool.setIntent(intent)` acepta la intencion completa y es lo que usa un panel;
la herramienta sigue escuchando `selection:mode` del puente y mapea los siete modos que si viajan por el.
`setIntent` publica ademas `selection:mode` de vuelta, con el proposito mas cercano de su familia, porque es
lo unico que hace que `WorldCamera.setPanWithPrimary(false)` se dispare y el boton primario quede libre para
la herramienta. Verificado en el navegador: sin ese reenvio la camara panea bajo el arrastre y la celda bajo
el cursor no cambia nunca, de modo que la seleccion se queda en una sola celda.

### 1.7 El foco en un campo de texto no deshabilita la entrada del lienzo

Aplicado antes de W7: `worldInputEnabled` es `modals.length === 0 && !textEntryFocused`, y el foco se
observa una sola vez sobre el documento con `focusin` y `focusout`.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/composables/useShellUi.ts`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

Ya recogido en el apartado 2.4 de `NOTES-w4d.md` para WASD. Se repite porque ahora afecta tambien a Enter y a
Escape: con un panel lateral abierto sin modal y el foco en un campo de texto, pulsar Enter confirmaria la
seleccion. La solucion propuesta alli es la misma: `useShellUi` debe emitir `input:enabled` en falso cuando el
foco esta en un campo de texto.

Mitigacion adoptada: la herramienta respeta `input:enabled` en todos sus caminos de entrada, teclado incluido,
de modo que el arreglo se aplica sin tocar este ambito.

### 1.6 Escape tiene dos duenos

Aplicado antes de W7, con la resolucion limpia que la nota recomienda: `useShellUi` antepone el lienzo en
la escalera de Escape mediante `setCanvasEscapeClaim`, de modo que si el lienzo consume la pulsacion, el
panel lateral no la ve.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/composables/useShellUi.ts`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

El apartado 1.5 de `NOTES-w3c.md` fija el orden de Escape en el shell: cierra el modal superior, luego la
bandeja de avisos, luego colapsa el panel lateral. La herramienta necesita Escape para cancelar la seleccion,
que es el gesto natural y el unico que el jugador va a probar.

Mitigacion adoptada: la herramienta solo atiende Escape cuando hay un modo activo, de modo que con la
herramienta en inspeccion el shell conserva su comportamiento intacto. Con un modo activo los dos actuan, y
el efecto visible es que una sola pulsacion cancela la seleccion y ademas colapsa el panel lateral. La
resolucion limpia es que `useShellUi` anteponga al lienzo en su escalera: si el lienzo tiene algo que
cancelar, Escape no baja al panel lateral.

### 1.5 `pages/game.vue` no monta el lienzo ni crea la herramienta

Resuelto por el agente de costura de W5-W.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/pages/game.vue`
Propietario del cambio: W3-C (cerrado), a aplicar por W7-A

El apartado 1.1 de `NOTES-w4d.md` ya dejo el montaje del lienzo pendiente. La herramienta de seleccion anade
tres lineas al mismo bloque, y el enlace del puerto con los almacenes, que es lo que no puede vivir dentro de
`app/game` por la regla de zona de ESLint:

```ts
const tool = createSelectionTool({
  world: scenes.world,
  overlay: scenes.overlay,
  bridge: gameBridge(),
  port: {
    onChanged: (snapshot) => {
      selection.replaceCells(snapshot.cells);
    },
    onConfirm: (snapshot) => {
      shell.openPanel(PANEL_OF_MODE[snapshot.intent.mode]);
    },
    onCancel: () => {
      selection.cancel();
    },
  },
});
// y en onBeforeUnmount: tool.destroy();
```

`PANEL_OF_MODE` es de quien escriba los paneles: `PURCHASE` abre `land-purchase`, `FIELD_CREATE` y
`FIELD_EXTEND` abren `field-create` y `field-edit`, `BUILDING` abre `building-placement`, y los tres
forestales abren los del tercer grupo.

Mitigacion adoptada: ninguna necesaria para el codigo, que es independiente de la pagina. La verificacion
manual de este ambito se hizo sobre `/perf`, que si monta el lienzo, adjuntando la herramienta a la escena
viva; el apartado 4.2 explica como.
