# NOTES-w5w

Agente de costura del cliente, fase W5. Su encargo era que el juego se vea y se pueda jugar en el
navegador: hasta ahora `pages/game.vue` no instanciaba Phaser y el mundo solo aparecia en la ruta de
medicion.

Ambito escrito, y ningun fichero fuera de el salvo el que declara el apartado 4.1:

```text
frontend/app/pages/game.vue                     reescrito: monta el lienzo y cose los cuatro puertos
frontend/app/composables/useGameBridge.ts       evento settings:changed y su carga util
frontend/app/composables/useShellUi.ts          arbitraje de entrada y escalera de Escape
frontend/app/components/panels/registry.ts      superficie de building-placement
frontend/app/components/ui/UiButton.vue         firma de reason
frontend/app/mock/handlers.ts                   tres diferencias con el servidor real
frontend/app/game/world/WorldScene.ts           interruptores de rejilla y contornos, y las preferencias
frontend/app/game/world/camera.ts               umbral de detalle, sensibilidad y movimiento reducido
frontend/app/game/world/zoom.ts                 umbral como parametro de levelOfDetail
frontend/app/game/world/index.ts                una reexportacion
frontend/app/__tests__/mock-server.test.ts      dos afirmaciones (apartado 4.1)
docs/handoff/NOTES-w5w.md                       este fichero
```

---

## 1. Que se ha aplicado, y de que nota venia

| Punto | Origen | Estado |
|---|---|---|
| `game.vue` no llamaba a `createGame` | `NOTES-w4d.md` 1.1, `NOTES-w4g.md` 1.5, `NOTES-w4-cierre.md` 4, `NOTES-w4-cierre-2.md` 2 | Aplicado |
| `SelectionPort.onConfirm` sin enlazar y sin tabla de paneles | `NOTES-w4e.md` 2, `NOTES-w4f.md` 2.3 | Aplicado |
| El panel lateral arrancaba vacio | `NOTES-w4e.md` 1.3 | Aplicado, `shell.selectTab('world')` al montar |
| El puente no declaraba preferencias de renderizado | `NOTES-w4e.md` 1.2, `NOTES-w4-cierre-2.md` 3 | Aplicado, con tres interruptores nuevos en la escena y dos en la camara |
| `building-placement` declarado modal | `NOTES-w4f.md` 2.2, `NOTES-w4-cierre-2.md` 6 | Aplicado, `surface: SIDE` |
| El foco en un campo de texto no deshabilitaba el lienzo | `NOTES-w4d.md` 2.4, `NOTES-w4g.md` 1.7, `NOTES-w4-cierre.md` 7 | Aplicado |
| Escape con dos duenos | `NOTES-w4g.md` 1.6 | Aplicado, con arbitraje invertido |
| `UiButton.reason` no admite `undefined` | `NOTES-w4f.md` 4.5, `NOTES-w4-cierre-2.md` 7 | Aplicado |
| El simulado renombraba la unica granja | `NOTES-w4f.md` 4.1, `NOTES-w4-cierre-2.md` 5 | Aplicado |
| El simulado no rechazaba retirar un almacen lleno | `NOTES-w4f.md` 4.2, `NOTES-w4-cierre-2.md` 5 | Aplicado |
| El simulado valoraba dos veces una celda repetida | `NOTES-w4a.md` 1.3, `NOTES-w4-cierre.md` 6 | Aplicado |

### 1.1 La costura de la pagina

`pages/game.vue` monta el lienzo despues de que `net.bootstrap()` haya resuelto, en un sentido o en
otro. El orden importa y no es preferencia: el terreno no viaja, se genera localmente a partir de la
semilla y se cachea (plan 5.1), de modo que una escena construida antes de que llegue `world/info`
cachearia chunks dibujados con semilla cero y seguiria mostrandolos. Un arranque fallido tambien monta
el lienzo, porque el fallo ya se informa encima de el.

