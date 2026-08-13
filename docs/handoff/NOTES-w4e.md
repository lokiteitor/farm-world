# NOTES-w4e

Agente de paneles de mundo y campos, fase W4 (reintento). Ambito escrito:
`frontend/app/components/panels/{cell-inspector,land-purchase,field-list,field-inspector,field-create,field-edit,legend,minimap,notices,settings}/**`
y este fichero. Ningun fichero fuera de esos once se ha modificado.

Los diez paneles que este agente poseia eran el stub que W3-C dejo con el registro. Los diez estan
sustituidos. Quedan como stub los seis restantes de la lista de W5-F, los seis de W6-D y los tres de
granja que el brief de este agente no asigna (apartado 3.1).

---

## 1. Pendiente para otros agentes

### 1.4 Los ajustes solo son alcanzables desde la leyenda

Categoria: decision de este ambito, con consecuencia para quien reordene la navegacion
Ficheros afectados: `frontend/app/components/panels/legend/LegendPanel.vue`

`settings` esta declarado en el registro con superficie `MODAL` y pestana `help`, pero
`PANEL_TABS.help.defaultPanel` es `legend` y `TabBar` solo abre el panel por omision de la
pestana: nadie llamaba a `openModal('settings')`, de modo que el panel existia y era inalcanzable.
La leyenda, que es el panel por omision de la pestana de ayuda, lleva ahora un boton «Ajustes».

Si W5-F o W7 prefieren una entrada en la barra superior, retirar el boton de la leyenda es una
linea; lo que no debe quedar es el estado anterior.

### 1.5 La geometria de un campo no llega por la respuesta de la mutacion

Categoria: observacion sobre el reductor, sin cambio pendiente
Ficheros afectados: `frontend/app/stores/sync.ts` (W3-C)

El resultado de `POST /api/fields` lleva `{ field, cells }`, y el reductor usa `cells` solo para
invalidar los chunks: la geometria se guarda cuando llega la trama `FIELD_UPSERTED`, que si la
lleva. Es correcto por el contrato y con el socket vivo converge, pero un cliente que acaba de
crear un campo sin socket no tiene su forma, y las tres operaciones de geometria validan contra
ella.

Resuelto dentro de este ambito sin tocar el reductor: `worldAccess.ensureFieldGeometry` pide
`GET /api/fields/:fieldId` cuando `cellsOf` esta vacio y aplica la respuesta con el mismo
`applyCells` que usa el reductor. Lo usan el inspector y el panel de geometria.

### 1.6 Propiedad de los directorios

Categoria: cambio en fichero de otro propietario
Ficheros afectados: `docs/ownership.md`, apartados 3.6 y 4.5
Propietario del cambio: el agente de cierre de la fase

El apartado 3.6 atribuye a W4-E los once paneles del primer grupo, y el registro declara
`owner: 'W4-E'` en once entradas. El brief de este agente asigna diez, y tres de ellos no estan
entre los once: `notices` figura como W6-D y `settings` como W5-F en el registro, mientras que
`farm-overview`, `building-placement` y `building-inspector` figuran como W4-E y no estan en este
brief. Apartado 3.1 de este fichero, con la tabla de correspondencia.

El registro esta congelado y no se ha tocado: la unica consecuencia es que el campo `owner` de
cinco entradas no describe quien las escribio. La tabla de `docs/ownership.md` es el sitio donde
cuadrarlo.

---

## 2. Contrato que este ambito publica

Tres modulos son compartidos por varios paneles. Este agente posee diez directorios de panel y
ninguno por encima de ellos, de modo que cada pieza compartida vive en el directorio de la materia
a la que pertenece, y no en un directorio nuevo que la tabla de propiedad no atribuiria a nadie.

| Pieza | Ruta | Uso |
|---|---|---|
| Vocabulario | `legend/vocabulary.ts` | Nombres y colores de terreno, propiedad, uso, los ocho estados del ciclo, las cuatro fases de arbol, operaciones, cultivos, edificios y condicion del suelo. Los colores salen de `game/textures/palette.ts` con `toCssHex`, nunca de un literal ni de una variable CSS con respaldo escrito a mano |
| Escala | `legend/units.ts` | `areaHectares`, `formatHectares`, `formatArea` y `scaleStatement`. La celda de 10 m del plan vive en `shared/config/world.ts` y aqui no se repite |
| Atajos | `legend/shortcuts.ts` | La tabla de gestos, con el modulo que enlaza cada uno |
| Acceso al mundo | `cell-inspector/worldAccess.ts` | `panelCellReader`, `readCell`, `readCells`, `ensureChunksFor`, `ensureFieldGeometry`, `startSelectionMode`, `stopSelectionMode`, `jumpToCell`, `judgeSelection`, `reasonLines`, `groupByReason` |
| Arnes de prueba | `cell-inspector/__tests__/harness.ts` | `bootMockClient`, `teardownMockClient`, `loadChunksFor`, `loadChunkRect`, `findUnownedGrass`, `settle` |
| Orden del listado | `field-list/ordering.ts` | `sortRows`, `matchesFilter`, `matchesText`, puras |
| Geometria del minimapa | `minimap/compose.ts` | `minimapWindow`, `windowChunks`, `chunkOffset`, `cellOfPoint`, `viewportRect`, puras |
| Preferencias | `settings/preferences.ts` | `loadPreferences`, `savePreferences`, `normalisePreferences`, `applyDocumentPreferences`, `LOD_THRESHOLD_CHOICES` |

Convenciones que conviene no reinventar:

- Ninguna regla de dominio se escribe en un panel. La compra es `canPurchase` y `cellPrice`, la
  seleccion es `validateToolSelection` de W4-G sobre `validateSelection` de `shared/rules`, el
  rendimiento es `finalYieldLiters`, las operaciones validas salen de `CROP_CYCLE_TRANSITIONS` y la
  contigüidad de la fusion es `isContiguous`. Un boton inhabilitado lleva como motivo la entrada de
  `VALIDATION_MESSAGES` del codigo por el que el servidor lo rechazaria.
- Todo importe se formatea con `useFormatting`, que envuelve `Money`. Ningun panel divide, redondea
  ni concatena un importe por su cuenta.
- `startSelectionMode` conserva una seleccion ya compuesta para el mismo proposito. Es lo que
  permite el flujo de la seccion 9.5 del plan: el jugador arrastra, confirma, y la confirmacion abre
  el panel que posee la peticion. Un panel que empezase seleccion nueva al montarse tiraria las
  celdas que venia a confirmar.
- Una celda cuyo chunk no ha llegado bloquea el envio aunque el veredicto sea verde
  (`SelectionVerdict.sendable`), que es la lectura conservadora de la seccion 7 del plan.
- `exactOptionalPropertyTypes` esta activo: el motivo de un boton se pasa con
  `v-bind="reasonProps"` y nunca como `:reason="x ?? undefined"`.

Correspondencia entre los modos de la herramienta de W4-G y los paneles, que el apartado 1.5 de
`NOTES-w4g.md` pide y que la pagina que monte el lienzo necesita para enlazar `onConfirm`:

```ts
const PANEL_OF_MODE = {
  PURCHASE: 'land-purchase',
  FIELD_CREATE: 'field-create',
  FIELD_EXTEND: 'field-edit',
  FIELD_SPLIT: 'field-edit',
  BUILDING: 'building-placement',
  FOREST_PLOT: 'forestry',
  FELL_AREA: 'forest-plot',
  CLEAR_LAND: 'forest-plot',
  INSPECT: 'cell-inspector',
} as const;
```

`field-edit` acepta ademas `mode: 'EXTEND' | 'SPLIT' | 'MERGE'` como prop, de modo que
`FIELD_EXTEND` y `FIELD_SPLIT` abren el mismo panel en su pestana.

---

## 3. Discrepancias detectadas

### 3.1 El brief y el registro no reparten los mismos paneles