La pagina ata cuatro cosas que no pueden vivir en otro sitio, porque `app/game` no puede importar
`app/stores` y una escena de Phaser no puede llamar a `inject`:

1. `WorldSource`, que es el almacen de mundo visto por el puerto de W4-D. Es el mismo enlace que
   `pages/perf.vue` usa con `?source=store`.
2. `SelectionPort`, con `onChanged`, `onConfirm` y `onCancel`.
3. Las preferencias de renderizado, que el panel de ajustes persiste y la escena aplica.
4. La reclamacion de Escape.

La herramienta de seleccion no se crea junto al juego, y este es el detalle que costo una vuelta:
Phaser registra y arranca las escenas por su cuenta, y la herramienta registra objetos en la escena y
se suscribe a su emisor, que no existen hasta que `create` ha corrido. Construirla en la misma
sentencia que `createGame` lanza `TypeError: Cannot read properties of undefined (reading 'once')` y
la pagina entera responde 500. La espera es un sondeo con fecha limite, el mismo que `pages/perf.vue`
usa para el banco.

### 1.2 La tabla de correspondencia entre modo y panel

`PANEL_OF_MODE` cubre los nueve modos y su tipo lo exige, de modo que un modo anadido a
`game/selection/modes.ts` sin panel es un error de compilacion y no una confirmacion que no hace nada.

```text
INSPECT       cell-inspector
PURCHASE      land-purchase
FIELD_CREATE  field-create
FIELD_EXTEND  field-edit      props { fieldId, mode: 'EXTEND' }
FIELD_SPLIT   field-edit      props { fieldId, mode: 'SPLIT' }
FOREST_PLOT   forestry        (W6-D)
FELL_AREA     forest-plot     props { forestPlotId }   (W6-D)
CLEAR_LAND    forest-plot     props { forestPlotId }   (W6-D)
BUILDING      building-placement  props { type }
```

Lo que W6-D recibe ya esta preparado: los tres modos forestales abren sus paneles con la parcela sobre
la que actuan, y basta con que los paneles declaren `forestPlotId` como propiedad. Ningun panel del
lote de W5-F aparece en la tabla y ninguno debe: `machinery`, `workers`, `labor-pool`, `market` y
`starting-guide` se alcanzan desde su pestana y ninguno es el destino de un arrastre sobre el mapa.

La superficie no se decide en la pagina: se lee de `PANEL_REGISTRY[panelId].surface`, de modo que un
panel que cambia de superficie no obliga a tocar el punto de llamada. Y abrir lo que ya esta abierto no
hace nada, porque el panel que arranca un modo suele ser el que la confirmacion abre y reabrirlo
apilaria un segundo modal o remontaria el panel lateral en mitad del flujo que conduce.

`onChanged` mantiene ademas el proposito del almacen de seleccion en paso con el modo de la
herramienta. Es necesario: `startSelectionMode` conserva una seleccion ya compuesta solo cuando el
proposito coincide, y si no coincide empieza una nueva, que es tirar las celdas que el panel venia a
confirmar.

### 1.3 Las preferencias de renderizado

`GameBridgeEvents` declara `settings:changed` con las cinco preferencias, y el puente retiene su ultima
carga util. Retenerla no es un lujo: la escena se suscribe en su propio `create`, que corre despues de
las escenas de arranque, de modo que una pagina que publicase las preferencias al montar el lienzo las
publicaria a nadie. Ademas `createWorldScenes` acepta `preferences`, para que los primeros fotogramas
no se dibujen con los valores por omision y se corrijan despues.

Los tres interruptores que faltaban en la escena y los dos que faltaban en la camara:

| Preferencia | Donde se aplica |
|---|---|
| Rejilla | `WorldScene.drawGrid`, junto a la condicion de nivel de detalle |
| Contornos | `WorldScene.rebuildOutlinesIfNeeded`, con firma propia (`off`) para que apagarlos no espere a que cambie el conjunto visible |
| Umbral de nivel de detalle | `levelOfDetail(zoom, umbral)` en `zoom.ts` y `WorldCamera.setLodThreshold`; la escena reevalua el nivel al aplicarlas, porque mover el umbral puede cambiar el nivel sin que cambie el zoom |
| Sensibilidad del zoom | `WorldCamera`, como multiplicador sobre un paso discreto por muesca de rueda, con el resto acumulado para que un valor por debajo de uno signifique "mas lento" y no "nada" |
| Movimiento reducido | `WorldCamera`, suprime la transicion de zoom y el vuelo de camara; lo que ya estaba en el DOM como atributo sigue estando |

El panel de ajustes sigue publicando `world:reload`, que es el unico evento congelado con ese
significado y que el panel no puede cambiar por no ser suyo. La pagina escucha ese evento, relee las
preferencias persistidas y publica `settings:changed`. Es una vuelta de mas y es deliberada: deja el
panel intacto y pone la traduccion en el unico sitio que conoce a los dos lados.

### 1.4 El arbitraje de entrada y Escape

`worldInputEnabled` pasa de `modals.length === 0` a `modals.length === 0 && !textEntryFocused`. El foco
es un hecho del documento y se observa una sola vez, en el mismo modulo que consume el predicado, con
`focusin` y `focusout` en captura, que son los que burbujean. Cuenta como campo de texto un `input` que
no sea de tipo boton o rango, un `textarea` y cualquier elemento editable; un `select` no, porque
consume las teclas que necesita mientras esta abierto.

Escape tenia dos duenos y ahora tiene uno por pulsacion. La herramienta cancela desde su propia
vinculacion de teclado y no puede pedir permiso, porque es una escena de Phaser y no puede importar el
shell, de modo que el arbitraje se invierte: `useShellUi` expone `setCanvasEscapeClaim`, la pagina
registra que el lienzo reclama la tecla cuando hay un modo activo, y la escalera del shell pasa a ser
modal, lienzo, bandeja de avisos y panel lateral. El lienzo va despues del modal porque con un modal
abierto no tiene entrada.

### 1.5 El servidor simulado

Tres diferencias con el servidor real, mas dos consecuencias:

- `POST /api/farms` crea una segunda granja en lugar de renombrar la unica. Como `MockWorld` declara un
  unico `farm` y `mock/world.ts` es de otro agente, las granjas fundadas viven en un `WeakMap` de este
  modulo indexado por el mundo, y `GET /api/farms` y la instantanea listan todas. Una granja recien
  fundada llega con todo a cero, que es lo que hace el servidor real: fundar no cuesta ni ocupa suelo
  (ADR-0029).
- `DELETE /api/buildings/:buildingId` rechaza ademas cuando retirar la capacidad de un almacen dejaria
  las existencias sin sitio, con `BUILDING_NOT_EMPTY` y en el mismo orden en que el servidor real evalua
  las dos negativas.
- `POST /api/land/quote` y `POST /api/land/purchase` deduplican la seleccion antes de valorarla, y el
  tope se mide sobre las celdas distintas, que es el orden de `normaliseSelection` del modulo real.
- Consecuencia de la segunda: la capacidad de almacenamiento de la granja se recalcula desde los
  edificios en `recomputeFarm`, porque estaba fija y construir un segundo silo no la movia. El contenido
  sigue siendo de la granja y la capacidad de los edificios, que es la asimetria del plan 5.4.
- Construir y retirar un edificio emiten ahora `INVENTORY_UPSERTED`, porque los dos cambian la capacidad
  que las lineas de inventario publican.

---

## 2. Decisiones para el ADR

Las redacta el agente de cierre de la fase. Este agente no escribe en `docs/adr.md`.

1. **La costura del lienzo vive en la pagina, y es la unica que hay.** `app/game` no puede importar
   `app/stores` y una escena no puede inyectar: los cuatro puertos (datos del mundo, seleccion,
   preferencias y teclado) se atan en `pages/game.vue`. La consecuencia practica es que la pagina es el
   unico fichero del cliente que conoce a la vez el almacen y la escena, y eso es exactamente lo que la
   regla de zona busca.