| Panel | `registry.ts` declara | Brief de este agente | Escrito por |
|---|---|---|---|
| `cell-inspector`, `land-purchase`, `field-list`, `field-inspector`, `field-create`, `field-edit`, `legend`, `minimap` | W4-E | W4-E | W4-E |
| `notices` | W6-D | W4-E | W4-E |
| `settings` | W5-F | W4-E | W4-E |
| `farm-overview`, `building-placement`, `building-inspector` | W4-E | no asignados | sin escribir |

Se ha seguido el brief, que es la instruccion directa, y el registro no se ha tocado por estar
congelado. Consecuencia practica para W5-F y W6-D: `settings` y `notices` ya estan hechos y no
figuran en su lote real; los tres paneles de granja siguen siendo stub y su reasignacion no
corresponde a este agente.

### 3.2 La tesela de propiedad dibuja tres marcas para el mismo hecho

Ya anotado como 2.1 de `NOTES-w4d.md` y 2.2 de `NOTES-w4g.md`. Afecta a la leyenda, que es este
ambito: sobre suelo en propiedad conviven el tinte de la tesela `OWNED`, el borde que esa misma
tesela dibuja en sus cuatro lados con alfa 170, y el contorno de propiedad del conjunto.

La leyenda declara dos entradas y no tres: «En propiedad» con el color de `use.OWNED` y «Contorno
de propiedad» con `ui.outlineProperty`. El borde por celda no se nombra a proposito, porque no es
una marca distinta sino la misma repetida, y nombrarla obligaria a explicar al jugador una
redundancia del renderizador. Si W7 aplica la simplificacion que `NOTES-w4d.md` propone —que la
tesela conserve el tinte y pierda el borde— la leyenda no necesita ningun cambio.

### 3.3 El inspector de celda pide chunks por su cuenta

`POST /api/world/chunks` lo emitia hasta ahora solo el streamer de W4-D. El inspector de celda y el
panel de compra tambien lo hacen, a traves de `ensureChunksFor`, porque una celda cuyo chunk nunca
llego no tiene veredicto y el lienzo solo transmite lo que mira la camara. Va por la misma ruta y
al mismo punto de entrada del almacen (`applyChunkResult`), de modo que no hay un segundo
decodificador de la capa de modificaciones; lo unico que cambia es quien pregunta.

Riesgo conocido y acotado: el LRU del streamer podria desalojar un chunk que solo el panel
necesita. Solo desaloja lo que esta lejos de la camara, y la celda inspeccionada esta donde el
jugador mira, de modo que el caso no es alcanzable hoy. Se anota porque el dia que un panel
inspeccione algo remoto dejara de ser cierto.

### 3.4 El minimapa no genera el terreno de un chunk que no tiene

Deja en color de vacio los chunks que el cliente no ha cargado, en lugar de generarlos con la
semilla, que seria barato. Es deliberado: mezclar chunks con capa de modificaciones y chunks con
terreno pelado produciria una imagen en la que el jugador no puede distinguir «aqui no hay nada»
de «esto no lo he descargado». El recuento de chunks cargados esta impreso bajo el mapa por el
mismo motivo.

### 3.5 El servidor simulado y el reloj del cliente

`mockClock` ancla en el instante real de arranque del mundo de ejemplo, de modo que la
extrapolacion local queda donde debe. Conviene saberlo antes de escribir una prueba que fabrique
un ancla a mano: con `anchorRealMs = 0` y multiplicador 24 el reloj de juego se va unos cincuenta
mil anos al futuro y toda cuenta atras se lee como vencida.

---

## 4. Verificacion, salida real

### 4.1 Ordenes

| Orden | Salida |
|---|---|
| `make sync-types` | 53 ficheros a `backend/src/shared` y 53 a `frontend/app/shared` |
| `make typecheck` | **exit 0**. `tsc` en shared y backend sin salida; `vue-tsc --build --force` del cliente en verde |
| `make lint` | **exit 0**. `npx eslint .` sin hallazgos; Prettier: «All matched files use Prettier code style!» |
| `npx vitest run` sobre los diez directorios de este ambito (en `frontend/`) | **10 ficheros, 84 pruebas en verde**, 5,29 s |
| `npx vitest run` completo del cliente | **40 ficheros, 367 pruebas: 366 en verde y 1 en rojo**, la del apartado 1.1 |
| `npx vitest run` de `shared/` | 23 ficheros, 418 pruebas en verde |
| `make test-unit` | **Error 1**, por la unica prueba del apartado 1.1 |

`npx vue-tsc --noEmit` sigue terminando con codigo 0 sin comprobar nada, por lo que explica el
apartado 5 de `NOTES-w3d.md`: `frontend/tsconfig.json` es un fichero de solucion con `"files": []`.
La orden que comprueba de verdad es `npx vue-tsc --build --force`, y es la que se reporta.

Ruido de la suite que conviene no confundir con un fallo: jsdom escribe «Not implemented:
HTMLCanvasElement's getContext()» una vez por montaje del minimapa. El panel pregunta una sola vez
por el contexto 2D y recuerda la respuesta, de modo que son cuatro lineas y no una por repintado.

### 4.2 Recorrido manual en el navegador

Entorno: Chrome 151 sin cabeza, ventana 1440x900, servidor de desarrollo `npx nuxt dev --port 3111`
(3000, 3001 y 3100 estan ocupados en esta maquina), ruta `/game?mock=1&mockSession=1`, es decir el
camino real de datos: cliente REST tipado y reductor contra el servidor simulado. Los paneles se
condujeron desde el protocolo de depuracion, pulsando los mismos controles que pulsaria el jugador.
**Ningun error de consola durante todo el recorrido.**

| Panel | Como se llego | Lo que devolvio |
|---|---|---|
| `cell-inspector` | Pestana Mundo | «Celda 113, 105 · 100 m2», Terreno Pradera, Propiedad En propiedad, Uso Edificio, Pertenece a Garaje, Chunk 3, 3 · indice 305, Precio 120,00, Saldo 28.450,00. Compra inhabilitada con «Alguna de las celdas ya tiene propietario» |
| `land-purchase` | Boton «Comprar por area» del inspector | Tabla de precios de §115: Pradera 120,00, Bosque 70,00, Montana y Agua «No comprable». Compra inhabilitada con «La seleccion no contiene ninguna celda» |
| `field-list` | Pestana Campos | «2 campos · 420 celdas · 4,20 ha». Parcela norte 252 celdas · Trigo · 2,52 ha · Creciendo · 1 d 11 h; Parcela este 168 celdas · sin cultivo · 1,68 ha · Barbecho · «Arar en curso» · — |
| `field-inspector` | Clic en el renglon | Los ocho estados con Creciendo marcado, Cultivo Trigo, Suelo Arado, Siguiente transicion 1 d 11 h, Fertilidad 82,0 %, Malezas 36,0 %, Fertilizacion 0,0 %, Progreso 62,6 %, rendimiento previsto 16.964 L con base 22.680 L, fertilidad x0.87 y fertilizacion x1.00 |
| `field-edit` | Boton «Ampliar» del inspector | Modal con las tres pestanas «Ampliar §20 / Dividir §21 / Fusionar §22», resultado 2,52 ha, y en Fusionar la lista de candidatos con «Parcela este 168 celdas · Barbecho» y el motivo «Elige al menos un campo con el que fusionar» |
| `field-create` | Boton «Crear campo» del listado | Modal con nombre, granja, recuento, superficie, celdas validas y sin resolver, y el modo de creacion ya activo en el lienzo |
| `legend` | Superposicion, y pestana Ayuda | 64 muestras en seis grupos con sus secciones del GDD. La primera muestra computa `rgb(122, 156, 79)`, que es `0x7a9c4f`, exactamente `PALETTE.terrain.GRASS.base` |
| `minimap` | Superposicion | Lienzo de 224 x 224 pixeles, es decir 7 x 7 chunks a un pixel por celda, «Celda 113, 105 · 1 de 49 chunks cargados» |
| `notices` | Superposicion | «Transicion de campo hace 4 min — La parcela norte paso a crecimiento mientras no habia nadie mirando», con «Ir al campo» y «Descartar» |
| `settings` | Boton «Ajustes» de la leyenda | Las cinco preferencias, umbral de nivel de detalle con 0.3x / 0.4x / 0.6x / 0.85x, sensibilidad 1.00, y el bloque de mundo y conexion |