2. **Las preferencias de renderizado viajan como evento con carga util retenida, no como recarga.** El
   panel persiste, la pagina traduce y la escena aplica. `world:reload` significa "vuelve a dibujarlo
   todo" e invalida todos los chunks; usarlo para cambiar el color de una rejilla es correcto y es caro.
   Retener la ultima carga util es lo que hace irrelevante el orden entre montar el lienzo y publicar
   las preferencias, que no es controlable porque las escenas de arranque generan antes todas las
   texturas.
3. **Escape con un unico dueno, resuelto invirtiendo el arbitraje.** El shell pregunta al lienzo si la
   pulsacion es suya y se aparta cuando lo es. La alternativa —que la herramienta pidiese permiso al
   shell— exige que una escena de Phaser importe el shell, que es la linea que el plan 9 dibuja.
4. **El lienzo pierde la entrada con el foco en un campo de texto.** La camara vincula WASD y la
   herramienta Enter y Escape sobre el documento, de modo que escribir el nombre de una parcela movia la
   camara y confirmaba la seleccion. El predicado sigue siendo uno solo; perder el arrastre mientras se
   escribe no cuesta nada, porque quien escribe no arrastra.
5. **La superficie de un panel es dato del registro y el punto de llamada la lee.** `building-placement`
   pasa a `SIDE` porque un modal deshabilita la entrada del lienzo, y ese panel acompana a un modo donde
   la huella tiene que seguir al cursor y el clic tiene que colocar: declarado modal, el panel
   deshabilitaba el gesto que existe para explicar. Comprobado en el navegador: con un modal abierto el
   visor lleva la clase `fw-input-blocked`.
6. **La tabla modo-panel es exhaustiva por tipo.** Confirmar no muta nada: publica una instantanea y el
   panel nombrado es quien pide al servidor con el presupuesto autoritativo. Que la tabla sea un
   `Record` sobre los nueve modos convierte un modo sin panel en un error de compilacion.

---

## 3. Verificacion, salida real

### 3.1 Ordenes

| Orden | Resultado |
|---|---|
| `npx vue-tsc --build --force` (en `frontend/`) | exit 0, sin salida |
| `npx vitest run` (cliente completo) | **51 ficheros, 512 pruebas, todas en verde**, 25,67 s |
| `make typecheck` | exit 0. `tsc` en `shared` y en `backend` sin salida; `vue-tsc --build --force` del cliente en verde |
| `make lint` | exit 0. `npx eslint .` sin hallazgos; Prettier: «All matched files use Prettier code style!» |
| `make test-unit` | Una ejecucion en rojo y las siguientes en verde. Apartado 4.2 |

Al empezar la sesion, la suite del cliente eran 40 ficheros y 368 pruebas; al terminar son 51 y 512,
porque otros agentes de W5 estan escribiendo a la vez. Las dos pruebas del apartado 4.1 son las unicas
que este agente ha tocado.

### 3.2 Recorrido en el navegador

Entorno: `npx nuxt dev --port 3111` (3000, 3001 y 3100 estan ocupados en esta maquina), Chrome 151 sin
cabeza con SwiftShader dirigido por el protocolo de depuracion, ventana 1440x900, ruta
`/game?mock=1&mockSession=1`, es decir el camino real de datos: cliente REST tipado y reductor contra el
servidor simulado. Se apagaron el servidor de desarrollo y el navegador al terminar.

**Ningun error de consola en todo el recorrido.** Lo unico que la consola emite es el aviso del servidor
simulado («[mock] servidor simulado activo: ninguna peticion sale a la red») y el informativo de Vue
sobre `<Suspense>`.