El servidor de desarrollo y el navegador sin cabeza se apagaron al terminar. Comprobado:
`http://localhost:3111` rechaza la conexion y el puerto 9222 no responde.

Lo que el recorrido no puede ejercitar: los tres paneles que dependen de una seleccion
(`land-purchase`, `field-create` y `field-edit`) se ven en su estado vacio, porque `pages/game.vue`
todavia no monta el lienzo ni crea la herramienta de seleccion (apartado 1.1 de `NOTES-w4d.md` y 1.5
de `NOTES-w4g.md`). Sus caminos completos —presupuesto autoritativo, compra con `expectedTotal`,
creacion, ampliacion, division y fusion— estan cubiertos por las pruebas de componente, que corren
contra el mismo servidor simulado y comprando la tierra de verdad antes de dibujar el campo.

### 4.3 Que cubre cada suite

| Suite | Pruebas | Que fija |
|---|---|---|
| `legend` | 11 | Los cuatro terrenos, los ocho estados y las cuatro fases estan nombrados; cada color es identico al de `PALETTE`; la escala (1 celda = 100 m2, 100 celdas = 1 ha, 250 celdas = 2,50 ha); la entrada a los ajustes |
| `cell-inspector` | 7 | Lectura de terreno, propiedad, uso y campo; precio con `cellPrice`; compra inhabilitada con `CELL_ALREADY_OWNED`; compra real que baja el saldo exactamente el precio; modo de compra por area; orden de camara; celda sin cargar |
| `land-purchase` | 6 | Tabla de precios sin seleccion; desglose por terreno que coincide con el presupuesto del servidor; motivos agregados y salto al conflicto; compra mixta negada hasta admitir la parcial; compra que cobra el total del presupuesto; envio negado con celdas sin resolver |
| `field-list` | 11 | Orden por superficie, por estado segun el ciclo y por tiempo restante con nulos al final; busqueda sin acentos; filtro de espera del jugador; renglones con celdas, hectareas y estado; apertura sincronizada de camara y panel |
| `field-inspector` | 9 | Los ocho estados con el actual marcado; las cuatro barras; el rendimiento de `finalYieldLiters`; la estimacion desde el ancla; arar ofrecido en barbecho ocioso; operaciones inhabilitadas con `FIELD_HAS_ACTIVE_TASK`; las tres operaciones de geometria; la orden de camara |
| `field-create` | 6 | Modo activado al montar y apagado al cerrar; sin seleccion no admite crear; creacion real sobre tierra comprada; `CELL_NOT_OWNED`; `SELECTION_NOT_CONTIGUOUS` con salto al conflicto; celdas sin resolver |
| `field-edit` | 8 | Las tres pestanas con su seccion; el modo del lienzo por pestana; ampliacion real que lleva el campo de 8 a 12 celdas; `SELECTION_NOT_ADJACENT`; division real en dos mitades contiguas; `FIELD_SPLIT_INCOMPLETE`; fusion incompatible; fusion sin candidato |
| `minimap` | 9 | Ventana impar centrada; chunks negativos dentro del buffer; el centro del cuadro es la celda central; recorte del visor; ancho minimo; recuento de chunks; seguimiento de la camara; clic que publica la celda; vuelta a la granja |
| `notices` | 6 | Avisos de la instantanea; traduccion por codigo en lugar del texto del cable; filtros; descarte individual y total; peticiones rechazadas con el mensaje de su codigo; salto al campo |
| `settings` | 11 | El umbral por omision es el del renderizador; una clave ilegible no arrastra a las demas; acotado de la sensibilidad; almacenamiento con basura; supervivencia a la recarga; movimiento reducido como atributo; las cinco preferencias; multiplicador en solo lectura; persistencia y repintado; restauracion; cierre de sesion |

---

## 5. Material para el ADR

Lo redacta el agente designado de la fase. Decisiones de este ambito que conviene que recoja.

1. **La leyenda lee la paleta y no las variables CSS.** El DOM del shell lee todo token como
   `var(--fw-x, respaldo)`, que es la decision de W3-C y es correcta para superficies y texto. La
   leyenda no: importa `PALETTE` y `toCssHex` de `game/textures/palette.ts`, porque un respaldo
   escrito a mano es una segunda paleta esperando a discrepar, y una leyenda que discrepa del
   lienzo es peor que no tener leyenda. La prueba compara las 64 muestras con los numeros del
   modulo que genera las texturas.
2. **Ninguna regla de dominio vive en un panel.** Los diez delegan en `shared/rules` o en las
   composiciones que W4-G documento, y el motivo de un control inhabilitado es la entrada de
   `VALIDATION_MESSAGES` del codigo por el que el servidor lo rechazaria. Es la mitad visible de la
   entrada de ADR sobre reglas compartidas entre cliente y servidor.
3. **Dos presupuestos, y el que manda es el del servidor.** La compra de tierra calcula el
   desglose local con `cellPrice` para que se mueva con el arrastre sin coste, pide
   `POST /api/land/quote` cuando el arrastre se asienta, y confirma enviando ese total como
   `expectedTotal`. El cliente no puede saber que alguien compro una celda de la seleccion hace un
   segundo, y un presupuesto caducado se rechaza en lugar de cobrarse en silencio.
4. **Una celda sin resolver no es invalida, es desconocida, y bloquea el envio.** Es la misma
   decision que W4-G tomo para el resaltado, aplicada a los cuatro paneles que envian una
   seleccion: `sendable` es un campo distinto de `validation.ok` justamente para que la diferencia
   no se pierda.
5. **El estado almacenado y el proyectado se muestran por separado cuando difieren.** Un campo cuyo
   trabajo materializador no ha corrido esta en su estado almacenado en la fila mientras la
   proyeccion ya avanzo, y el servidor valida contra la proyeccion. Ocultar la diferencia haria que
   el panel pareciese equivocado a quien lo comparase con la base de datos; mostrar solo el
   almacenado negaria una operacion que el servidor acepta.
6. **El minimapa es un segundo consumidor de la miniatura, no un segundo camino de datos.** Compone
   `chunkThumbnailPixels` sobre la misma cache decodificada que dibuja la escena, en un unico
   `ImageData` de 224 por 224 con un solo `putImageData`. No hay forma de que el minimapa y el
   lienzo discrepen sobre el aspecto de una region.
7. **Las preferencias del cliente no son estado de servidor y no van a Pinia.** Mismo razonamiento
   que `useShellUi` da para el suyo: nada de esto se reduce de una trama, nada es autoritativo, y
   meterlo en un almacen invitaria al reductor a escribirlo. Lo que si necesitan es sobrevivir a
   una recarga, y por eso se persisten con lectura defensiva: una clave ilegible toma su valor por
   omision en lugar de tirar las otras cuatro.
8. **Las piezas compartidas entre paneles viven en el directorio de su materia.** Este agente posee
   diez directorios de panel y ninguno por encima; un directorio nuevo bajo `panels/` seria una ruta
   que la tabla de propiedad no atribuye a nadie. De ahi que el vocabulario y la escala esten junto
   a la leyenda, que es donde se publican al jugador, y el acceso al mundo junto al inspector de
   celda, que es el panel que responde «que es esta celda».

---

## 6. Ficheros creados