| Comprobacion | Lo que se observo |
|---|---|
| El mundo se pinta | Lienzo de 1080x669 dentro del visor, terreno con sus cuatro tipos, la granja con sus cuatro edificios, los dos campos y sus contornos. El marcador de posicion de W3-C desaparece |
| Panel lateral al cargar | «Inspector de celda · Celda 113, 105 · 100 m2», terreno Pradera, uso Edificio, pertenece a Garaje, precio 120,00, saldo 28.450,00. Ya no arranca vacio |
| Desplazamiento | Arrastre con el boton central: el minimapa pasa de «Celda 113, 105 · 20 de 49 chunks cargados» a «Celda 126, 113 · 25 de 49» |
| Teclado | Manteniendo `d` pulsada la camara pasa de la celda 113 a la 139 |
| Zoom | Tres muescas de rueda hacia fuera y tres hacia dentro, con los chunks cargados subiendo a 49 de 49 y volviendo |
| Contador de depuracion (F3) | «FPS 16 · Zoom 1.00 · Detalle cerca · Chunks 20 cargados, 6 visibles · Draw calls 1 / 130 · 6905 cuadrilateros · Contornos 512 segmentos · Streaming 0.1 ms». Apartado 4.3 |
| Seleccion por arrastre | Con el modo de compra activo, un arrastre de 11 x 7 celdas produce «77 celdas · 1680.00 $ · 63 no validas» junto al cursor, relleno por celda con su veredicto y contorno del conjunto |
| El panel que la seleccion abre | Con el panel de Campos abierto y el modo de compra activo, un arrastre de 24 celdas sobre suelo libre y Enter abren «Compra de tierra»: 18 celdas de pradera 2.160,00 y 6 de bosque 420,00, presupuesto local 2.580,00 y presupuesto del servidor 2.580,00 |
| Escape, primera pulsacion | El modo se cancela (el panel pasa a «0 celdas · Seleccionar») y el panel lateral **no** se pliega |
| Escape, segunda pulsacion | Sin modo activo, el shell recupera la tecla y pliega el panel lateral |
| Rejilla | Desmarcarla en Ajustes y cerrar el modal: la rejilla desaparece del lienzo y `localStorage` guarda `"gridVisible":false` |
| Contornos | Igual: los contornos de campo y de propiedad desaparecen y los edificios conservan su tesela |
| Umbral de nivel de detalle | Con el umbral en 0,85 y una muesca de rueda hacia fuera (zoom 0,7), el lienzo pasa a la miniatura por chunk. Con el umbral por omision de 0,4, ese mismo zoom se dibuja con el detalle cercano |
| Foco en un campo de texto | Con el cursor en el buscador del panel de campos, el visor lleva `fw-input-blocked` y mantener `d` pulsada no mueve la camara; al salir del campo, la clase desaparece |
| Modal y entrada del lienzo | Con el modal de ajustes abierto, `fw-input-blocked` es cierto; al cerrarlo, falso. Es el motivo del cambio de superficie de `building-placement` |

---

## 4. Discrepancias detectadas

### 4.1 Dos pruebas del servidor simulado afirmaban el comportamiento que habia que corregir

Categoria: cambio en fichero de otro agente
Ficheros afectados: `frontend/app/__tests__/mock-server.test.ts`
Propietario: W3-C (cerrado)

Las dos pruebas de mutacion usaban `POST /api/farms` como ejemplo y afirmaban que la granja pasaba a
llamarse como el jugador pidio, que es exactamente la diferencia con el servidor real que el brief manda
corregir. Se han ajustado las tres afirmaciones afectadas: el recuento sube a dos, la granja creada
lleva el nombre pedido y la primera conserva el suyo. No se ha tocado nada mas del fichero y las otras
seis pruebas siguen intactas.

Se declara aqui porque el fichero no esta en el ambito de este agente. Se edito porque la alternativa
era dejar `make test-unit` en rojo, que la instruccion prohibe expresamente, y porque ningun otro agente
de esta fase escribe en ese fichero.

### 4.2 La suite del cliente falla de forma intermitente mientras otros agentes escriben

Categoria: observacion de proceso, sin cambio pendiente