```text
frontend/app/components/panels/legend/vocabulary.ts            nombres y colores, desde la paleta
frontend/app/components/panels/legend/units.ts                 escala del mundo y superficies
frontend/app/components/panels/legend/shortcuts.ts             la tabla de gestos
frontend/app/components/panels/legend/LegendPanel.vue          la leyenda y la entrada a los ajustes
frontend/app/components/panels/legend/__tests__/legend.test.ts
frontend/app/components/panels/cell-inspector/worldAccess.ts   rejilla, modos de seleccion y veredictos
frontend/app/components/panels/cell-inspector/CellInspectorPanel.vue
frontend/app/components/panels/cell-inspector/__tests__/harness.ts
frontend/app/components/panels/cell-inspector/__tests__/cell-inspector.test.ts
frontend/app/components/panels/land-purchase/LandPurchasePanel.vue
frontend/app/components/panels/land-purchase/__tests__/land-purchase.test.ts
frontend/app/components/panels/field-list/ordering.ts          orden y filtro, puros
frontend/app/components/panels/field-list/FieldListPanel.vue
frontend/app/components/panels/field-list/__tests__/field-list.test.ts
frontend/app/components/panels/field-inspector/FieldInspectorPanel.vue
frontend/app/components/panels/field-inspector/__tests__/field-inspector.test.ts
frontend/app/components/panels/field-create/FieldCreatePanel.vue
frontend/app/components/panels/field-create/__tests__/field-create.test.ts
frontend/app/components/panels/field-edit/FieldEditPanel.vue
frontend/app/components/panels/field-edit/__tests__/field-edit.test.ts
frontend/app/components/panels/minimap/compose.ts              geometria de la ventana, pura
frontend/app/components/panels/minimap/MinimapPanel.vue
frontend/app/components/panels/minimap/__tests__/minimap.test.ts
frontend/app/components/panels/notices/NoticesPanel.vue
frontend/app/components/panels/notices/__tests__/notices.test.ts
frontend/app/components/panels/settings/preferences.ts         preferencias persistidas
frontend/app/components/panels/settings/SettingsPanel.vue
frontend/app/components/panels/settings/__tests__/settings.test.ts
docs/handoff/NOTES-w4e.md                                      este fichero
```

Los diez `.vue` sustituyen al stub que W3-C dejo en su sitio; el resto son adiciones dentro de los
mismos directorios. `frontend/app/components/panels/registry.ts` no se ha tocado.

---

## 7. Ordenes que no se han ejecutado

Ninguna que mute el repositorio fuera del ambito asignado: sin `git`, sin `npm install`, sin
`docker compose`, sin `prisma`, sin construcciones de produccion. Se ejecutaron `make sync-types`,
`make typecheck`, `make lint`, `make test-unit`, `npx vue-tsc --build --force`, `npx vitest run`,
`npx nuxt dev --port 3111` y, sobre los diez directorios de este ambito unicamente,
`npx eslint --fix` y `npx prettier --write`. El servidor de desarrollo y el navegador sin cabeza
quedaron apagados.

## 8. Resuelto

Las notas aplicadas se conservan aqui con su numeracion original, porque otros documentos y
varios comentarios de codigo las citan por numero.

### 1.3 El panel lateral arranca vacio: la pestana inicial no abre su panel por omision

Aplicado antes de W7: el `onMounted` de `pages/game.vue` llama a `shell.selectTab('world')`.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/composables/useShellUi.ts` o `frontend/app/pages/game.vue`
Propietario del cambio: W3-C (cerrado), a aplicar por el agente de integracion

`activeTab` arranca en `world` y `sidePanel` en `null`, y solo `selectTab` abre el panel por
omision de una pestana. La consecuencia, comprobada en el navegador, es que al cargar `/game` el
panel lateral dice «Ningun panel abierto» con la pestana Mundo ya marcada como activa, y hay que
pulsar la pestana que ya esta seleccionada para que aparezca el inspector de celda.

Cambio a aplicar, una linea en el `onMounted` de `pages/game.vue`, junto a las que ya deciden que
modal abrir:

```ts
shell.selectTab('world');
```

Mitigacion adoptada: ninguna posible desde este ambito. Los diez paneles funcionan en cuanto se
pulsa una pestana.

### 1.2 El puente no declara ningun evento de preferencias de renderizado

Aplicado antes de W7: `GameBridgeEvents` declara `settings:changed` con `RenderPreferences`, el puente
retiene la ultima carga con `latest` y `WorldScene` la aplica tambien al crearse, que es lo que resuelve
el orden entre la escena y el panel.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/composables/useGameBridge.ts`, interfaz `GameBridgeEvents`
Propietario del cambio: W3-C (cerrado), a aplicar por el agente de integracion

Tres de las cinco preferencias del panel de ajustes son ajustes del lienzo —rejilla, contornos y
umbral de nivel de detalle, mas la sensibilidad del zoom— y ninguno de los quince eventos del
puente significa «las preferencias de renderizado han cambiado». Es el mismo hueco que W4-G
registro para `selection:confirmed` (`NOTES-w4g.md`, apartado 1.1).

Cambio a aplicar, cuatro lineas dentro de `GameBridgeEvents`:

```ts
/** Client rendering preferences changed. The scene applies what it owns. */
'settings:changed': {
  readonly gridVisible: boolean;
  readonly outlinesVisible: boolean;
  readonly lodThresholdZoom: number;
  readonly zoomSensitivity: number;
  readonly reducedMotion: boolean;
};
```

Y, del lado de la escena, tres interruptores que hoy no existen: `WorldScene` oculta la rejilla
por nivel de detalle y no por preferencia, no tiene modo de ocultar contornos, y
`NEAR_LOD_MIN_ZOOM` y la duracion de la transicion son constantes de `game/world/config.ts`.

Mitigacion adoptada: las cinco preferencias se persisten en `localStorage` bajo
`farm-world.preferences` y sobreviven a la recarga; el movimiento reducido se aplica de verdad,
como atributo `data-fw-reduced-motion` en el elemento raiz con su regla global; y un cambio publica
`world:reload`, que es el unico evento del puente congelado que significa «vuelve a dibujarlo
todo». `components/panels/settings/preferences.ts` expone `loadPreferences()` para que la pagina
que monte el lienzo se las pase a la escena en cuanto el evento exista.

### 1.1 La prueba del registro de paneles afirma que los veintitres son stubs

Aplicado antes de W7: `registry.test.ts` distingue los andamiajes por la presencia de `UiPendingPanel` en
su marcado, que es el cambio exacto que esta nota propone.

El texto original de la nota:

Categoria: cambio en fichero congelado
Ficheros afectados: `frontend/app/components/panels/__tests__/registry.test.ts`
Propietario del cambio: W3-C (cerrado), a aplicar por el agente de integracion

Es el unico rojo que deja esta fase, y es inevitable por construccion. La suite recorre
`PANEL_IDS` y exige de cada panel montado el texto «No implementado» y el identificador de su
agente responsable, que es lo que pinta `UiPendingPanel`. Un panel implementado no puede
satisfacerlo sin mentir.

No se ha tocado, por la misma razon por la que los tres agentes de backend de W4 no tocaron
`app.int.test.ts`: es el punto de encuentro de los tres agentes de paneles de W4, W5 y W6, y el
ultimo en escribirlo borraria a los otros dos. El cambio exacto, que sigue afirmando lo que la
prueba queria afirmar y ademas sirve para las fases siguientes:

```ts
import UiPendingPanel from '~/components/ui/UiPendingPanel.vue';

it('todos montan sin error de consola', async () => {
  for (const id of PANEL_IDS) {
    const component = await resolvePanel(id);
    const wrapper = mount(component as Parameters<typeof mount>[0]);
    // Un panel implementado ya no dice «No implementado»; lo que sigue siendo exigible es
    // que monte sin error y que el que siga siendo stub se declare como tal.
    if (wrapper.findComponent(UiPendingPanel).exists()) {
      expect(wrapper.text()).toContain(PANEL_REGISTRY[id].title);
      expect(wrapper.text()).toContain('No implementado');
      expect(wrapper.text()).toContain(PANEL_REGISTRY[id].owner);
    }
    wrapper.unmount();
  }
  expect(error).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});
```

Aviso para quien lo aplique: montar los paneles implementados sin Pinia sembrada emite peticiones
al transporte real. La suite ya llama a `setActivePinia(createPinia())` en `beforeEach`, y con eso
los paneles montan y se quedan en su estado vacio, que es lo que la prueba mide. Los diez paneles
de este agente se han comprobado en ese modo.