`make test-unit` fallo una vez en `app/components/panels/__tests__/registry.test.ts` y volvio a estar en
verde en la ejecucion siguiente sin tocar nada. Esa prueba monta los veintitres paneles por importacion
diferida, de modo que un panel guardado a medias por otro agente durante la ejecucion la rompe. No es un
defecto del registro ni de los paneles: es el coste de ejecutar la suite completa mientras la fase esta
viva. La ejecucion de referencia de este agente es la del apartado 3.1.

Lo mismo ocurrio con `make typecheck`, que fallo en `app/game/entities/EntityLayer.ts` a las 15:53 y
estaba en verde a las 15:54; el fichero es de W5-D y estaba siendo escrito.

### 4.3 El contador de depuracion se dibuja debajo del panel de leyenda

Categoria: solape de interfaz, sin cambio aplicado
Ficheros afectados: `frontend/app/game/overlay/OverlayScene.ts` (W4-D) o la posicion de las
superposiciones en `AppShell.vue` (W3-C)

El contador de F3 se dibuja en (8, 8) de la camara de superposicion, que es la esquina superior
izquierda del lienzo, y ahi es donde el shell coloca el panel de leyenda. En `/game` el contador es
invisible salvo que se pliegue la leyenda; en `/perf` no hay leyenda y se ve. Costo un rato averiguar
que F3 si funciona, de modo que conviene registrarlo. Lo barato es dibujarlo en la esquina opuesta.

### 4.5 La camara publicaba el salto al origen por el puente y ahora lo recibe al construirse

Categoria: cambio de comportamiento dentro del ambito, sin pendiente

`game.vue` emitia `camera:goto` con la celda de origen en `onMounted`. Con el lienzo montado despues,
ese evento se publicaria antes de que exista la escena, de modo que la celda de origen viaja ahora como
`home` de `createWorldScenes`, que ademas es la celda a la que vuelve «A la granja». El evento sigue
existiendo y lo usan el minimapa, el inspector y el salto al primer conflicto.

### 4.6 Lo que este agente no ha tocado y sigue pendiente

- `SelectionMode` del puente sigue sin llevar el sujeto (`fieldId`, `forestPlotId`, `buildingType`), de
  modo que un modo armado desde un panel llega a la herramienta sin el campo sobre el que actua
  (`NOTES-w4g.md` 1.2). No bloquea: los paneles conservan su propio veredicto con `judgeSelection`, y la
  consecuencia visible es que la herramienta no puede confirmar por su cuenta una ampliacion ni una
  division. Si W7 aplica el cambio, `propsOfMode` de `game.vue` ya lee esos tres campos de la intencion.
- No existe `selection:confirmed` en el puente (`NOTES-w4g.md` 1.1). El puerto lo cubre y lleva ademas
  la instantanea completa, que el evento no podria llevar sin arrastrar tipos de dominio al puente.
- El borde por celda de la tesela `OWNED` sigue compitiendo con el contorno de propiedad
  (`NOTES-w4d.md` 2.1).

---

## 5. Ordenes que no se han ejecutado

Ninguna que mute el repositorio fuera del ambito asignado: sin `git`, sin `npm install`, sin
`docker compose`, sin `prisma`, sin construcciones de produccion. Se ejecutaron `make sync-types`,
`make typecheck`, `make lint`, `make test-unit`, `npx vue-tsc --build --force`, `npx vitest run`,
`npx nuxt dev --port 3111` y Chrome sin cabeza contra el protocolo de depuracion. El servidor de
desarrollo y el navegador quedaron apagados antes de cerrar esta nota.

## Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 4.4 `nuxt.config.ts` sigue fijando el puerto 3001

Aplicado por W7-A (integracion).

El texto original de la nota:

Categoria: cambio en fichero congelado
Propietario: W7-A

Cuarta tanda de verificacion que necesita `--port 3111`. Ya recogido en `NOTES-w3d` 1,
`NOTES-w3-cierre` 6, `NOTES-w4d` 1.4 y `NOTES-w4-cierre` 9.
